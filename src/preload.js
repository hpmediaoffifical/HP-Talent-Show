const { contextBridge, ipcRenderer, webUtils } = require('electron');

const api = {
  // ===== TikTok connection =====
  tt: {
    connect: (username, opts) => ipcRenderer.invoke('tt:connect', { username, opts }),
    disconnect: () => ipcRenderer.invoke('tt:disconnect'),
    status: () => ipcRenderer.invoke('tt:status'),
    fetchProfile: (username, opts) => ipcRenderer.invoke('tt:fetchProfile', { username, opts }),
    fetchAvatarData: (username) => ipcRenderer.invoke('tt:fetchAvatarData', { username }),
  },

  // ===== Creators / Groups =====
  creators: {
    list: () => ipcRenderer.invoke('creators:list'),
    upsert: (creator) => ipcRenderer.invoke('creators:upsert', creator),
    remove: (id) => ipcRenderer.invoke('creators:remove', id),
    armLearnRecipient: (on) => ipcRenderer.invoke('creators:armLearnRecipient', on),
  },
  groups: {
    list: () => ipcRenderer.invoke('groups:list'),
    upsert: (group) => ipcRenderer.invoke('groups:upsert', group),
    remove: (id) => ipcRenderer.invoke('groups:remove', id),
  },

  // ===== Hồ sơ nhóm (thông số riêng theo từng nhóm) =====
  groupProfiles: {
    getAll: () => ipcRenderer.invoke('groupProfiles:getAll'),
    save: (groupId, patch) => ipcRenderer.invoke('groupProfiles:save', { groupId, patch }),
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
    resetAll: () => ipcRenderer.invoke('pkduo:resetAll'),
    addPoints: (side, points) => ipcRenderer.invoke('pkduo:addPoints', { side, points }),
    testGift: (side, qty, sign) => ipcRenderer.invoke('pkduo:testGift', { side, qty, sign }),
    getUrl: () => ipcRenderer.invoke('pkduo:getUrl'),
    getFxUrl: () => ipcRenderer.invoke('pkduo:getFxUrl'),
  },
  // Chế độ link overlay dùng chung: false = OBS (127.0.0.1), true = TikTok Studio (hostname hpstudio.obs).
  overlay: {
    getLinkMode: () => ipcRenderer.invoke('overlay:getLinkMode'),
    setLinkMode: (on) => ipcRenderer.invoke('overlay:setLinkMode', on),
    // Ẩn/hiện overlay theo cảnh (tự-theo-menu + ghim + bật/tắt tay).
    getVisibility: () => ipcRenderer.invoke('overlay:getVisibility'),
    setVisibility: (patch) => ipcRenderer.invoke('overlay:setVisibility', patch),
    // Phát bản đồ HIỆU LỰC (tay + cảnh + ghim) tới overlay — chỉ broadcast, không lưu đè lựa chọn tay.
    applyVisibility: (vis) => ipcRenderer.invoke('overlay:applyVisibility', vis),
  },
  // Dòng hosts "127.0.0.1 hpstudio.obs" cho link TikTok Studio: kiểm tra trạng thái / tự cài (UAC).
  hosts: {
    status: () => ipcRenderer.invoke('hosts:status'),
    fix: () => ipcRenderer.invoke('hosts:fix'),
  },

  // ===== GIỮ / ĐỔI (Keep/Change) =====
  kcduo: {
    getState: () => ipcRenderer.invoke('kcduo:getState'),
    setConfig: (cfg) => ipcRenderer.invoke('kcduo:setConfig', cfg),
    start: () => ipcRenderer.invoke('kcduo:start'),
    stop: () => ipcRenderer.invoke('kcduo:stop'),
    reset: () => ipcRenderer.invoke('kcduo:reset'),
    resetAll: () => ipcRenderer.invoke('kcduo:resetAll'),
    addPoints: (side, points) => ipcRenderer.invoke('kcduo:addPoints', { side, points }),
    testGift: (side, qty, sign) => ipcRenderer.invoke('kcduo:testGift', { side, qty, sign }),
    getUrl: () => ipcRenderer.invoke('kcduo:getUrl'),
  },

  // ===== PK Nhóm =====
  pkgroup: {
    getState: () => ipcRenderer.invoke('pkgroup:getState'),
    setConfig: (cfg) => ipcRenderer.invoke('pkgroup:setConfig', cfg),
    start: () => ipcRenderer.invoke('pkgroup:start'),
    stop: () => ipcRenderer.invoke('pkgroup:stop'),
    reset: () => ipcRenderer.invoke('pkgroup:reset'),
    resetAll: () => ipcRenderer.invoke('pkgroup:resetAll'),
    addPoints: (id, points) => ipcRenderer.invoke('pkgroup:addPoints', { id, points }),
    testGift: (id, qty, sign) => ipcRenderer.invoke('pkgroup:testGift', { id, qty, sign }),
    setMvpTotal: (creatorId, groupId, total) => ipcRenderer.invoke('pkgroup:setMvpTotal', { creatorId, groupId, total }),
    getUrl: () => ipcRenderer.invoke('pkgroup:getUrl'),
    getFxUrl: () => ipcRenderer.invoke('pkgroup:getFxUrl'),
  },

  // ===== DANH SÁCH NHẠC (quà → clip audio) =====
  musiclist: {
    getState: () => ipcRenderer.invoke('musiclist:getState'),
    setConfig: (cfg) => ipcRenderer.invoke('musiclist:setConfig', cfg),
  },

  // ===== STICKER DANCE =====
  stickerdance: {
    getState: () => ipcRenderer.invoke('stickerdance:getState'),
    getConfig: () => ipcRenderer.invoke('stickerdance:getConfig'),
    setConfig: (cfg) => ipcRenderer.invoke('stickerdance:setConfig', cfg),
    apply: (cfg) => ipcRenderer.invoke('stickerdance:apply', cfg),
    reset: () => ipcRenderer.invoke('stickerdance:reset'),
    getUrl: () => ipcRenderer.invoke('stickerdance:getUrl'),
    signal: (sig) => ipcRenderer.invoke('stickerdance:signal', sig),
  },

  // ===== MVP HONOR (thẻ vinh danh avatar) =====
  mvphonor: {
    getState: () => ipcRenderer.invoke('mvphonor:getState'),
    getConfig: () => ipcRenderer.invoke('mvphonor:getConfig'),
    setConfig: (cfg) => ipcRenderer.invoke('mvphonor:setConfig', cfg),
    reset: () => ipcRenderer.invoke('mvphonor:reset'),
    getUrl: () => ipcRenderer.invoke('mvphonor:getUrl'),
  },

  // ===== VÒNG QUAY MAY MẮN (Lucky Wheel) =====
  luckywheel: {
    getState: () => ipcRenderer.invoke('luckywheel:getState'),
    getConfig: () => ipcRenderer.invoke('luckywheel:getConfig'),
    setConfig: (cfg) => ipcRenderer.invoke('luckywheel:setConfig', cfg),
    spin: (opts) => ipcRenderer.invoke('luckywheel:spin', opts),
    clearHistory: () => ipcRenderer.invoke('luckywheel:clearHistory'),
    setCount: (n) => ipcRenderer.invoke('luckywheel:setCount', n),
    removeHistory: (id) => ipcRenderer.invoke('luckywheel:removeHistory', id),
    export: () => ipcRenderer.invoke('luckywheel:export'),
    reset: () => ipcRenderer.invoke('luckywheel:reset'),
    getUrl: () => ipcRenderer.invoke('luckywheel:getUrl'),
  },

  // ===== MENU QUÀ (thông tin quà) =====
  giftmenu: {
    getConfig: () => ipcRenderer.invoke('giftmenu:getConfig'),
    setConfig: (cfg) => ipcRenderer.invoke('giftmenu:setConfig', cfg),
    apply: (cfg) => ipcRenderer.invoke('giftmenu:apply', cfg),
    getUrl: () => ipcRenderer.invoke('giftmenu:getUrl'),
  },

  // ===== TƯƠNG TÁC + QUÀ (overlay gộp chat + quà thành 1 cột dọc) =====
  interact: {
    getConfig: () => ipcRenderer.invoke('interact:getConfig'),
    setConfig: (cfg) => ipcRenderer.invoke('interact:setConfig', cfg),
    getUrl: () => ipcRenderer.invoke('interact:getUrl'),
  },

  // ===== NHIỆM VỤ · BỘ BA (3 KPI: người tặng quà / tim / điểm) =====
  missiontrio: {
    getState: () => ipcRenderer.invoke('missiontrio:getState'),
    setConfig: (cfg) => ipcRenderer.invoke('missiontrio:setConfig', cfg),
    start: () => ipcRenderer.invoke('missiontrio:start'),
    stop: () => ipcRenderer.invoke('missiontrio:stop'),
    reset: () => ipcRenderer.invoke('missiontrio:reset'),
    bump: (kind, amount) => ipcRenderer.invoke('missiontrio:bump', { kind, amount }),
    getUrl: (mode) => ipcRenderer.invoke('missiontrio:getUrl', mode),
  },

  // ===== NHIỆM VỤ · TÁP TIM (bức tường thả tim) =====
  likewall: {
    getState: () => ipcRenderer.invoke('likewall:getState'),
    setConfig: (cfg) => ipcRenderer.invoke('likewall:setConfig', cfg),
    start: () => ipcRenderer.invoke('likewall:start'),
    stop: () => ipcRenderer.invoke('likewall:stop'),
    reset: () => ipcRenderer.invoke('likewall:reset'),
    bump: (amount) => ipcRenderer.invoke('likewall:bump', { amount }),
    getUrl: () => ipcRenderer.invoke('likewall:getUrl'),
  },

  // ===== THẺ BÀI (táp tim để lật thẻ) =====
  cardflip: {
    getState: () => ipcRenderer.invoke('cardflip:getState'),
    setConfig: (cfg) => ipcRenderer.invoke('cardflip:setConfig', cfg),
    startHearts: () => ipcRenderer.invoke('cardflip:startHearts'),
    stopHearts: () => ipcRenderer.invoke('cardflip:stopHearts'),
    resetHearts: () => ipcRenderer.invoke('cardflip:resetHearts'),
    setHearts: (n) => ipcRenderer.invoke('cardflip:setHearts', n),
    flip: (id, value) => ipcRenderer.invoke('cardflip:flip', { id, value }),
    select: (id, value) => ipcRenderer.invoke('cardflip:select', { id, value }),
    listStyles: () => ipcRenderer.invoke('cardflip:listStyles'),
    getUrl: () => ipcRenderer.invoke('cardflip:getUrl'),
    getFxUrl: () => ipcRenderer.invoke('cardflip:getFxUrl'),
  },

  // ===== NHẠC DANCE · Video overlay =====
  dancevideo: {
    getState: (channel) => ipcRenderer.invoke('dancevideo:getState', channel),
    getConfig: () => ipcRenderer.invoke('dancevideo:getConfig'),
    setConfig: (cfg) => ipcRenderer.invoke('dancevideo:setConfig', cfg),
    play: (cmd) => ipcRenderer.invoke('dancevideo:play', cmd),
    stopMain: (channel) => ipcRenderer.invoke('dancevideo:stopMain', channel),
    setSpeed: (cmd) => ipcRenderer.invoke('dancevideo:setSpeed', cmd),
    setPaused: (cmd) => ipcRenderer.invoke('dancevideo:setPaused', cmd),
    playBackground: (cmd) => ipcRenderer.invoke('dancevideo:playBackground', cmd),
    stopBackground: (channel) => ipcRenderer.invoke('dancevideo:stopBackground', channel),
    stopAll: () => ipcRenderer.invoke('dancevideo:stopAll'),
    getUrl: (channel) => ipcRenderer.invoke('dancevideo:getUrl', channel),
  },

  // ===== Match history (LỊCH SỬ trận đấu) =====
  history: {
    list: (filter) => ipcRenderer.invoke('history:list', filter),
    clear: (filter) => ipcRenderer.invoke('history:clear', filter),
    remove: (id) => ipcRenderer.invoke('history:remove', id),
    export: (filter) => ipcRenderer.invoke('history:export', filter),
    apply: (id, mapping) => ipcRenderer.invoke('history:apply', { id, mapping }),
    unapply: (id) => ipcRenderer.invoke('history:unapply', id),
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
    applyScore: (creatorId, points, label) => ipcRenderer.invoke('ranking:applyScore', { creatorId, points, label }),
    applySticker: () => ipcRenderer.invoke('ranking:applySticker'),
    commitRound: () => ipcRenderer.invoke('ranking:commitRound'),
    undoApply: (applyId) => ipcRenderer.invoke('ranking:undoApply', applyId),
    applyLog: () => ipcRenderer.invoke('ranking:applyLog'),
    getLinks: () => ipcRenderer.invoke('ranking:getLinks'),
    setLinks: (patch) => ipcRenderer.invoke('ranking:setLinks', patch),
    validateLinks: () => ipcRenderer.invoke('ranking:validateLinks'),
    setPerfOrder: (creatorId, order) => ipcRenderer.invoke('ranking:setPerfOrder', { creatorId, order }),
    clearPerfOrder: () => ipcRenderer.invoke('ranking:clearPerfOrder'),
    syncPerfOrders: (assignments) => ipcRenderer.invoke('ranking:syncPerfOrders', assignments),
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
    getBarUrl: () => ipcRenderer.invoke('score:getBarUrl'),
    getCardUrl: () => ipcRenderer.invoke('score:getCardUrl'),
    getTimerUrl: () => ipcRenderer.invoke('score:getTimerUrl'),
  },

  // ===== Lịch sử 🎯 Tính điểm =====
  scoreHistory: {
    list: () => ipcRenderer.invoke('scoreHistory:list'),
    add: (rec) => ipcRenderer.invoke('scoreHistory:add', rec),
    remove: (id) => ipcRenderer.invoke('scoreHistory:remove', id),
    clear: () => ipcRenderer.invoke('scoreHistory:clear'),
    export: () => ipcRenderer.invoke('scoreHistory:export'),
  },

  // ===== Lịch sử 🏆 THI ĐẤU NHÓM =====
  rankingHistory: {
    list: () => ipcRenderer.invoke('rankingHistory:list'),
    add: (rec) => ipcRenderer.invoke('rankingHistory:add', rec),
    remove: (id) => ipcRenderer.invoke('rankingHistory:remove', id),
    clear: () => ipcRenderer.invoke('rankingHistory:clear'),
    export: (heSo) => ipcRenderer.invoke('rankingHistory:export', heSo),
  },

  review: {
    open: (type) => ipcRenderer.invoke('review:open', type),
    close: (type) => ipcRenderer.invoke('review:close', type),
    setAlwaysOnTop: (type, value) => ipcRenderer.invoke('review:alwaysOnTop', { type, value }),
    setClickThrough: (type, value) => ipcRenderer.invoke('review:clickThrough', { type, value }),
    setBackground: (type, value, alpha) => ipcRenderer.invoke('review:background', { type, value, alpha }),
    fitContent: (width, height) => ipcRenderer.invoke('review:fitContent', { width, height }),
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

  // ===== KIM CƯƠNG TỔNG theo nhóm (sheet DAILY DATA) =====
  kc: {
    getGroups: () => ipcRenderer.invoke('kc:getGroups'),
    getMonths: () => ipcRenderer.invoke('kc:getMonths'),
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
    // Tiến độ tải bản cập nhật (received/total/pct) → renderer vẽ thanh %.
    onProgress: (cb) => {
      const h = (_e, d) => { try { cb(d); } catch {} };
      ipcRenderer.on('updates:progress', h);
      return () => ipcRenderer.removeListener('updates:progress', h);
    },
  },

  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    // true = bản DEV (chạy nguồn) → mở khoá tính năng; false = bản CÀI → cần LIVE.
    isDev: () => ipcRenderer.invoke('app:isDev'),
    // Phản hồi popup xác nhận thoát (true = Thoát hẳn, false = Ở lại) — thay dialog gốc bằng UI đẹp trong app.
    confirmQuitResult: (ok) => ipcRenderer.send('app:confirmQuitResult', !!ok),
  },

  // ===== Cửa sổ DANH SÁCH PHÁT tách rời (chỉ xem) =====
  playlist: {
    open: () => ipcRenderer.invoke('playlist:open'),
    isOpen: () => ipcRenderer.invoke('playlist:isOpen'),
    push: (data) => ipcRenderer.send('playlist:push', data),
    // Lệnh từ cửa sổ popup gửi ngược về renderer chính (xóa mục, bỏ mục đang phát, tạm dừng, xáo trộn, xóa tất cả…).
    command: (cmd) => ipcRenderer.send('playlist:command', cmd),
  },

  // ===== OBS WebSocket (reset overlay) =====
  obs: {
    // Trả chuỗi xác thực OBS WebSocket v5 (mật khẩu nằm ở main, renderer không thấy).
    authString: (salt, challenge) => ipcRenderer.invoke('obs:authString', { salt, challenge }),
  },

  // ===== Events from main =====
  on: (channel, handler) => {
    const allowed = new Set([
      'tt:connected', 'tt:disconnected', 'tt:error',
      'tt:chat', 'tt:gift', 'tt:like', 'tt:member', 'tt:follow', 'tt:share', 'tt:roomUser',
      'pkduo:state', 'pkduo:config', 'kcduo:state', 'kcduo:config', 'pkgroup:state', 'ranking:state', 'score:state', 'stickerdance:state', 'mvphonor:state', 'luckywheel:state', 'giftmenu:state', 'interact:state', 'missiontrio:state', 'likewall:state', 'cardflip:state', 'dancevideo:ended',
      'history:changed', 'scoreHistory:changed', 'rankingHistory:changed', 'ranking:links',
      'playlist:update', 'playlist:requestState', 'playlist:command',
      'tt:recipientLearned',
      'app:confirmQuit',
      'hosts:status',
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
    pickAudios: () => ipcRenderer.invoke('shell:pickAudios'),
    pickVideos: () => ipcRenderer.invoke('shell:pickVideos'),
    pickMediaFolder: () => ipcRenderer.invoke('shell:pickMediaFolder'),
    prepareGiftDrag: (data) => ipcRenderer.invoke('shell:prepareGiftDrag', data),
    startGiftDrag: (file) => ipcRenderer.send('shell:startGiftDrag', file),
    confirm: (opts) => ipcRenderer.invoke('shell:confirm', opts),
    // Electron 33 đã bỏ File.path → lấy đường dẫn thật của file KÉO-THẢ qua webUtils.
    pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  },
};

contextBridge.exposeInMainWorld('api', api);
