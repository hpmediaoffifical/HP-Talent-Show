// TikTok LIVE client wrapper — kết nối TikTok LIVE theo @username,
// emit các sự kiện { connected, disconnected, chat, gift, like, member,
// follow, share, social, roomUser, error } cho main process.
//
// Dùng tiktok-live-connector (zerodytrash). Không cần OAuth, không cần
// streamer authorize. Đây là reverse-engineering library — TikTok có thể
// đổi internal API, cần update theo lib.

const { EventEmitter } = require('events');

let _lib = null;
function loadLib() {
  if (_lib) return _lib;
  // tiktok-live-connector v2 là TS, được publish dưới dạng CJS exports.
  // Một số builds cũ export TikTokLiveConnection; build 2.x cũng có WebcastEvent.
  _lib = require('tiktok-live-connector');
  return _lib;
}

class TikTokClient extends EventEmitter {
  constructor() {
    super();
    this.connection = null;
    this.username = '';
    this.roomInfo = null;
    this.connected = false;
    this.connecting = false;
  }

  isConnected() { return this.connected; }

  async connect(rawUsername, opts = {}) {
    if (this.connecting) throw new Error('Đang trong quá trình kết nối, vui lòng đợi.');
    if (this.connected) await this.disconnect();
    const username = String(rawUsername || '').trim().replace(/^@/, '');
    if (!username) throw new Error('Vui lòng nhập TikTok username (vd: @username).');

    this.connecting = true;
    this.username = username;
    try {
      const lib = loadLib();
      const { TikTokLiveConnection, WebcastEvent } = lib;
      if (!TikTokLiveConnection) throw new Error('Thư viện tiktok-live-connector v2 không export TikTokLiveConnection.');

      const connectionOpts = {
        processInitialData: opts.processInitialData ?? false,
        enableExtendedGiftInfo: true,
      };
      // Eulerstream sign key (optional, dùng cho production để ổn định hơn)
      if (opts.signApiKey) connectionOpts.signApiKey = opts.signApiKey;
      // Session id (optional, cho phép connect tới private/age-gated)
      if (opts.sessionId) {
        connectionOpts.sessionId = opts.sessionId;
        connectionOpts.ttTargetIdc = opts.ttTargetIdc || 'useast2a';
      }

      const conn = new TikTokLiveConnection(username, connectionOpts);
      this.connection = conn;
      this._wireEvents(conn, WebcastEvent || {});

      const state = await conn.connect();
      this.connected = true;
      this.roomInfo = {
        roomId: state?.roomId || state?.room_id || null,
        username,
        nickname: state?.roomInfo?.owner?.nickname || state?.roomInfo?.owner?.nickName || username,
        avatar: pickAvatar(state?.roomInfo?.owner) || '',
        title: state?.roomInfo?.title || '',
        viewerCount: state?.roomInfo?.userCount ?? state?.roomInfo?.user_count ?? 0,
      };
      this.emit('connected', this.roomInfo);
      return this.roomInfo;
    } catch (err) {
      this.connected = false;
      this.connection = null;
      this.emit('error', { message: err?.message || String(err) });
      throw err;
    } finally {
      this.connecting = false;
    }
  }

  async disconnect() {
    if (this.connection) {
      try { await this.connection.disconnect(); } catch {}
      this.connection = null;
    }
    if (this.connected) this.emit('disconnected', { username: this.username });
    this.connected = false;
  }

