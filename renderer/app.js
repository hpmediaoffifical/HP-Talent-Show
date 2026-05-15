// HP Talent Show — Renderer logic.
// Mọi giao tiếp với main đi qua window.api (xem preload.js).

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

function toast(msg, kind = '') {
  const c = $('#toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; }, 2400);
  setTimeout(() => t.remove(), 2800);
}

function askConfirm(message, title = 'Xác nhận') {
  return new Promise((resolve) => {
    const overlay = $('#confirmOverlay');
    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = message;
    overlay.hidden = false;
    const cleanup = (value) => {
      overlay.hidden = true;
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      overlay.removeEventListener('mousedown', onBackdrop);
      resolve(value);
    };
    const yes = $('#confirmYes');
    const no = $('#confirmNo');
    const onYes = () => cleanup(true);
    const onNo = () => cleanup(false);
    const onBackdrop = (e) => { if (e.target === overlay) cleanup(false); };
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    overlay.addEventListener('mousedown', onBackdrop);
    no.focus();
  });
}

// ===== Tab routing =====
$$('.nav-btn').forEach(b => b.addEventListener('click', () => {
  $$('.nav-btn').forEach(x => x.classList.toggle('active', x === b));
  const id = b.dataset.tab;
  $$('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === id));
  if (id === 'overlays') refreshOverlayUrls();
}));

// Open external
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-ext]');
  if (a) { e.preventDefault(); window.api.shell.openExternal(a.dataset.ext); }
});

// ============================================================
// State
// ============================================================
let creators = [];
let groups = [];
let giftMaster = []; // [{id, name, icon, webm, diamond}]
let pkCfg = null;
let currentEditingCreator = null;
let currentEditingGroup = null;
let stats = { gifts: 0, diamond: 0, donors: new Set(), viewers: 0 };
let ttConnected = false;
let liveUsername = '';
let scoreLinkRanking = false;
let scoreLinkVoteLock = false;
let latestScoreState = null;
let scoreDurationSyncing = false;
let scoreTargetSyncing = false;
let scoreAutoRoundHandled = false;
let scoreStoppedManually = false;
let scoreConfigAutoTimer = null;
let pkConfigAutoTimer = null;
let scoreSoundAudio = null;
let scoreSoundRunKey = '';
let scoreSoundLastStatus = '';
let scoreSoundInitialized = false;
let scoreSoundWarningPlayed = false;
let scoreSoundGoalPlayed = false;
let scoreSoundResultPlayed = false;
let settingsPreviewAudio = null;
let bannerItems = [];
let bannerIndex = 0;
let bannerTimer = null;
let tickerItems = [];
const collapsedCreatorGroups = new Set();
let chatFontSize = 18;
const userAvatarCache = new Map();
const giftDonors = new Set();
const logInteractAt = { chatList: 0, giftList: 0 };

function giftToPkGift(g) {
  return { giftName: g.name, giftId: g.id, icon: g.icon, diamond: g.diamond };
}

function pkGiftModeKey() { return pkCfg?.joinMode ? 'joinGifts' : 'fixedGifts'; }

function getTeam(side) { return side === 'A' ? pkCfg.teamA : pkCfg.teamB; }

function creatorGiftUsage(exceptCreatorId = '') {
  const usedBy = {};
  for (const c of creators) {
    if (exceptCreatorId && c.id === exceptCreatorId) continue;
    if (c.defaultGiftId) usedBy[String(c.defaultGiftId)] = c.nickname || c.tiktokId || 'Creator';
  }
  return usedBy;
}

function normalizeId(value) { return String(value || '').trim().replace(/^@/, '').toLowerCase(); }

function filePathToUrl(filePath) {
  const s = String(filePath || '').trim();
  if (!s || /^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  return 'file:///' + s.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:').split('/').map((part, i) => i === 0 ? part : encodeURIComponent(part)).join('/');
}

function soundNameFromValue(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  try {
    const decoded = decodeURIComponent(s.replace(/^file:\/\/\//i, ''));
    return decoded.split(/[\\/]/).filter(Boolean).pop() || s;
  } catch {
    return s.split(/[\\/]/).filter(Boolean).pop() || s;
  }
}

function setSoundInput(id, value) {
  const input = $('#' + id);
  input.dataset.path = value || '';
  input.value = soundNameFromValue(value);
}

function soundValue(id) {
  const input = $('#' + id);
  return input.dataset.path || input.value.trim();
}

function gameplaySoundEnabled() {
  const el = $('#gameSoundEnabled');
  return !el || el.checked;
}

function gameplaySoundValue(id) {
  return gameplaySoundEnabled() ? soundValue(id) : '';
}

function creatorAvatarValue(creator) {
  return creator?.avatar || '../logo/hp-logo.png';
}

function safeAvatarUrl(value) {
  const s = String(value || '').trim();
  return s || '../logo/hp-logo.png';
}

function testSoundValue(value) {
  const soundUrl = String(value || '').trim();
  if (!soundUrl) {
    toast('Chưa chọn file âm thanh', 'error');
    return;
  }
  const audio = new Audio(soundUrl);
  audio.currentTime = 0;
  audio.play().catch(() => toast('Không phát được âm thanh này', 'error'));
}

function playSettingsSound(id, volumeId) {
  const soundUrl = String(soundValue(id) || '').trim();
  if (!soundUrl) {
    toast('Chưa chọn file âm thanh', 'error');
    return;
  }
  stopSettingsSound();
  settingsPreviewAudio = new Audio(soundUrl);
  settingsPreviewAudio.volume = Math.max(0, Math.min(1, (Number($('#' + volumeId)?.value) || 0) / 100));
  settingsPreviewAudio.play().catch(() => toast('Không phát được âm thanh này', 'error'));
}

function stopSettingsSound() {
  if (!settingsPreviewAudio) return;
  settingsPreviewAudio.pause();
  settingsPreviewAudio.currentTime = 0;
  settingsPreviewAudio = null;
}

function playScoreSound(value) {
  const soundUrl = String(value || '').trim();
  if (!soundUrl) return;
  try {
    if (!scoreSoundAudio) scoreSoundAudio = new Audio();
    scoreSoundAudio.pause();
    scoreSoundAudio.src = soundUrl;
    scoreSoundAudio.currentTime = 0;
    scoreSoundAudio.play().catch(() => {});
  } catch {}
}

function scoreRunKey(st = {}) {
  return String(st.runStartedAt || st.endAt || 'idle');
}

function handleScoreGameplaySound(st = {}, prevStatus = '') {
  const status = st.status || 'idle';
  if (!scoreSoundInitialized) {
    scoreSoundInitialized = true;
    scoreSoundLastStatus = status;
    scoreSoundRunKey = ['prestart', 'running', 'grace'].includes(status) ? scoreRunKey(st) : 'idle';
    return;
  }
  const key = ['prestart', 'running', 'grace'].includes(status) ? scoreRunKey(st) : 'idle';
  if (key !== scoreSoundRunKey) {
    scoreSoundRunKey = key;
    scoreSoundWarningPlayed = false;
    scoreSoundGoalPlayed = false;
    scoreSoundResultPlayed = false;
  }
  if (status !== scoreSoundLastStatus) {
    if (['prestart', 'running'].includes(status) && !['prestart', 'running', 'grace'].includes(prevStatus)) playScoreSound(st.startSound);
    if (status === 'success' && !scoreSoundResultPlayed) { scoreSoundResultPlayed = true; playScoreSound(st.successSound); }
    if (status === 'failed' && !scoreSoundResultPlayed) { scoreSoundResultPlayed = true; playScoreSound(st.failSound); }
  }
  const remainingMs = Number(st.remainingMs) || 0;
  if (!scoreSoundWarningPlayed && ['running', 'grace'].includes(status) && remainingMs <= 10000 && remainingMs > 0) {
    scoreSoundWarningPlayed = true;
    playScoreSound(st.warningSound);
  }
  const target = Math.max(1, Number(st.target) || 1);
  const score = Math.max(0, Number(st.score) || 0);
  if (!scoreSoundGoalPlayed && ['running', 'grace'].includes(status) && score >= target) {
    scoreSoundGoalPlayed = true;
    playScoreSound(st.goalSound);
  }
  scoreSoundLastStatus = status;
}

async function loadAudioOutputs(selectedId = 'default') {
  const sel = $('#audioOutput');
  if (!sel) return;
  sel.innerHTML = '<option value="default">Thiết bị phát mặc định</option>';
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    for (const d of devices.filter(x => x.kind === 'audiooutput')) {
      const opt = document.createElement('option');
      opt.value = d.deviceId || 'default';
      opt.textContent = d.label || `Thiết bị phát ${sel.length}`;
      sel.appendChild(opt);
    }
    sel.value = Array.from(sel.options).some(o => o.value === selectedId) ? selectedId : 'default';
  } catch {}
}

// ============================================================
// Gift Picker
// ============================================================
const GiftPicker = (() => {
  let resolver = null;
  let filtered = [];
  let bound = false;
  let currentOpts = {};
  let selectedIds = new Set();

  function open(opts = {}) {
    if (!bound) bind(); // defensive — đảm bảo handler luôn được gắn
    return new Promise((resolve) => {
      resolver = resolve;
      currentOpts = opts;
      selectedIds = new Set((opts.selected || []).map(String));
      $('#giftPicker').classList.add('is-open');
      $('#gpTitle').textContent = opts.title || '🎁 Chọn quà';
      $('#gpCount').textContent = `${giftMaster.length} quà`;
      $('#gpDone').hidden = !opts.multi;
      $('#gpQuery').value = '';
      setTimeout(() => $('#gpQuery')?.focus(), 50);
      render();
    });
  }
  function close(value) {
    const overlay = $('#giftPicker');
    if (overlay) overlay.classList.remove('is-open');
    $('#gpDone').hidden = true;
    const r = resolver; resolver = null;
    currentOpts = {};
    selectedIds = new Set();
    if (r) r(value || null);
  }
  function isOpen() { return $('#giftPicker')?.classList.contains('is-open'); }
  function render() {
    const q = $('#gpQuery').value.trim().toLowerCase();
    const sort = $('#gpSort').value;
    const disabledIds = new Set((currentOpts.disabledIds || []).map(String));
    const excludeIds = new Set((currentOpts.excludeIds || []).map(String));
    const usedBy = currentOpts.usedBy || {};
    filtered = giftMaster.filter(g => {
      if (excludeIds.has(String(g.id))) return false;
      if (!q) return true;
      return g.name.toLowerCase().includes(q) || String(g.id).includes(q);
    });
    switch (sort) {
      case 'name-asc': filtered.sort((a, b) => a.name.localeCompare(b.name, 'vi')); break;
      case 'name-desc': filtered.sort((a, b) => b.name.localeCompare(a.name, 'vi')); break;
      case 'dia-asc': filtered.sort((a, b) => a.diamond - b.diamond); break;
      case 'dia-desc': filtered.sort((a, b) => b.diamond - a.diamond); break;
      case 'id-asc': filtered.sort((a, b) => Number(a.id) - Number(b.id)); break;
    }
    const grid = $('#gpGrid');
    if (filtered.length === 0) {
      grid.innerHTML = '<div class="gp-empty">Không tìm thấy quà phù hợp.</div>';
      return;
    }
    // Render at most 300 ở mỗi lần để mượt
    const slice = filtered.slice(0, 300);
    grid.innerHTML = slice.map(g => {
      const id = String(g.id);
      const disabled = disabledIds.has(id);
      const selected = selectedIds.has(id);
      return `
      <div class="gp-item${disabled ? ' is-disabled' : ''}${selected ? ' is-selected' : ''}" data-id="${escapeAttr(g.id)}" title="${escapeAttr(g.name)}">
        ${g.icon ? `<img loading="lazy" src="${escapeAttr(g.icon)}" onerror="this.style.visibility='hidden'" />` : '<div style="width:56px;height:56px"></div>'}
        <div class="gp-iname">${escapeHtml(g.name)}</div>
        <div class="gp-iid">ID ${escapeHtml(g.id)}</div>
        <div class="gp-idia">🪙 ${escapeHtml(String(g.diamond || 0))}</div>
        ${disabled ? `<div class="gp-used">${escapeHtml(usedBy[id] || 'Đã chọn')}</div>` : ''}
      </div>
    `;
    }).join('') + (filtered.length > 300 ? `<div class="gp-empty">Hiển thị 300/${filtered.length} — gõ thêm để lọc.</div>` : '');
    grid.querySelectorAll('.gp-item').forEach(el => el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (disabledIds.has(String(id))) return;
      const g = giftMaster.find(x => String(x.id) === id);
      if (!g) return;
      if (currentOpts.multi) {
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        render();
      } else {
        close(g);
      }
    }));
  }
  function bind() {
    if (bound) return;
    const overlay = $('#giftPicker');
    if (!overlay) return; // DOM chưa sẵn
    $('#gpClose')?.addEventListener('click', (e) => { e.preventDefault(); close(null); });
    $('#gpDone')?.addEventListener('click', (e) => {
      e.preventDefault();
      close(giftMaster.filter(g => selectedIds.has(String(g.id))));
    });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
    $('#gpQuery')?.addEventListener('input', render);
    $('#gpSort')?.addEventListener('change', render);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) { e.preventDefault(); close(null); }
    });
    $('#gpRefresh')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const btn = $('#gpRefresh');
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = '⏳';
      try {
        const r = await window.api.gifts.refresh();
        if (r.ok) {
          await loadGiftMaster();
          toast(`✅ Đã cập nhật ${r.count} quà`, 'success');
        } else {
          toast('⚠ ' + (r.error || 'Lỗi refresh'), 'error');
        }
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
        render();
      }
    });
    bound = true;
  }

  // Auto-bind ngay khi script load (script ở cuối body nên DOM sẵn rồi).
  // Không phụ thuộc vào init() — kể cả init() throw thì popup vẫn close được.
  if (document.readyState !== 'loading') bind();
  else document.addEventListener('DOMContentLoaded', bind);

  return { open, close, bind };
})();

