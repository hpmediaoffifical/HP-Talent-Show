// OBS Scene Bridge — persistent WebSocket to OBS, listens CurrentProgramSceneChanged
// and maps sceneName -> overlay vis. Auto hide/show overlays on TikTok Studio via SSE __vis.
// Uses native WebSocket (Electron/Node 20+) + obs-websocket v5 auth via main's obsAuthString logic.

const crypto = require('crypto');
let WebSocketImpl = null;
try { WebSocketImpl = global.WebSocket || null; } catch {}
if (!WebSocketImpl) { try { WebSocketImpl = require('ws'); } catch {} }

const OP = { HELLO: 0, IDENTIFY: 1, IDENTIFIED: 2, REQUEST: 6, REQUEST_RESPONSE: 7, EVENT: 5 };

// EventSubscription bitmask: Scenes = 1<<2 = 4
const SUB_SCENES = 1 << 2;

function obsAuthString(password, salt, challenge) {
  // Same as obs-websocket v5 spec: base64( sha256( base64( sha256(password+salt) ) + challenge ) )
  const hash1 = crypto.createHash('sha256').update(password + salt).digest('base64');
  const hash2 = crypto.createHash('sha256').update(hash1 + challenge).digest('base64');
  return hash2;
}

class ObsSceneBridge {
  constructor({ onSceneChanged, onStatus, onScenesRefreshed } = {}) {
    this.onSceneChanged = typeof onSceneChanged === 'function' ? onSceneChanged : () => {};
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.onScenesRefreshed = typeof onScenesRefreshed === 'function' ? onScenesRefreshed : () => {};
    this.ws = null;
    this.timer = null;
    this.reconnectDelay = 1500;
    this.shouldRun = false;
    this.cfg = { wsPort: 4455, wsPassword: '', enabled: false, map: {} };
    this.currentScene = '';
    this.scenes = []; // [{sceneName, sceneUuid, sceneIndex}]
    this._reqId = 0;
    this._pending = new Map(); // requestId -> {resolve,reject,timer}
  }

  configure(cfg) {
    const next = {
      wsPort: Math.max(1, Math.min(65535, parseInt(cfg?.wsPort, 10) || 4455)),
      wsPassword: String(cfg?.wsPassword || ''),
      enabled: !!cfg?.enabled,
      map: (cfg?.map && typeof cfg.map === 'object' && !Array.isArray(cfg.map)) ? cfg.map : {},
    };
    // sanitize map: sceneName -> [overlayKey]
    const clean = {};
    for (const [scene, keys] of Object.entries(next.map)) {
      const k = String(scene || '').trim();
      if (!k) continue;
      const arr = Array.isArray(keys) ? keys.map(x => String(x).trim()).filter(Boolean) : [];
      clean[k] = [...new Set(arr)];
    }
    next.map = clean;
    const wasEnabled = this.cfg.enabled;
    const portChanged = this.cfg.wsPort !== next.wsPort;
    const passChanged = this.cfg.wsPassword !== next.wsPassword;
    this.cfg = next;
    if (next.enabled && (!wasEnabled || portChanged || passChanged)) {
      // port/pass đổi phải ngắt kết nối cũ rồi nối lại
      if (portChanged || passChanged) { this._cleanupWs(); if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
      this.shouldRun = true;
      this._connect();
    } else if (!next.enabled && wasEnabled) {
      this.stop();
      this._emitStatus('disabled');
    } else if (next.enabled) {
      // map changed while running — re-apply current scene
      if (this.currentScene) this.onSceneChanged(this.currentScene);
    }
    return this.cfg;
  }

  getConfig() { return { ...this.cfg, currentScene: this.currentScene, connected: !!(this.ws && this.ws.readyState === 1), scenes: [...this.scenes] }; }
  getScenes() { return [...this.scenes]; }
  getCurrentScene() { return this.currentScene; }
  isConnected() { return !!(this.ws && this.ws.readyState === 1); }

  start() {
    if (this.shouldRun && this.ws) return;
    this.shouldRun = this.cfg.enabled;
    if (!this.shouldRun) return;
    this._connect();
  }

  stop() {
    this.shouldRun = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this._cleanupWs();
    this._pending.forEach(({ reject, timer }) => { clearTimeout(timer); try { reject(new Error('bridge stopped')); } catch {} });
    this._pending.clear();
  }

  // Request OBS to switch scene (user clicks scene button in app)
  async switchScene(sceneName) {
    const name = String(sceneName || '').trim();
    if (!name) throw new Error('Thiếu tên Scene');
    await this._request('SetCurrentProgramScene', { sceneName: name });
    // after switch, OBS will emit event; but also optimistically apply
    this.currentScene = name;
    this.onSceneChanged(name);
    return true;
  }

  async refreshSceneList() {
    if (!this.isConnected()) throw new Error('Chưa kết nối OBS');
    const data = await this._request('GetSceneList', {});
    const scenes = Array.isArray(data.scenes) ? data.scenes : [];
    const cur = data.currentProgramSceneName || data.currentProgramSceneName === '' ? data.currentProgramSceneName : (data.currentProgramSceneName || '');
    // some OBS versions use currentProgramSceneName, older use currentProgramSceneName
    this.scenes = scenes.map(s => ({ sceneName: s.sceneName, sceneUuid: s.sceneUuid || '', sceneIndex: s.sceneIndex ?? 0 }));
    if (cur) this.currentScene = String(cur);
    else if (data.currentProgramSceneName) this.currentScene = String(data.currentProgramSceneName);
    this.onScenesRefreshed(this.scenes, this.currentScene);
    this._emitStatus(this.isConnected() ? 'connected' : 'idle');
    return { scenes: this.scenes, currentScene: this.currentScene };
  }

  _emitStatus(s) {
    try { this.onStatus({ status: s, connected: this.isConnected(), currentScene: this.currentScene, scenes: this.scenes }); } catch {}
  }

  _connect() {
    if (!this.shouldRun) return;
    if (this.ws) this._cleanupWs();
    const port = this.cfg.wsPort;
    const url = `ws://127.0.0.1:${port}`;
    this._emitStatus('connecting');
    let ws;
    try {
      const WS = WebSocketImpl || global.WebSocket;
      if (!WS) throw new Error('WebSocket not available');
      ws = new WS(url);
    } catch (e) { this._scheduleReconnect(e.message || String(e)); return; }
    this.ws = ws;
    let helloDone = false;
    const timeout = setTimeout(() => {
      if (!helloDone) { try { ws.close(); } catch {} this._scheduleReconnect('OBS WebSocket timeout'); }
    }, 4000);

    const on = (evt, fn) => {
      try { if (typeof ws.addEventListener === 'function') ws.addEventListener(evt, fn); else if (typeof ws.on === 'function') ws.on(evt, fn); } catch {}
    };
    const getRaw = (ev) => {
      if (ev == null) return '';
      if (typeof ev === 'string') return ev;
      if (Buffer.isBuffer(ev)) return ev.toString('utf8');
      if (ev.data !== undefined) return typeof ev.data === 'string' ? ev.data : (Buffer.isBuffer(ev.data) ? ev.data.toString('utf8') : String(ev.data));
      return String(ev);
    };

    on('open', () => { /* wait HELLO */ });

    on('error', () => {
      clearTimeout(timeout);
      if (!helloDone) this._scheduleReconnect('Không kết nối được OBS (ws://127.0.0.1:' + port + ')');
    });

    on('close', () => {
      clearTimeout(timeout);
      if (this.shouldRun) this._scheduleReconnect('OBS ngắt kết nối');
      else this._emitStatus('disabled');
    });

    on('message', async (ev) => {
      let raw = getRaw(ev);
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.op === OP.HELLO) {
        helloDone = true;
        clearTimeout(timeout);
        const d = { rpcVersion: 1, eventSubscriptions: SUB_SCENES };
        const auth = msg.d && msg.d.authentication;
        if (auth) {
          const { salt, challenge } = auth;
          if (this.cfg.wsPassword) {
            try { d.authentication = obsAuthString(this.cfg.wsPassword, salt, challenge); }
            catch (e) { this._scheduleReconnect('Lỗi xác thực OBS: ' + e.message); return; }
          } else {
            this._scheduleReconnect('OBS yêu cầu mật khẩu');
            try { ws.close(); } catch {}
            return;
          }
        }
        try { ws.send(JSON.stringify({ op: OP.IDENTIFY, d })); } catch { this._scheduleReconnect('Gửi IDENTIFY thất bại'); }
      } else if (msg.op === OP.IDENTIFIED) {
        helloDone = true;
        clearTimeout(timeout);
        this.reconnectDelay = 1500;
        this._emitStatus('connected');
        try { await this.refreshSceneList(); } catch {}
        if (this.currentScene) this.onSceneChanged(this.currentScene);
      } else if (msg.op === OP.EVENT) {
        this._handleEvent(msg.d);
      } else if (msg.op === OP.REQUEST_RESPONSE) {
        this._handleResponse(msg.d);
      }
    });
  }

