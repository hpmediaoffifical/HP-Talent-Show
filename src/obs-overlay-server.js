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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

class ObsOverlayServer {
  constructor({ root, port = 18282, token, onLog, cacheDir, normalizeAvatar } = {}) {
    this.root = root;
    this.port = port;
    this.token = token || crypto.randomBytes(18).toString('hex');
    this.onLog = onLog || (() => {});
    this.server = null;
    this.pkDuoClients = new Set();
    this.pkGroupClients = new Set();
    this.rankingClients = new Set();
    this.scoreClients = new Set();
    this.pkDuoState = {};
    this.pkGroupState = {};
    this.rankingState = {};
    this.scoreState = {};
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
    if (this.server) return;
    this.server = http.createServer((req, res) => this._handle(req, res));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', resolve);
    });
    // Keep OBS's embedded browser connected while the OBS window is backgrounded.
    // Some machines/network stacks otherwise leave an idle localhost SSE stream stale.
    this.heartbeatTimer = setInterval(() => this._heartbeat(), 5000);
    this.onLog(`OBS overlay server: http://127.0.0.1:${this.port}`);
  }

  stop() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    for (const set of [this.pkDuoClients, this.pkGroupClients, this.rankingClients, this.scoreClients]) {
      for (const res of set) { try { res.end(); } catch {} }
      set.clear();
    }
    if (this.server) { try { this.server.close(); } catch {} }
    this.server = null;
  }

  getPkDuoUrl() { return `http://127.0.0.1:${this.port}/pk-duo?token=${encodeURIComponent(this.token)}`; }
  getPkDuoFxUrl() { return `http://127.0.0.1:${this.port}/pk-duo-fx?token=${encodeURIComponent(this.token)}`; }
  getPkGroupUrl() { return `http://127.0.0.1:${this.port}/pk-group?token=${encodeURIComponent(this.token)}`; }
  getRankingUrl() { return `http://127.0.0.1:${this.port}/ranking?token=${encodeURIComponent(this.token)}`; }
  getScoreUrl() { return `http://127.0.0.1:${this.port}/score?token=${encodeURIComponent(this.token)}`; }

  sendPkDuo(state) { this.pkDuoState = state || {}; this._broadcast(this.pkDuoClients, 'pkduo', this.pkDuoState); }
  sendPkGroup(state) { this.pkGroupState = state || {}; this._broadcast(this.pkGroupClients, 'pkgroup', this.pkGroupState); }
  sendRanking(state) { this.rankingState = state || {}; this._broadcast(this.rankingClients, 'ranking', this.rankingState); }
  sendScore(state) { this.scoreState = state || {}; this._broadcast(this.scoreClients, 'score', this.scoreState); }

  _broadcast(set, event, data) {
    const body = `event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`;
    for (const res of set) { try { res.write(body); } catch {} }
  }

  _heartbeat() {
    // Gửi lại STATE hiện tại như một event thật (không chỉ comment keep-alive).
    // → vừa giữ SSE sống trên OBS CEF, vừa để overlay tự vẽ lại định kỳ,
    //   tránh trường hợp overlay bị "treo/ẩn" sau một lúc khi có gói tin bị rớt.
    const beats = [
      [this.pkDuoClients, 'pkduo', this.pkDuoState],
      [this.pkGroupClients, 'pkgroup', this.pkGroupState],
      [this.rankingClients, 'ranking', this.rankingState],
      [this.scoreClients, 'score', this.scoreState],
    ];
    for (const [set, event, data] of beats) {
      const body = `event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`;
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
      '/pk-duo-fx-overlay.js': 'renderer/pk-duo-fx-overlay.js',
      '/pk-duo-fx-overlay.css': 'renderer/pk-duo-fx-overlay.css',
      '/pk-group-overlay.js': 'renderer/pk-group-overlay.js',
      '/pk-group-overlay.css': 'renderer/pk-group-overlay.css',
      '/ranking-overlay.js': 'renderer/ranking-overlay.js',
      '/ranking-overlay.css': 'renderer/ranking-overlay.css',
      '/score-overlay.js': 'renderer/score-overlay.js',
      '/score-overlay.css': 'renderer/score-overlay.css',
      '/overlay-common.css': 'renderer/overlay-common.css',
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

    // Avatar proxy: cho phép overlay load avatar từ TikTok CDN qua proxy đơn giản
    // (tránh CORS / mixed content trong OBS Browser Source).
    if (req.method === 'GET' && reqUrl.pathname === '/avatar') {
      return this._serveAvatar(reqUrl, res);
    }

    if (!this._okToken(reqUrl)) return this._reject(res, 401, 'bad token');

    // Overlay HTML pages
    if (req.method === 'GET' && reqUrl.pathname === '/pk-duo') {
      return this._serveFile(path.join(this.root, 'renderer', 'pk-duo-overlay.html'), res);
    }
    // Overlay FX toàn màn hình: dùng CHUNG stream điểm /pk-duo-events (không cần client set/route data riêng).
    if (req.method === 'GET' && reqUrl.pathname === '/pk-duo-fx') {
      return this._serveFile(path.join(this.root, 'renderer', 'pk-duo-fx-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/pk-group') {
      return this._serveFile(path.join(this.root, 'renderer', 'pk-group-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/ranking') {
      return this._serveFile(path.join(this.root, 'renderer', 'ranking-overlay.html'), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/score') {
      return this._serveFile(path.join(this.root, 'renderer', 'score-overlay.html'), res);
    }

    // SSE event streams
    if (req.method === 'GET' && reqUrl.pathname === '/pk-duo-events') return this._sse(req, res, this.pkDuoClients, 'pkduo', this.pkDuoState);
    if (req.method === 'GET' && reqUrl.pathname === '/pk-group-events') return this._sse(req, res, this.pkGroupClients, 'pkgroup', this.pkGroupState);
    if (req.method === 'GET' && reqUrl.pathname === '/ranking-events') return this._sse(req, res, this.rankingClients, 'ranking', this.rankingState);
    if (req.method === 'GET' && reqUrl.pathname === '/score-events') return this._sse(req, res, this.scoreClients, 'score', this.scoreState);

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
    res.write(`retry: 1500\n:event stream connected\n\nevent: ${evName}\ndata: ${JSON.stringify(initialState || {})}\n\n`);
    set.add(res);
    req.on('close', () => set.delete(res));
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

  _okToken(reqUrl) { return reqUrl.searchParams.get('token') === this.token; }

  _reject(res, code, msg) {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(msg || String(code));
  }
}

module.exports = { ObsOverlayServer };