async function loadGiftMaster() {
  const r = await window.api.gifts.list();
  giftMaster = r.gifts || [];
}

// ============================================================
// Init
// ============================================================
async function init() {
  await loadGiftMaster();
  await refreshCreators();
  await refreshGroups();
  await loadPkConfig();
  await loadRankingConfig();
  await loadScoreConfig();
  await refreshOverlayUrls();
  await loadSettings();
  wireTtEvents();
  wireConnectTab();
  wireCreatorTab();
  wireGroupTab();
  wirePkDuoTab();
  wireRankingTab();
  wireScoreTab();
  wireOverlaysTab();
  wireSettingsTab();
  loadLiveBanners();
  loadLiveTicker();
}

async function loadLiveBanners() {
  const box = $('#liveBanner');
  if (!box || !window.api.banner?.list) return;
  try {
    const res = await window.api.banner.list();
    bannerItems = res?.banners || [];
    bannerIndex = 0;
    renderLiveBanner();
    clearInterval(bannerTimer);
    if (bannerItems.length > 1) bannerTimer = setInterval(() => {
      bannerIndex = (bannerIndex + 1) % bannerItems.length;
      renderLiveBanner();
    }, 8000);
  } catch {
    renderLiveBannerError();
  }
}

function renderLiveBannerError() {
  const box = $('#liveBanner');
  if (!box) return;
  box.className = 'live-banner-placeholder';
  box.innerHTML = '<strong>Chưa tải được banner</strong><span>Kiểm tra quyền chia sẻ Google Sheet.</span>';
}

function renderLiveBanner() {
  const box = $('#liveBanner');
  if (!box) return;
  const item = bannerItems[bannerIndex];
  if (!item) {
    box.className = 'live-banner-placeholder';
    box.innerHTML = '<strong>Banner vinh danh / thông tin</strong><span>Thêm ảnh tại sheet Banner, cột A.</span>';
    return;
  }
  box.className = `live-banner${item.link ? ' clickable' : ''}`;
  box.innerHTML = `
    <img src="${escapeAttr(item.image)}" alt="${escapeAttr(item.note || 'Banner')}" />
    ${item.note ? `<span>${escapeHtml(item.note)}</span>` : ''}
  `;
  box.onclick = item.link ? () => window.api.shell.openExternal(item.link) : null;
}

async function loadLiveTicker() {
  const box = $('#liveTicker');
  const track = $('#liveTickerTrack');
  if (!box || !track || !window.api.ticker?.list) return;
  try {
    const res = await window.api.ticker.list();
    tickerItems = res?.tickers || [];
    renderLiveTicker();
  } catch {
    tickerItems = [];
    renderLiveTicker();
  }
}

function renderLiveTicker() {
  const box = $('#liveTicker');
  const track = $('#liveTickerTrack');
  if (!box || !track) return;
  const text = tickerItems.map(t => t.text).filter(Boolean).join('     •     ');
  box.hidden = !text;
  track.textContent = text ? `${text}     •     ${text}` : '';
}

// ============================================================
// TikTok connection events
// ============================================================
function wireTtEvents() {
  window.api.on('tt:connected', (info) => {
    $('#connDot').classList.add('live');
    $('#connDot').classList.remove('connecting');
    $('#connLabel').textContent = 'Đang LIVE';
    $('#connHost').textContent = `@${info.username}`;
    if ($('#hostInfo')) $('#hostInfo').hidden = false;
    if ($('#hostAvatar')) $('#hostAvatar').src = info.avatar || '../logo/hp-logo.png';
    if ($('#hostNick')) $('#hostNick').textContent = info.nickname || info.username;
    if ($('#hostHandle')) $('#hostHandle').textContent = '@' + info.username + (info.roomId ? ` · room ${info.roomId}` : '');
    if ($('#hostTitle')) $('#hostTitle').textContent = info.title || '';
    ttConnected = true;
    liveUsername = info.username || $('#ttUsername').value.trim();
    $('#btnConnect').disabled = false;
    $('#btnConnect').textContent = '■ Ngắt';
    $('#btnConnect').classList.remove('primary');
    $('#btnConnect').classList.add('ghost');
    toast(`✅ Kết nối @${info.username}`, 'success');
  });
  window.api.on('tt:disconnected', () => {
    $('#connDot').classList.remove('live', 'connecting');
    $('#connLabel').textContent = 'Đã ngắt';
    $('#connHost').textContent = '';
    ttConnected = false;
    liveUsername = '';
    $('#btnConnect').disabled = false;
    $('#btnConnect').textContent = '▶ Kết nối';
    $('#btnConnect').classList.add('primary');
    $('#btnConnect').classList.remove('ghost');
  });
  window.api.on('tt:error', (info) => {
    $('#connDot').classList.remove('live', 'connecting');
    $('#connLabel').textContent = 'Lỗi';
    toast('⚠ ' + (info.message || 'Lỗi kết nối'), 'error');
    ttConnected = false;
    liveUsername = '';
    $('#btnConnect').disabled = false;
    $('#btnConnect').textContent = '▶ Kết nối';
    $('#btnConnect').classList.add('primary');
    $('#btnConnect').classList.remove('ghost');
  });

  window.api.on('tt:chat', (d) => {
    const list = $('#chatList');
    const div = document.createElement('div');
    div.className = 'item chat-item';
    div.innerHTML = `
      <img class="avatar" src="${escapeAttr(d.avatar || '../logo/hp-logo.png')}" alt="" />
      <div>${levelBadge(d.level)}<span class="who">${escapeHtml(d.nickname || d.uniqueId)}</span><div class="comment">${escapeHtml(d.comment || '')}</div></div>
    `;
    const img = div.querySelector('.avatar');
    wireUserPopupAvatar(img, d);
    img.onerror = () => fillAvatarFromTikTok(img, d.uniqueId || d.userId || d.nickname);
    if (!d.avatar) fillAvatarFromTikTok(img, d.uniqueId || d.userId || d.nickname);
    prependLog(list, div);
  });

  window.api.on('tt:gift', (d) => {
    const shouldProcess = d.shouldProcess || d.repeatEnd;
    stats.gifts += shouldProcess ? Math.max(1, d.repeatCount) : 0;
    const giftDiamond = Number(d.diamondCount) || Number((giftMaster.find(g => String(g.id) === String(d.giftId)) || giftMaster.find(g => String(g.name || '').toLowerCase() === String(d.giftName || '').toLowerCase()))?.diamond) || 0;
    stats.diamond += shouldProcess ? giftDiamond * Math.max(1, d.repeatCount) : 0;
    if (d.uniqueId) stats.donors.add(d.uniqueId);
    if (shouldProcess) {
      const list = $('#giftList');
      const div = document.createElement('div');
      div.className = 'item gift-item';
      const repeat = Math.max(1, Number(d.repeatCount) || 1);
      const coinEach = giftDiamond;
      const totalCoin = coinEach * repeat;
      const donorKey = d.uniqueId || d.nickname || '';
      const isFirstGift = donorKey && !giftDonors.has(donorKey);
      if (donorKey) giftDonors.add(donorKey);
      div.innerHTML = `
        <img class="avatar" src="${escapeAttr(d.avatar || '../logo/hp-logo.png')}" alt="" />
        <div>
          ${levelBadge(d.level)}<span class="who">${escapeHtml(d.nickname || d.uniqueId)}</span>${isFirstGift ? '<span class="first-gift">Lần đầu tặng</span>' : ''}
          <div class="gift-line"><span class="gift-label">Quà tặng:</span>${d.giftIcon ? `<img class="gift-icon" src="${escapeAttr(d.giftIcon)}" alt="" />` : '🎁'}<span>${escapeHtml(String(d.giftId || ''))} - ${escapeHtml(d.giftName || '')}</span></div>
          <div class="gift-meta"><span>Số lần: x${formatCompact(repeat)}</span><span>Kim cương: ${formatCompact(totalCoin)}</span></div>
        </div>
      `;
      const avatar = div.querySelector('.avatar');
      wireUserPopupAvatar(avatar, d);
      avatar.onerror = () => fillAvatarFromTikTok(avatar, d.uniqueId || d.userId || d.nickname);
      if (!d.avatar) fillAvatarFromTikTok(avatar, d.uniqueId || d.userId || d.nickname);
      const giftIcon = div.querySelector('.gift-icon');
      if (giftIcon) wireGiftIconDrag(giftIcon, d.giftId, d.giftName);
      prependLog(list, div);
      if (isFirstGift) toast(`${d.nickname || d.uniqueId} lần đầu tặng quà`, 'success');
    }
    refreshStats();
  });

  window.api.on('tt:roomUser', (d) => { stats.viewers = d.viewerCount || 0; refreshStats(); });

  window.api.on('pkduo:state', (st) => renderPkPreview(st));
  window.api.on('ranking:state', (st) => renderRkPreview(st));
  window.api.on('score:state', (st) => renderScPreview(st));
}

function refreshStats() {
  $('#stViewers').textContent = formatNumber(stats.viewers);
  $('#stGifts').textContent = formatNumber(stats.gifts);
  $('#stDiamond').textContent = formatNumber(stats.diamond);
  $('#stDonors').textContent = formatNumber(stats.donors.size);
}

function setChatFontSize(size) {
  chatFontSize = Math.max(13, Math.min(30, Number(size) || 18));
  document.documentElement.style.setProperty('--chat-font-size', `${chatFontSize}px`);
}

function markLogInteraction(id) { logInteractAt[id] = Date.now(); }

function prependLog(list, div) {
  const active = Date.now() - (logInteractAt[list.id] || 0) < 10000;
  const before = list.scrollTop;
  list.prepend(div);
  while (list.childElementCount > 200) list.lastChild.remove();
  if (active) list.scrollTop = before + div.offsetHeight + 4;
  else list.scrollTop = 0;
}

async function fillAvatarFromTikTok(img, uniqueId) {
  const id = String(uniqueId || '').trim().replace(/^@/, '');
  if (!id || userAvatarCache.has(id)) {
    if (userAvatarCache.get(id)) img.src = userAvatarCache.get(id);
    return;
  }
  userAvatarCache.set(id, '');
  try {
    const p = await window.api.tt.fetchProfile(id);
    if (p?.avatar) {
      userAvatarCache.set(id, p.avatar);
      img.src = p.avatar;
    }
  } catch {}
}

function wireGiftIconDrag(img, giftId, giftName) {
  img.draggable = true;
  let preparing = false;
  async function prepare() {
    if (img.dataset.dragFile || preparing) return;
    preparing = true;
    try {
      const file = await window.api.shell.prepareGiftDrag({ url: img.src, giftId, giftName });
      if (file) img.dataset.dragFile = file;
    } catch {}
    finally { preparing = false; }
  }
  img.addEventListener('mouseenter', prepare);
  img.addEventListener('mousedown', prepare);
  img.addEventListener('dragstart', (e) => {
    if (img.dataset.dragFile) {
      e.preventDefault();
      window.api.shell.startGiftDrag(img.dataset.dragFile);
      return;
    }
    e.preventDefault();
    prepare().then(() => {
      if (img.dataset.dragFile) window.api.shell.startGiftDrag(img.dataset.dragFile);
      else toast('Đang chuẩn bị icon quà, kéo lại lần nữa.', 'error');
    });
  });
}

function openUserPopup(data) {
  $('#userPopupAvatar').src = data.avatar || '../logo/hp-logo.png';
  $('#userPopupName').textContent = data.nickname || data.uniqueId || 'Người dùng TikTok';
  $('#userPopupId').textContent = data.uniqueId ? '@' + data.uniqueId : '';
  $('#userPopupLevel').textContent = data.level ? `Lv ${data.level}` : '';
  $('#userPopupHeart').textContent = data.heartCount ? `❤ ${formatCompact(data.heartCount)}` : '';
  $('#userPopupFollowers').textContent = data.followerCount ? `Follow: ${formatCompact(data.followerCount)}` : '';
  $('#userPopupFollowing').textContent = data.followingCount ? `Đang follow: ${formatCompact(data.followingCount)}` : '';
  $('#userPopupBio').textContent = data.signature || '';
  $('#userPopup').hidden = false;
  hydrateUserPopup(data);
}

function closeUserPopup() { $('#userPopup').hidden = true; }

function wireUserPopupAvatar(img, data) {
  img.addEventListener('click', () => openUserPopup({
    avatar: img.src || data.avatar,
    nickname: data.nickname,
    uniqueId: data.uniqueId,
    level: data.level,
    heartCount: data.heartCount,
    followerCount: data.followerCount,
    followingCount: data.followingCount,
    signature: data.signature,
  }));
}

async function hydrateUserPopup(data) {
  if (data.followerCount || !data.uniqueId) return;
  try {
    const p = await window.api.tt.fetchProfile(data.uniqueId);
    if ($('#userPopup').hidden) return;
    if (p.avatar) $('#userPopupAvatar').src = p.avatar;
    if (p.nickname) $('#userPopupName').textContent = p.nickname;
    $('#userPopupHeart').textContent = p.heartCount ? `❤ ${formatCompact(p.heartCount)}` : $('#userPopupHeart').textContent;
    $('#userPopupFollowers').textContent = p.followerCount ? `Follow: ${formatCompact(p.followerCount)}` : $('#userPopupFollowers').textContent;
    $('#userPopupFollowing').textContent = p.followingCount ? `Đang follow: ${formatCompact(p.followingCount)}` : $('#userPopupFollowing').textContent;
    $('#userPopupBio').textContent = p.signature || $('#userPopupBio').textContent;
  } catch {}
}

function levelBadge(level) {
  return level ? `<span class="user-level">Lv ${escapeHtml(level)}</span>` : '';
}

