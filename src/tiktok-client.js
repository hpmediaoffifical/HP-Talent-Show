// TikTok LIVE client wrapper — kết nối TikTok LIVE theo @username,
// emit các sự kiện { connected, disconnected, chat, gift, like, member,
// follow, share, social, roomUser, error } cho main process.
//
// Dùng tiktok-live-connector (zerodytrash). Không cần OAuth, không cần
// streamer authorize. Đây là reverse-engineering library — TikTok có thể
// đổi internal API, cần update theo lib.

const { EventEmitter } = require('events');

// Rút một message dễ đọc từ lỗi bất kỳ. tiktok-live-connector v2 KHÔNG emit
// Error chuẩn — nó emit object { info, exception } (xem client.js handleError).
// Nếu chỉ làm `err.message || String(err)` thì với object này ta ra "[object Object]".
function errMessage(err) {
  if (!err) return 'Lỗi kết nối không xác định';
  if (typeof err === 'string') return err;
  // Shape của lib v2: { info, exception }
  if (err.info || err.exception) {
    const inner = err.exception && (err.exception.message || err.exception.info || err.exception.name);
    return [err.info, inner].filter(Boolean).join(': ') || 'Lỗi kết nối';
  }
  if (err.message) return String(err.message);
  try {
    const s = JSON.stringify(err);
    if (s && s !== '{}') return s;
  } catch {}
  return String(err);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch có TIMEOUT. fetchProfile được gọi rất nhiều (bù avatar cho từng người xem trong
// chat/gift + tự lấy lại avatar creator/nhóm lúc mở app). fetch() mặc định KHÔNG có timeout:
// nếu TikTok/tikwm treo hoặc bị chặn, các request dồn lại vô hạn làm nghẽn tiến trình main
// (chậm IPC → giao diện đơ). Giới hạn mỗi request tối đa ~7s rồi bỏ qua để không dồn ứ.
async function fetchWithTimeout(url, opts = {}, ms = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// UA desktop Chrome đầy đủ — TikTok phục vụ TRANG THẬT (kèm JSON hồ sơ) cho request giống trình
// duyệt thật; UA cụt hay bị trả trang thử-thách JS rỗng.
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Ghép một message dễ hiểu (tiếng Việt) từ lỗi connect cuối cùng, gợi ý cách xử lý.
function friendlyConnectError(err, username) {
  const raw = errMessage(err);
  const low = raw.toLowerCase();
  // Host không LIVE / sai username
  if (/not.*live|offline|user_not_found|isn['’]?t live|not currently|room is finished|status.*[:=]\s*4/.test(low)) {
    return `@${username} hiện KHÔNG LIVE (hoặc sai username). Hãy chắc chắn host đang phát trực tiếp rồi thử lại.`;
  }
  // Bị TikTok chặn lấy Room ID (SIGI_STATE/captcha/all sources)
  if (/sigi_state|captcha|blocked|room id|all sources|liveroom/.test(low)) {
    return 'Không lấy được Room ID từ TikTok (bị chặn tạm thời).\n'
      + `• Kiểm tra @${username} có đang LIVE thật không.\n`
      + '• Thử KẾT NỐI lại sau vài giây (tránh VPN/mạng chập chờn).\n'
      + '• Vẫn lỗi: vào CÀI ĐẶT nhập Session ID để kết nối ổn định hơn.';
  }
  // Euler/sign hết quyền
  if (/euler|sign|permission/.test(low)) {
    return 'Nguồn dự phòng (Euler/Sign) từ chối. Thử lại sau ít phút, hoặc nhập Session ID trong CÀI ĐẶT.';
  }
  return raw;
}

let _lib = null;
function loadLib() {
  if (_lib) return _lib;
  // Ngẫu nhiên hoá device/location fingerprint để giảm khả năng bị TikTok chặn
  // hàng loạt theo một fingerprint cố định. config.js đọc các env này 1 lần lúc require.
  if (!process.env.RANDOMIZE_TIKTOK_DEVICE) process.env.RANDOMIZE_TIKTOK_DEVICE = 'true';
  if (!process.env.RANDOMIZE_TIKTOK_LOCATION) process.env.RANDOMIZE_TIKTOK_LOCATION = 'true';
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
    this._seenGiftMsgIds = new Set(); // msgId quà đã phát (chống nhận đôi cùng 1 message)
  }

  isConnected() { return this.connected; }

  async connect(rawUsername, opts = {}) {
    if (this.connecting) throw new Error('Đang trong quá trình kết nối, vui lòng đợi.');
    if (this.connected) await this.disconnect();
    const username = String(rawUsername || '').trim().replace(/^@/, '');
    if (!username) throw new Error('Vui lòng nhập TikTok username (vd: @username).');

    this.connecting = true;
    this.username = username;
    // Số lần thử: SIGI_STATE fail rồi API/Euler bị chặn tạm thời rất hay là hiccup
    // thoáng qua — thử lại vài lần (fingerprint đã random) thường là kết nối được.
    const maxAttempts = Math.max(1, Number(opts.retries ?? 3));
    let lastErr = null;
    try {
      const lib = loadLib();
      const { TikTokLiveConnection, WebcastEvent } = lib;
      if (!TikTokLiveConnection) throw new Error('Thư viện tiktok-live-connector v2 không export TikTokLiveConnection.');

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const connectionOpts = {
          processInitialData: opts.processInitialData ?? false,
          enableExtendedGiftInfo: true,
        };
        // Eulerstream sign key (optional, dùng cho production để ổn định hơn)
        if (opts.signApiKey) connectionOpts.signApiKey = opts.signApiKey;
        // Session id (optional, cho phép connect tới private/age-gated + ổn định hơn)
        if (opts.sessionId) {
          connectionOpts.sessionId = opts.sessionId;
          connectionOpts.ttTargetIdc = opts.ttTargetIdc || 'useast2a';
        }

        const conn = new TikTokLiveConnection(username, connectionOpts);
        this.connection = conn;
        // Trong lúc connect, lib phát 'error' cho MỖI bước fallback (SIGI→API→Euler)
        // dù cuối cùng có thể thành công. Nuốt các cảnh báo đó, chỉ dựa vào việc
        // conn.connect() resolve/throw để quyết định kết quả thật.
        this._connectPhase = true;
        this._wireEvents(conn, WebcastEvent || {});

        try {
          const state = await conn.connect();
          this._connectPhase = false;
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
          lastErr = err;
          this._connectPhase = false;
          // Dọn connection hỏng trước khi thử lại để không rò rỉ listener/socket.
          try { await conn.disconnect(); } catch {}
          this.connection = null;
          if (attempt < maxAttempts) await sleep(1200 * attempt);
        }
      }

      // Hết lượt thử — báo lỗi cuối cùng, rõ ràng.
      this.connected = false;
      this.connection = null;
      const msg = friendlyConnectError(lastErr, username);
      this.emit('error', { message: msg, fatal: true });
      throw new Error(msg);
    } finally {
      this.connecting = false;
    }
  }

  async disconnect() {
    this._seenGiftMsgIds.clear();
    if (this.connection) {
      try { await this.connection.disconnect(); } catch {}
      this.connection = null;
    }
    if (this.connected) this.emit('disconnected', { username: this.username });
    this.connected = false;
  }

  // Lấy profile info từ username (không cần đang LIVE). Trả về { uniqueId, nickname, avatar, found }
  async fetchProfile(rawUsername, opts = {}) {
    const username = String(rawUsername || '').trim().replace(/^@/, '');
    if (!username) throw new Error('Username trống.');
    // Gộp từ NHIỀU nguồn (mỗi nguồn nay hay khuyết avatar/UID): tikwm (user.id = ID nhận quà) →
    // oembed (nickname) → TRANG @user (avatar + userId + nickname, dùng cookie Session ID nếu có).
    let nickname = '', avatar = '', userId = '', title = '', source = 'fallback', found = false;

    let apiProfile = {};
    try { apiProfile = await fetchTikwmProfile(username); } catch {}
    if (apiProfile.id) userId = String(apiProfile.id);
    if (apiProfile.nickname) nickname = apiProfile.nickname;
    if (apiProfile.avatar) avatar = apiProfile.avatar;
    if (apiProfile.nickname || apiProfile.avatar) { found = true; source = apiProfile.source || 'tikwm'; }

    if (!avatar || !nickname) {
      try {
        const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent('https://www.tiktok.com/@' + username)}`;
        const res = await fetchWithTimeout(oembedUrl, { headers: { 'User-Agent': UA_DESKTOP } });
        if (res.ok) {
          const data = await res.json();
          if (!nickname && data.author_name) { nickname = data.author_name; found = true; if (source === 'fallback') source = 'oembed'; }
          if (!avatar && data.thumbnail_url) { avatar = data.thumbnail_url; found = true; }
          if (!title && data.title) title = data.title;
        }
      } catch {}
    }

    // Nguồn CHÍNH cho avatar + userId khi tikwm bị chặn. Cần khi thiếu bất kỳ trường quan trọng nào.
    if (!avatar || !userId || !nickname) {
      try {
        const page = await fetchTikTokProfilePage(username, opts);
        if (page) {
          if (!userId && page.userId) userId = String(page.userId);
          if (!avatar && page.avatar) avatar = page.avatar;
          if (!nickname && page.nickname) nickname = page.nickname;
          if (!title && page.title) title = page.title;
          if (page.avatar || page.nickname || page.userId) { found = true; if (source === 'fallback' || source === 'oembed') source = page.source; }
        }
      } catch {}
    }

    return { uniqueId: username, nickname: nickname || username, avatar, title, userId, found, source };
  }

  _wireEvents(conn, EV) {
    // tiktok-live-connector v2 hỗ trợ both: conn.on('chat', ...) (string)
    // và conn.on(WebcastEvent.CHAT, ...). Dùng string để tương thích broad nhất.
    conn.on('disconnected', () => {
      this.connected = false;
      this.emit('disconnected', { username: this.username });
    });
    // Lỗi runtime khi ĐANG LIVE thường không fatal (hiccup giải mã/websocket, lib
    // tự phục hồi). Chỉ coi là fatal nếu lúc đó đã mất kết nối thật.
    conn.on('error', (err) => {
      // Đang trong pha connect: đây là các cảnh báo fallback nội bộ của lib
      // (SIGI_STATE fail → thử API → thử Euler). KHÔNG nổi banner đỏ; kết quả
      // thật do conn.connect() resolve/throw quyết định trong connect().
      if (this._connectPhase) return;
      this.emit('error', { message: errMessage(err), fatal: !this.connected });
    });
    conn.on('streamEnd', () => this.emit('streamEnd', { username: this.username }));

    conn.on('chat', (d) => this.emit('chat', shapeChat(d)));
    // CHỐNG NHẬN ĐÔI: mỗi message TikTok có msgId riêng. Khi kết nối vừa có WebSocket vừa có
    // HTTP polling (hoặc lib phát lại gói), CÙNG một msgId đến hai lần → quà bị tính x2.
    // Bỏ qua msgId đã thấy; quà tặng riêng biệt luôn có msgId khác nhau nên không mất quà.
    conn.on('gift', (d) => {
      const ev = shapeGift(d);
      // Sức chứa 3000: LIVE đông có thể qua 500 message chỉ trong ít phút, mà gói phát lại đôi khi
      // về muộn hơn thế → cắt ở 500 là để lọt. Chuỗi msgId rất nhẹ nên 3000 gần như không tốn gì.
      // LƯU Ý: msgId RỖNG thì không chặn được ở đây (không có định danh). KHÔNG dựng khoá thay thế
      // từ uniqueId+giftId+repeatCount — các nhịp combo "từng nhịp" trùng nhau y hệt một cách HỢP LỆ,
      // chặn theo khoá đó sẽ NUỐT quà thật. Lớp chặn cho trường hợp đó nằm ở comboDelta (bia mộ
      // `closed` trong src/gift-combo.js), không phải ở đây.
      if (ev.msgId) {
        if (this._seenGiftMsgIds.has(ev.msgId)) return;
        this._seenGiftMsgIds.add(ev.msgId);
        if (this._seenGiftMsgIds.size > 3000) {
          this._seenGiftMsgIds.delete(this._seenGiftMsgIds.values().next().value);
        }
      }
      this.emit('gift', ev);
    });
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
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return {};
  const data = await res.json();
  const user = data?.data?.user;
  if (!user) return {};
  return {
    id: user.id || user.uid || '',
    nickname: user.nickname || '',
    avatar: user.avatarLarger || user.avatarMedium || user.avatarThumb || '',
    followerCount: user.followerCount ?? user.stats?.followerCount ?? 0,
    followingCount: user.followingCount ?? user.stats?.followingCount ?? 0,
    heartCount: user.heartCount ?? user.stats?.heartCount ?? 0,
    signature: user.signature || '',
    source: 'tikwm',
  };
}

// Bóc hồ sơ (userId + avatar + nickname) từ HTML trang @user. Ưu tiên khối JSON nhúng
// (__UNIVERSAL_DATA_FOR_REHYDRATION__ / SIGI_STATE) vì có ĐỦ userId lẫn avatar; rơi về regex nếu thiếu.
function parseProfileHtml(html) {
  let user = null;
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i);
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      user = data?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.user || null;
    } catch {}
  }
  if (!user) {
    const m2 = html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/i);
    if (m2) {
      try {
        const d = JSON.parse(m2[1]);
        const um = d?.UserModule?.users || {};
        user = Object.values(um)[0] || null;
      } catch {}
    }
  }
  if (user) {
    return {
      userId: String(user.id || user.uid || ''),
      uniqueId: user.uniqueId || '',
      nickname: user.nickname || '',
      avatar: user.avatarLarger || user.avatarMedium || user.avatarThumb || '',
      source: 'profile-page',
    };
  }
  // Fallback regex (JSON đổi khoá hoặc bị rút gọn): vẫn cố lấy avatar + id + nickname.
  const avatarEsc = html.match(/"avatarLarger"\s*:\s*"([^"]+)"/)?.[1]
    || html.match(/"avatarMedium"\s*:\s*"([^"]+)"/)?.[1]
    || html.match(/"avatarThumb"\s*:\s*"([^"]+)"/)?.[1]
    || '';
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] || '';
  return {
    userId: html.match(/"id"\s*:\s*"(\d{6,25})"/)?.[1] || '',
    uniqueId: '',
    nickname: decodeJsonString(html.match(/"nickname"\s*:\s*"([^"]+)"/)?.[1] || ''),
    avatar: decodeJsonString(avatarEsc) || decodeHtmlAttr(ogImage),
    source: 'profile-page',
  };
}

async function fetchTikTokProfilePage(username, opts = {}) {
  const headers = {
    'User-Agent': UA_DESKTOP,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
  };
  // Cookie ĐĂNG NHẬP (Session ID người dùng, dùng chung với kết nối LIVE) → TikTok trả TRANG THẬT
  // có đủ JSON hồ sơ thay vì trang thử-thách JS rỗng (nguyên nhân "Tải" không ra avatar/UID).
  const sid = opts.sessionId && String(opts.sessionId).trim();
  if (sid) headers['Cookie'] = `sessionid=${sid}; tt-target-idc=${opts.ttTargetIdc || 'useast2a'}`;
  const url = `https://www.tiktok.com/@${encodeURIComponent(username)}`;
  const res = await fetchWithTimeout(url, { headers }, 10000);
  if (!res.ok) return {};
  const html = await res.text();
  const parsed = parseProfileHtml(html);
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] || '';
  parsed.title = cleanTikTokTitle(decodeHtmlAttr(ogTitle));
  return parsed;
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
  if (a && Array.isArray(a.url) && a.url[0]) return a.url[0];   // v2: profilePicture.url = [...]
  if (a && typeof a.url === 'string') return a.url;
  if (user.profilePicture?.url?.[0]) return user.profilePicture.url[0];
  if (user.profilePicture?.urlList?.[0]) return user.profilePicture.urlList[0];
  if (user.profilePicture?.urls?.[0]) return user.profilePicture.urls[0];
  if (user.profilePicture?.url_list?.[0]) return user.profilePicture.url_list[0];
  if (user.userDetails?.profilePicture?.url?.[0]) return user.userDetails.profilePicture.url[0];
  if (user.userDetails?.profilePicture?.urlList?.[0]) return user.userDetails.profilePicture.urlList[0];
  if (user.userDetails?.profilePicture?.urls?.[0]) return user.userDetails.profilePicture.urls[0];
  if (user.userDetails?.profilePicture?.url_list?.[0]) return user.userDetails.profilePicture.url_list[0];
  if (user.userDetails?.avatarLarger) return user.userDetails.avatarLarger;
  if (user.userDetails?.avatarMedium) return user.userDetails.avatarMedium;
  if (user.userDetails?.avatarThumb) return user.userDetails.avatarThumb;
  if (user.userDetails?.profilePictureUrls?.[0]) return user.userDetails.profilePictureUrls[0];
  if (user.userDetails?.profilePictureUrls?.length) return user.userDetails.profilePictureUrls[0];
  if (user.user?.profilePictureUrl) return user.user.profilePictureUrl;
  if (user.user?.avatarThumb) return pickAvatar(user.user);
  return '';
}

function shapeUser(d) {
  const user = d?.user || d || {};
  const details = user.userDetails || d?.userDetails || {};
  return {
    uniqueId: user.uniqueId || user.unique_id || details.uniqueId || user.displayId || user.user?.uniqueId || '',
    nickname: user.nickname || user.nickName || details.nickname || user.user?.nickname || user.uniqueId || '',
    userId: user.userId || user.user_id || user.id || details.userId || details.user_id || '',
    // Gift v2 đôi khi đặt thông tin avatar ở event cha thay vì d.user. Thử cả hai
    // shape để gifter PK Đôi không mất ảnh chỉ vì payload đổi vị trí field.
    avatar: pickAvatar(user) || pickAvatar(d),
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
  // Connector v2 trả gift_type ở cả event cha lẫn nested gift tùy loại quà. Bỏ sót
  // snake_case ở event cha làm combo bị coi là quà thường và cộng lại gói chốt.
  const giftType = Number(
    d?.giftType
    ?? d?.gift_type
    ?? d?.gift?.giftType
    ?? d?.gift?.gift_type
    ?? d?.giftDetails?.giftType
    ?? d?.giftDetails?.gift_type
    ?? 0
  ) || 0;
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
  // MÃ LƯỢT COMBO của TikTok (WebcastGiftMessage.groupId): mỗi LƯỢT tặng combo có một mã riêng,
  // mọi nhịp của cùng lượt mang cùng mã. Đây là cách CHẮC CHẮN nhất để biết "lượt tặng mới" hay
  // "chuỗi cũ chạy tiếp" — không phải đoán theo repeatCount (xem bẫy ở src/gift-combo.js).
  const groupRaw = d?.groupId ?? d?.group_id ?? '';
  const comboGroupId = groupRaw && String(groupRaw) !== '0' ? String(groupRaw) : '';
  // NGƯỜI NHẬN quà trong LIVE nhóm = co-host được tặng, nằm ở toMemberId (ID số) + toMemberNickname (tên).
  // CẢNH BÁO: toUserId / giftExtra.anchorId là ID HOST phòng (KHÔNG đổi theo người nhận) → KHÔNG dùng.
  // toMemberId rỗng/"0" = quà chung cho host (không nhắm co-host cụ thể).
  const memberIdRaw = d?.toMemberId ?? d?.toMemberIdInt ?? '';
  const recipientMemberId = memberIdRaw && String(memberIdRaw) !== '0' ? String(memberIdRaw) : '';
  const recipientMemberName = d?.toMemberNickname || '';
  return {
    ...u,
    // ID message của TikTok — dùng để chặn cùng một gói quà đến hai lần (xem _seenGiftMsgIds).
    msgId: String(d?.common?.msgId ?? d?.msgId ?? d?.common?.msg_id ?? ''),
    recipientMemberId,
    recipientMemberName,
    giftId: String(d?.giftId ?? d?.gift_id ?? d?.gift?.id ?? d?.gift?.gift_id ?? d?.giftDetails?.giftId ?? ''),
    giftName: d?.giftName || d?.giftDetails?.giftName || d?.gift?.name || d?.gift?.giftName || '',
    giftIcon: giftImage,
    repeatCount,
    repeatEnd,
    comboGroupId,
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
