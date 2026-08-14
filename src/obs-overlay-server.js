// OBS Overlay Server — localhost-only HTTP + SSE server.
// Mỗi module (PK Đôi, BXH, Score) có endpoint riêng + state riêng;
// renderer cho mỗi overlay tự kết nối qua EventSource và render real-time.
//
// Bảo mật: chỉ accept request từ 127.0.0.1 / ::1, token bắt buộc cho mọi
// data endpoint (trừ static asset .js/.css cần load trước khi có token).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fileURLToPath } = require('url');

// Host dùng để SINH chuỗi URL overlay cho người dùng copy (không ảnh hưởng bind/bảo mật — xem this.linkHost).
// - Mặc định '127.0.0.1' cho OBS: loopback thuần, bất tử, không phụ thuộc gì.
// - Chế độ TikTok Studio: đổi sang hostname vì TikTok LIVE Studio TỪ CHỐI URL IP trần
//   (http://127.0.0.1:port → "Hãy nhập URL chính xác") nhưng CHẤP NHẬN hostname. Hostname này map về
//   127.0.0.1 qua hosts file ("127.0.0.1 hpstudio.obs") nên vẫn 100% cục bộ, độ trễ 0, không cert, không DNS ngoài.
// Server LUÔN bind '127.0.0.1' và chỉ nhận request loopback; request tới hpstudio.obs phân giải về 127.0.0.1
// nên vẫn qua ải. Đổi host chỉ đổi chuỗi hiển thị/copy — OBS cũ đã cấu hình 127.0.0.1 không bị ảnh hưởng.
const TIKTOK_STUDIO_HOST = 'hpstudio.obs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.apng': 'image/apng', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// Video NHẠC DANCE: OBS Browser Source (http origin) KHÔNG load được src file:// → phải stream
// file cục bộ qua chính overlay server (có hỗ trợ Range để tua/stream mượt). Chỉ nhận đuôi video an toàn.
const VIDEO_MIME = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v', '.ogv': 'video/ogg', '.mkv': 'video/x-matroska',
};

class ObsOverlayServer {
  constructor({ root, port = 18282, token, onLog, cacheDir, normalizeAvatar, onLuckyWheelSpin, onCardFlip, onDanceVideoEnded, onInteractSplit, assetVersion } = {}) {
    this.root = root;
    this.port = port;
    this.token = token || crypto.randomBytes(18).toString('hex');
    // Host để SINH URL copy. Mặc định loopback (OBS). setLinkMode(true) đổi sang hostname cho TikTok Studio.
    this.linkHost = '127.0.0.1';
    // Phiên bản asset (= version app). Phát kèm SSE để overlay tự reload khi ĐỔI phiên bản (sau cập nhật).
    this.assetVersion = String(assetVersion || '');
    this.onLog = onLog || (() => {});
    this.onLuckyWheelSpin = typeof onLuckyWheelSpin === 'function' ? onLuckyWheelSpin : null;
    this.onCardFlip = typeof onCardFlip === 'function' ? onCardFlip : null;
    // Video NHẠC DANCE phát xong (hoặc lỗi) trên overlay → báo về để hàng đợi hiệu ứng bước tiếp.
    this.onDanceVideoEnded = typeof onDanceVideoEnded === 'function' ? onDanceVideoEnded : null;
    // Overlay TƯƠNG TÁC + QUÀ: người dùng kéo vạch chia (Quà/Bình luận) trên overlay/Review →
    // báo về để lưu tỉ lệ vào config (ghi nhớ vị trí qua các lần mở).
    this.onInteractSplit = typeof onInteractSplit === 'function' ? onInteractSplit : null;
    // MỘT CỔNG RIÊNG cho MỖI loại overlay. Lý do: OBS chạy mọi Browser Source trong CÙNG một
    // tiến trình CEF, mà Chromium giới hạn 6 KẾT NỐI đồng thời / host:port. Mỗi overlay giữ 1 luồng
    // SSE thường trực → khi tổng số nguồn > 6 (user có ~15), các nguồn "đến sau" (vd Vòng quay)
    // KHÔNG xin được kết nối → tải trang trắng/không chạy JS. Tách mỗi loại sang 1 cổng loopback
    // riêng = mỗi loại có "ngân sách 6 kết nối" riêng, không tranh nhau. (Đã xác minh bằng netstat:
    // obs-browser-page giữ đúng 6 kết nối tới 18282, Vòng quay bị đói.)
    // NHẠC DANCE có 3 overlay độc lập, mỗi cái 1 cổng riêng (né trần 6 kết nối/host của CEF).
    this.portOffsets = { 'pk-duo': 0, 'pk-duo-fx': 1, 'pk-group': 2, 'ranking': 3, 'score': 4, 'sticker': 5, 'mvp-honor': 6, 'lucky-wheel': 7, 'gift-menu': 8, 'mission-trio': 9, 'card-flip': 10, 'card-flip-fx': 11, 'dance-video-1': 12, 'dance-video-2': 13, 'dance-video-3': 14, 'interact': 15, 'kc-duo': 16, 'like-wall': 17, 'pk-group-fx': 18 };
    this.portCount = 19;
    this.danceChannels = ['webm1', 'webm2', 'webm3'];
    this.servers = [];
    this._boundPorts = new Set();
    this.pkDuoClients = new Set();
    this.kcDuoClients = new Set();
    this.pkGroupClients = new Set();
    this.rankingClients = new Set();
    this.scoreClients = new Set();
    this.stickerClients = new Set();
    this.mvpHonorClients = new Set();
    this.luckyWheelClients = new Set();
    this.giftMenuClients = new Set();
    this.missionTrioClients = new Set();
    this.likeWallClients = new Set();
    this.cardFlipClients = new Set();
    // Overlay TƯƠNG TÁC + QUÀ: 1 tập client, state = config, + 2 ring buffer sự kiện gần đây
    // (chat / quà) để phát lại cho client MỚI (OBS mở/reload không bị trống).
    this.interactClients = new Set();
    this.interactChatBuf = [];
    this.interactGiftBuf = [];
    this.interactSeq = 0;
    // Mỗi kênh NHẠC DANCE 1 tập client + 1 state riêng.
    this.danceVideoClients = { webm1: new Set(), webm2: new Set(), webm3: new Set() };
    this.pkDuoState = {};
    this.kcDuoState = {};
    this.pkGroupState = {};
    this.rankingState = {};
    this.scoreState = {};
    this.stickerState = {};
    this.mvpHonorState = {};
    this.luckyWheelState = {};
    this.giftMenuState = {};
    this.missionTrioState = {};
    this.likeWallState = {};
    this.cardFlipState = {};
    this.interactState = {}; // config overlay TƯƠNG TÁC + QUÀ
    this.danceVideoState = { webm1: {}, webm2: {}, webm3: {} };
    // ẨN/HIỆN overlay theo "cảnh": bản đồ {khoá cảnh (= tên sự kiện SSE) -> bool}. false = ẩn.
    // App điều khiển; overlay tự làm TRONG SUỐT (opacity:0) khi khoá của nó = false. KHÔNG đụng engine
    // (video/animation vẫn chạy, sự kiện vẫn bắn) — chỉ đổi hiển thị trên OBS/TikTok Studio.
    this.visState = {};
    this.heartbeatTimer = null;
    // Cache avatar theo "danh tính ảnh" = PATH của URL (bỏ query chữ ký/expires): URL avatar TikTok
    // đã chứa hash ảnh trong path nên đổi ảnh = đổi path. Nhờ vậy URL ký lại (đổi x-signature/x-expires)
    // vẫn HIT cache → phục vụ được cả khi URL HẾT HẠN hoặc TikTok chặn fetch. LƯU RA ĐĨA để tồn tại
    // qua lần khởi động lại và qua giai đoạn TikTok chặn → avatar "tải 1 lần là dùng mãi".
    this._avatarCache = new Map();    // pathKey -> { ctype, buf }
    this._avatarInflight = new Map(); // pathKey -> Promise
    this._avatarDir = cacheDir || path.join(root || '.', 'config', 'avatar-cache');
    this._normalizeAvatar = typeof normalizeAvatar === 'function' ? normalizeAvatar : null;
    try { fs.mkdirSync(this._avatarDir, { recursive: true }); } catch {}
  }