// ============================================================
// Connect tab
// ============================================================
function wireConnectTab() {
  setChatFontSize(chatFontSize);
  $('#chatFontDown').addEventListener('click', () => setChatFontSize(chatFontSize - 1));
  $('#chatFontUp').addEventListener('click', () => setChatFontSize(chatFontSize + 1));
  $('#userPopupClose').addEventListener('click', closeUserPopup);
  $('#userPopup').addEventListener('mousedown', e => { if (e.target === $('#userPopup')) closeUserPopup(); });
  $('#connDot').addEventListener('click', () => {
    const username = String(liveUsername || $('#ttUsername').value || '').trim().replace(/^@/, '');
    if (!ttConnected || !username) return;
    window.api.shell.openExternal(`https://tiktok.com/@${encodeURIComponent(username)}/live`);
  });
  ['chatList', 'giftList'].forEach(id => {
    const el = $('#' + id);
    el.addEventListener('mouseenter', () => markLogInteraction(id));
    el.addEventListener('mousemove', () => markLogInteraction(id));
    el.addEventListener('wheel', () => markLogInteraction(id), { passive: true });
  });
  $('#btnConnect').addEventListener('click', async () => {
    if (ttConnected) {
      const ok = await askConfirm('Bạn có muốn ngắt kết nối TikTok LIVE?', 'Ngắt kết nối');
      if (!ok) return;
      $('#btnConnect').disabled = true;
      try {
        await window.api.tt.disconnect();
        toast('Đã ngắt kết nối');
      } finally {
        $('#btnConnect').disabled = false;
      }
      return;
    }
    const u = $('#ttUsername').value.trim();
    if (!u) { toast('Nhập @username trước đã.', 'error'); return; }
    $('#connDot').classList.add('connecting');
    $('#connLabel').textContent = 'Đang kết nối...';
    $('#btnConnect').disabled = true;
    try { await window.api.tt.connect(u); } catch (e) { toast('⚠ ' + e.message, 'error'); }
  });
  $('#ttUsername').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnConnect').click(); });
}

// ============================================================
// Creators
// ============================================================
async function refreshCreators() {
  creators = await window.api.creators.list();
  renderCreators();
  renderCreatorGroupSelect();
  renderPkCreatorSelects?.();
  renderScoreCreatorSelect?.();
}

function renderCreators() {
  const list = $('#creatorsList');
  const countEl = $('#crCount');
  if (countEl) countEl.textContent = creators.length ? `${creators.length}` : '';
  list.innerHTML = '';
  if (creators.length === 0) {
    list.innerHTML = '<div class="hint">Chưa có Creator nào. Hãy thêm Creator đầu tiên.</div>';
    return;
  }
  const groupsById = new Map(groups.map(g => [g.id, g]));
  const buckets = new Map();
  for (const c of creators) {
    const key = c.groupId && groupsById.has(c.groupId) ? c.groupId : '__ungrouped';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(c);
  }
  const groupKeys = Array.from(buckets.keys()).sort((a, b) => {
    if (a === '__ungrouped') return 1;
    if (b === '__ungrouped') return -1;
    return (groupsById.get(a)?.name || '').localeCompare(groupsById.get(b)?.name || '', 'vi');
  });
  const groupedCount = groupKeys.filter(k => k !== '__ungrouped').length;
  const summary = document.createElement('div');
  summary.className = 'creator-summary';
  summary.innerHTML = `<span>Tổng <b>${formatNumber(creators.length)}</b> Creator</span><span>·</span><span><b>${formatNumber(groupedCount)}</b> nhóm có thành viên</span>`;
  list.appendChild(summary);
  for (const key of groupKeys) {
    const members = buckets.get(key).slice().sort((a, b) => (a.nickname || a.tiktokId || '').localeCompare(b.nickname || b.tiktokId || '', 'vi'));
    const group = groupsById.get(key);
    const groupName = group?.name || 'Chưa thuộc nhóm';
    const groupColor = group?.color || '#9CA3AF';
    const isCollapsed = collapsedCreatorGroups.has(key);
    const groupWrap = document.createElement('div');
    groupWrap.className = `creator-group${isCollapsed ? ' is-collapsed' : ''}`;
    groupWrap.innerHTML = `
      <button class="creator-group-head" type="button" data-toggle-group="${escapeAttr(key)}">
        <span class="creator-group-title"><i class="creator-group-color" style="background:${escapeAttr(groupColor)}"></i>${escapeHtml(groupName)}</span>
        <span class="creator-group-meta">${formatNumber(members.length)} thành viên · ${isCollapsed ? 'Hiện' : 'Ẩn'}</span>
      </button>
      <div class="creator-group-body"></div>
    `;
    const body = groupWrap.querySelector('.creator-group-body');
    for (const c of members) {
      body.appendChild(createCreatorRow(c, group));
    }
    list.appendChild(groupWrap);
  }
  list.querySelectorAll('[data-toggle-group]').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.toggleGroup;
    if (collapsedCreatorGroups.has(key)) collapsedCreatorGroups.delete(key);
    else collapsedCreatorGroups.add(key);
    renderCreators();
  }));
  list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editCreator(b.dataset.edit)));
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Xoá Creator này?')) return;
    await window.api.creators.remove(b.dataset.del);
    await refreshCreators();
    toast('Đã xoá Creator', 'success');
  }));
}

async function updateCreatorQuick(creator) {
  await window.api.creators.upsert(creator);
  await refreshCreators();
  toast('🔄 Đã cập nhật Creator', 'success');
}

function createCreatorRow(c, g) {
  const creatorKey = c.id || c.tiktokId || '';
  const div = document.createElement('div');
  div.className = 'creator-card';
  div.innerHTML = `
      <img class="cc-ava" src="${escapeAttr(c.avatar || '../logo/hp-logo.png')}" />
      <div class="cc-body">
        <div class="cc-meta">
          <span class="cc-name">${escapeHtml(c.nickname || c.tiktokId)}</span>
          <span>@${escapeHtml(c.tiktokId)}</span>
        </div>
        <div class="cc-meta">
          ${g ? `<span class="cc-group-pill" style="background:${escapeAttr(g.color || '#FE2C55')}">${escapeHtml(g.name)}</span>` : '<span>Chưa thuộc nhóm</span>'}
        </div>
        <div class="cc-gift">
          ${c.defaultGiftIcon ? `<img src="${escapeAttr(c.defaultGiftIcon)}" />` : '🎁'}
          <span>${escapeHtml(c.defaultGiftName || '(chưa đặt quà mặc định)')}</span>
        </div>
      </div>
      <div class="cc-actions">
        <button class="ghost tiny" data-edit="${escapeAttr(creatorKey)}" type="button">Cài đặt</button>
        <button class="warn tiny" data-del="${escapeAttr(creatorKey)}" type="button" title="Xoá">🗑</button>
      </div>
    `;
  return div;
}

function renderCreatorGroupSelect() {
  const sel = $('#crGroup');
  const current = sel.value;
  sel.innerHTML = '<option value="">— Không thuộc nhóm —</option>';
  for (const g of groups) {
    const opt = document.createElement('option');
    opt.value = g.id; opt.textContent = g.name;
    sel.appendChild(opt);
  }
  sel.value = current;
}

function clearCreatorForm() {
  currentEditingCreator = null;
  $('#crTiktokId').value = '';
  $('#crNickname').value = '';
  $('#crGroup').value = '';
  $('#crAvatarUrl').value = '';
  $('#crAvatarPreview').src = '../logo/hp-logo.png';
  $('#crChannel').textContent = '';
  setCreatorGiftDisplay(null);
}

function setCreatorGiftDisplay(g) {
  $('#crGiftId').value = g?.id || '';
  $('#crGiftName').value = g?.name || '';
  $('#crGiftIcon').value = g?.icon || '';
  $('#crGiftDisplay').textContent = g ? `${g.name} · 🪙 ${g.diamond}` : '🎁 Chọn quà';
  $('#crGiftIconPreview').src = g?.icon || '';
}

function editCreator(id) {
  const c = creators.find(x => x.id === id || (!x.id && x.tiktokId === id));
  if (!c) { toast('Không tìm thấy creator này', 'error'); return; }
  currentEditingCreator = c;
  $('#crTiktokId').value = c.tiktokId || '';
  $('#crNickname').value = c.nickname || '';
  $('#crGroup').value = c.groupId || '';
  $('#crAvatarUrl').value = c.avatar || '';
  $('#crAvatarPreview').src = c.avatar || '../logo/hp-logo.png';
  $('#crChannel').textContent = c.channelName || '';
  if (c.defaultGiftId || c.defaultGiftName) {
    const m = giftMaster.find(g => String(g.id) === String(c.defaultGiftId)) || giftMaster.find(g => g.name.toLowerCase() === String(c.defaultGiftName || '').toLowerCase());
    setCreatorGiftDisplay(m || { id: c.defaultGiftId, name: c.defaultGiftName, icon: c.defaultGiftIcon, diamond: 0 });
  } else {
    setCreatorGiftDisplay(null);
  }
  // Scroll to top form
  $('#crTiktokId').focus();
  $('#crTiktokId').scrollIntoView({ block: 'start', behavior: 'smooth' });
  toast(`✏️ Đang sửa: ${c.nickname || c.tiktokId}`);
}

function wireCreatorTab() {
  $('#btnPickCrGift').addEventListener('click', async () => {
    const usedBy = creatorGiftUsage(currentEditingCreator?.id || '');
    const g = await GiftPicker.open({
      title: '🎁 Chọn quà mặc định cho Creator',
      disabledIds: Object.keys(usedBy),
      usedBy,
    });
    if (g) setCreatorGiftDisplay(g);
  });

  // Auto-fetch profile khi blur TikTok ID (debounced) — không cần bấm nút
  let lastFetchedId = '';
  async function autoFetchCreator(force = false) {
    const u = $('#crTiktokId').value.trim().replace(/^@/, '');
    if (!u) { toast('Nhập TikTok ID trước đã.', 'error'); return; }
    if (!force && u === lastFetchedId) return;
    lastFetchedId = u;
    $('#crSpinner').hidden = false;
    $('#btnLoadCreator').disabled = true;
    try {
      const p = await window.api.tt.fetchProfile(u);
      if (p.found) {
        if (p.nickname) {
          // Auto-fill cả Nick name nếu user chưa edit, và channel name
          if (!$('#crNickname').value || !currentEditingCreator) $('#crNickname').value = p.nickname;
          $('#crChannel').textContent = p.nickname;
        }
        if (p.avatar) {
          $('#crAvatarUrl').value = p.avatar;
          $('#crAvatarPreview').src = p.avatar;
        } else {
          $('#crAvatarUrl').value = '';
          $('#crAvatarPreview').src = '../logo/hp-logo.png';
        }
        toast('Đã tải Nick Name và Avatar', 'success');
      } else {
        toast('Không tìm thấy profile, vẫn có thể lưu thủ công.', 'error');
      }
    } catch (e) { toast('Không tải được profile: ' + (e.message || 'lỗi không xác định'), 'error'); }
    finally {
      $('#crSpinner').hidden = true;
      $('#btnLoadCreator').disabled = false;
    }
  }
  $('#crTiktokId').addEventListener('blur', autoFetchCreator);
  $('#crTiktokId').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); autoFetchCreator(true); }
  });
  $('#btnLoadCreator').addEventListener('click', () => autoFetchCreator(true));

  $('#btnNewCreator').addEventListener('click', () => { clearCreatorForm(); lastFetchedId = ''; });
  $('#btnRefreshCreatorInfo').addEventListener('click', async () => {
    await refreshGroups();
    await refreshCreators();
    await window.api.ranking.setConfig({});
    toast('🔄 Đã cập nhật thông tin đã setup', 'success');
  });

  $('#btnSaveCreator').addEventListener('click', async () => {
    const tiktokId = $('#crTiktokId').value.trim().replace(/^@/, '');
    if (!tiktokId) { toast('Cần nhập TikTok ID', 'error'); return; }
    const giftId = $('#crGiftId').value.trim();
    if (giftId && creators.some(c => c.id !== currentEditingCreator?.id && String(c.defaultGiftId) === String(giftId))) {
      const owner = creators.find(c => c.id !== currentEditingCreator?.id && String(c.defaultGiftId) === String(giftId));
      toast(`Quà này đã được chọn bởi ${owner?.nickname || owner?.tiktokId || 'Creator khác'}`, 'error');
      return;
    }
    const payload = {
      id: currentEditingCreator?.id,
      tiktokId,
      nickname: $('#crNickname').value.trim() || tiktokId,
      channelName: $('#crChannel').textContent || '',
      groupId: $('#crGroup').value,
      avatar: $('#crAvatarUrl').value.trim(),
      defaultGiftName: $('#crGiftName').value.trim(),
      defaultGiftId: giftId,
      defaultGiftIcon: $('#crGiftIcon').value.trim(),
    };
    const wasEditing = !!currentEditingCreator;
    await window.api.creators.upsert(payload);
    await refreshCreators();
    clearCreatorForm();
    lastFetchedId = '';
    toast(wasEditing ? '✅ Đã cập nhật Creator' : '💾 Đã thêm Creator', 'success');
  });
}

// ============================================================
// Groups
// ============================================================
async function refreshGroups() {
  groups = await window.api.groups.list();
  renderGroups();
  renderCreatorGroupSelect();
  renderCreators();
  renderPkCreatorSelects?.();
  renderScoreCreatorSelect?.();
}