  _handleMessage(ev) {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.op === OP.EVENT) this._handleEvent(msg.d);
    else if (msg.op === OP.REQUEST_RESPONSE) this._handleResponse(msg.d);
  }

  _handleEvent(d) {
    if (!d || !d.eventType) return;
    if (d.eventType === 'CurrentProgramSceneChanged') {
      const name = String(d.eventData?.sceneName || '').trim();
      if (name) {
        this.currentScene = name;
        this.onSceneChanged(name);
        this._emitStatus('connected');
      }
    } else if (d.eventType === 'SceneListChanged' || d.eventType === 'SceneCreated' || d.eventType === 'SceneRemoved' || d.eventType === 'SceneNameChanged') {
      // refresh scene list lazily
      this.refreshSceneList().catch(() => {});
    }
  }

  _request(requestType, requestData) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new Error('Chưa kết nối OBS'));
    return new Promise((resolve, reject) => {
      const requestId = 'b' + (++this._reqId) + '_' + Date.now().toString(36);
      const timer = setTimeout(() => { this._pending.delete(requestId); reject(new Error('OBS request timeout: ' + requestType)); }, 4000);
      this._pending.set(requestId, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ op: OP.REQUEST, d: { requestType, requestId, requestData: requestData || {} } }));
      } catch (e) { clearTimeout(timer); this._pending.delete(requestId); reject(e); }
    });
  }

  _handleResponse(d) {
    if (!d || !d.requestId) return;
    const entry = this._pending.get(d.requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this._pending.delete(d.requestId);
    const st = d.requestStatus || {};
    if (st.result) entry.resolve(d.responseData || {});
    else entry.reject(new Error(st.comment || ('OBS request failed: ' + (d.requestId))));
  }

  _cleanupWs() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      // remove listeners if any
      this.ws = null;
    }
  }

  _scheduleReconnect(reason) {
    this._cleanupWs();
    if (!this.shouldRun) { this._emitStatus('idle'); return; }
    this._emitStatus('reconnecting');
    if (this.timer) clearTimeout(this.timer);
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(10000, this.reconnectDelay * 1.6);
    this.timer = setTimeout(() => { this.timer = null; this._connect(); }, delay);
    // also emit reason
    try { this.onStatus({ status: 'reconnecting', reason, nextMs: delay }); } catch {}
  }
}

module.exports = { ObsSceneBridge };
