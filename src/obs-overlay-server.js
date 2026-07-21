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
  constructor({ root, port = 18282, token, onLog } = {}) {
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
    this._avatarCache = new Map(); // url -> { ctype, buf } — tránh fetch lại + phục vụ khi CDN chập chờn
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

  _serveAvatar(reqUrl, res) {
    const url = reqUrl.searchParams.get('url') || '';
    let host = '';
    try { host = new URL(url).hostname; } catch { /* url hỏng */ }
    // Nếu host lạ → không lỗi cụt: chuyển về logo để overlay luôn có ảnh, không lộ vòng tròn rỗng.
    if (!host || !this._isAllowedAvatarHost(host)) {
      res.writeHead(302, { Location: '/logo.png' });
      return res.end();
    }
    const hit = this._avatarCache.get(url);
    if (hit) {
      res.writeHead(200, { 'Content-Type': hit.ctype, 'Cache-Control': 'public, max-age=86400' });
      return res.end(hit.buf);
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    // Header giả trình duyệt: một số CDN TikTok chặn request thiếu UA/Referer (403).
    fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    }).then(async r => {
      if (!r.ok) throw new Error('status ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const ctype = r.headers.get('content-type') || 'image/jpeg';
      if (buf.length && this._avatarCache.size < 2000) this._avatarCache.set(url, { ctype, buf });
      res.writeHead(200, { 'Content-Type': ctype, 'Cache-Control': 'public, max-age=86400' });
      res.end(buf);
    }).catch(() => {
      // CDN lỗi/timeout → fallback logo thay vì 502 (tránh ô avatar rỗng trên overlay).
      if (!res.headersSent) { res.writeHead(302, { Location: '/logo.png' }); res.end(); }
    }).finally(() => clearTimeout(timer));
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