  async start() {
    if (this.servers.length) return;
    // Cổng chính (this.port) BẮT BUỘC phải bind được; các cổng phụ nếu kẹt thì bỏ qua
    // và loại overlay đó tự lùi về cổng chính (_portFor).
    for (let i = 0; i < this.portCount; i++) {
      const p = this.port + i;
      const server = http.createServer((req, res) => this._handle(req, res));
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(p, '127.0.0.1', resolve);
        });
        this.servers.push(server);
        this._boundPorts.add(p);
      } catch (e) {
        try { server.close(); } catch {}
        if (i === 0) throw e; // không có cổng chính thì overlay vô dụng → ném lỗi như cũ
        this.onLog(`OBS overlay: cổng phụ ${p} bận, bỏ qua (một loại overlay sẽ dùng lại cổng chính)`);
      }
    }
    // Keep OBS's embedded browser connected while the OBS window is backgrounded.
    // Some machines/network stacks otherwise leave an idle localhost SSE stream stale.
    this.heartbeatTimer = setInterval(() => this._heartbeat(), 5000);
    this.onLog(`OBS overlay server: http://127.0.0.1:${this.port}-${this.port + this.portCount - 1}`);
  }

  // Cổng riêng cho từng loại overlay (né trần 6 kết nối/host của CEF). Nếu cổng phụ không bind được
  // thì lùi về cổng chính để URL vẫn hoạt động.
  _portFor(kind) {
    const p = this.port + (this.portOffsets[kind] || 0);
    return this._boundPorts.has(p) ? p : this.port;
  }

  stop() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    const danceSets = this.danceChannels.map(ch => this.danceVideoClients[ch]);
    for (const set of [this.pkDuoClients, this.kcDuoClients, this.pkGroupClients, this.rankingClients, this.scoreClients, this.stickerClients, this.mvpHonorClients, this.luckyWheelClients, this.giftMenuClients, this.missionTrioClients, this.likeWallClients, this.cardFlipClients, this.interactClients, ...danceSets]) {
      for (const res of set) { try { res.end(); } catch {} }
      set.clear();
    }
    for (const server of this.servers) { try { server.close(); } catch {} }
    this.servers = [];
    this._boundPorts.clear();
  }

  // Chế độ link copy: false = OBS (127.0.0.1), true = TikTok Studio (hostname map hosts→127.0.0.1).
  // Chỉ đổi chuỗi URL sinh ra cho người dùng copy; KHÔNG đụng bind/bảo mật (vẫn loopback-only).
  setLinkMode(tiktok) { this.linkHost = tiktok ? TIKTOK_STUDIO_HOST : '127.0.0.1'; return this.linkHost; }
  isTikTokLinkMode() { return this.linkHost === TIKTOK_STUDIO_HOST; }

  getPkDuoUrl() { return `http://${this.linkHost}:${this._portFor('pk-duo')}/pk-duo?token=${encodeURIComponent(this.token)}`; }
  getKcDuoUrl() { return `http://${this.linkHost}:${this._portFor('kc-duo')}/kc-duo?token=${encodeURIComponent(this.token)}&v=1`; }
  getPkDuoFxUrl() { return `http://${this.linkHost}:${this._portFor('pk-duo-fx')}/pk-duo-fx?token=${encodeURIComponent(this.token)}`; }
  getPkGroupUrl() { return `http://${this.linkHost}:${this._portFor('pk-group')}/pk-group?token=${encodeURIComponent(this.token)}`; }
  // Overlay FX toàn màn hình PK Nhóm — dùng CHUNG stream /pk-group-events, cổng riêng để né trần 6 kết nối/host của CEF.
  getPkGroupFxUrl() { return `http://${this.linkHost}:${this._portFor('pk-group-fx')}/pk-group-fx?token=${encodeURIComponent(this.token)}&v=1`; }
  getRankingUrl() { return `http://${this.linkHost}:${this._portFor('ranking')}/ranking?token=${encodeURIComponent(this.token)}`; }
  getScoreUrl() { return `http://${this.linkHost}:${this._portFor('score')}/score?token=${encodeURIComponent(this.token)}`; }
  // 2 nguồn OBS TÁCH KIỂU (ép cứng qua ?layout=) — dùng chung state/SSE /score-events (cùng điểm/đồng hồ),
  // nhưng mỗi link render CỐ ĐỊNH 1 phong cách để bật/tắt con mắt + đặt vị trí độc lập trong OBS.
  getScoreBarUrl() { return `${this.getScoreUrl()}&layout=bar`; }
  getScoreCardUrl() { return `${this.getScoreUrl()}&layout=card`; }
  getScoreTimerUrl() { return `${this.getScoreUrl()}&layout=timer`; }
  getStickerUrl() { return `http://${this.linkHost}:${this._portFor('sticker')}/sticker?token=${encodeURIComponent(this.token)}`; }
  getMvpHonorUrl() { return `http://${this.linkHost}:${this._portFor('mvp-honor')}/mvp-honor?token=${encodeURIComponent(this.token)}`; }
  getLuckyWheelUrl() { return `http://${this.linkHost}:${this._portFor('lucky-wheel')}/lucky-wheel?token=${encodeURIComponent(this.token)}&v=15`; }
  getGiftMenuUrl() { return `http://${this.linkHost}:${this._portFor('gift-menu')}/gift-menu?token=${encodeURIComponent(this.token)}&v=2`; }
  getMissionTrioUrl(mode) { const m = mode === 'horizontal' ? 'horizontal' : 'vertical'; return `http://${this.linkHost}:${this._portFor('mission-trio')}/mission-trio?token=${encodeURIComponent(this.token)}&mode=${m}&v=2`; }
  getLikeWallUrl() { return `http://${this.linkHost}:${this._portFor('like-wall')}/like-wall?token=${encodeURIComponent(this.token)}&v=3`; }
  getCardFlipUrl() { return `http://${this.linkHost}:${this._portFor('card-flip')}/card-flip?token=${encodeURIComponent(this.token)}&v=5`; }
  // Overlay "lật 3D" toàn màn hình — DÙNG CHUNG stream /card-flip-events (không cần set/route riêng),
  // nhưng ở cổng riêng để né trần 6 kết nối/host của CEF.
  getCardFlipFxUrl() { return `http://${this.linkHost}:${this._portFor('card-flip-fx')}/card-flip-fx?token=${encodeURIComponent(this.token)}&v=7`; }
  getInteractUrl() { return `http://${this.linkHost}:${this._portFor('interact')}/interact?token=${encodeURIComponent(this.token)}&v=1`; }
  // Mỗi kênh NHẠC DANCE 1 link OBS riêng (cổng riêng + ?ch=).
  _danceChan(ch) { return this.danceChannels.includes(ch) ? ch : 'webm1'; }
  getDanceVideoUrl(ch) {
    ch = this._danceChan(ch);
    const idx = { webm1: 1, webm2: 2, webm3: 3 }[ch];
    return `http://${this.linkHost}:${this._portFor('dance-video-' + idx)}/dance-video?token=${encodeURIComponent(this.token)}&ch=${ch}&v=2`;
  }
  danceVideoClientCount(ch) { const s = this.danceVideoClients[this._danceChan(ch)]; return s ? s.size : 0; }

  sendPkDuo(state) { this.pkDuoState = state || {}; this._broadcast(this.pkDuoClients, 'pkduo', this.pkDuoState); }
  sendKcDuo(state) { this.kcDuoState = state || {}; this._broadcast(this.kcDuoClients, 'kcduo', this.kcDuoState); }
  sendPkGroup(state) { this.pkGroupState = state || {}; this._broadcast(this.pkGroupClients, 'pkgroup', this.pkGroupState); }
  sendRanking(state) { this.rankingState = state || {}; this._broadcast(this.rankingClients, 'ranking', this.rankingState); }
  sendScore(state) { this.scoreState = state || {}; this._broadcast(this.scoreClients, 'score', this.scoreState); }
  sendSticker(state) { this.stickerState = state || {}; this._broadcast(this.stickerClients, 'sticker', this.stickerState); }
  sendMvpHonor(state) { this.mvpHonorState = state || {}; this._broadcast(this.mvpHonorClients, 'mvphonor', this.mvpHonorState); }
  sendLuckyWheel(state) { this.luckyWheelState = state || {}; this._broadcast(this.luckyWheelClients, 'luckywheel', this.luckyWheelState); }
  sendGiftMenu(state) { this.giftMenuState = state || {}; this._broadcast(this.giftMenuClients, 'giftmenu', this.giftMenuState); }
  sendMissionTrio(state) { this.missionTrioState = state || {}; this._broadcast(this.missionTrioClients, 'missiontrio', this.missionTrioState); }
  sendLikeWall(state) { this.likeWallState = state || {}; this._broadcast(this.likeWallClients, 'likewall', this.likeWallState); }
  sendCardFlip(state) { this.cardFlipState = state || {}; this._broadcast(this.cardFlipClients, 'cardflip', this.cardFlipState); }
  // Overlay TƯƠNG TÁC + QUÀ: state = config (độ trong suốt, cỡ chữ/avatar, tỉ lệ chia, bật/tắt cột).
  sendInteract(config) { this.interactState = config || {}; this._broadcast(this.interactClients, 'interact', this.interactState); }
  // Đẩy 1 bình luận / 1 quà mới ra overlay (append). Kèm __seq để client KHÔNG bị dedupe khi 2
  // sự kiện có nội dung giống hệt nhau. Giữ ~60 sự kiện gần nhất để phát lại cho client mới.
  pushInteractChat(item) {
    const ev = { ...(item || {}), __seq: ++this.interactSeq };
    this.interactChatBuf.push(ev);
    if (this.interactChatBuf.length > 60) this.interactChatBuf.shift();
    this._broadcast(this.interactClients, 'ichat', ev);
  }
  pushInteractGift(item) {
    const ev = { ...(item || {}), __seq: ++this.interactSeq };
    this.interactGiftBuf.push(ev);
    if (this.interactGiftBuf.length > 60) this.interactGiftBuf.shift();
    this._broadcast(this.interactClients, 'igift', ev);
  }
  sendDanceVideo(ch, state) { ch = this._danceChan(ch); this.danceVideoState[ch] = state || {}; this._broadcast(this.danceVideoClients[ch], 'dancevideo', this.danceVideoState[ch]); }

  _broadcast(set, event, data) {
    const body = `event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`;
    for (const res of set) { try { res.write(body); } catch {} }
  }

  // Mọi tập client (dùng cho tín hiệu chung như ẩn/hiện overlay theo cảnh).
  _allClientSets() {
    return [
      this.pkDuoClients, this.kcDuoClients, this.pkGroupClients, this.rankingClients, this.scoreClients,
      this.stickerClients, this.mvpHonorClients, this.luckyWheelClients, this.giftMenuClients,
      this.missionTrioClients, this.likeWallClients, this.cardFlipClients, this.interactClients,
      ...this.danceChannels.map(ch => this.danceVideoClients[ch]),
    ];
  }
  _broadcastAll(event, data) {
    const body = `event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`;
    for (const set of this._allClientSets()) for (const res of set) { try { res.write(body); } catch {} }
  }
  // Dòng SSE ẩn/hiện overlay (gửi kèm khi client mới kết nối + mỗi nhịp heartbeat để tự chữa lành nếu rớt gói).
  _visPayload() { return `event: __vis\ndata: ${JSON.stringify(this.visState || {})}\n\n`; }
  // App gọi để đặt bản đồ ẩn/hiện overlay theo cảnh. Phát ngay tới MỌI overlay đang mở.
  setVisibility(map) {
    this.visState = (map && typeof map === 'object') ? map : {};
    this._broadcastAll('__vis', this.visState);
  }

  _heartbeat() {
    // Gửi lại STATE hiện tại như một event thật (không chỉ comment keep-alive).
    // → vừa giữ SSE sống trên OBS CEF, vừa để overlay tự vẽ lại định kỳ,
    //   tránh trường hợp overlay bị "treo/ẩn" sau một lúc khi có gói tin bị rớt.
    const beats = [
      [this.pkDuoClients, 'pkduo', this.pkDuoState],
      [this.kcDuoClients, 'kcduo', this.kcDuoState],
      [this.pkGroupClients, 'pkgroup', this.pkGroupState],
      [this.rankingClients, 'ranking', this.rankingState],
      [this.scoreClients, 'score', this.scoreState],
      [this.stickerClients, 'sticker', this.stickerState],
      [this.mvpHonorClients, 'mvphonor', this.mvpHonorState],
      [this.luckyWheelClients, 'luckywheel', this.luckyWheelState],
      [this.giftMenuClients, 'giftmenu', this.giftMenuState],
      [this.missionTrioClients, 'missiontrio', this.missionTrioState],
      [this.likeWallClients, 'likewall', this.likeWallState],
      [this.cardFlipClients, 'cardflip', this.cardFlipState],
      // Chỉ nhịp lại CONFIG cho overlay TƯƠNG TÁC (giữ kết nối + vẽ lại), KHÔNG phát lại chat/quà
      // theo nhịp (tránh nhân đôi sự kiện — chúng chỉ phát 1 lần lúc xảy ra / lúc client mới kết nối).
      [this.interactClients, 'interact', this.interactState],
      ...this.danceChannels.map(ch => [this.danceVideoClients[ch], 'dancevideo', this.danceVideoState[ch]]),
    ];
    const ver = `event: __ver\ndata: ${this.assetVersion}\n\n` + this._visPayload();
    for (const [set, event, data] of beats) {
      const body = ver + `event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`;
      for (const res of set) {
        if (res.destroyed || res.writableEnded) { set.delete(res); continue; }
        try { res.write(body); } catch { set.delete(res); }
      }
    }
  }

  _handle(req, res) {
    const reqUrl = new URL(req.url, `http://127.0.0.1:${this.port}`);
    const remote = req.socket.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
      return this._reject(res, 403, 'localhost only');
    }

    // Static assets (no token, để overlay load được trước khi check token cho data)
    const staticMap = {
      '/pk-duo-overlay.js': 'renderer/pk-duo-overlay.js',
      '/pk-duo-overlay.css': 'renderer/pk-duo-overlay.css',
      '/kc-duo-overlay.js': 'renderer/kc-duo-overlay.js',
      '/kc-duo-overlay.css': 'renderer/kc-duo-overlay.css',
      '/pk-duo-fx-overlay.js': 'renderer/pk-duo-fx-overlay.js',
      '/pk-duo-fx-overlay.css': 'renderer/pk-duo-fx-overlay.css',
      '/pk-group-overlay.js': 'renderer/pk-group-overlay.js',
      '/pk-group-overlay.css': 'renderer/pk-group-overlay.css',
      '/pk-group-fx-overlay.js': 'renderer/pk-group-fx-overlay.js',
      '/pk-group-fx-overlay.css': 'renderer/pk-group-fx-overlay.css',
      '/ranking-overlay.js': 'renderer/ranking-overlay.js',
      '/ranking-overlay.css': 'renderer/ranking-overlay.css',
      '/score-overlay.js': 'renderer/score-overlay.js',
      '/score-overlay.css': 'renderer/score-overlay.css',
      '/sticker-overlay.js': 'renderer/sticker-overlay.js',
      '/sticker-overlay.css': 'renderer/sticker-overlay.css',
      '/mvp-honor-overlay.js': 'renderer/mvp-honor-overlay.js',
      '/mvp-honor-overlay.css': 'renderer/mvp-honor-overlay.css',
      '/lucky-wheel-overlay.js': 'renderer/lucky-wheel-overlay.js',
      '/lucky-wheel-overlay.css': 'renderer/lucky-wheel-overlay.css',
      '/gift-menu-overlay.js': 'renderer/gift-menu-overlay.js',
      '/gift-menu-overlay.css': 'renderer/gift-menu-overlay.css',
      '/mission-trio-overlay.js': 'renderer/mission-trio-overlay.js',
      '/mission-trio-overlay.css': 'renderer/mission-trio-overlay.css',
      '/like-wall-overlay.js': 'renderer/like-wall-overlay.js',
      '/like-wall-overlay.css': 'renderer/like-wall-overlay.css',
      '/card-flip-overlay.js': 'renderer/card-flip-overlay.js',
      '/card-flip-overlay.css': 'renderer/card-flip-overlay.css',
      '/card-flip-fx-overlay.js': 'renderer/card-flip-fx-overlay.js',
      '/card-flip-fx-overlay.css': 'renderer/card-flip-fx-overlay.css',
      '/dance-video-overlay.js': 'renderer/dance-video-overlay.js',
      '/dance-video-overlay.css': 'renderer/dance-video-overlay.css',
      '/interact-overlay.js': 'renderer/interact-overlay.js',
      '/interact-overlay.css': 'renderer/interact-overlay.css',
      '/overlay-common.css': 'renderer/overlay-common.css',
      '/overlay-skin.css': 'renderer/overlay-skin.css',
      '/overlay-skin.js': 'renderer/overlay-skin.js',
      '/overlay-fog.css': 'renderer/overlay-fog.css',
      '/overlay-fog.js': 'renderer/overlay-fog.js',
      '/overlay-sse.js': 'renderer/overlay-sse.js',
      '/review-resize.js': 'renderer/review-resize.js',
      '/pk-duo-rocket.svg': 'renderer/pk-duo-rocket.svg',
      '/pk-duo-boost.svg': 'renderer/pk-duo-boost.svg',
      '/pk-duo-neutral.svg': 'renderer/pk-duo-neutral.svg',
      '/pk-duo-arrow.svg': 'renderer/pk-duo-arrow.svg',
      '/favicon.ico': 'logo/hp-logo.ico',
      '/logo.png': 'logo/hp-logo.png',
    };
    if (req.method === 'GET' && staticMap[reqUrl.pathname]) {
      return this._serveFile(path.join(this.root, staticMap[reqUrl.pathname]), res);
    }

    // Khung vinh danh (MVP Honor): phục vụ ảnh khung N.png + nền tiêu đề động Na.apng từ
    // renderer/mvp-frames (không cần token, vì OBS Browser Source phải load được ảnh trước khi
    // có state). Chỉ cho tên file .png / .apng an toàn.
    if (req.method === 'GET' && reqUrl.pathname.startsWith('/mvp-frames/')) {
      const name = path.basename(reqUrl.pathname);
      if (/^[\w.-]+\.(png|apng)$/i.test(name)) {
        return this._serveFile(path.join(this.root, 'renderer', 'mvp-frames', name), res);
      }
      return this._reject(res, 404, 'not found');
    }

    // Ảnh thẻ bài (mặt úp/mở + viền trên/dưới) theo bộ thẻ bất kỳ trong card-assets/ — không cần
    // token vì OBS Browser Source phải load được ảnh trước khi có state. Tên thư mục+file .png an toàn.
    if (req.method === 'GET' && reqUrl.pathname.startsWith('/card-assets/')) {
      const rel = reqUrl.pathname.replace(/^\/card-assets\//, '');
      const m = /^([\w-]{1,40})\/([\w.-]+\.png)$/i.exec(rel);
      if (m) return this._serveFile(path.join(this.root, 'renderer', 'card-assets', m[1], m[2]), res);
      return this._reject(res, 404, 'not found');
    }

    // Avatar proxy: cho phép overlay load avatar từ TikTok CDN qua proxy đơn giản
    // (tránh CORS / mixed content trong OBS Browser Source).
    if (req.method === 'GET' && reqUrl.pathname === '/avatar') {
      return this._serveAvatar(reqUrl, res);
    }

    if (!this._okToken(reqUrl)) return this._reject(res, 401, 'bad token');

    // Nút giữa vòng quay gọi endpoint này từ Review hoặc OBS Interact. Chỉ quay
    // khi lượt trước đã kết thúc để nhiều cửa sổ overlay không thể chồng lệnh.
    if (req.method === 'POST' && reqUrl.pathname === '/lucky-wheel-spin') {
      const activeSpin = this.luckyWheelState?.spin;
      const endsAt = activeSpin ? Number(activeSpin.startAt) + Number(activeSpin.duration || 0) * 1000 : 0;
      if (endsAt > Date.now()) return this._json(res, { ok: false, error: 'wheel-is-spinning' });
      const result = this.onLuckyWheelSpin ? this.onLuckyWheelSpin() : null;
      return this._json(res, result ? { ok: true, result } : { ok: false, error: 'wheel-unavailable' });
    }

    // Overlay THẺ BÀI tương tác: bấm 1 thẻ (OBS Interact / cửa sổ Review) → đảo mặt úp/mở của thẻ đó.
    if (req.method === 'POST' && reqUrl.pathname === '/card-flip-toggle') {
      const id = reqUrl.searchParams.get('id') || '';
      const result = this.onCardFlip ? this.onCardFlip(id) : null;
      return this._json(res, result ? { ok: true, state: result } : { ok: false, error: 'card-unavailable' });
    }

    // Overlay TƯƠNG TÁC + QUÀ: kéo vạch chia (Quà/Bình luận) → lưu tỉ lệ (ghi nhớ vị trí).
    if (req.method === 'POST' && reqUrl.pathname === '/interact-split') {
      const ratio = Number(reqUrl.searchParams.get('ratio'));
      const cfg = (this.onInteractSplit && Number.isFinite(ratio)) ? this.onInteractSplit(ratio) : null;
      return this._json(res, cfg ? { ok: true, config: cfg } : { ok: false, error: 'interact-unavailable' });
    }

    // Video NHẠC DANCE phát xong/lỗi trên overlay → báo về renderer để hàng đợi hiệu ứng bước tiếp.
    if (req.method === 'POST' && reqUrl.pathname === '/dance-video-ended') {
      const ch = this._danceChan(reqUrl.searchParams.get('ch') || 'webm1');
      const playId = reqUrl.searchParams.get('playId') || '';
      const layer = reqUrl.searchParams.get('layer') || 'main';
      try { this.onDanceVideoEnded?.(ch, playId, layer); } catch {}
      return this._json(res, { ok: true });
    }

    // Stream file video cục bộ cho overlay (http origin không load được file://). Có Range để tua/stream.
    if (req.method === 'GET' && reqUrl.pathname === '/dance-media') {
      return this._serveMedia(reqUrl, req, res);
    }

    // Overlay HTML pages
    if (req.method === 'GET' && reqUrl.pathname === '/pk-duo') {
      return this._serveFile(path.join(this.root, 'renderer', 'pk-duo-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/kc-duo') {
      return this._serveFile(path.join(this.root, 'renderer', 'kc-duo-overlay.html'), res);
    }
    // Overlay FX toàn màn hình: dùng CHUNG stream điểm /pk-duo-events (không cần client set/route data riêng).
    if (req.method === 'GET' && reqUrl.pathname === '/pk-duo-fx') {
      return this._serveFile(path.join(this.root, 'renderer', 'pk-duo-fx-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/pk-group') {
      return this._serveFile(path.join(this.root, 'renderer', 'pk-group-overlay.html'), res);
    }
    // Overlay FX toàn màn hình PK Nhóm: dùng CHUNG stream điểm /pk-group-events (không cần route data riêng).
    if (req.method === 'GET' && reqUrl.pathname === '/pk-group-fx') {
      return this._serveFile(path.join(this.root, 'renderer', 'pk-group-fx-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/ranking') {
      return this._serveFile(path.join(this.root, 'renderer', 'ranking-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/score') {
      return this._serveFile(path.join(this.root, 'renderer', 'score-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/sticker') {
      return this._serveFile(path.join(this.root, 'renderer', 'sticker-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/mvp-honor') {
      return this._serveFile(path.join(this.root, 'renderer', 'mvp-honor-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/lucky-wheel') {
      return this._serveFile(path.join(this.root, 'renderer', 'lucky-wheel-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/gift-menu') {
      return this._serveFile(path.join(this.root, 'renderer', 'gift-menu-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/mission-trio') {
      return this._serveFile(path.join(this.root, 'renderer', 'mission-trio-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/like-wall') {
      return this._serveFile(path.join(this.root, 'renderer', 'like-wall-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/card-flip') {
      return this._serveFile(path.join(this.root, 'renderer', 'card-flip-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/card-flip-fx') {
      return this._serveFile(path.join(this.root, 'renderer', 'card-flip-fx-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/dance-video') {
      return this._serveFile(path.join(this.root, 'renderer', 'dance-video-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/interact') {
      return this._serveFile(path.join(this.root, 'renderer', 'interact-overlay.html'), res);
    }

    // SSE event streams
    if (req.method === 'GET' && reqUrl.pathname === '/pk-duo-events') return this._sse(req, res, this.pkDuoClients, 'pkduo', this.pkDuoState);
    if (req.method === 'GET' && reqUrl.pathname === '/kc-duo-events') return this._sse(req, res, this.kcDuoClients, 'kcduo', this.kcDuoState);
    if (req.method === 'GET' && reqUrl.pathname === '/pk-group-events') return this._sse(req, res, this.pkGroupClients, 'pkgroup', this.pkGroupState);
    if (req.method === 'GET' && reqUrl.pathname === '/ranking-events') return this._sse(req, res, this.rankingClients, 'ranking', this.rankingState);
    if (req.method === 'GET' && reqUrl.pathname === '/score-events') return this._sse(req, res, this.scoreClients, 'score', this.scoreState);
    if (req.method === 'GET' && reqUrl.pathname === '/sticker-events') return this._sse(req, res, this.stickerClients, 'sticker', this.stickerState);
    if (req.method === 'GET' && reqUrl.pathname === '/mvp-honor-events') return this._sse(req, res, this.mvpHonorClients, 'mvphonor', this.mvpHonorState);
    // Fallback cho Browser Source/CEF không nhận EventSource ổn định: MVP Honor có thể
    // lấy state bằng HTTP ngay lúc mở, sau đó client poll nhẹ để không bị màn hình trắng.
    if (req.method === 'GET' && reqUrl.pathname === '/mvp-honor-state') return this._json(res, this.mvpHonorState);
    // Lucky Wheel cũng cần fallback này: một số bản OBS CEF tải HTML nhưng bỏ lỡ
    // EventSource ban đầu, khiến canvas chỉ hiện vòng rỗng dù server vẫn có state.
    if (req.method === 'GET' && reqUrl.pathname === '/lucky-wheel-state') return this._json(res, this.luckyWheelState);
    if (req.method === 'GET' && reqUrl.pathname === '/lucky-wheel-events') return this._sse(req, res, this.luckyWheelClients, 'luckywheel', this.luckyWheelState);
    // Menu Quà (thông tin quà) — overlay chỉ hiển thị, dùng chung cơ chế SSE + fallback state.
    if (req.method === 'GET' && reqUrl.pathname === '/gift-menu-state') return this._json(res, this.giftMenuState);
    if (req.method === 'GET' && reqUrl.pathname === '/gift-menu-events') return this._sse(req, res, this.giftMenuClients, 'giftmenu', this.giftMenuState);
    // NHIỆM VỤ · BỘ BA — 3 thanh KPI, dùng chung cơ chế SSE + fallback state.
    if (req.method === 'GET' && reqUrl.pathname === '/mission-trio-state') return this._json(res, this.missionTrioState);
    if (req.method === 'GET' && reqUrl.pathname === '/mission-trio-events') return this._sse(req, res, this.missionTrioClients, 'missiontrio', this.missionTrioState);
    // NHIỆM VỤ · TÁP TIM — bức tường thả tim, dùng chung cơ chế SSE + fallback state.
    if (req.method === 'GET' && reqUrl.pathname === '/like-wall-state') return this._json(res, this.likeWallState);
    if (req.method === 'GET' && reqUrl.pathname === '/like-wall-events') return this._sse(req, res, this.likeWallClients, 'likewall', this.likeWallState);
    // THẺ BÀI — dùng chung cơ chế SSE + fallback state.
    if (req.method === 'GET' && reqUrl.pathname === '/card-flip-state') return this._json(res, this.cardFlipState);
    if (req.method === 'GET' && reqUrl.pathname === '/card-flip-events') return this._sse(req, res, this.cardFlipClients, 'cardflip', this.cardFlipState);
    // TƯƠNG TÁC + QUÀ — config qua state (fallback JSON) + luồng SSE phát lại lịch sử gần đây cho client mới.
    if (req.method === 'GET' && reqUrl.pathname === '/interact-state') return this._json(res, this.interactState);
    if (req.method === 'GET' && reqUrl.pathname === '/interact-events') return this._sseInteract(req, res);
    // NHẠC DANCE (video) — 3 kênh độc lập, chọn qua ?ch=webm1|2|3. Dùng chung cơ chế SSE + fallback.
    if (req.method === 'GET' && reqUrl.pathname === '/dance-video-state') {
      const ch = this._danceChan(reqUrl.searchParams.get('ch') || 'webm1');
      return this._json(res, this.danceVideoState[ch]);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/dance-video-events') {
      const ch = this._danceChan(reqUrl.searchParams.get('ch') || 'webm1');
      return this._sse(req, res, this.danceVideoClients[ch], 'dancevideo', this.danceVideoState[ch]);
    }

    return this._reject(res, 404, 'not found');
  }

  _sse(req, res, set, evName, initialState) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.socket?.setNoDelay(true);
    res.flushHeaders?.();
    // Tell EventSource to recover quickly if OBS/CEF does close the connection.
    // Kèm event __ver (phiên bản app): overlay ghi nhớ lúc mở, tự reload khi thấy version ĐỔI (sau cập nhật).
    res.write(`retry: 1500\n:event stream connected\n\nevent: __ver\ndata: ${this.assetVersion}\n\n` + this._visPayload() + `event: ${evName}\ndata: ${JSON.stringify(initialState || {})}\n\n`);
    set.add(res);
    req.on('close', () => set.delete(res));
  }

  // SSE riêng cho overlay TƯƠNG TÁC + QUÀ: gửi config trước, rồi PHÁT LẠI theo đúng thứ tự thời gian
  // các bình luận/quà gần đây (dựa vào __seq) để OBS mở/reload có ngay nội dung thay vì trống trơn.
  _sseInteract(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.socket?.setNoDelay(true);
    res.flushHeaders?.();
    let body = `retry: 1500\n:event stream connected\n\nevent: __ver\ndata: ${this.assetVersion}\n\n` + this._visPayload() + `event: interact\ndata: ${JSON.stringify(this.interactState || {})}\n\n`;
    const replay = [
      ...this.interactChatBuf.map(e => ['ichat', e]),
      ...this.interactGiftBuf.map(e => ['igift', e]),
    ].sort((a, b) => (a[1].__seq || 0) - (b[1].__seq || 0));
    for (const [ev, data] of replay) body += `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(body);
    this.interactClients.add(res);
    req.on('close', () => this.interactClients.delete(res));
  }

  // Kiểm host tránh SSRF: chặn loopback/mạng nội bộ, cho phép mọi CDN ảnh công khai
  // (TikTok/ByteDance đổi host liên tục — allow-list theo từ khoá thay vì liệt kê cứng).
  _isAllowedAvatarHost(host) {
    host = String(host || '').toLowerCase();
    if (!host) return false;
    if (host === 'localhost' || /(^|\.)local$/.test(host)) return false;
    if (/^(127\.|10\.|0\.0\.0\.0|169\.254\.|::1|\[::1\])/.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return /(tiktokcdn|tiktokv|tiktok|byteoversea|bytecdn|byteimg|ibyteimg|ibytedtos|bytedance|pstatp|sgpstatp|ttwstatic|muscdn|akamaized|hpvn\.media)/.test(host);
  }

  // Khoá cache = HOST + PATH của URL (bỏ query chữ ký) → URL ký lại cùng ảnh vẫn trùng khoá.
  _avatarKey(url) {
    try { const u = new URL(url); return crypto.createHash('sha1').update(u.host + u.pathname).digest('hex'); }
    catch { return crypto.createHash('sha1').update(String(url)).digest('hex'); }
  }
  _sniffCtype(buf) {
    if (!buf || buf.length < 12) return 'image/jpeg';
    if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (buf.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
    return 'image/jpeg';
  }
  _normalizeAvatarBuffer(buf) {
    if (!this._normalizeAvatar || !buf?.length) return buf;
    try {
      const normalized = this._normalizeAvatar(buf);
      return Buffer.isBuffer(normalized) && normalized.length ? normalized : buf;
    } catch { return buf; }
  }
  // Đọc bản đã lưu ĐĨA (tồn tại qua khởi động lại + qua lúc TikTok chặn). Nạp vào cache RAM luôn.
  _avatarFromDisk(key) {
    if (this._avatarCache.has(key)) return this._avatarCache.get(key);
    try {
      let buf = fs.readFileSync(path.join(this._avatarDir, key));
      const normalized = this._normalizeAvatarBuffer(buf);
      if (!normalized.equals(buf)) {
        buf = normalized;
        try { fs.writeFileSync(path.join(this._avatarDir, key), buf); } catch {}
      }
      if (buf && buf.length) { const hit = { ctype: this._sniffCtype(buf), buf }; this._avatarCache.set(key, hit); return hit; }
    } catch {}
    return null;
  }
  // Fetch avatar TikTok (retry) + GỘP request trùng đang bay + LƯU ĐĨA theo khoá path.
  _fetchAvatarBuf(url) {
    const key = this._avatarKey(url);
    const inflight = this._avatarInflight.get(key);
    if (inflight) return inflight;
    const task = (async () => {
      let lastErr;
      for (let attempt = 0; attempt < 2; attempt++) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 9000);
        try {
          // Header giả trình duyệt: một số CDN TikTok chặn request thiếu UA/Referer (403).
          const r = await fetch(url, {
            signal: ac.signal,
            redirect: 'follow',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
              'Referer': 'https://www.tiktok.com/',
              'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            },
          });
          if (!r.ok) throw new Error('status ' + r.status);
          const buf = this._normalizeAvatarBuffer(Buffer.from(await r.arrayBuffer()));
          const ctype = this._sniffCtype(buf);
          if (buf.length) {
            const hit = { ctype, buf };
            this._avatarCache.set(key, hit);
            try { fs.writeFileSync(path.join(this._avatarDir, key), buf); } catch {}
          }
          return { ctype, buf };
        } catch (e) {
          lastErr = e;
        } finally {
          clearTimeout(timer);
        }
      }
      throw lastErr || new Error('avatar fetch failed');
    })();
    this._avatarInflight.set(key, task);
    return task.finally(() => this._avatarInflight.delete(key));
  }

  // Tải & lưu sẵn avatar (gọi khi lấy avatar Creator ở Hồ sơ) → có bản ĐĨA ngay cả khi sau này TikTok
  // chặn / URL hết hạn. "Tải 1 lần ở Hồ sơ Creator là dùng mãi". Không ném lỗi.
  primeAvatar(url) {
    try {
      const s = String(url || '');
      if (!/^https?:\/\//i.test(s)) return Promise.resolve(false);
      let host = ''; try { host = new URL(s).hostname; } catch {}
      if (!host || !this._isAllowedAvatarHost(host)) return Promise.resolve(false);
      if (this._avatarFromDisk(this._avatarKey(s))) return Promise.resolve(true);
      return this._fetchAvatarBuf(s).then(() => true).catch(() => false);
    } catch { return Promise.resolve(false); }
  }

  _serveAvatar(reqUrl, res) {
    const keyParam = reqUrl.searchParams.get('key') || '';
    // Avatar Creator/nhóm đã được tải một lần ở Hồ sơ dùng khóa cục bộ. OBS không còn cần
    // đọc URL TikTok đã ký, nên ảnh vẫn hiển thị khi URL hết hạn hoặc TikTok chặn request.
    if (keyParam) {
      if (!/^[a-f0-9]{40}$/i.test(keyParam)) {
        res.writeHead(302, { Location: '/logo.png' });
        return res.end();
      }
      const cached = this._avatarFromDisk(keyParam);
      if (cached) {
        res.writeHead(200, { 'Content-Type': cached.ctype, 'Cache-Control': 'public, max-age=86400' });
        return res.end(cached.buf);
      }
      res.writeHead(302, { Location: '/logo.png' });
      return res.end();
    }
    const url = reqUrl.searchParams.get('url') || '';
    let host = '';
    try { host = new URL(url).hostname; } catch { /* url hỏng */ }
    // Nếu host lạ → không lỗi cụt: chuyển về logo để overlay luôn có ảnh, không lộ vòng tròn rỗng.
    if (!host || !this._isAllowedAvatarHost(host)) {
      res.writeHead(302, { Location: '/logo.png' });
      return res.end();
    }
    const key = this._avatarKey(url);
    // 1) Cache RAM / ĐĨA theo path → phục vụ ngay, KHÔNG phụ thuộc TikTok (kể cả URL hết hạn/bị chặn).
    const disk = this._avatarFromDisk(key);
    if (disk) {
      res.writeHead(200, { 'Content-Type': disk.ctype, 'Cache-Control': 'public, max-age=86400' });
      return res.end(disk.buf);
    }
    // 2) Chưa có bản nào → fetch (retry, gộp trùng) rồi lưu đĩa.
    this._fetchAvatarBuf(url).then(({ ctype, buf }) => {
      if (res.headersSent) return;
      res.writeHead(200, { 'Content-Type': ctype, 'Cache-Control': 'public, max-age=86400' });
      res.end(buf);
    }).catch(() => {
      // Fetch lỗi & chưa từng có bản đĩa → logo (tránh ô rỗng). Client sẽ tự thử lại sau.
      if (!res.headersSent) { res.writeHead(302, { Location: '/logo.png' }); res.end(); }
    });
  }

  _serveFile(filePath, res) {
    if (!fs.existsSync(filePath)) return this._reject(res, 404, 'file not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  }

  // Đổi "src" (file:// URL hoặc đường dẫn cục bộ) thành đường dẫn hệ thống an toàn.
  _mediaPathFromSrc(src) {
    const s = String(src || '').trim();
    if (!s) return '';
    try { if (/^file:\/\//i.test(s)) return fileURLToPath(s); } catch { return ''; }
    return s; // đường dẫn thô (VD G:\...)
  }

  // Stream video cục bộ cho OBS Browser Source (http origin). Hỗ trợ HTTP Range để video tua/stream
  // mượt thay vì tải hết mới phát. Chỉ phục vụ file TỒN TẠI + đuôi video hợp lệ (chống lộ file bất kỳ).
  _serveMedia(reqUrl, req, res) {
    const filePath = this._mediaPathFromSrc(reqUrl.searchParams.get('src') || '');
    const ext = path.extname(filePath).toLowerCase();
    if (!filePath || !VIDEO_MIME[ext]) return this._reject(res, 400, 'bad media');
    let stat;
    try { stat = fs.statSync(filePath); } catch { return this._reject(res, 404, 'media not found'); }
    if (!stat.isFile()) return this._reject(res, 404, 'media not found');
    const total = stat.size;
    const ctype = VIDEO_MIME[ext];
    const range = req.headers.range;
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] === '' ? 0 : parseInt(m[1], 10);
      let end = m[2] === '' ? total - 1 : parseInt(m[2], 10);
      if (!Number.isFinite(start) || start < 0) start = 0;
      if (!Number.isFinite(end) || end >= total) end = total - 1;
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); return res.end(); }
      res.writeHead(206, {
        'Content-Type': ctype,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Cache-Control': 'no-store',
      });
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', () => { try { res.end(); } catch {} });
      return stream.pipe(res);
    }
    res.writeHead(200, {
      'Content-Type': ctype,
      'Accept-Ranges': 'bytes',
      'Content-Length': total,
      'Cache-Control': 'no-store',
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { try { res.end(); } catch {} });
    return stream.pipe(res);
  }

  _json(res, data) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data || {}));
  }

  _okToken(reqUrl) { return reqUrl.searchParams.get('token') === this.token; }

  _reject(res, code, msg) {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(msg || String(code));
  }
}

module.exports = { ObsOverlayServer };