function renderGroups() {
  const list = $('#groupsList');
  const countEl = $('#grCount');
  if (countEl) countEl.textContent = groups.length ? `${groups.length}` : '';
  list.innerHTML = '';
  if (groups.length === 0) {
    list.innerHTML = '<div class="hint">Chưa có nhóm nào.</div>';
    return;
  }
  for (const g of groups) {
    const cnt = groupMemberCount(g);
    const color = g.color || colorFromId(g.tiktokId || g.id);
    const groupKey = g.id || g.tiktokId || '';
    const div = document.createElement('div');
    div.className = 'group-card';
    div.innerHTML = `
      <div class="gc-head">
        <img class="gc-avatar" src="${escapeAttr(g.avatar || '../logo/hp-logo.png')}" alt="" style="border-color:${escapeAttr(color)}" />
        <div class="gc-info">
          <strong>${escapeHtml(g.name)}</strong>
          <span class="gc-handle">@${escapeHtml(g.tiktokId || '—')}</span>
        </div>
        <span class="gc-count">${cnt} thành viên</span>
      </div>
      <div class="gc-actions">
        <button class="ghost tiny" data-edit="${escapeAttr(groupKey)}" type="button">✏️ Sửa</button>
        <button class="warn tiny" data-del="${escapeAttr(groupKey)}" type="button">🗑 Xoá</button>
      </div>
    `;
    list.appendChild(div);
  }
  list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editGroup(b.dataset.edit)));
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (confirm('Xoá nhóm này? Creator thuộc nhóm sẽ thành chưa-nhóm.')) {
      await window.api.groups.remove(b.dataset.del); await refreshGroups();
    }
  }));
}

function clearGroupForm() {
  currentEditingGroup = null;
  $('#grTiktokId').value = '';
  $('#grName').value = '';
  $('#grAvatar').value = '';
  $('#grAvatarPreview').src = '../logo/hp-logo.png';
  $('#grChannel').textContent = '';
}

function editGroup(id) {
  const g = groups.find(x => x.id === id || (!x.id && x.tiktokId === id));
  if (!g) { toast('Không tìm thấy nhóm này', 'error'); return; }
  currentEditingGroup = g;
  $('#grTiktokId').value = g.tiktokId || '';
  $('#grName').value = g.name || '';
  $('#grAvatar').value = g.avatar || '';
  $('#grAvatarPreview').src = g.avatar || '../logo/hp-logo.png';
  $('#grChannel').textContent = groupInfoText(g, g.channelName || '');
  $('#grTiktokId').focus();
  $('#grTiktokId').scrollIntoView({ block: 'start', behavior: 'smooth' });
  toast(`✏️ Đang sửa: ${g.name}`);
}

function wireGroupTab() {
  let lastFetchedGroupId = '';

  async function autoFetchGroup(force = false) {
    const u = $('#grTiktokId').value.trim().replace(/^@/, '');
    if (!u) { toast('Nhập ID nhóm trước đã.', 'error'); return; }
    if (!force && u === lastFetchedGroupId) return;
    lastFetchedGroupId = u;
    $('#grSpinner').hidden = false;
    $('#btnLoadGroup').disabled = true;
    try {
      const p = await window.api.tt.fetchProfile(u);
      if (p.found) {
        if (p.nickname) {
          if (!$('#grName').value || !currentEditingGroup) $('#grName').value = p.nickname;
          $('#grChannel').textContent = groupInfoText({ id: currentEditingGroup?.id, tiktokId: u }, p.nickname);
        }
        if (p.avatar) {
          $('#grAvatar').value = p.avatar;
          $('#grAvatarPreview').src = p.avatar;
        } else {
          $('#grAvatar').value = '';
          $('#grAvatarPreview').src = '../logo/hp-logo.png';
        }
        toast('Đã tải Avatar và tên nhóm', 'success');
      } else {
        toast('Không tìm thấy nhóm, vẫn có thể lưu thủ công.', 'error');
      }
    } catch (e) { toast('Không tải được nhóm: ' + (e.message || 'lỗi không xác định'), 'error'); }
    finally {
      $('#grSpinner').hidden = true;
      $('#btnLoadGroup').disabled = false;
    }
  }
  $('#grTiktokId').addEventListener('blur', autoFetchGroup);
  $('#grTiktokId').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); autoFetchGroup(true); }
  });
  $('#btnLoadGroup').addEventListener('click', () => autoFetchGroup(true));

  $('#btnNewGroup').addEventListener('click', () => { clearGroupForm(); lastFetchedGroupId = ''; });

  $('#btnSaveGroup').addEventListener('click', async () => {
    const tiktokId = $('#grTiktokId').value.trim().replace(/^@/, '');
    const name = $('#grName').value.trim();
    if (!tiktokId) { toast('Cần ID nhóm (TikTok ID)', 'error'); return; }
    if (!name) { toast('Cần tên nhóm', 'error'); return; }
    const duplicate = groups.find(g => g.id !== currentEditingGroup?.id && normalizeId(g.tiktokId) === normalizeId(tiktokId));
    if (duplicate) {
      toast(`ID nhóm @${tiktokId} đã tồn tại: ${duplicate.name}`, 'error');
      return;
    }
    const payload = {
      id: currentEditingGroup?.id,
      tiktokId,
      name,
      channelName: $('#grChannel').textContent || '',
      avatar: $('#grAvatar').value.trim(),
      color: colorFromId(tiktokId),
    };
    const wasEditing = !!currentEditingGroup;
    await window.api.groups.upsert(payload);
    await refreshGroups();
    clearGroupForm();
    lastFetchedGroupId = '';
    toast(wasEditing ? '✅ Đã cập nhật nhóm' : '💾 Đã thêm nhóm', 'success');
  });
}

function groupMemberCount(group) {
  if (!group) return 0;
  return creators.filter(c => c.groupId === group.id).length;
}

function groupInfoText(group, name) {
  const cnt = groupMemberCount(group);
  return [name, `${cnt} thành viên`].filter(Boolean).join(' · ');
}

// Deterministic color từ string id — dùng cho ranking badge khi user không chọn màu thủ công
function colorFromId(id) {
  if (!id) return '#FE2C55';
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash << 5) - hash + id.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 72%, 52%)`;
}

// ============================================================
// PK Đôi
// ============================================================
async function loadPkConfig() {
  const st = await window.api.pkduo.getState();
  pkCfg = {
    teamA: normalizePkTeam(st.teamA, { name: 'TEAM A', color: '#FE2C55' }),
    teamB: normalizePkTeam(st.teamB, { name: 'TEAM B', color: '#25F4EE' }),
    durationSec: st.durationSec || 90, prepSec: st.prepSec ?? 3, delaySec: st.delaySec ?? 5,
    joinMode: !!st.joinMode, pointsBy: st.pointsBy || 'diamond',
    bgColor: st.bgColor || '#000000', bgOpacity: st.bgOpacity ?? 88,
    giftSize: st.giftSize || 46, textSize: st.textSize || 21,
    giftDisplayMode: st.giftDisplayMode || 'scroll',
    content: st.content || 'PK ĐÔI',
    startSound: st.startSound || '', warningSound: st.warningSound || '', teamASound: st.teamASound || '', teamBSound: st.teamBSound || '', drawSound: st.drawSound || '',
  };
  syncPkActiveGifts();
  renderPkCreatorSelects();
  $('#pkContent').value = pkCfg.content || '';
  $('#pkAname').value = pkCfg.teamA?.name || 'TEAM A';
  $('#pkAcolor').value = pkCfg.teamA?.color || '#FE2C55';
  $('#pkBname').value = pkCfg.teamB?.name || 'TEAM B';
  $('#pkBcolor').value = pkCfg.teamB?.color || '#25F4EE';
  $('#pkAgroup').value = pkCfg.teamA?.groupId || '';
  $('#pkBgroup').value = pkCfg.teamB?.groupId || '';
  renderPkCreatorSelect('A');
  renderPkCreatorSelect('B');
  $('#pkAcreator').value = pkCfg.teamA?.creatorId || '';
  $('#pkBcreator').value = pkCfg.teamB?.creatorId || '';
  // Tách durationSec → h/m/s
  const d = pkCfg.durationSec || 300;
  $('#pkDurH').value = Math.floor(d / 3600);
  $('#pkDurM').value = Math.floor((d % 3600) / 60);
  $('#pkDurS').value = d % 60;
  $('#pkPrep').value = pkCfg.prepSec;
  $('#pkDelay').value = pkCfg.delaySec;
  $('#pkJoinMode').value = String(pkCfg.joinMode);
  $('#pkPointsBy').value = pkCfg.pointsBy;
  $('#pkBg').value = pkCfg.bgColor;
  $('#pkBgOpacity').value = pkCfg.bgOpacity;
  $('#pkBgOpacityValue').textContent = `${pkCfg.bgOpacity}%`;
  $('#pkGiftSize').value = pkCfg.giftSize;
  $('#pkGiftDisplayMode').value = pkCfg.giftDisplayMode || 'scroll';
  $('#pkTextSize').value = pkCfg.textSize;
  setSoundInput('pkSndStart', pkCfg.startSound || '');
  setSoundInput('pkSndWarn', pkCfg.warningSound || '');
  setSoundInput('pkSndAwin', pkCfg.teamASound || '');
  setSoundInput('pkSndBwin', pkCfg.teamBSound || '');
  setSoundInput('pkSndDraw', pkCfg.drawSound || '');
  renderPkGifts();
  renderPkPreview(st);
}

function normalizePkTeam(team, fallback) {
  const t = { ...fallback, ...(team || {}) };
  t.fixedGifts = Array.isArray(t.fixedGifts) ? t.fixedGifts : (Array.isArray(t.gifts) ? t.gifts : []);
  t.joinGifts = Array.isArray(t.joinGifts) ? t.joinGifts : [];
  t.gifts = Array.isArray(t.gifts) ? t.gifts : t.fixedGifts;
  return t;
}

function syncPkActiveGifts() {
  if (!pkCfg) return;
  const key = pkCfg.joinMode ? 'joinGifts' : 'fixedGifts';
  pkCfg.teamA.gifts = pkCfg.teamA[key] || [];
  pkCfg.teamB.gifts = pkCfg.teamB[key] || [];
}

function savePkActiveGifts() {
  const key = pkGiftModeKey();
  pkCfg.teamA[key] = pkCfg.teamA.gifts || [];
  pkCfg.teamB[key] = pkCfg.teamB.gifts || [];
}

function renderPkCreatorSelects() {
  if (!pkCfg || !$('#pkAgroup')) return;
  for (const side of ['A', 'B']) {
    const groupSel = $(`#pk${side}group`);
    const current = groupSel.value || getTeam(side).groupId || '';
    groupSel.innerHTML = '<option value="">— Chọn nhóm —</option>' + groups.map(g => `<option value="${escapeAttr(g.id)}">${escapeHtml(g.name)}</option>`).join('');
    groupSel.value = current;
    renderPkCreatorSelect(side);
  }
}

function renderPkCreatorSelect(side) {
  const team = getTeam(side);
  const groupId = $(`#pk${side}group`)?.value || team.groupId || '';
  const sel = $(`#pk${side}creator`);
  if (!sel) return;
  const current = sel.value || team.creatorId || '';
  const filtered = creators.filter(c => !groupId || c.groupId === groupId);
  sel.innerHTML = '<option value="">— Chọn creator —</option>' + filtered.map(c => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.nickname || c.tiktokId)}</option>`).join('');
  sel.value = filtered.some(c => c.id === current) ? current : '';
}

function applyPkCreator(side) {
  const team = getTeam(side);
  const group = groups.find(g => g.id === $(`#pk${side}group`).value);
  const creator = creators.find(c => c.id === $(`#pk${side}creator`).value);
  team.groupId = group?.id || '';
  team.groupName = group?.name || '';
  team.creatorId = creator?.id || '';
  team.creatorName = creator?.nickname || creator?.tiktokId || '';
  team.creatorAvatar = creator?.avatar || '../logo/hp-logo.png';
  if (group?.color) team.color = group.color;
  if (creator && pkCfg?.joinMode) {
    const gift = creatorDefaultGift(creator);
    if (gift) {
      team.joinGifts = [gift];
      team.gifts = team.joinGifts;
      renderPkGifts();
    }
  }
  $(`#pk${side}name`).value = team.name || (side === 'A' ? 'TEAM A' : 'TEAM B');
  $(`#pk${side}color`).value = normalizeHexColor(team.color, side === 'A' ? '#FE2C55' : '#25F4EE');
}

function creatorDefaultGift(creator) {
  if (!creator?.defaultGiftId && !creator?.defaultGiftName) return null;
  const master = giftMaster.find(g => String(g.id) === String(creator.defaultGiftId))
    || giftMaster.find(g => g.name.toLowerCase() === String(creator.defaultGiftName || '').toLowerCase());
  return giftToPkGift(master || {
    id: creator.defaultGiftId,
    name: creator.defaultGiftName,
    icon: creator.defaultGiftIcon,
    diamond: 0,
  });
}

function normalizeHexColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
}

function renderPkGifts() {
  for (const side of ['A', 'B']) {
    const wrap = $(`#pk${side}gifts`);
    wrap.dataset.team = side;
    wrap.innerHTML = '';
    const team = side === 'A' ? pkCfg.teamA : pkCfg.teamB;
    (team.gifts || []).forEach((g, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.title = g.giftName || g.giftId || '';
      chip.draggable = true;
      chip.dataset.side = side;
      chip.dataset.index = String(i);
      chip.innerHTML = `${g.icon ? `<img src="${escapeAttr(g.icon)}" />` : '🎁'}<button type="button">×</button>`;
      chip.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-pk-gift', JSON.stringify({ side, index: i }));
        chip.classList.add('dragging');
      });
      chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
      chip.querySelector('button').addEventListener('click', () => {
        team.gifts.splice(i, 1);
        savePkActiveGifts();
        renderPkGifts();
        schedulePkAutoSave();
      });
      wrap.appendChild(chip);
    });
  }
}

function pkDropIndex(zone, e) {
  const chips = Array.from(zone.querySelectorAll('.chip:not(.dragging)'));
  for (const chip of chips) {
    const rect = chip.getBoundingClientRect();
    const isAfter = e.clientY > rect.top + rect.height / 2 || (Math.abs(e.clientY - (rect.top + rect.height / 2)) < rect.height / 2 && e.clientX > rect.left + rect.width / 2);
    if (e.clientY < rect.bottom && e.clientX < rect.right) return Number(chip.dataset.index || 0) + (isAfter ? 1 : 0);
  }
  return chips.length;
}

