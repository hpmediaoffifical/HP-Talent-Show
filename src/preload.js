const { contextBridge, ipcRenderer } = require('electron');

const api = {
  // ===== TikTok connection =====
  tt: {
    connect: (username, opts) => ipcRenderer.invoke('tt:connect', { username, opts }),
    disconnect: () => ipcRenderer.invoke('tt:disconnect'),
    status: () => ipcRenderer.invoke('tt:status'),
    fetchProfile: (username) => ipcRenderer.invoke('tt:fetchProfile', { username }),
  },

  // ===== Creators / Groups =====
  creators: {
    list: () => ipcRenderer.invoke('creators:list'),
    upsert: (creator) => ipcRenderer.invoke('creators:upsert', creator),
    remove: (id) => ipcRenderer.invoke('creators:remove', id),
  },
  groups: {
    list: () => ipcRenderer.invoke('groups:list'),
    upsert: (group) => ipcRenderer.invoke('groups:upsert', group),
    remove: (id) => ipcRenderer.invoke('groups:remove', id),
  },

  // ===== Sao lưu / khôi phục dữ liệu =====
  data: {
    counts: () => ipcRenderer.invoke('data:counts'),
    export: () => ipcRenderer.invoke('data:export'),
    import: () => ipcRenderer.invoke('data:import'),
  },

  // ===== PK Đôi =====
  pkduo: {
    getState: () => ipcRenderer.invoke('pkduo:getState'),
    setConfig: (cfg) => ipcRenderer.invoke('pkduo:setConfig', cfg),
    start: () => ipcRenderer.invoke('pkduo:start'),
    stop: () => ipcRenderer.invoke('pkduo:stop'),
    reset: () => ipcRenderer.invoke('pkduo:reset'),
    addPoints: (side, points) => ipcRenderer.invoke('pkduo:addPoints', { side, points }),
    getUrl: () => ipcRenderer.invoke('pkduo:getUrl'),
  },

  // ===== PK Nhóm =====
  pkgroup: {
    getState: () => ipcRenderer.invoke('pkgroup:getState'),
    setConfig: (cfg) => ipcRenderer.invoke('pkgroup:setConfig', cfg),
    start: () => ipcRenderer.invoke('pkgroup:start'),
    stop: () => ipcRenderer.invoke('pkgroup:stop'),
    reset: () => ipcRenderer.invoke('pkgroup:reset'),
    addPoints: (id, points) => ipcRenderer.invoke('pkgroup:addPoints', { id, points }),
    testGift: (id) => ipcRenderer.invoke('pkgroup:testGift', { id }),
    getUrl: () => ipcRenderer.invoke('pkgroup:getUrl'),
  },

  // ===== Match history (LỊCH SỬ trận đấu) =====
  history: {
    list: (filter) => ipcRenderer.invoke('history:list', filter),
    clear: (filter) => ipcRenderer.invoke('history:clear', filter),
    remove: (id) => ipcRenderer.invoke('history:remove', id),
    export: (filter) => ipcRenderer.invoke('history:export', filter),
  },

  // ===== Ranking (BXH) =====
  ranking: {
    getState: () => ipcRenderer.invoke('ranking:getState'),
    setConfig: (cfg) => ipcRenderer.invoke('ranking:setConfig', cfg),
    reset: () => ipcRenderer.invoke('ranking:reset'),
    startRound: () => ipcRenderer.invoke('ranking:startRound'),
    resetRound: () => ipcRenderer.invoke('ranking:resetRound'),
    setActive: (id) => ipcRenderer.invoke('ranking:setActive', id),
    getUrl: () => ipcRenderer.invoke('ranking:getUrl'),
    getGridUrl: () => ipcRenderer.invoke('ranking:getGridUrl'),
  },

  // ===== Score =====
  score: {
    getState: () => ipcRenderer.invoke('score:getState'),
    setConfig: (cfg) => ipcRenderer.invoke('score:setConfig', cfg),
    start: () => ipcRenderer.invoke('score:start'),
    stop: () => ipcRenderer.invoke('score:stop'),
    reset: () => ipcRenderer.invoke('score:reset'),
    addPoints: (points, user) => ipcRenderer.invoke('score:addPoints', { points, user }),
    getUrl: () => ipcRenderer.invoke('score:getUrl'),
  },

  review: {
    open: (type) => ipcRenderer.invoke('review:open', type),
    close: (type) => ipcRenderer.invoke('review:close', type),
    setAlwaysOnTop: (type, value) => ipcRenderer.invoke('review:alwaysOnTop', { type, value }),
    setClickThrough: (type, value) => ipcRenderer.invoke('review:clickThrough', { type, value }),
    setBackground: (type, value, alpha) => ipcRenderer.invoke('review:background', { type, value, alpha }),
    getState: () => ipcRenderer.invoke('review:getState'),
  },

  // ===== Gift Master =====
  gifts: {
    list: () => ipcRenderer.invoke('gifts:list'),
    byId: (idOrName) => ipcRenderer.invoke('gifts:byId', idOrName),
    refresh: () => ipcRenderer.invoke('gifts:refresh'),
  },

  banner: {
    list: () => ipcRenderer.invoke('banner:list'),
  },

  ticker: {
    list: () => ipcRenderer.invoke('ticker:list'),
  },

  // ===== Settings =====
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },

  license: {
    get: () => ipcRenderer.invoke('license:get'),
    activate: (key) => ipcRenderer.invoke('license:activate', key),
    check: () => ipcRenderer.invoke('license:check'),
    clear: () => ipcRenderer.invoke('license:clear'),
  },

  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
    install: (info) => ipcRenderer.invoke('updates:install', info),
  },

  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },

  // ===== Events from main =====
  on: (channel, handler) => {
    const allowed = new Set([
      'tt:connected', 'tt:disconnected', 'tt:error',
      'tt:chat', 'tt:gift', 'tt:like', 'tt:member', 'tt:follow', 'tt:share', 'tt:roomUser',
      'pkduo:state', 'pkgroup:state', 'ranking:state', 'score:state',
      'history:changed',
      'log',
    ]);
    if (!allowed.has(channel)) return () => {};
    const listener = (_e, data) => handler(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    copyText: (text) => ipcRenderer.invoke('shell:copyText', text),
    pickAudio: () => ipcRenderer.invoke('shell:pickAudio'),
    prepareGiftDrag: (data) => ipcRenderer.invoke('shell:prepareGiftDrag', data),
    startGiftDrag: (file) => ipcRenderer.send('shell:startGiftDrag', file),
  },
};

contextBridge.exposeInMainWorld('api', api);