  // Lấy profile info từ username (không cần đang LIVE). Trả về { uniqueId, nickname, avatar, found }
  async fetchProfile(rawUsername) {
    const username = String(rawUsername || '').trim().replace(/^@/, '');
    if (!username) throw new Error('Username trống.');
    let best = { uniqueId: username, nickname: username, avatar: '', found: false, source: 'fallback' };
    try {
      const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent('https://www.tiktok.com/@' + username)}`;
      const res = await fetch(oembedUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const data = await res.json();
        best = {
          uniqueId: username,
          nickname: data.author_name || username,
          avatar: data.thumbnail_url || '',
          title: data.title || '',
          found: true,
          source: 'oembed',
        };
        if (best.avatar) return best;
      }
    } catch {}
    try {
      const api = await fetchTikwmProfile(username);
      if (api.nickname || api.avatar) {
        return {
          uniqueId: username,
          nickname: api.nickname || best.nickname || username,
          avatar: api.avatar || best.avatar || '',
          title: best.title || '',
          found: true,
          source: api.source,
        };
      }
    } catch {}
    try {
      const page = await fetchTikTokProfilePage(username);
      if (page.nickname || page.avatar) {
        return {
          uniqueId: username,
          nickname: page.nickname || best.nickname || username,
          avatar: page.avatar || best.avatar || '',
          title: page.title || best.title || '',
          found: true,
          source: page.source,
        };
      }
    } catch {}
    return best;
  }

  _wireEvents(conn, EV) {
    // tiktok-live-connector v2 hỗ trợ both: conn.on('chat', ...) (string)
    // và conn.on(WebcastEvent.CHAT, ...). Dùng string để tương thích broad nhất.
    conn.on('disconnected', () => {
      this.connected = false;
      this.emit('disconnected', { username: this.username });
    });
    conn.on('error', (err) => this.emit('error', { message: err?.message || String(err) }));
    conn.on('streamEnd', () => this.emit('streamEnd', { username: this.username }));

    conn.on('chat', (d) => this.emit('chat', shapeChat(d)));
    conn.on('gift', (d) => this.emit('gift', shapeGift(d)));
    conn.on('like', (d) => this.emit('like', shapeLike(d)));
    conn.on('member', (d) => this.emit('member', shapeUser(d)));
    conn.on('follow', (d) => this.emit('follow', shapeUser(d)));
    conn.on('share', (d) => this.emit('share', shapeUser(d)));
    conn.on('social', (d) => this.emit('social', shapeUser(d)));
    conn.on('subscribe', (d) => this.emit('subscribe', shapeUser(d)));
    conn.on('roomUser', (d) => this.emit('roomUser', {
      viewerCount: d?.viewerCount ?? d?.userCount ?? 0,
      topGifters: d?.topGifters || d?.topViewers || [],
    }));
  }
}

async function fetchTikwmProfile(username) {
  const url = `https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(username)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return {};
  const data = await res.json();
  const user = data?.data?.user;
  if (!user) return {};
  return {
    nickname: user.nickname || '',
    avatar: user.avatarLarger || user.avatarMedium || user.avatarThumb || '',
    followerCount: user.followerCount ?? user.stats?.followerCount ?? 0,
    followingCount: user.followingCount ?? user.stats?.followingCount ?? 0,
    heartCount: user.heartCount ?? user.stats?.heartCount ?? 0,
    signature: user.signature || '',
    source: 'tikwm',
  };
}

async function fetchTikTokProfilePage(username) {
  const url = `https://www.tiktok.com/@${encodeURIComponent(username)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) return {};
  const html = await res.text();
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
    || '';
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
    || '';
  const avatarEsc = html.match(/"avatarLarger"\s*:\s*"([^"]+)"/)?.[1]
    || html.match(/"avatarMedium"\s*:\s*"([^"]+)"/)?.[1]
    || html.match(/"avatarThumb"\s*:\s*"([^"]+)"/)?.[1]
    || '';
  const nicknameEsc = html.match(/"nickname"\s*:\s*"([^"]+)"/)?.[1] || '';
  const avatar = decodeJsonString(avatarEsc) || decodeHtmlAttr(ogImage);
  const nickname = decodeJsonString(nicknameEsc) || cleanTikTokTitle(decodeHtmlAttr(ogTitle));
  return { avatar, nickname, title: decodeHtmlAttr(ogTitle), source: 'profile-page' };
}

function decodeJsonString(value) {
  if (!value) return '';
  try { return JSON.parse('"' + value.replace(/"/g, '\\"') + '"'); } catch { return value.replace(/\\u002F/g, '/').replace(/\\\//g, '/'); }
}

function decodeHtmlAttr(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanTikTokTitle(value) {
  return String(value || '').replace(/\s+on TikTok.*$/i, '').replace(/\s+\|\s+TikTok.*$/i, '').trim();
}

function pickAvatar(user) {
  if (!user) return '';
  // TikTok user object có thể có nhiều biến thể field
  const a = user.profilePictureUrl || user.profilePicture || user.avatarThumb || user.avatar_thumb || user.avatarMedium || user.avatarLarger
    || user.avatarUrl || user.avatar || user.displayAvatar || user.user?.avatarUrl || user.user?.avatar;
  if (typeof a === 'string') return a;
  if (a && Array.isArray(a.url_list) && a.url_list[0]) return a.url_list[0];
  if (a && Array.isArray(a.urlList) && a.urlList[0]) return a.urlList[0];
  if (a && Array.isArray(a.urls) && a.urls[0]) return a.urls[0];
  if (user.profilePicture?.urls?.[0]) return user.profilePicture.urls[0];
  if (user.profilePicture?.url_list?.[0]) return user.profilePicture.url_list[0];
  if (user.userDetails?.profilePictureUrls?.[0]) return user.userDetails.profilePictureUrls[0];
  if (user.userDetails?.profilePictureUrls?.length) return user.userDetails.profilePictureUrls[0];
  if (user.user?.profilePictureUrl) return user.user.profilePictureUrl;
  if (user.user?.avatarThumb) return pickAvatar(user.user);
  return '';
}

function shapeUser(d) {
  const user = d?.user || d || {};
  return {
    uniqueId: user.uniqueId || user.unique_id || user.userDetails?.uniqueId || user.displayId || user.user?.uniqueId || '',
    nickname: user.nickname || user.nickName || user.userDetails?.nickname || user.user?.nickname || user.uniqueId || '',
    userId: user.userId || user.user_id || user.id || '',
    avatar: pickAvatar(user),
    level: user.level ?? user.userLevel ?? user.followInfo?.level ?? d?.level ?? d?.userLevel ?? '',
    followRole: user.followRole ?? d?.followRole ?? '',
    followerCount: user.followerCount ?? user.followInfo?.followerCount ?? d?.followerCount ?? '',
    followingCount: user.followingCount ?? user.followInfo?.followingCount ?? d?.followingCount ?? '',
    heartCount: user.heartCount ?? user.stats?.heartCount ?? d?.heartCount ?? '',
    signature: user.signature || user.bioDescription || d?.signature || '',
    raw: undefined,
  };
}

function shapeChat(d) {
  const u = shapeUser(d);
  return {
    ...u,
    comment: d?.comment || d?.content || '',
    timestamp: d?.timestamp || Date.now(),
  };
}

function shapeGift(d) {
  const u = shapeUser(d);
  // Trong v2, có giftDetails.giftImage.giftPictureUrl
  const giftImage = d?.giftDetails?.giftImage?.giftPictureUrl
    || d?.giftImage?.giftPictureUrl
    || d?.giftPictureUrl
    || d?.gift?.image?.url_list?.[0]
    || d?.gift?.icon?.url_list?.[0]
    || d?.giftDetails?.image?.url_list?.[0]
    || d?.extendedGiftInfo?.image?.url_list?.[0]
    || '';
  const diamond = d?.gift?.diamond_count ?? d?.diamondCount ?? d?.gift?.diamondCount ?? d?.giftDetails?.diamondCount ?? 0;
  const giftType = Number(d?.giftType ?? d?.gift?.gift_type ?? d?.giftDetails?.giftType ?? 0) || 0;
  const repeatCount = Number(
    d?.repeatCount
    ?? d?.repeat_count
    ?? d?.comboCount
    ?? d?.combo_count
    ?? d?.gift?.repeat_count
    ?? d?.gift?.repeatCount
    ?? d?.giftDetails?.repeatCount
    ?? 1
  ) || 1;
  const repeatEnd = !!(d?.repeatEnd ?? d?.repeat_end ?? d?.gift?.repeat_end ?? d?.gift?.repeatEnd);
  return {
    ...u,
    giftId: String(d?.giftId ?? d?.gift_id ?? d?.gift?.id ?? d?.gift?.gift_id ?? d?.giftDetails?.giftId ?? ''),
    giftName: d?.giftName || d?.giftDetails?.giftName || d?.gift?.name || d?.gift?.giftName || '',
    giftIcon: giftImage,
    repeatCount,
    repeatEnd,
    giftType,
    shouldProcess: giftType !== 1 || repeatEnd,
    diamondCount: Number(diamond) || 0,
    timestamp: d?.timestamp || Date.now(),
  };
}

function shapeLike(d) {
  const u = shapeUser(d);
  return {
    ...u,
    likeCount: Number(d?.likeCount ?? d?.likes ?? 1),
    totalLikeCount: Number(d?.totalLikeCount ?? d?.totalLikes ?? 0),
    timestamp: d?.timestamp || Date.now(),
  };
}

module.exports = { TikTokClient };