function movePkGift(fromSide, toSide, index, toIndex = null) {
  if (!['A', 'B'].includes(fromSide) || !['A', 'B'].includes(toSide)) return false;
  const fromTeam = getTeam(fromSide);
  const toTeam = getTeam(toSide);
  const gift = fromTeam.gifts?.[index];
  if (!gift) return false;
  toTeam.gifts = toTeam.gifts || [];
  const giftId = String(gift.giftId || gift.id || '');
  if (fromSide !== toSide && giftId && toTeam.gifts.some(g => String(g.giftId || g.id || '') === giftId)) return false;
  fromTeam.gifts.splice(index, 1);
  let insertAt = Number.isFinite(Number(toIndex)) ? Number(toIndex) : toTeam.gifts.length;
  if (fromSide === toSide && insertAt > index) insertAt -= 1;
  insertAt = Math.max(0, Math.min(toTeam.gifts.length, insertAt));
  toTeam.gifts.splice(insertAt, 0, gift);
  savePkActiveGifts();
  renderPkGifts();
  return { moved: true, reordered: fromSide === toSide };
}

function pkGiftIds(side) {
  const team = side === 'A' ? pkCfg.teamA : pkCfg.teamB;
  return new Set((team.gifts || []).map(g => String(g.giftId)));
}

function addPkGifts(side, gifts) {
  const team = side === 'A' ? pkCfg.teamA : pkCfg.teamB;
  const other = side === 'A' ? pkCfg.teamB : pkCfg.teamA;
  team.gifts = team.gifts || [];
  const existing = new Set(team.gifts.map(g => String(g.giftId)));
  const blocked = new Set((other.gifts || []).map(g => String(g.giftId)));
  const added = [];
  for (const g of gifts) {
    const id = String(g.id || g.giftId);
    if (existing.has(id) || blocked.has(id)) continue;
    const pkGift = g.giftName ? g : giftToPkGift(g);
    team.gifts.push(pkGift);
    existing.add(id);
    added.push(pkGift);
  }
  return added;
}

function schedulePkAutoSave() {
  clearTimeout(pkConfigAutoTimer);
  pkConfigAutoTimer = setTimeout(async () => {
    try {
      if (pkCfg) await window.api.pkduo.setConfig(collectPkCfg());
    } catch {}
  }, 250);
}

function wirePkDuoTab() {
  $('#pkJoinMode').addEventListener('change', () => {
    savePkActiveGifts();
    pkCfg.joinMode = $('#pkJoinMode').value === 'true';
    syncPkActiveGifts();
    if (pkCfg.joinMode) {
      applyPkCreator('A');
      applyPkCreator('B');
    }
    renderPkGifts();
    schedulePkAutoSave();
    toast(pkCfg.joinMode ? 'Đang chỉnh bảng quà Chọn Phe' : 'Đang chỉnh bảng quà Cố định');
  });

  for (const side of ['A', 'B']) {
    $(`#pk${side}group`).addEventListener('change', () => {
      getTeam(side).groupId = $(`#pk${side}group`).value;
      renderPkCreatorSelect(side);
      applyPkCreator(side);
      schedulePkAutoSave();
    });
    $(`#pk${side}creator`).addEventListener('change', () => {
      applyPkCreator(side);
      schedulePkAutoSave();
    });
  }

  $$('.pk-pick-master').forEach(btn => btn.addEventListener('click', async () => {
    const side = btn.dataset.team;
    const selected = await GiftPicker.open({
      title: `🎁 Chọn nhiều quà cho Đội ${side}`,
      multi: true,
      excludeIds: [...pkGiftIds(side === 'A' ? 'B' : 'A')],
      selected: [...pkGiftIds(side)],
    });
    if (!selected || !selected.length) return;
    const added = addPkGifts(side, selected);
    savePkActiveGifts();
    renderPkGifts();
    schedulePkAutoSave();
    toast(`Đã thêm ${added.length} quà cho Đội ${side}`, added.length ? 'success' : 'error');
  }));

  $$('.pk-gifts').forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      if (!Array.from(e.dataTransfer.types || []).includes('application/x-pk-gift')) return;
      e.preventDefault();
      zone.classList.add('drag-over');
      e.dataTransfer.dropEffect = 'move';
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/x-pk-gift') || '{}');
        const result = movePkGift(data.side, zone.dataset.team, Number(data.index), pkDropIndex(zone, e));
        if (result?.moved) {
          schedulePkAutoSave();
          toast(result.reordered ? `Đã sắp xếp quà Team ${zone.dataset.team}` : `Đã chuyển quà sang Team ${zone.dataset.team}`, 'success');
        }
      } catch {}
    });
  });

  $$('.pk-sound-file').forEach(btn => btn.addEventListener('click', async () => {
    const file = await window.api.shell.pickAudio();
    if (file) {
      setSoundInput(btn.dataset.target, filePathToUrl(file));
      await window.api.pkduo.setConfig(collectPkCfg());
      toast('Đã lưu âm thanh PK Đôi', 'success');
    }
  }));

  $('#pkBgOpacity').addEventListener('input', () => { $('#pkBgOpacityValue').textContent = `${$('#pkBgOpacity').value}%`; });
  ['pkContent','pkAname','pkBname','pkAcolor','pkBcolor','pkDurH','pkDurM','pkDurS','pkPrep','pkDelay','pkPointsBy','pkBg','pkBgOpacity','pkTextSize','pkGiftSize','pkGiftDisplayMode'].forEach(id => {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input', schedulePkAutoSave);
  });

  $('#pkSaveCfg').addEventListener('click', async () => {
    await updatePkConfig();
  });
  document.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && $('.panel[data-panel="pkduo"]')?.classList.contains('active')) {
      e.preventDefault();
      await updatePkConfig();
    }
  });
  $('#pkStart').addEventListener('click', async () => {
    if ($('#pkStart').dataset.running === 'true') {
      await window.api.pkduo.stop();
      return;
    }
    await window.api.pkduo.setConfig(collectPkCfg());
    await window.api.pkduo.start();
  });
  $('#pkReset').addEventListener('click', async () => { await window.api.pkduo.reset(); });
  $('#pkAddA').addEventListener('click', async () => { await window.api.pkduo.addPoints('A', 1); });
  $('#pkAddB').addEventListener('click', async () => { await window.api.pkduo.addPoints('B', 1); });
  $('#pkCopyUrl').addEventListener('click', async () => {
    const url = await window.api.pkduo.getUrl();
    await window.api.shell.copyText(url);
    toast('📋 Đã copy link PK Đôi', 'success');
  });
}

async function updatePkConfig() {
  const cfg = collectPkCfg();
  await window.api.pkduo.setConfig(cfg);
  toast('🔄 Đã cập nhật PK Đôi', 'success');
}

function collectPkCfg() {
  savePkActiveGifts();
  applyPkCreator('A');
  applyPkCreator('B');
  const h = Number($('#pkDurH').value) || 0;
  const m = Number($('#pkDurM').value) || 0;
  const s = Number($('#pkDurS').value) || 0;
  const durationSec = Math.max(5, h * 3600 + m * 60 + s);
  return {
    teamA: { ...pkCfg.teamA, name: $('#pkAname').value.trim() || 'TEAM A', color: $('#pkAcolor').value, gifts: pkCfg.teamA.gifts || [] },
    teamB: { ...pkCfg.teamB, name: $('#pkBname').value.trim() || 'TEAM B', color: $('#pkBcolor').value, gifts: pkCfg.teamB.gifts || [] },
    durationSec,
    prepSec: Number($('#pkPrep').value) || 0,
    delaySec: Number($('#pkDelay').value) || 0,
    joinMode: $('#pkJoinMode').value === 'true',
    pointsBy: $('#pkPointsBy').value,
    bgColor: $('#pkBg').value,
    bgOpacity: Number($('#pkBgOpacity').value),
    giftSize: Number($('#pkGiftSize').value),
    giftDisplayMode: $('#pkGiftDisplayMode').value,
    textSize: Number($('#pkTextSize').value),
    content: $('#pkContent').value.trim() || 'PK ĐÔI',
    startSound: gameplaySoundValue('scSndStart'),
    warningSound: gameplaySoundValue('scSndWarn'),
    teamASound: gameplaySoundValue('scSndSuccess'),
    teamBSound: gameplaySoundValue('scSndSuccess'),
    drawSound: gameplaySoundValue('scSndFail'),
  };
}

function renderPkPreview(st) {
  const sec = Math.ceil((st.remainingMs || 0) / 1000);
  const statusText = st.status === 'prestart' ? `Sắp bắt đầu — ${sec}s`
    : st.status === 'running' ? `Đang đấu — ${sec}s`
    : st.status === 'grace' ? 'ĐANG TÍNH ĐIỂM'
    : st.status === 'finished' ? 'Đã kết thúc'
    : 'Chờ bắt đầu';
  const a = st.teamA || {}; const b = st.teamB || {};
  if (pkCfg) {
    pkCfg.teamA = { ...pkCfg.teamA, ...a };
    pkCfg.teamB = { ...pkCfg.teamB, ...b };
  }
  const running = st.status === 'prestart' || st.status === 'running' || st.status === 'grace';
  const startBtn = $('#pkStart');
  if (startBtn) {
    startBtn.dataset.running = running ? 'true' : 'false';
    startBtn.textContent = running ? '■ DỪNG' : '▶ BẮT ĐẦU';
    startBtn.classList.toggle('primary', !running);
    startBtn.classList.toggle('warn', running);
  }
  $('#pkPreview').innerHTML = `
    <div style="display:flex; flex-direction:column; gap:8px; width:100%; max-width:680px">
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; align-items:center; font-size:13px; opacity:.92">
        <div style="display:flex; align-items:center; gap:8px; color:${escapeAttr(a.color || '#FE2C55')}">${a.creatorAvatar ? `<img src="${escapeAttr(a.creatorAvatar)}" style="width:34px;height:34px;border-radius:50%;object-fit:cover" />` : ''}<b>${escapeHtml(a.name || 'TEAM A')}</b></div>
        <span style="text-align:center">${escapeHtml(statusText)}</span>
        <div style="display:flex; align-items:center; justify-content:flex-end; gap:8px; color:${escapeAttr(b.color || '#25F4EE')}"><b>${escapeHtml(b.name || 'TEAM B')}</b>${b.creatorAvatar ? `<img src="${escapeAttr(b.creatorAvatar)}" style="width:34px;height:34px;border-radius:50%;object-fit:cover" />` : ''}</div>
      </div>
      <div style="display:flex; align-items:center; gap:8px">
        <strong style="font-size:24px; min-width:70px; text-align:center; line-height:1">${formatNumber(st.scoreA || 0)}</strong>
        <div style="flex:1; height:18px; border-radius:10px; background:linear-gradient(90deg, ${escapeAttr(a.color || '#FE2C55')} 0 ${50 + (st.push || 0)}%, ${escapeAttr(b.color || '#25F4EE')} ${50 + (st.push || 0)}% 100%); transition:all .3s"></div>
        <strong style="font-size:24px; min-width:70px; text-align:center; line-height:1">${formatNumber(st.scoreB || 0)}</strong>
      </div>
    </div>
  `;
}

// ============================================================
// Ranking
// ============================================================
async function loadRankingConfig() {
  const st = await window.api.ranking.getState();
  $('#rkTitle').value = st.title || 'TOP IDOL';
  $('#rkMode').value = st.mode || 'creator';
  $('#rkMaxRows').value = st.maxRows ?? 10;
  $('#rkRankFrom').value = st.rankFrom ?? 1;
  $('#rkRankTo').value = st.rankTo ?? 0;
  $('#rkNameMode').value = st.nameMode || 'two-line';
  $('#rkPointsBy').value = st.pointsBy || 'diamond';
  $('#rkStreak').value = st.streakColor || '#67e8f9';
  $('#rkBg').value = st.overlayBgColor || '#2a2d37';
  $('#rkBgOpacity').value = st.overlayBgOpacity ?? 74;
  $('#rkShowRank').checked = st.showRank !== false;
  $('#rkShowAvatar').checked = st.showAvatar !== false;
  $('#rkShowGift').checked = st.showGift !== false;
  $('#rkShowRound').checked = st.showRound !== false;
  $('#rkHideAllScores').checked = !!st.hideAllScores;
  $('#rkGridRows').value = st.gridRows || 3;
  $('#rkGridCols').value = st.gridCols || 3;
  $('#rkGridFlow').value = st.gridFlow || 'row';
  renderRkPreview(st);
}

function wireRankingTab() {
  let rkTimer = null;
  const collectRkCfg = () => ({
    title: $('#rkTitle').value.trim() || 'TOP IDOL',
    mode: $('#rkMode').value,
    maxRows: Number($('#rkMaxRows').value),
    rankFrom: Number($('#rkRankFrom').value) || 1,
    rankTo: Number($('#rkRankTo').value) || 0,
    nameMode: $('#rkNameMode').value,
    pointsBy: $('#rkPointsBy').value,
    streakColor: $('#rkStreak').value,
    overlayBgColor: $('#rkBg').value,
    overlayBgOpacity: Number($('#rkBgOpacity').value),
    showRank: $('#rkShowRank').checked,
    showAvatar: $('#rkShowAvatar').checked,
    showGift: $('#rkShowGift').checked,
    showRound: $('#rkShowRound').checked,
    hideAllScores: $('#rkHideAllScores').checked,
    gridRows: Number($('#rkGridRows').value) || 3,
    gridCols: Number($('#rkGridCols').value) || 3,
    gridFlow: $('#rkGridFlow').value,
  });
  const updateRkRealtime = () => {
    clearTimeout(rkTimer);
    rkTimer = setTimeout(async () => {
      await window.api.ranking.setConfig(collectRkCfg());
    }, 180);
  };
  ['rkTitle','rkMode','rkMaxRows','rkRankFrom','rkRankTo','rkNameMode','rkPointsBy','rkStreak','rkBg','rkBgOpacity','rkShowRank','rkShowAvatar','rkShowGift','rkShowRound','rkHideAllScores','rkGridRows','rkGridCols','rkGridFlow'].forEach(id => {
    const el = $('#' + id);
    el.addEventListener('input', updateRkRealtime);
    el.addEventListener('change', updateRkRealtime);
  });
  $('#rkSaveCfg').addEventListener('click', async () => {
    await window.api.ranking.setConfig(collectRkCfg());
    toast('Đã cập nhật Thi đấu nhóm', 'success');
  });
  $('#rkStartRound').addEventListener('click', async () => {
    const round = await window.api.ranking.startRound();
    await refreshCreators();
    const st = await window.api.ranking.getState();
    renderRkPreview(st);
    toast(`🔄 NEW ROUND: R${round}`, 'success');
  });
  $('#rkResetRound').addEventListener('click', async () => {
    await window.api.ranking.resetRound();
    await refreshCreators();
    const st = await window.api.ranking.getState();
    renderRkPreview(st);
    toast('RESET ROUND: R0', 'success');
  });
  $('#rkReset').addEventListener('click', async () => {
    if (confirm('Reset toàn bộ điểm Thi đấu nhóm?')) {
      await window.api.ranking.reset();
      await refreshCreators();
      const st = await window.api.ranking.getState();
      renderRkPreview(st);
      toast('↺ RESET ĐIỂM', 'success');
    }
  });
  $('#rkCopyUrl').addEventListener('click', async () => {
    const url = await window.api.ranking.getUrl(); await window.api.shell.copyText(url);
    toast('📋 THI ĐẤU DỌC', 'success');
  });
  $('#rkCopyGridUrl').addEventListener('click', async () => {
    const url = await window.api.ranking.getGridUrl(); await window.api.shell.copyText(url);
    toast('📋 THI ĐẤU NGANG', 'success');
  });
  $('#rkScoreToggle').addEventListener('click', async () => {
    const c = getVotedCreator();
    if (!c) { toast('Chưa chọn Creator VOTE', 'error'); return; }
    const running = ['prestart', 'running', 'grace'].includes(latestScoreState?.status);
    if (running) {
      scoreStoppedManually = true;
      await window.api.score.stop();
      toast('■ Đã dừng Tính điểm', 'success');
    } else {
      await syncScoreDurationFromBridge();
      await syncScoreToCreator(c);
      scoreAutoRoundHandled = false;
      scoreStoppedManually = false;
      await window.api.score.start();
      toast(`▶ Tính điểm: ${c.nickname || c.tiktokId}`, 'success');
    }
  });
  $('#rkScoreReset').addEventListener('click', async () => {
    await window.api.score.reset();
    toast('↺ Đã reset Tính điểm', 'success');
  });
  ['rkScoreMin', 'rkScoreSec'].forEach(id => $('#' + id).addEventListener('input', syncScoreDurationFromBridge));
  $('#rkScoreTarget').addEventListener('input', syncScoreTargetFromBridge);
  $('#rkLockVoteRunning').addEventListener('change', async () => {
    scoreLinkVoteLock = $('#rkLockVoteRunning').checked;
    await window.api.settings.set({ scoreLinkVoteLock });
    renderScoreBridge();
    const st = await window.api.ranking.getState();
    renderRkPreview(st);
    toast(scoreLinkVoteLock ? 'Đã bật Khóa VOTE' : 'Đã tắt Khóa VOTE', 'success');
  });
}

function getVotedCreator() {
  return creators.find(c => !!c.voteActive) || null;
}

async function syncScoreToCreator(c) {
  const cfg = collectScoreCfg();
  cfg.creatorName = c.nickname || c.tiktokId || '';
  cfg.creatorAvatar = c.avatar || '';
  $('#scCreatorName').value = cfg.creatorName;
  $('#scCreatorAvatar').value = cfg.creatorAvatar;
  if ($('#scCreatorSelect')) $('#scCreatorSelect').value = c.id || '';
  await window.api.score.setConfig(cfg);
}

function getRequiredTargetForCreator(creatorId) {
  const rows = Array.from(document.querySelectorAll('#rkPreview .rk-row'));
  const idx = rows.findIndex(row => row.querySelector('[data-rk-points]')?.dataset.rkPoints === String(creatorId));
  if (idx <= 0) return Math.max(1, Number($('#scTarget').value) || 1000);
  const current = parseNumberInput(rows[idx].querySelector('[data-rk-points]')?.value || '0');
  const above = parseNumberInput(rows[idx - 1].querySelector('[data-rk-points]')?.value || '0');
  return Math.max(1, above - current + 1);
}

async function applyAutoTargetForVote(c) {
  if (!scoreLinkRanking || !c) return;
  const target = getRequiredTargetForCreator(c.id || c.tiktokId);
  scoreTargetSyncing = true;
  $('#rkScoreTarget').value = formatNumber(target);
  $('#scTarget').value = target;
  scoreTargetSyncing = false;
  await window.api.score.setConfig(collectScoreCfg());
}

async function syncScoreTargetFromBridge() {
  if (scoreTargetSyncing) return;
  const target = Math.max(1, parseNumberInput($('#rkScoreTarget').value) || 1000);
  scoreTargetSyncing = true;
  $('#scTarget').value = target;
  scoreTargetSyncing = false;
  await window.api.score.setConfig(collectScoreCfg());
}

async function syncScoreTargetFromScoreTab() {
  if (scoreTargetSyncing) return;
  const target = Math.max(1, Number($('#scTarget').value) || 1000);
  scoreTargetSyncing = true;
  $('#rkScoreTarget').value = formatNumber(target);
  scoreTargetSyncing = false;
  scheduleScoreAutoSave();
}

async function syncScoreDurationFromBridge() {
  if (scoreDurationSyncing) return;
  const m = Math.max(0, Number($('#rkScoreMin').value) || 0);
  const s = Math.max(0, Math.min(59, Number($('#rkScoreSec').value) || 0));
  scoreDurationSyncing = true;
  $('#scDurH').value = 0;
  $('#scDurM').value = m;
  $('#scDurS').value = s;
  scoreDurationSyncing = false;
  await window.api.score.setConfig(collectScoreCfg());
}

async function syncScoreDurationFromScoreTab() {
  if (scoreDurationSyncing) return;
  const h = Number($('#scDurH').value) || 0;
  const m = Number($('#scDurM').value) || 0;
  const s = Number($('#scDurS').value) || 0;
  const total = h * 3600 + m * 60 + s;
  scoreDurationSyncing = true;
  $('#rkScoreMin').value = Math.floor(total / 60);
  $('#rkScoreSec').value = total % 60;
  scoreDurationSyncing = false;
  scheduleScoreAutoSave();
}

function renderScoreBridge() {
  const box = $('#rkScoreBridge');
  if (!box) return;
  const c = getVotedCreator();
  box.hidden = !scoreLinkRanking;
  $('#rkScoreBridgeName').textContent = c ? `Đang VOTE: ${c.nickname || c.tiktokId}` : 'Chọn VOTE một Creator để điều khiển';
  const running = ['prestart', 'running', 'grace'].includes(latestScoreState?.status);
  const toggle = $('#rkScoreToggle');
  toggle.textContent = running ? '■ DỪNG' : '▶ BẮT ĐẦU';
  toggle.classList.toggle('warn', running);
  toggle.classList.toggle('primary', !running);
  ['rkScoreToggle', 'rkScoreReset', 'rkScoreTarget', 'rkScoreMin', 'rkScoreSec'].forEach(id => { const b = $('#' + id); if (b) b.disabled = !c; });
  const lock = $('#rkLockVoteRunning');
  if (lock) lock.checked = scoreLinkVoteLock;
  applyVoteLockState();
}

function isLinkedScoreRunning() {
  return scoreLinkRanking && scoreLinkVoteLock && ['prestart', 'running', 'grace'].includes(latestScoreState?.status);
}

function applyVoteLockState() {
  const locked = isLinkedScoreRunning();
  document.querySelectorAll('[data-rk-toggle="voteActive"]').forEach(btn => {
    btn.disabled = locked;
  });
}

async function bumpVotedCreatorRound() {
  const c = getVotedCreator();
  if (!c) return;
  const nextRound = (Number(c.voteRound) || 0) + 1;
  await updateRankingCreator(c.id || c.tiktokId, {
    voteRound: nextRound,
    __history: { at: Date.now(), label: `Auto round R${nextRound}` },
  }, `Round ${c.nickname || c.tiktokId}: R${nextRound}`);
}

async function updateRankingCreator(id, patch, message = 'Đã cập nhật Thi đấu nhóm') {
  const c = creators.find(x => x.id === id || x.tiktokId === id);
  if (!c) return;
  const historyEntry = patch.__history;
  const cleanPatch = { ...patch };
  delete cleanPatch.__history;
  const gameplayHistory = Object.prototype.hasOwnProperty.call(cleanPatch, 'gameplayHistory')
    ? cleanPatch.gameplayHistory
    : historyEntry
    ? [historyEntry, ...(Array.isArray(c.gameplayHistory) ? c.gameplayHistory : [])].slice(0, 30)
    : c.gameplayHistory;
  await window.api.creators.upsert({ ...c, ...cleanPatch, gameplayHistory });
  await refreshCreators();
  const st = await window.api.ranking.getState();
  renderRkPreview(st);
  renderScoreBridge();
  toast(message, 'success');
}

function rankLabel(rank, hidden) {
  if (hidden) return 'Ẩn';
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  const n = Number(rank) || 0;
  return n > 0 && n < 10 ? `0${n}` : String(n || '');
}

function pointHistoryHtml(id) {
  const c = creators.find(x => x.id === id || x.tiktokId === id);
  const history = Array.isArray(c?.gameplayHistory) ? c.gameplayHistory.slice(0, 8) : [];
  if (!history.length) return '<div class="rk-history-empty">Chưa có lịch sử</div>';
  return history.map(h => {
    const t = h.at ? new Date(h.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
    const delta = Number(h.delta);
    const sign = delta > 0 ? '+' : (delta < 0 ? '-' : '');
    const value = Number.isFinite(delta) ? `${sign}${formatNumber(Math.abs(delta))}` : escapeHtml(h.label || 'Cập nhật');
    const detail = Number.isFinite(Number(h.before)) && Number.isFinite(Number(h.after)) && Number.isFinite(delta)
      ? `${formatNumber(h.before)} ${sign || '+'} ${formatNumber(Math.abs(delta))} = ${formatNumber(h.after)}`
      : (h.label || '');
    return `<div class="rk-history-line"><b>${escapeHtml(value)}</b><span>${escapeHtml(detail)}</span><i>${escapeHtml(t)}</i></div>`;
  }).join('');
}

async function adjustRankingPoints(id, sign, amountText) {
  const c = creators.find(x => x.id === id || x.tiktokId === id);
  if (!c) return;
  const before = Number(c.contestPoints) || 0;
  const amount = parseNumberInput(amountText);
  if (!amount) { toast('Số điểm không hợp lệ', 'error'); return; }
  const delta = amount * sign;
  const next = Math.max(0, before + delta);
  await updateRankingCreator(id, {
    contestPoints: next,
    __history: { at: Date.now(), before, delta, label: sign > 0 ? 'Cộng KC' : 'Trừ KC', after: next },
  }, sign > 0 ? 'Đã cộng điểm' : 'Đã trừ điểm');
}

function openPointMenu(input) {
  $('.rk-point-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'rk-point-menu';
  menu.innerHTML = `
    <label>Nhập KC cần thay đổi
      <input data-point-value type="text" inputmode="numeric" value="1.000" />
    </label>
    <div class="rk-point-actions">
      <button data-point-action="plus" type="button">CỘNG</button>
      <button data-point-action="minus" type="button">TRỪ</button>
    </div>
  `;
  document.body.appendChild(menu);
  const rect = input.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 230)}px`;
  menu.style.top = `${rect.bottom + 6}px`;
  const close = () => {
    document.removeEventListener('mousedown', onOutside);
    menu.remove();
  };
  const onOutside = (e) => { if (!menu.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
  const valueInput = menu.querySelector('[data-point-value]');
  valueInput.focus();
  valueInput.select();
  menu.querySelectorAll('[data-point-action]').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const amountText = valueInput.value;
    close();
    await adjustRankingPoints(input.dataset.rkPoints, btn.dataset.pointAction === 'plus' ? 1 : -1, amountText);
  }));
  valueInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const amountText = valueInput.value;
    close();
    await adjustRankingPoints(input.dataset.rkPoints, 1, amountText);
  });
}

function renderRkPreview(st) {
  const el = $('#rkPreview');
  const showCreatorControls = st.mode === 'creator';
  const rows = Array.isArray(st.rows) ? st.rows.slice() : [];
  if (showCreatorControls) {
    const visibleIds = new Set(rows.map(r => r.id));
    const groupsById = new Map(groups.map(g => [g.id, g]));
    creators.filter(c => c.hideObs && !visibleIds.has(c.id)).forEach(c => {
      const g = groupsById.get(c.groupId);
      rows.push({
        id: c.id,
        rank: 'ẩn',
        name: c.nickname || c.tiktokId,
        avatar: c.avatar || '',
        initials: (c.nickname || c.tiktokId || '?').trim().slice(0, 2).toUpperCase(),
        points: Number(c.contestPoints) || 0,
        round: Number(c.voteRound) || 0,
        giftIcon: c.defaultGiftIcon || '',
        groupName: g?.name || '',
        hideScore: !!c.hideScore,
        lost: !!c.lost,
        voteActive: !!c.voteActive,
        active: !!c.voteActive,
        hideObs: true,
      });
    });
  }
  if (rows.length === 0) {
    el.innerHTML = '<div class="hint">Chưa có dữ liệu — cần Creator + nối LIVE. Tạo creator có "Quà mặc định" trùng với gift người xem tặng.</div>';
    return;
  }
  el.innerHTML = rows.slice(0, 30).map((r) => `
    <div class="rk-row${r.active ? ' is-active' : ''}${r.lost ? ' is-lost' : ''}${r.hideObs ? ' is-hidden-obs' : ''}">
      <div class="rk-left">
        ${st.showRank === false ? '' : `<span class="rk-rank">${rankLabel(r.rank, r.hideObs)}</span>`}
        ${st.showAvatar === false ? '' : `<img class="rk-avatar" src="${escapeAttr(safeAvatarUrl(r.avatar))}" onerror="this.onerror=null;this.src='../logo/hp-logo.png'" />`}
        <div class="rk-person">
          <span class="rk-name">${escapeHtml(r.name)}</span>
          <span class="rk-group">${r.groupName ? escapeHtml(r.groupName) : 'Chưa nhóm'}</span>
        </div>
      </div>
      ${showCreatorControls ? `<div class="rk-scorebox">
        ${st.showGift === false || !r.giftIcon ? '' : `<img class="rk-gift-icon" src="${escapeAttr(r.giftIcon)}" />`}
        <input class="rk-mini-input" data-rk-points="${escapeAttr(r.id)}" type="text" inputmode="numeric" value="${formatNumber(r.points)}" title="Điểm thi đấu" />
        <span class="rk-round-chip">R<input data-rk-round="${escapeAttr(r.id)}" type="number" min="0" value="${Number(r.round) || 0}" title="Round" /></span>
        <div class="rk-actions">
          <button class="rk-pill${r.voteActive ? ' on' : ''}" data-rk-toggle="voteActive" data-id="${escapeAttr(r.id)}" type="button" ${scoreLinkRanking && scoreLinkVoteLock && ['prestart','running','grace'].includes(latestScoreState?.status) ? 'disabled' : ''}>VOTE</button>
          <button class="rk-pill${r.lost ? ' on danger' : ''}" data-rk-toggle="lost" data-id="${escapeAttr(r.id)}" type="button">THUA</button>
          <button class="rk-pill${r.hideScore ? ' on' : ''}" data-rk-toggle="hideScore" data-id="${escapeAttr(r.id)}" type="button">Ẩn điểm</button>
          <button class="rk-pill${r.hideObs ? ' on' : ''}" data-rk-toggle="hideObs" data-id="${escapeAttr(r.id)}" type="button">${r.hideObs ? 'Hiện OBS' : 'Ẩn OBS'}</button>
        </div>
        <details class="rk-more"><summary>⚙</summary><div class="rk-more-pop">
          <div class="rk-history-title">Lịch sử gameplay</div>
          <button class="rk-clear-history" data-rk-clear-history="${escapeAttr(r.id)}" type="button">Xóa lịch sử</button>
          ${pointHistoryHtml(r.id)}
        </div></details>
      </div>` : `<div class="rk-scorebox readonly">${r.hideScore || st.hideAllScores ? '<span class="rk-pts muted">Ẩn điểm</span>' : `<span class="rk-pts">${formatNumber(r.points)}</span>`}${st.showRound === false ? '' : `<span class="rk-round-chip">R${Number(r.round) || 0}</span>`}</div>`}
    </div>
  `).join('');
  el.querySelectorAll('[data-rk-points]').forEach(input => input.addEventListener('change', async () => {
    const c = creators.find(x => x.id === input.dataset.rkPoints || x.tiktokId === input.dataset.rkPoints);
    const before = Number(c?.contestPoints) || 0;
    const after = parseNumberInput(input.value);
    await updateRankingCreator(input.dataset.rkPoints, {
      contestPoints: after,
      __history: { at: Date.now(), before, delta: after - before, label: 'Sửa KC', after },
    }, 'Đã cập nhật điểm');
  }));
  el.querySelectorAll('[data-rk-points]').forEach(input => input.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openPointMenu(input);
  }));
  el.querySelectorAll('[data-rk-round]').forEach(input => input.addEventListener('change', async () => {
    await updateRankingCreator(input.dataset.rkRound, {
      voteRound: Number(input.value) || 0,
      __history: { at: Date.now(), label: `Sửa round R${Number(input.value) || 0}` },
    }, 'Đã cập nhật round');
  }));
  el.querySelectorAll('[data-rk-toggle]').forEach(btn => btn.addEventListener('click', async () => {
    const c = creators.find(x => x.id === btn.dataset.id || x.tiktokId === btn.dataset.id);
    if (!c) return;
    const key = btn.dataset.rkToggle;
    if (key === 'voteActive' && isLinkedScoreRunning()) {
      toast('Đang chạy Tính điểm liên kết, VOTE đang bị khóa', 'error');
      applyVoteLockState();
      return;
    }
    if (key === 'voteActive') {
      await window.api.ranking.setActive('');
    }
    if (key === 'voteActive' && !c.voteActive) {
      for (const other of creators) {
        if (other.id !== c.id && other.voteActive) await window.api.creators.upsert({ ...other, voteActive: false });
      }
    }
    await updateRankingCreator(btn.dataset.id, {
      [key]: !c[key],
      __history: { at: Date.now(), label: `${btn.textContent.trim()} ${!c[key] ? 'ON' : 'OFF'}` },
    }, `Đã cập nhật ${btn.textContent.trim()}`);
    if (key === 'voteActive' && !c.voteActive && scoreLinkRanking) {
      const fresh = creators.find(x => x.id === c.id || x.tiktokId === c.tiktokId) || c;
      await applyAutoTargetForVote({ ...fresh, voteActive: true });
      await syncScoreToCreator({ ...fresh, voteActive: true });
    }
  }));
  el.querySelectorAll('[data-rk-clear-history]').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!await askConfirm('Xóa toàn bộ lịch sử gameplay của Creator này?', 'Xóa lịch sử')) return;
    await updateRankingCreator(btn.dataset.rkClearHistory, { gameplayHistory: [] }, 'Đã xóa lịch sử');
  }));
  renderScoreBridge();
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.rk-more[open]').forEach(d => { d.open = false; });
  document.querySelector('.rk-point-menu')?.remove();
});

// ============================================================
// Score
// ============================================================
async function loadScoreConfig() {
  const st = await window.api.score.getState();
  $('#scTarget').value = st.target || 1000;
  $('#rkScoreTarget').value = formatNumber(st.target || 1000);
  const dMs = Number(st.durationMs) || 180000;
  const dSec = Math.floor(dMs / 1000);
  $('#scDurH').value = Math.floor(dSec / 3600);
  $('#scDurM').value = Math.floor((dSec % 3600) / 60);
  $('#scDurS').value = dSec % 60;
  $('#scPrep').value = st.prepSec ?? 3;
  $('#scDelay').value = Math.floor((st.delayMs ?? 5000) / 1000);
  $('#scContent').value = st.content || '';
  $('#scCreatorName').value = st.creatorName || '';
  $('#scCreatorAvatar').value = st.creatorAvatar || '';
  renderScoreCreatorSelect(st);
  $('#scTheme').value = st.themePreset || 'douyin';
  $('#scSize').value = st.overlaySize || 'medium';
  $('#scBarStyle').value = st.barStyle || 'pill';
  $('#scCompact').checked = false;
  $('#scHideAvatar').checked = !!st.hideAvatar;
  $('#scHideCreator').checked = !!st.hideCreator;
  $('#scMilestoneGradient').checked = false;
  $('#scShowGiftUser').checked = false;
  $('#scShowTopUsers').checked = false;
  $('#scShowSpeed').checked = false;
  $('#scTimeColor').value = st.timeColor || '#ffffff';
  $('#scContentColor').value = st.contentColor || '#f0eef6';
  $('#scOverColor').value = st.overColor || '#ff0000';
  $('#scBarColor1').value = st.barColor1 || '#b93678';
  $('#scBarColor2').value = st.barColor2 || '#ff8ed1';
  $('#scWaveColor').value = st.waveColor || '#ffffff';
  $('#scBigThreshold').value = st.bigGiftThreshold || 500;
  $('#scPointsBy').value = st.pointsBy || 'diamond';
  $('#scMilestones').value = '';
  setSoundInput('scSndStart', st.startSound || '');
  setSoundInput('scSndWarn', st.warningSound || '');
  setSoundInput('scSndGoal', st.goalSound || '');
  setSoundInput('scSndSuccess', st.successSound || '');
  setSoundInput('scSndFail', st.failSound || '');
  renderScPreview(st);
  const total = Math.floor((Number(st.durationMs) || 180000) / 1000);
  $('#rkScoreMin').value = Math.floor(total / 60);
  $('#rkScoreSec').value = total % 60;
}

function collectScoreCfg() {
  const h = Number($('#scDurH').value) || 0;
  const m = Number($('#scDurM').value) || 0;
  const s = Number($('#scDurS').value) || 0;
  const durationMs = Math.max(5000, (h * 3600 + m * 60 + s) * 1000);
  // Parse milestones
  const milestones = [];
  return {
    target: Math.max(1, Number($('#scTarget').value) || 1000),
    durationMs,
    prepSec: Number($('#scPrep').value) || 0,
    delayMs: Math.max(0, Number($('#scDelay').value) || 0) * 1000,
    content: $('#scContent').value.trim(),
    creatorName: $('#scCreatorName').value.trim(),
    creatorAvatar: $('#scCreatorAvatar').value.trim(),
    themePreset: $('#scTheme').value,
    overlaySize: $('#scSize').value,
    barStyle: $('#scBarStyle').value,
    compactMode: false,
    hideAvatar: $('#scHideAvatar').checked,
    hideCreator: $('#scHideCreator').checked,
    milestoneGradientEnabled: false,
    showGiftUser: false,
    showTopUsers: false,
    showSpeed: false,
    timeColor: $('#scTimeColor').value,
    contentColor: $('#scContentColor').value,
    overColor: $('#scOverColor').value,
    barColor1: $('#scBarColor1').value,
    barColor2: $('#scBarColor2').value,
    waveColor: $('#scWaveColor').value,
    bigGiftThreshold: Math.max(1, Number($('#scBigThreshold').value) || 500),
    pointsBy: $('#scPointsBy').value,
    customMilestoneValues: milestones,
    startSound: gameplaySoundValue('scSndStart'),
    warningSound: gameplaySoundValue('scSndWarn'),
    goalSound: gameplaySoundValue('scSndGoal'),
    successSound: gameplaySoundValue('scSndSuccess'),
    failSound: gameplaySoundValue('scSndFail'),
  };
}

function renderScoreCreatorSelect(st = latestScoreState || {}) {
  const sel = $('#scCreatorSelect');
  if (!sel) return;
  const currentName = st.creatorName || $('#scCreatorName')?.value || '';
  const currentAvatar = st.creatorAvatar || $('#scCreatorAvatar')?.value || '';
  const current = creators.find(c => {
    const nameMatches = (c.nickname || c.tiktokId || '') === currentName;
    const avatarMatches = !currentAvatar || currentAvatar === '../logo/hp-logo.png' || c.avatar === currentAvatar;
    return nameMatches && avatarMatches;
  })?.id || '';
  sel.innerHTML = '<option value="">— Chọn Creator —</option>' + creators
    .slice()
    .sort((a, b) => (a.nickname || a.tiktokId || '').localeCompare(b.nickname || b.tiktokId || '', 'vi'))
    .map(c => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.nickname || c.tiktokId)}</option>`)
    .join('');
  sel.value = current;
}

function applyScoreCreatorSelect() {
  const c = creators.find(x => x.id === $('#scCreatorSelect').value);
  $('#scCreatorName').value = c ? (c.nickname || c.tiktokId || '') : '';
  $('#scCreatorAvatar').value = c ? creatorAvatarValue(c) : '';
  renderScPreview({ ...(latestScoreState || collectScoreCfg()), ...collectScoreCfg(), score: latestScoreState?.score || 0, status: latestScoreState?.status || 'idle', timeText: latestScoreState?.timeText || '00:00' });
  scheduleScoreAutoSave();
}

function scheduleScoreAutoSave() {
  clearTimeout(scoreConfigAutoTimer);
  scoreConfigAutoTimer = setTimeout(async () => {
    try {
      await window.api.score.setConfig(collectScoreCfg());
    } catch {}
  }, 250);
}

function wireScoreTab() {
  // Theme picker → auto-fill 4 color pickers
  $('#scTheme').addEventListener('change', () => {
    const t = $('#scTheme').value;
    const THEMES = {
      douyin:  ['#b93678', '#ff8ed1', '#ffffff', '#ff0000'],
      vip:     ['#b76b00', '#ffd36a', '#fff4c1', '#ffea7a'],
      neon:    ['#00a6ff', '#35ffcf', '#e7ffff', '#70fff0'],
      battle:  ['#8f101f', '#ff4b4b', '#ffe1e1', '#ff3b3b'],
      luxury:  ['#4c2a85', '#c79cff', '#f6edff', '#d7b8ff'],
      minimal: ['#6b7280', '#d1d5db', '#ffffff', '#ffffff'],
    };
    if (THEMES[t]) {
      $('#scBarColor1').value = THEMES[t][0];
      $('#scBarColor2').value = THEMES[t][1];
      $('#scWaveColor').value = THEMES[t][2];
      $('#scOverColor').value = THEMES[t][3];
    }
  });
  $('#scTarget').addEventListener('input', syncScoreTargetFromScoreTab);
  ['scDurH', 'scDurM', 'scDurS'].forEach(id => $('#' + id).addEventListener('input', syncScoreDurationFromScoreTab));
  ['scPrep','scDelay','scTheme','scSize','scBarStyle','scHideAvatar','scHideCreator','scTimeColor','scContentColor','scOverColor','scBarColor1','scBarColor2','scWaveColor'].forEach(id => {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input', scheduleScoreAutoSave);
  });
  $('#scCreatorSelect').addEventListener('change', applyScoreCreatorSelect);
  $$('.score-sound-file').forEach(btn => btn.addEventListener('click', async () => {
    const file = await window.api.shell.pickAudio();
    if (file) {
      setSoundInput(btn.dataset.target, filePathToUrl(file));
      await window.api.settings.set({ audio: {
        gameSoundEnabled: gameplaySoundEnabled(),
        startSound: soundValue('scSndStart'),
        warningSound: soundValue('scSndWarn'),
        goalSound: soundValue('scSndGoal'),
        successSound: soundValue('scSndSuccess'),
        failSound: soundValue('scSndFail'),
      } });
      await window.api.score.setConfig(collectScoreCfg());
      await window.api.pkduo.setConfig(collectPkCfg());
      toast('Đã lưu âm thanh Score', 'success');
    }
  }));
  $$('.score-sound-test').forEach(btn => btn.addEventListener('click', () => {
    testSoundValue(soundValue(btn.dataset.target));
  }));
  $('#scSaveCfg').addEventListener('click', async () => {
    await window.api.score.setConfig(collectScoreCfg());
    toast('💾 Đã lưu Score', 'success');
  });
  $('#scLinkRanking').addEventListener('change', async () => {
    scoreLinkRanking = $('#scLinkRanking').checked;
    await window.api.settings.set({ scoreLinkRanking });
    renderScoreBridge();
    toast(scoreLinkRanking ? 'Đã bật liên kết Thi đấu nhóm ↔ Tính điểm' : 'Đã tắt liên kết Thi đấu nhóm ↔ Tính điểm', 'success');
  });
  $('#scStart').addEventListener('click', async () => {
    const running = ['prestart', 'running', 'grace'].includes(latestScoreState?.status);
    if (running) {
      scoreStoppedManually = true;
      await window.api.score.stop();
      toast('■ Đã dừng', 'success');
    } else {
      await window.api.score.setConfig(collectScoreCfg());
      scoreAutoRoundHandled = false;
      scoreStoppedManually = false;
      await window.api.score.start();
      toast('▶ Score: bắt đầu', 'success');
    }
  });
  $('#scReset').addEventListener('click', async () => {
    if (confirm('Reset điểm về 0?')) { await window.api.score.reset(); toast('↺ Reset', 'success'); }
  });
  $('#scTestPlus').addEventListener('click', async () => {
    await window.api.score.addPoints(Math.max(1, Number($('#scTestPoints').value) || 100), { uniqueId: 'test-user', nickname: 'Test user', avatar: '../logo/hp-logo.png' });
  });
  $('#scTestMinus').addEventListener('click', async () => {
    await window.api.score.addPoints(-Math.max(1, Number($('#scTestPoints').value) || 100), { uniqueId: 'test-user', nickname: 'Test user', avatar: '../logo/hp-logo.png' });
  });
  $('#scCopyUrl').addEventListener('click', async () => {
    const url = await window.api.score.getUrl(); await window.api.shell.copyText(url);
    toast('📋 Đã copy link Score', 'success');
  });
}

function renderScPreview(st) {
  const prevStatus = latestScoreState?.status;
  latestScoreState = st;
  handleScoreGameplaySound(st, prevStatus);
  if (scoreLinkRanking && !scoreStoppedManually && !scoreAutoRoundHandled && ['running', 'grace'].includes(prevStatus) && ['success', 'failed'].includes(st.status)) {
    scoreAutoRoundHandled = true;
    bumpVotedCreatorRound().catch(() => {});
  }
  if (['idle', 'prestart', 'running'].includes(st.status)) {
    scoreAutoRoundHandled = false;
    if (st.status !== 'idle') scoreStoppedManually = false;
  }
  renderScoreBridge();
  applyVoteLockState();
  const target = Math.max(1, Number(st.target) || 1);
  const score = Math.max(0, Number(st.score) || 0);
  const pct = Math.min(100, Math.round((score / target) * 100));
  const barColor1 = st.barColor1 || '#ff6aa9';
  const barColor2 = st.barColor2 || '#8eb6ff';
  const status = st.status || 'idle';
  const running = ['prestart', 'running', 'grace'].includes(status);
  const startBtn = $('#scStart');
  if (startBtn) {
    startBtn.textContent = running ? '■ DỪNG' : '▶ BẮT ĐẦU';
    startBtn.classList.toggle('warn', running);
    startBtn.classList.toggle('primary', !running);
  }
  const statusLabel =
    status === 'prestart' ? '⏳ Chuẩn bị' :
    status === 'running' ? '▶ Đang chạy' :
    status === 'grace' ? '⏱ Grace' :
    status === 'success' ? '🏆 THÀNH CÔNG' :
    status === 'failed' ? '❌ Không hoàn thành' :
    '⏸ Chờ bắt đầu';
  const recent = Array.isArray(st.recentGifts) ? st.recentGifts : [];
  const topUsers = Array.isArray(st.topUsers) ? st.topUsers : [];
  const visibleRecent = recent.slice(0, 5);
  const visibleTopUsers = topUsers.slice(0, 5);
  $('#scPreview').innerHTML = `
    <div class="score-review-card${score >= target ? ' kpi-met' : ''}">
      <div class="score-review-time">${escapeHtml(st.timeText || '00:00')}</div>
      <div class="score-review-progress" style="--score-review-fill:linear-gradient(90deg, ${escapeAttr(barColor1)}, ${escapeAttr(barColor2)})"><i style="width:${pct}%"></i><span class="score-review-sheen" style="width:${pct}%"></span><b>⚑</b></div>
      <div class="score-review-head">
        <div class="score-review-creator">
          ${st.creatorAvatar ? `<img src="${escapeAttr(st.creatorAvatar)}" />` : '<span>HP</span>'}
          <strong>${escapeHtml(st.creatorName || 'Creator')}</strong>
        </div>
        <div class="score-review-score">Điểm: ${formatNumber(score)}/${formatNumber(target)}</div>
      </div>
      <div class="score-review-status">${escapeHtml(statusLabel)}</div>
      <div class="score-review-columns">
        <section>
          <div class="score-review-section-head"><b>Quà vừa tính điểm</b><span>mới nhất ở trên</span></div>
          <div class="score-review-list">
            ${visibleRecent.length ? visibleRecent.map(g => `<div class="score-review-gift">${g.giftIcon ? `<img src="${escapeAttr(g.giftIcon)}" />` : '<em>🎁</em>'}<div><b>${escapeHtml(g.user)}</b><span>${escapeHtml(g.giftName)} x${formatCompact(g.repeat)} · +${formatNumber(g.points)}</span></div></div>`).join('') : '<div class="score-review-empty">Chưa có quà nào được tính điểm trong phiên này.</div>'}
          </div>
        </section>
        <section>
          <div class="score-review-section-head"><b>Tổng điểm theo user</b><span>cao nhất ở trên</span></div>
          <div class="score-review-total">Tổng số người tặng: ${formatNumber(topUsers.length)}</div>
          <div class="score-review-list">
            ${visibleTopUsers.length ? visibleTopUsers.map((u, i) => `<div class="score-review-user"><b>${i + 1}</b>${u.avatar ? `<img src="${escapeAttr(u.avatar)}" />` : '<em>👤</em>'}<span><strong>${escapeHtml(u.nickname || u.user || '?')}</strong><small>@${escapeHtml(u.user || '?')}</small></span><mark>${formatNumber(u.points)}</mark></div>`).join('') : '<div class="score-review-empty">Chưa có user nào tặng điểm trong vòng đấu.</div>'}
          </div>
        </section>
      </div>
    </div>
  `;
  wireScoreReviewListDrag();
}

function wireScoreReviewListDrag() {
  $$('#scPreview .score-review-list').forEach(list => {
    let dragging = false;
    let startY = 0;
    let startTop = 0;
    list.addEventListener('pointerdown', (e) => {
      dragging = true;
      startY = e.clientY;
      startTop = list.scrollTop;
      list.classList.add('dragging');
      list.setPointerCapture?.(e.pointerId);
    });
    list.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      list.scrollTop = startTop - (e.clientY - startY);
    });
    const stop = (e) => {
      dragging = false;
      list.classList.remove('dragging');
      if (e?.pointerId != null) list.releasePointerCapture?.(e.pointerId);
    };
    list.addEventListener('pointerup', stop);
    list.addEventListener('pointercancel', stop);
    list.addEventListener('pointerleave', stop);
  });
}

// ============================================================
// Overlays page
// ============================================================
async function refreshOverlayUrls() {
  const [pk, rk, sc] = await Promise.all([
    window.api.pkduo.getUrl(), window.api.ranking.getUrl(), window.api.score.getUrl(),
  ]);
  $('#urlPk').value = pk; $('#urlRk').value = rk; $('#urlSc').value = sc;
}

function wireOverlaysTab() {
  $$('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const v = $('#' + b.dataset.copy).value;
    await window.api.shell.copyText(v);
    toast('📋 Đã copy', 'success');
  }));

  $('#btnSaveOverlay').addEventListener('click', async () => {
    const w = Math.max(100, Math.min(7680, Number($('#ovlW').value) || 2160));
    const h = Math.max(100, Math.min(7680, Number($('#ovlH').value) || 3840));
    await window.api.settings.set({
      overlay: {
        width: w,
        height: h,
        bg: $('#ovlBg').value,
        chroma: $('#ovlChroma').value,
        showHost: $('#ovlShowHost').checked,
      },
    });
    $('#ovlW').value = w; $('#ovlH').value = h;
    toast('💾 Đã lưu cấu hình overlay (' + w + '×' + h + ')', 'success');
  });
}

// ============================================================
// Settings
// ============================================================
async function loadSettings() {
  const s = await window.api.settings.get();
  if (s.lastUsername) $('#ttUsername').value = s.lastUsername;
  scoreLinkRanking = !!s.scoreLinkRanking;
  scoreLinkVoteLock = !!s.scoreLinkVoteLock;
  if ($('#scLinkRanking')) $('#scLinkRanking').checked = scoreLinkRanking;
  if ($('#rkLockVoteRunning')) $('#rkLockVoteRunning').checked = scoreLinkVoteLock;
  renderScoreBridge();
  // Overlay settings
  const ov = s.overlay || {};
  $('#ovlW').value = (ov.width === 1080 && ov.height === 1920) ? 2160 : (ov.width || 2160);
  $('#ovlH').value = (ov.width === 1080 && ov.height === 1920) ? 3840 : (ov.height || 3840);
  $('#ovlBg').value = ov.bg || 'transparent';
  $('#ovlChroma').value = ov.chroma || '#00FF00';
  $('#ovlShowHost').checked = !!ov.showHost;
  const audio = s.audio || {};
  if ($('#gameSoundEnabled')) $('#gameSoundEnabled').checked = audio.gameSoundEnabled !== false;
  await loadAudioOutputs(audio.outputDeviceId || 'default');
  $('#waitingSoundName').dataset.path = audio.waitingSound || '';
  $('#waitingSoundName').value = soundNameFromValue(audio.waitingSound || '');
  $('#waitingVolume').value = audio.waitingVolume ?? 100;
  $('#preEffectSoundName').dataset.path = audio.preEffectSound || '';
  $('#preEffectSoundName').value = soundNameFromValue(audio.preEffectSound || '');
  $('#preEffectVolume').value = audio.preEffectVolume ?? 100;
  if (audio.startSound) setSoundInput('scSndStart', audio.startSound);
  if (audio.warningSound) setSoundInput('scSndWarn', audio.warningSound);
  if (audio.goalSound) setSoundInput('scSndGoal', audio.goalSound);
  if (audio.successSound) setSoundInput('scSndSuccess', audio.successSound);
  if (audio.failSound) setSoundInput('scSndFail', audio.failSound);
}

function wireSettingsTab() {
  $('#audioOutput').addEventListener('mousedown', () => loadAudioOutputs($('#audioOutput').value));
  $('#btnPickWaitingSound').addEventListener('click', async () => {
    const file = await window.api.shell.pickAudio();
    if (file) setSoundInput('waitingSoundName', filePathToUrl(file));
  });
  $('#btnPickPreEffectSound').addEventListener('click', async () => {
    const file = await window.api.shell.pickAudio();
    if (file) setSoundInput('preEffectSoundName', filePathToUrl(file));
  });
  $('#btnPlayWaitingSound')?.addEventListener('click', () => playSettingsSound('waitingSoundName', 'waitingVolume'));
  $('#btnStopWaitingSound')?.addEventListener('click', stopSettingsSound);
  $('#btnPlayPreEffectSound')?.addEventListener('click', () => playSettingsSound('preEffectSoundName', 'preEffectVolume'));
  $('#btnStopPreEffectSound')?.addEventListener('click', stopSettingsSound);
  $('#gameSoundEnabled')?.addEventListener('change', async () => {
    await window.api.settings.set({ audio: { gameSoundEnabled: gameplaySoundEnabled() } });
    scheduleScoreAutoSave();
    schedulePkAutoSave();
  });
  $('#btnSaveSettings').addEventListener('click', async () => {
    await window.api.settings.set({
      audio: {
        outputDeviceId: $('#audioOutput').value || 'default',
        gameSoundEnabled: gameplaySoundEnabled(),
        startSound: soundValue('scSndStart'),
        warningSound: soundValue('scSndWarn'),
        goalSound: soundValue('scSndGoal'),
        successSound: soundValue('scSndSuccess'),
        failSound: soundValue('scSndFail'),
        waitingSound: soundValue('waitingSoundName'),
        waitingVolume: Number($('#waitingVolume').value) || 0,
        preEffectSound: soundValue('preEffectSoundName'),
        preEffectVolume: Number($('#preEffectVolume').value) || 0,
      },
    });
    toast('💾 Đã lưu cài đặt âm thanh', 'success');
  });
}

// ============================================================
// Utils
// ============================================================
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function formatNumber(n) {
  return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('vi-VN');
}
function parseNumberInput(value) {
  const clean = String(value ?? '').replace(/[.,\s]/g, '');
  return Math.max(0, Math.round(Number(clean) || 0));
}
function formatCompact(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v >= 1000000) return (v / 1000000).toFixed(v % 1000000 ? 1 : 0) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'K';
  return String(v);
}

init().catch(e => { console.error(e); toast('Lỗi init: ' + e.message, 'error'); });
