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
  if (id === 'settings') refreshOverlayUrls();
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
let pkGroupCfg = null;
let currentEditingCreator = null;
let currentEditingGroup = null;
let stats = { gifts: 0, diamond: 0, donors: new Set(), viewers: 0 };
let ttConnected = false;
let liveUsername = '';
let activeGroupId = ''; // '' = TALENT SHOW (mở tất cả); id = chỉ nhóm đó. KHÔNG lưu vào settings.
let scoreLinkRanking = false;
let scoreLinkVoteLock = false;
let latestScoreState = null;
let scoreDurationSyncing = false;
let scoreTargetSyncing = false;
let scoreAutoRoundHandled = false;
let scoreStoppedManually = false;
let scoreConfigAutoTimer = null;
let pkConfigAutoTimer = null;
let pkGroupConfigAutoTimer = null;
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
let tickerTimer = null;
const TICKER_REFRESH_MS = 60_000;
const collapsedCreatorGroups = new Set();
let chatFontSize = 18;
const userAvatarCache = new Map();
const giftDonors = new Set();
const logInteractAt = { chatList: 0, giftList: 0 };
let latestUpdateInfo = null;
let reviewStateTimer = null;

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

// ===== Bộ lọc theo chế độ nhóm =====
function visibleGroups() { return activeGroupId ? groups.filter(g => g.id === activeGroupId) : groups; }
function visibleCreators() { return activeGroupId ? creators.filter(c => c.groupId === activeGroupId) : creators; }

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

// ============================================================
// Avatar dropdown — phủ lên <select> gốc để hiện avatar nhóm/creator.
// Giữ nguyên <select> làm nguồn value + sự kiện 'change' nên toàn bộ
// logic hiện có (applyPkCreator, các listener đọc sel.value...) không đổi.
// ============================================================
const AVATAR_FALLBACK = '../logo/hp-logo.png';

// Fallback avatar toàn app: ảnh avatar lỗi (URL hỏng/hết hạn) → tự thay bằng logo HP.
// Chỉ áp cho avatar (theo class), KHÔNG đụng icon quà. Bắt ở pha capture vì sự kiện 'error' của <img> không bubble.
const AVATAR_SELECTOR = '.avatar, .cc-ava, .gc-avatar, .rk-avatar, .av-select__ava, .pkg-member-check img, .score-review-user img, .js-avatar';
document.addEventListener('error', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLImageElement) || el.dataset.avFallback) return;
  if (!el.matches(AVATAR_SELECTOR)) return;
  el.dataset.avFallback = '1';
  el.src = AVATAR_FALLBACK;
}, true);

function avatarForGroupId(id) {
  const g = (typeof groups !== 'undefined' ? groups : []).find(x => String(x.id) === String(id));
  return g?.avatar || '';
}
function avatarForCreatorId(id) {
  const c = (typeof creators !== 'undefined' ? creators : []).find(x => String(x.id) === String(id));
  return c?.avatar || '';
}

function closeAllAvatarSelects(except) {
  document.querySelectorAll('.av-select.is-open').forEach(w => {
    if (w === except) return;
    w.classList.remove('is-open');
    const p = w.querySelector('.av-select__panel');
    if (p) p.hidden = true;
  });
}

function enhanceAvatarSelect(sel, resolveAvatar) {
  if (!sel || sel.dataset.avEnhanced) return;
  sel.dataset.avEnhanced = '1';

  const wrap = document.createElement('div');
  wrap.className = 'av-select';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'av-select__btn';
  btn.innerHTML = '<img class="av-select__ava" alt="" /><span class="av-select__label"></span><span class="av-select__caret">▾</span>';
  const panel = document.createElement('div');
  panel.className = 'av-select__panel';
  panel.hidden = true;

  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel); // di chuyển select vào wrap (giữ nguyên listener + value)
  wrap.appendChild(btn);
  wrap.appendChild(panel);

  const avImg = btn.querySelector('.av-select__ava');
  const label = btn.querySelector('.av-select__label');
  const fallback = (img) => { img.onerror = () => { img.onerror = null; img.src = AVATAR_FALLBACK; }; };

  const optAvatar = (value) => (value === '' ? '' : (resolveAvatar ? resolveAvatar(value) : '')) || AVATAR_FALLBACK;

  function syncButton() {
    const opt = sel.options[sel.selectedIndex];
    label.textContent = opt ? opt.textContent : '';
    const hasValue = sel.value !== '';
    avImg.src = optAvatar(sel.value);
    avImg.classList.toggle('is-placeholder', !hasValue);
    fallback(avImg);
  }

  function buildPanel() {
    panel.innerHTML = '';
    for (const opt of Array.from(sel.options)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'av-select__opt' + (opt.value === sel.value ? ' is-active' : '');
      item.dataset.value = opt.value;
      const img = document.createElement('img');
      img.className = 'av-select__ava';
      img.src = optAvatar(opt.value);
      if (opt.value === '') img.classList.add('is-placeholder');
      fallback(img);
      const span = document.createElement('span');
      span.textContent = opt.textContent;
      item.append(img, span);
      item.addEventListener('click', () => {
        sel.value = opt.value;
        close();
        syncButton();
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      panel.appendChild(item);
    }
  }

  function open() {
    if (sel.disabled) return;
    closeAllAvatarSelects(wrap);
    buildPanel();
    panel.hidden = false;
    wrap.classList.add('is-open');
    const active = panel.querySelector('.av-select__opt.is-active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }
  function close() {
    panel.hidden = true;
    wrap.classList.remove('is-open');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.classList.contains('is-open') ? close() : open();
  });

  // Khi render lại options (innerHTML) → dựng lại panel + đồng bộ nút.
  new MutationObserver(() => {
    syncButton();
    if (wrap.classList.contains('is-open')) buildPanel();
  }).observe(sel, { childList: true });

  // Bắt cả những chỗ gán trực tiếp sel.value = ... (không đổi innerHTML).
  const valueDesc = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', {
    configurable: true,
    get() { return valueDesc.get.call(this); },
    set(v) {
      valueDesc.set.call(this, v);
      syncButton();
      if (wrap.classList.contains('is-open')) buildPanel();
    },
  });

  syncButton();
}

let avatarSelectsGlobalWired = false;
function initAvatarSelects() {
  ['#pkAgroup', '#pkBgroup', '#pkgGroup', '#crGroup'].forEach(s => enhanceAvatarSelect($(s), avatarForGroupId));
  ['#pkAcreator', '#pkBcreator', '#scCreatorSelect'].forEach(s => enhanceAvatarSelect($(s), avatarForCreatorId));
  if (!avatarSelectsGlobalWired) {
    avatarSelectsGlobalWired = true;
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.av-select.is-open').forEach(w => {
        if (!w.contains(e.target)) {
          w.classList.remove('is-open');
          const p = w.querySelector('.av-select__panel');
          if (p) p.hidden = true;
        }
      });
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllAvatarSelects(null); });
  }
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
  let coinFilter = null; // null = tất cả; số = lọc theo mức coin

  function open(opts = {}) {
    if (!bound) bind(); // defensive — đảm bảo handler luôn được gắn
    return new Promise((resolve) => {
      resolver = resolve;
      currentOpts = opts;
      selectedIds = new Set((opts.selected || []).map(String));
      coinFilter = null;
      $('#gpCoins')?.querySelectorAll('.gp-coin').forEach(b => b.classList.toggle('is-active', b.dataset.coin === ''));
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
      if (coinFilter != null && Number(g.diamond) < coinFilter) return false;
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
    filtered.sort((a, b) => Number(selectedIds.has(String(b.id))) - Number(selectedIds.has(String(a.id))));
    const grid = $('#gpGrid');
    if (filtered.length === 0) {
      grid.innerHTML = '<div class="gp-empty">Không tìm thấy quà phù hợp.</div>';
      return;
    }
    // Hiển thị full tất cả quà (lazy-load ảnh để vẫn mượt)
    grid.innerHTML = filtered.map(g => {
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
    }).join('');
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
    $('#gpCoins')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.gp-coin');
      if (!btn) return;
      coinFilter = btn.dataset.coin === '' ? null : Number(btn.dataset.coin);
      $('#gpCoins').querySelectorAll('.gp-coin').forEach(b => b.classList.toggle('is-active', b === btn));
      render();
    });
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
  await initLicenseGate();
  await loadGiftMaster();
  await refreshCreators();
  await refreshGroups();
  await loadPkConfig();
  await loadPkGroupConfig();
  await loadRankingConfig();
  await loadScoreConfig();
  await refreshOverlayUrls();
  await loadSettings();
  wireTtEvents();
  wireConnectTab();
  wireCreatorTab();
  wireGroupTab();
  wirePkDuoTab();
  wirePkGroupTab();
  wireHistoryUI();
  wireRankingTab();
  wireScoreTab();
  wireOverlaysTab();
  wireSettingsTab();
  initAvatarSelects();
  loadLiveBanners();
  startLiveTickerAutoRefresh();
  checkUpdatesOnStartup();
}

async function initLicenseGate() {
  wireLicenseUi();
  const version = await window.api.app.getVersion().catch(() => '0.1.0');
  $('#appVersionText').textContent = version;
  const st = await window.api.license.check().catch(e => ({ ok: false, error: e.message || String(e), license: {} }));
  renderLicenseState(st);
  if (!st.ok) showLicenseOverlay(st.error || 'Chưa kích hoạt KEY bản quyền.');
}

function showLicenseOverlay(message = '') {
  const ov = $('#licenseOverlay');
  if (!ov) return;
  ov.hidden = false;
  $('#licenseOverlayStatus').textContent = message;
  $('#licenseKeyInput').focus();
}

function hideLicenseOverlay() {
  const ov = $('#licenseOverlay');
  if (ov) ov.hidden = true;
}

function renderLicenseState(st = {}) {
  const license = st.license || st || {};
  const key = license.key || '';
  if ($('#licenseKeyInput') && key) $('#licenseKeyInput').value = key;
  if ($('#licenseKeySettings')) $('#licenseKeySettings').value = key;
  if ($('#licenseDeviceId')) $('#licenseDeviceId').textContent = `Thiết bị: ${license.deviceId || ''}`;
  if ($('#licenseDeviceSettings')) $('#licenseDeviceSettings').value = license.deviceId || '';
  if ($('#licenseVipText')) $('#licenseVipText').textContent = license.vip || '—';
  if ($('#licenseExpireText')) $('#licenseExpireText').textContent = license.expiresAt || '—';
  if ($('#licenseStatusText')) $('#licenseStatusText').textContent = st.ok ? (st.offline ? 'Hợp lệ (offline)' : 'Hợp lệ') : (st.error || license.status || 'Không hợp lệ');
  if ($('#licenseVersionText')) $('#licenseVersionText').textContent = license.appVersion || $('#appVersionText')?.textContent || '—';
}

async function activateLicenseFrom(inputId) {
  const key = $('#' + inputId)?.value.trim();
  const btn = inputId === 'licenseKeyInput' ? $('#licenseActivateBtn') : $('#licenseActivateSettings');
  if (btn) btn.disabled = true;
  try {
    const st = await window.api.license.activate(key);
    renderLicenseState(st);
    if (!st.ok) {
      $('#licenseOverlayStatus').textContent = st.error || 'KEY không hợp lệ.';
      toast(st.error || 'KEY không hợp lệ', 'error');
      return;
    }
    hideLicenseOverlay();
    toast('Đã kích hoạt bản quyền', 'success');
  } catch (e) {
    const msg = e.message || String(e);
    $('#licenseOverlayStatus').textContent = msg;
    toast(msg, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function wireLicenseUi() {
  $('#licenseActivateBtn')?.addEventListener('click', () => activateLicenseFrom('licenseKeyInput'));
  $('#licenseKeyInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') activateLicenseFrom('licenseKeyInput'); });
  $('#licenseActivateSettings')?.addEventListener('click', () => activateLicenseFrom('licenseKeySettings'));
  $('#licenseClearSettings')?.addEventListener('click', async () => {
    if (!await askConfirm('Xóa KEY đã lưu trên máy này?', 'Xóa KEY')) return;
    const st = await window.api.license.clear();
    renderLicenseState(st);
    showLicenseOverlay('Đã xóa KEY. Vui lòng kích hoạt lại.');
  });
  $('#btnCheckUpdate')?.addEventListener('click', () => checkForUpdate(true));
  $('#btnInstallUpdate')?.addEventListener('click', installLatestUpdate);
  $('#versionCheckBtn')?.addEventListener('click', () => checkForUpdate(true));
}

async function checkForUpdate(manual = false) {
  const status = $('#updateStatus');
  if (status) status.textContent = 'Đang kiểm tra bản cập nhật...';
  try {
    latestUpdateInfo = await window.api.updates.check();
    if (latestUpdateInfo.hasUpdate) {
      if (status) status.textContent = `Có bản mới ${latestUpdateInfo.latest}. Bản hiện tại ${latestUpdateInfo.current}.`;
      $('#btnInstallUpdate').hidden = false;
      toast(`Có bản mới ${latestUpdateInfo.latest}`, 'success');
    } else {
      if (status) status.textContent = `Đang dùng bản mới nhất (${latestUpdateInfo.current}).`;
      $('#btnInstallUpdate').hidden = true;
      if (manual) toast('Đang dùng bản mới nhất', 'success');
    }
  } catch (e) {
    const msg = e.message || String(e);
    if (status) status.textContent = `Không kiểm tra được cập nhật: ${msg}`;
    if (manual) toast(msg, 'error');
  }
}

function checkUpdatesOnStartup() {
  setTimeout(() => checkForUpdate(false), 1800);
}

async function installLatestUpdate() {
  if (!latestUpdateInfo) await checkForUpdate(true);
  if (!latestUpdateInfo?.hasUpdate) return;
  $('#btnInstallUpdate').disabled = true;
  $('#updateStatus').textContent = 'Đang tải bản cập nhật, vui lòng chờ...';
  try {
    await window.api.updates.install(latestUpdateInfo);
    $('#updateStatus').textContent = 'Đã mở installer. Ứng dụng sẽ tự đóng để cập nhật.';
  } catch (e) {
    $('#btnInstallUpdate').disabled = false;
    const msg = e.message || String(e);
    $('#updateStatus').textContent = `Cập nhật thất bại: ${msg}`;
    toast(msg, 'error');
  }
}

function startLiveTickerAutoRefresh() {
  loadLiveTicker();
  if (tickerTimer) clearInterval(tickerTimer);
  tickerTimer = setInterval(loadLiveTicker, TICKER_REFRESH_MS);
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
  window.api.on('pkgroup:state', (st) => renderPkGroupPreview(st));
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
  $('#modeSelect')?.addEventListener('change', (e) => setActiveGroup(e.target.value));
}

// ============================================================
// Creators
// ============================================================
async function refreshCreators() {
  creators = await window.api.creators.list();
  renderCreators();
  renderCreatorGroupSelect();
  renderPkCreatorSelects?.();
  renderPkGroupMembers?.();
  renderScoreCreatorSelect?.();
  propagateDefaultGiftToBattles();
  checkDuplicateDefaultGifts();
}

// Đổi quà mặc định ở Hồ sơ Creator → đẩy realtime xuống engine PK Nhóm / PK Đôi
// (chỉ những nơi ĐANG KẾ THỪA, không đụng nơi đã ghi đè). Thi đấu nhóm vốn đã đọc default realtime.
function propagateDefaultGiftToBattles() {
  // PK Nhóm
  if (pkGroupCfg && Array.isArray(pkGroupCfg.participants)) {
    let changed = false;
    for (const p of pkGroupCfg.participants) {
      if (p.giftOverride && isRealGift(p.gifts?.[0])) continue;
      const c = creatorById(p.creatorId || p.id) || creatorById(p.tiktokId);
      const def = c ? creatorDefaultGift(c) : null;
      if (!sameGiftStrict(p.gifts?.[0], def)) { p.gifts = def ? [def] : []; p.giftOverride = false; changed = true; }
    }
    // Patch tối thiểu: chỉ participants, tránh clobber field khác đang chờ autosave
    if (changed) window.api.pkgroup?.setConfig({ participants: pkGroupCfg.participants }).catch(() => {});
  }
  // PK Đôi (chỉ chế độ Chọn Phe mới bám quà mặc định)
  if (pkCfg && pkCfg.joinMode) {
    let changed = false;
    for (const side of ['A', 'B']) {
      const team = getTeam(side);
      if (team.giftOverride && isRealGift((team.joinGifts || [])[0])) continue;
      const c = team.creatorId ? creatorById(team.creatorId) : null;
      const def = c ? creatorDefaultGift(c) : null;
      if (!sameGiftStrict((team.joinGifts || [])[0], def)) {
        team.joinGifts = def ? [def] : [];
        team.gifts = team.joinGifts;
        team.giftOverride = false;
        changed = true;
      }
    }
    if (changed) {
      renderPkGifts?.();
      window.api.pkduo?.setConfig({ teamA: pkCfg.teamA, teamB: pkCfg.teamB }).catch(() => {});
    }
  }
}

// Rà soát Thi đấu nhóm: TALENT SHOW (tất cả) gộp mọi nhóm → quà mặc định phải duy nhất,
// tránh 1 quà bị tính cho nhiều creator. (Lúc lưu creator đã chặn trùng; hàm này bắt dữ liệu cũ.)
function checkDuplicateDefaultGifts() {
  const byGift = new Map();
  for (const c of creators) {
    if (!c.defaultGiftId) continue;
    const k = String(c.defaultGiftId);
    if (!byGift.has(k)) byGift.set(k, []);
    byGift.get(k).push(c.nickname || c.tiktokId || 'Creator');
  }
  const dups = [...byGift.values()].filter(a => a.length > 1);
  const sig = dups.map(a => a.slice().sort().join('/')).sort().join('|');
  if (sig === checkDuplicateDefaultGifts._sig) return; // tránh toast lặp
  checkDuplicateDefaultGifts._sig = sig;
  if (dups.length) {
    const detail = dups.map(a => a.join(' = ')).join('; ');
    toast(`⚠️ Quà mặc định trùng giữa Creator (ảnh hưởng Thi đấu nhóm TALENT SHOW): ${detail}. Hãy đặt quà riêng.`, 'error');
  }
}

function renderCreators() {
  const cs = visibleCreators();
  const list = $('#creatorsList');
  const countEl = $('#crCount');
  if (countEl) countEl.textContent = cs.length ? `${cs.length}` : '';
  list.innerHTML = '';
  if (cs.length === 0) {
    list.innerHTML = '<div class="hint">Chưa có Creator nào. Hãy thêm Creator đầu tiên.</div>';
    return;
  }
  const groupsById = new Map(groups.map(g => [g.id, g]));
  const buckets = new Map();
  for (const c of cs) {
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
  summary.innerHTML = `<span>Tổng <b>${formatNumber(cs.length)}</b> Creator</span><span>·</span><span><b>${formatNumber(groupedCount)}</b> nhóm có thành viên</span>`;
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
  list.querySelectorAll('[data-gift]').forEach(b => {
    const handler = () => pickCreatorGiftQuick(b.dataset.gift);
    b.addEventListener('click', handler);
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  });
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

// Bấm trực tiếp vào ô quà ở mỗi dòng Creator để chọn/đổi quà mặc định
async function pickCreatorGiftQuick(id) {
  const c = creators.find(x => x.id === id || (!x.id && x.tiktokId === id));
  if (!c) { toast('Không tìm thấy creator này', 'error'); return; }
  const usedBy = creatorGiftUsage(c.id || '');
  const g = await GiftPicker.open({
    title: `🎁 Chọn quà mặc định cho ${c.nickname || c.tiktokId}`,
    disabledIds: Object.keys(usedBy),
    usedBy,
  });
  if (!g) return;
  await window.api.creators.upsert({
    ...c,
    defaultGiftId: g.id ? String(g.id) : '',
    defaultGiftName: g.name || '',
    defaultGiftIcon: g.icon || '',
  });
  await refreshCreators();
  toast(`🎁 Đã đặt quà "${g.name}" cho ${c.nickname || c.tiktokId}`, 'success');
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
        <div class="cc-gift cc-gift-pick" data-gift="${escapeAttr(creatorKey)}" role="button" tabindex="0" title="Bấm để chọn quà mặc định">
          ${c.defaultGiftIcon ? `<img src="${escapeAttr(c.defaultGiftIcon)}" />` : '🎁'}
          <span>${escapeHtml(c.defaultGiftName || '(chưa đặt quà mặc định)')}</span>
          <span class="cc-gift-edit">✏️</span>
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
  for (const g of visibleGroups()) {
    const opt = document.createElement('option');
    opt.value = g.id; opt.textContent = g.name;
    sel.appendChild(opt);
  }
  // Ở chế độ nhóm, mặc định gán creator mới vào nhóm đang chọn
  sel.value = activeGroupId ? activeGroupId : current;
}

// ===== Chế độ NHÓM | TALENT SHOW =====
function renderModeSelect() {
  const sel = $('#modeSelect');
  if (!sel) return;
  // Nếu nhóm đang chọn đã bị xóa thì tự về TALENT SHOW
  if (activeGroupId && !groups.some(g => g.id === activeGroupId)) activeGroupId = '';
  sel.innerHTML = '<option value="">🎤 TALENT SHOW (Tất cả)</option>' +
    groups.map(g => `<option value="${escapeAttr(g.id)}">👥 ${escapeHtml(g.name || g.tiktokId || 'Nhóm')}</option>`).join('');
  sel.value = activeGroupId;
  const bar = $('#bottomLive');
  if (bar) bar.classList.toggle('mode-group', !!activeGroupId);
}

function setActiveGroup(id) {
  activeGroupId = id || '';
  const bar = $('#bottomLive');
  if (bar) bar.classList.toggle('mode-group', !!activeGroupId);
  // Chế độ nhóm: tự điền TikTok ID đại diện của nhóm (vẫn cho sửa), không đụng khi đang LIVE
  if (activeGroupId && !ttConnected) {
    const g = groups.find(x => x.id === activeGroupId);
    if (g && g.tiktokId) $('#ttUsername').value = g.tiktokId;
  }
  applyActiveGroupMode();
}

function applyActiveGroupMode() {
  renderCreators();
  renderGroups();
  renderCreatorGroupSelect();
  renderPkCreatorSelects?.();
  renderPkGroupGroupSelect?.();
  renderPkGroupMembers?.();
  renderScoreCreatorSelect?.();
  // Ranking gom dữ liệu ở main process → đẩy bộ lọc xuống engine
  window.api.ranking?.setConfig({ activeGroupId }).catch(() => {});
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
  renderModeSelect();
  renderGroups();
  renderCreatorGroupSelect();
  renderCreators();
  renderPkCreatorSelects?.();
  renderPkGroupGroupSelect?.();
  renderPkGroupMembers?.();
  renderScoreCreatorSelect?.();
}

function renderGroups() {
  const gs = visibleGroups();
  const list = $('#groupsList');
  const countEl = $('#grCount');
  if (countEl) countEl.textContent = gs.length ? `${gs.length}` : '';
  list.innerHTML = '';
  if (gs.length === 0) {
    list.innerHTML = '<div class="hint">Chưa có nhóm nào.</div>';
    return;
  }
  for (const g of gs) {
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
    overlayScale: st.overlayScale || 100,
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
  $('#pkOverlayScale').value = pkCfg.overlayScale;
  $('#pkOverlayScaleValue').textContent = `${$('#pkOverlayScale').value}%`;
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
  if (pkCfg.joinMode) {
    pkCfg.teamA.joinGifts = (pkCfg.teamA.joinGifts || []).slice(0, 1);
    pkCfg.teamB.joinGifts = (pkCfg.teamB.joinGifts || []).slice(0, 1);
  }
  pkCfg.teamA.gifts = pkCfg.teamA[key] || [];
  pkCfg.teamB.gifts = pkCfg.teamB[key] || [];
}

function savePkActiveGifts() {
  const key = pkGiftModeKey();
  pkCfg.teamA[key] = pkCfg.joinMode ? (pkCfg.teamA.gifts || []).slice(0, 1) : (pkCfg.teamA.gifts || []);
  pkCfg.teamB[key] = pkCfg.joinMode ? (pkCfg.teamB.gifts || []).slice(0, 1) : (pkCfg.teamB.gifts || []);
}

function renderPkCreatorSelects() {
  if (!pkCfg || !$('#pkAgroup')) return;
  for (const side of ['A', 'B']) {
    const groupSel = $(`#pk${side}group`);
    const gs = visibleGroups();
    const prev = groupSel.value || getTeam(side).groupId || '';
    const current = activeGroupId ? activeGroupId : prev;
    groupSel.innerHTML = '<option value="">— Chọn nhóm —</option>' + gs.map(g => `<option value="${escapeAttr(g.id)}">${escapeHtml(g.name)}</option>`).join('');
    groupSel.value = gs.some(g => g.id === current) ? current : '';
    renderPkCreatorSelect(side);
  }
}

function renderPkCreatorSelect(side) {
  const team = getTeam(side);
  const groupId = $(`#pk${side}group`)?.value || team.groupId || '';
  const sel = $(`#pk${side}creator`);
  if (!sel) return;
  const current = sel.value || team.creatorId || '';
  const filtered = visibleCreators().filter(c => !groupId || c.groupId === groupId);
  sel.innerHTML = '<option value="">— Chọn creator —</option>' + filtered.map(c => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.nickname || c.tiktokId)}</option>`).join('');
  sel.value = filtered.some(c => c.id === current) ? current : '';
}

function applyPkCreator(side, opts = {}) {
  const team = getTeam(side);
  const group = groups.find(g => g.id === $(`#pk${side}group`).value);
  const creator = creators.find(c => c.id === $(`#pk${side}creator`).value);
  team.groupId = group?.id || '';
  team.groupName = group?.name || '';
  team.creatorId = creator?.id || '';
  team.creatorName = creator?.nickname || creator?.tiktokId || '';
  team.creatorAvatar = creator?.avatar || '../logo/hp-logo.png';
  if (group?.color) team.color = group.color;
  // Khi chọn creator: ưu tiên lấy tên hiển thị theo creator đã cài đặt
  if (opts.syncName && creator) {
    team.name = creator.nickname || creator.tiktokId || team.name;
  }
  if (creator && pkCfg?.joinMode && (opts.applyDefaultGift || !(team.joinGifts || []).length)) {
    const gift = creatorDefaultGift(creator);
    if (gift) {
      team.joinGifts = [gift];
      team.gifts = team.joinGifts;
      team.giftOverride = false; // đang bám quà mặc định của creator
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

// ===== Kế thừa quà mặc định (realtime) + Ghi đè =====
// Nguyên tắc: creator.defaultGift là "nguồn sự thật". Các nơi (PK Nhóm / PK Đôi) chỉ lưu OVERRIDE.
// Không override → luôn resolve theo quà mặc định hiện tại của creator → realtime tức thì.
function isRealGift(g) {
  return !!(g && (g.giftId || g.id || g.giftName || g.name || g.icon));
}

// So sánh chặt (id + tên + icon) — dùng khi đồng bộ quà kế thừa để cập nhật cả icon/tên xuống overlay
function sameGiftStrict(a, b) {
  if (!a || !b) return !a && !b;
  return String(a.giftId || a.id || '') === String(b.giftId || b.id || '')
    && String(a.giftName || a.name || '') === String(b.giftName || b.name || '')
    && String(a.icon || '') === String(b.icon || '');
}

function creatorById(idOrTiktok) {
  return creators.find(x => x.id === idOrTiktok || x.tiktokId === idOrTiktok) || null;
}

function normalizeHexColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
}

function renderPkGifts() {
  const joinMode = !!pkCfg?.joinMode;
  for (const side of ['A', 'B']) {
    const wrap = $(`#pk${side}gifts`);
    wrap.dataset.team = side;
    wrap.innerHTML = '';
    const team = side === 'A' ? pkCfg.teamA : pkCfg.teamB;
    (team.gifts || []).forEach((g, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.title = g.giftName || g.giftId || '';
      chip.draggable = !joinMode;
      chip.dataset.side = side;
      chip.dataset.index = String(i);
      chip.innerHTML = `${g.icon ? `<img src="${escapeAttr(g.icon)}" />` : '🎁'}<button type="button">×</button>`;
      if (!joinMode) {
        chip.addEventListener('dragstart', (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('application/x-pk-gift', JSON.stringify({ side, index: i }));
          chip.classList.add('dragging');
        });
        chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
      }
      chip.querySelector('button').addEventListener('click', () => {
        team.gifts.splice(i, 1);
        savePkActiveGifts();
        if (joinMode) { team.giftOverride = false; applyPkCreator(side, { applyDefaultGift: true }); }
        renderPkGifts();
        schedulePkAutoSave();
      });
      wrap.appendChild(chip);
    });
    // Join mode + đang ghi đè → nút về quà mặc định
    if (joinMode && team.giftOverride && isRealGift((team.gifts || [])[0])) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'ghost tiny pk-reset-gift';
      reset.title = 'Về quà mặc định của Creator';
      reset.textContent = '🔄 Mặc định';
      reset.addEventListener('click', () => {
        team.giftOverride = false;
        applyPkCreator(side, { applyDefaultGift: true });
        renderPkGifts();
        schedulePkAutoSave();
        toast(`🔄 Đội ${side} về quà mặc định`, 'success');
      });
      wrap.appendChild(reset);
    }
  }
  $$('.pk-pick-master').forEach(btn => {
    btn.textContent = joinMode ? 'Chọn quà kích hoạt' : '+ Thêm quà';
  });
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
  if (pkCfg.joinMode) {
    const first = gifts?.[0];
    if (!first) return [];
    const pkGift = first.giftName ? first : giftToPkGift(first);
    const id = String(pkGift.giftId || pkGift.id || '');
    if (id && (other.gifts || []).some(g => String(g.giftId || g.id || '') === id)) return [];
    team.gifts = [pkGift];
    team.joinGifts = team.gifts;
    team.giftOverride = true; // chọn tay quà kích hoạt = ghi đè
    return [pkGift];
  }
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
      applyPkCreator('A', { applyDefaultGift: !(pkCfg.teamA.joinGifts || []).length });
      applyPkCreator('B', { applyDefaultGift: !(pkCfg.teamB.joinGifts || []).length });
    }
    renderPkGifts();
    schedulePkAutoSave();
    toast(pkCfg.joinMode ? 'Đang chỉnh bảng quà Chọn Phe' : 'Đang chỉnh bảng quà Cố định');
  });

  for (const side of ['A', 'B']) {
    $(`#pk${side}group`).addEventListener('change', () => {
      getTeam(side).groupId = $(`#pk${side}group`).value;
      renderPkCreatorSelect(side);
      applyPkCreator(side, { applyDefaultGift: true, syncName: true });
      schedulePkAutoSave();
    });
    $(`#pk${side}creator`).addEventListener('change', () => {
      applyPkCreator(side, { applyDefaultGift: true, syncName: true });
      schedulePkAutoSave();
    });
  }

  $$('.pk-pick-master').forEach(btn => btn.addEventListener('click', async () => {
    const side = btn.dataset.team;
    const selected = await GiftPicker.open({
      title: pkCfg.joinMode ? `🎁 Chọn 1 quà kích hoạt cho Đội ${side}` : `🎁 Chọn nhiều quà cho Đội ${side}`,
      multi: !pkCfg.joinMode,
      excludeIds: [...pkGiftIds(side === 'A' ? 'B' : 'A')],
      selected: [...pkGiftIds(side)],
    });
    const picked = Array.isArray(selected) ? selected : (selected ? [selected] : []);
    if (!picked.length) return;
    const added = addPkGifts(side, picked);
    savePkActiveGifts();
    renderPkGifts();
    schedulePkAutoSave();
    toast(pkCfg.joinMode ? `Đã chọn quà kích hoạt cho Đội ${side}` : `Đã thêm ${added.length} quà cho Đội ${side}`, added.length ? 'success' : 'error');
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
  $('#pkOverlayScale').addEventListener('input', () => {
    $('#pkOverlayScaleValue').textContent = `${$('#pkOverlayScale').value}%`;
    schedulePkAutoSave();
  });
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
  // Đồng bộ tên đang gõ vào team trước, tránh applyPkCreator ghi đè lại tên cũ
  pkCfg.teamA.name = $('#pkAname').value.trim() || 'TEAM A';
  pkCfg.teamB.name = $('#pkBname').value.trim() || 'TEAM B';
  applyPkCreator('A');
  applyPkCreator('B');
  savePkActiveGifts();
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
    overlayScale: Math.max(80, Math.min(300, Number($('#pkOverlayScale').value) || 100)),
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
        <div style="display:flex; align-items:center; gap:8px; color:${escapeAttr(a.color || '#FE2C55')}">${a.creatorAvatar ? `<img class="js-avatar" src="${escapeAttr(a.creatorAvatar)}" style="width:34px;height:34px;border-radius:50%;object-fit:cover" />` : ''}<b>${escapeHtml(a.name || 'TEAM A')}</b></div>
        <span style="text-align:center">${escapeHtml(statusText)}</span>
        <div style="display:flex; align-items:center; justify-content:flex-end; gap:8px; color:${escapeAttr(b.color || '#25F4EE')}"><b>${escapeHtml(b.name || 'TEAM B')}</b>${b.creatorAvatar ? `<img class="js-avatar" src="${escapeAttr(b.creatorAvatar)}" style="width:34px;height:34px;border-radius:50%;object-fit:cover" />` : ''}</div>
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
// PK Nhóm
// ============================================================
async function loadPkGroupConfig() {
  const st = await window.api.pkgroup.getState();
  pkGroupCfg = {
    content: st.content || 'PK NHÓM',
    groupId: st.groupId || '',
    layoutMode: st.layoutMode || 'joined',
    playMode: st.playMode || 'fixed',
    pointsBy: st.pointsBy || 'diamond',
    noteEnabled: !!st.noteEnabled,
    noteText: st.noteText || 'Tặng quà chỉ định để chọn Creator (vẫn được tính điểm), sau đó lên gì cũng tính cho Creator đó. Tặng quà Creator khác để chuyển, hết trận sẽ tự hủy',
    noteBgColor: st.noteBgColor || '#1f2430',
    noteTextColor: st.noteTextColor || '#ffffff',
    noteSpeedSec: st.noteSpeedSec || 16,
    noteEffect: st.noteEffect || 'soft',
    separatedGap: st.separatedGap ?? 180,
    autoTextContrast: !!st.autoTextContrast,
    durationSec: st.durationSec || 90,
    prepSec: st.prepSec ?? 3,
    delaySec: st.delaySec ?? 5,
    textSize: st.textSize || 30,
    nameSize: st.nameSize || 100,
    giftSize: st.giftSize || 60,
    overlayScale: st.overlayScale || 100,
    creatorColors: st.creatorColors || {},
    smartColor: st.smartColor !== false,
    participants: Array.isArray(st.participants) ? st.participants : [],
  };
  renderPkGroupGroupSelect();
  $('#pkgContent').value = pkGroupCfg.content;
  $('#pkgGroup').value = pkGroupCfg.groupId;
  $('#pkgLayoutMode').value = pkGroupCfg.layoutMode;
  $('#pkgPlayMode').value = pkGroupCfg.playMode;
  $('#pkgPointsBy').value = pkGroupCfg.pointsBy;
  $('#pkgNoteEnabled').checked = !!pkGroupCfg.noteEnabled;
  $('#pkgNoteText').value = pkGroupCfg.noteText || '';
  $('#pkgNoteBg').value = pkGroupCfg.noteBgColor || '#1f2430';
  $('#pkgNoteColor').value = pkGroupCfg.noteTextColor || '#ffffff';
  $('#pkgNoteSpeed').value = pkGroupCfg.noteSpeedSec || 16;
  $('#pkgNoteEffect').value = pkGroupCfg.noteEffect || 'soft';
  $('#pkgSeparatedGap').value = pkGroupCfg.separatedGap ?? 180;
  $('#pkgSeparatedGapValue').textContent = `${$('#pkgSeparatedGap').value}px`;
  const d = pkGroupCfg.durationSec || 300;
  $('#pkgDurH').value = Math.floor(d / 3600);
  $('#pkgDurM').value = Math.floor((d % 3600) / 60);
  $('#pkgDurS').value = d % 60;
  $('#pkgPrep').value = pkGroupCfg.prepSec;
  $('#pkgDelay').value = pkGroupCfg.delaySec;
  $('#pkgTextSize').value = pkGroupCfg.textSize;
  $('#pkgNameSize').value = pkGroupCfg.nameSize;
  $('#pkgGiftSize').value = pkGroupCfg.giftSize;
  $('#pkgOverlayScale').value = Math.max(80, Math.min(300, pkGroupCfg.overlayScale));
  $('#pkgOverlayScaleValue').textContent = `${$('#pkgOverlayScale').value}%`;
  if ($('#pkgSmartColor')) $('#pkgSmartColor').checked = pkGroupCfg.smartColor !== false;
  renderPkGroupMembers();
  renderPkGroupPreview(st);
}

function renderPkGroupGroupSelect() {
  const sel = $('#pkgGroup');
  if (!sel) return;
  const gs = visibleGroups();
  const prev = sel.value || pkGroupCfg?.groupId || '';
  const current = activeGroupId ? activeGroupId : prev;
  sel.innerHTML = '<option value="">— Chọn nhóm —</option>' + gs.map(g => `<option value="${escapeAttr(g.id)}">${escapeHtml(groupInfoText(g, g.name))}</option>`).join('');
  sel.value = gs.some(g => g.id === current) ? current : '';
}

// Sinh màu hex từ HSL — dùng để phối màu đều, không trùng lặp cho các Creator.
function pkgHslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const val = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * val).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Gán màu KHÁC NHAU cho từng Creator theo thứ tự hiển thị (hue chia đều vòng tròn màu).
// Giữ nguyên màu người dùng đã tự chọn nếu chưa bị trùng; nếu trùng thì đẩy sang hue trống.
function ensureDistinctPkgColors(orderedMembers) {
  const map = new Map();
  const used = new Set();
  const norm = h => String(h || '').toLowerCase();
  const n = Math.max(1, orderedMembers.length);
  orderedMembers.forEach((c, i) => {
    let color = normalizeHexColor(pkGroupCfg?.creatorColors?.[c.id],
      normalizeHexColor(pkGroupCfg?.creatorColors?.[c.tiktokId], ''));
    if (!color || used.has(norm(color))) {
      let tries = 0;
      do {
        const hue = Math.round((i * 360 / n + tries * 43) % 360);
        color = pkgHslToHex(hue, 70, 55);
        tries++;
      } while (used.has(norm(color)) && tries < 30);
    }
    used.add(norm(color));
    map.set(c.id, color);
  });
  return map;
}

// Phối lại màu toàn bộ thành viên: chia đều hue để chắc chắn không trùng (nút "Phối lại màu").
function autoAssignPkgColors() {
  if (!pkGroupCfg) return;
  syncPkGroupMembersFromDom();
  const groupId = $('#pkgGroup')?.value || pkGroupCfg.groupId || '';
  const members = visibleCreators().filter(c => c.groupId === groupId);
  const order = new Map((pkGroupCfg.participants || []).map((p, i) => [p.creatorId || p.id, i]));
  const ordered = members.slice().sort((a, b) => {
    const ai = order.has(a.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bi = order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return (a.nickname || a.tiktokId || '').localeCompare(b.nickname || b.tiktokId || '', 'vi');
  });
  const n = Math.max(1, ordered.length);
  pkGroupCfg.creatorColors = { ...(pkGroupCfg.creatorColors || {}) };
  ordered.forEach((c, i) => {
    const color = pkgHslToHex(Math.round((i * 360 / n) % 360), 70, 55);
    pkGroupCfg.creatorColors[c.id] = color;
    const p = (pkGroupCfg.participants || []).find(x => x.creatorId === c.id || x.id === c.id);
    if (p) p.color = color;
  });
  renderPkGroupMembers();
  schedulePkGroupAutoSave();
}

function pkGroupParticipantForCreator(c) {
  const old = pkGroupCfg.participants.find(p => p.creatorId === c.id || p.id === c.id) || {};
  // Giữ override cũ nếu có; ngược lại luôn bám quà mặc định hiện tại (không đông cứng)
  const override = !!old.giftOverride && isRealGift(old.gifts?.[0]);
  const gift = override ? old.gifts[0] : creatorDefaultGift(c);
  const palette = ['#FE2C55', '#25F4EE', '#A855F7', '#F59E0B', '#22C55E', '#3B82F6', '#EC4899', '#14B8A6'];
  const color = palette[Math.abs(String(c.id || c.tiktokId || '').split('').reduce((n, ch) => n + ch.charCodeAt(0), 0)) % palette.length];
  const savedColor = pkGroupCfg?.creatorColors?.[c.id] || pkGroupCfg?.creatorColors?.[c.tiktokId];
  return {
    id: old.id || c.id,
    creatorId: c.id,
    tiktokId: c.tiktokId || '',
    name: old.name || c.nickname || c.tiktokId || 'Creator',
    avatar: c.avatar || old.avatar || '../logo/hp-logo.png',
    color: normalizeHexColor(old.color, normalizeHexColor(savedColor, normalizeHexColor(c.color, color))),
    giftOverride: override,
    gifts: gift ? [gift] : [],
    streak: Number(old.streak) || 0,
  };
}

function renderPkGroupMembers() {
  const wrap = $('#pkgMembers');
  if (!wrap || !pkGroupCfg) return;
  const groupId = $('#pkgGroup')?.value || pkGroupCfg.groupId || '';
  const members = visibleCreators().filter(c => c.groupId === groupId);
  const selected = new Map((pkGroupCfg.participants || []).map(p => [p.creatorId || p.id, p]));
  if (!groupId) {
    wrap.innerHTML = '<div class="hint">Chọn một nhóm để hiện danh sách creator.</div>';
    return;
  }
  if (!members.length) {
    wrap.innerHTML = '<div class="hint">Nhóm này chưa có creator.</div>';
    return;
  }
  const order = new Map((pkGroupCfg.participants || []).map((p, i) => [p.creatorId || p.id, i]));
  const displayMembers = members.slice().sort((a, b) => {
    const ai = order.has(a.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bi = order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return (a.nickname || a.tiktokId || '').localeCompare(b.nickname || b.tiktokId || '', 'vi');
  });
  const smartColor = pkGroupCfg.smartColor !== false;
  const colorMap = smartColor ? ensureDistinctPkgColors(displayMembers) : null;
  if (colorMap) {
    pkGroupCfg.creatorColors = { ...(pkGroupCfg.creatorColors || {}) };
    let changed = false;
    const norm = h => String(h || '').toLowerCase();
    displayMembers.forEach(c => {
      const col = colorMap.get(c.id);
      if (norm(pkGroupCfg.creatorColors[c.id]) !== norm(col)) { pkGroupCfg.creatorColors[c.id] = col; changed = true; }
      const part = (pkGroupCfg.participants || []).find(x => x.creatorId === c.id || x.id === c.id);
      if (part && norm(part.color) !== norm(col)) { part.color = col; changed = true; }
    });
    if (changed) schedulePkGroupAutoSave();
  }
  wrap.innerHTML = displayMembers.map(c => {
    const p = selected.get(c.id) || pkGroupParticipantForCreator(c);
    const checked = selected.has(c.id) ? 'checked' : '';
    // Không override → hiện quà mặc định hiện tại của creator (realtime)
    const override = !!p.giftOverride && isRealGift(p.gifts?.[0]);
    const gift = override ? p.gifts[0] : creatorDefaultGift(c);
    const rowColor = colorMap ? colorMap.get(c.id) : normalizeHexColor(p.color, '#FE2C55');
    return `<div class="pkg-member" data-id="${escapeAttr(c.id)}">
      <div class="pkg-order-tools"><button class="ghost tiny pkg-move-up" type="button">↑</button><button class="ghost tiny pkg-move-down" type="button">↓</button></div>
      <label class="pkg-member-check"><input type="checkbox" ${checked} /> <img src="${escapeAttr(c.avatar || '../logo/hp-logo.png')}" /><b>${escapeHtml(c.nickname || c.tiktokId)}</b></label>
      <input class="pkg-name" value="${escapeAttr(p.name || '')}" maxlength="20" placeholder="Tên hiển thị" />
      <input class="pkg-color" type="color" value="${escapeAttr(rowColor)}" />
      <input class="pkg-streak-input" type="number" min="0" max="999" value="${Number(p.streak) || 0}" title="MVP chuỗi" />
      <div class="pkg-gift-cell">
        <button class="ghost tiny pkg-pick-gift${override ? ' is-override' : ''}" type="button" title="${override ? 'Đang ghi đè quà — bấm để đổi' : 'Đang theo quà mặc định của Creator (realtime)'}">${gift?.icon ? `<img src="${escapeAttr(gift.icon)}" />` : '🎁'} ${escapeHtml(gift?.giftName || gift?.name || 'Chọn quà')}</button>
        ${override ? '<button class="ghost tiny pkg-reset-gift" type="button" title="Về quà mặc định">🔄</button>' : ''}
      </div>
      <button class="primary tiny pkg-test-gift" type="button">Test quà</button>
      <button class="ghost tiny pkg-add-point" type="button">+1</button>
    </div>`;
  }).join('');
  wrap.querySelectorAll('.pkg-member').forEach(row => {
    const creator = creators.find(c => c.id === row.dataset.id);
    row.querySelector('input[type="checkbox"]').addEventListener('change', () => { syncPkGroupMembersFromDom(); schedulePkGroupAutoSave(); renderPkGroupMembers(); });
    row.querySelector('.pkg-name').addEventListener('input', () => { syncPkGroupMembersFromDom(); schedulePkGroupAutoSave(); });
    row.querySelector('.pkg-color').addEventListener('change', () => { syncPkGroupMembersFromDom(); schedulePkGroupAutoSave(); });
    row.querySelector('.pkg-streak-input').addEventListener('input', () => {
      enforcePkGroupMvpInput(row);
      syncPkGroupMembersFromDom();
      window.api.pkgroup.setConfig(collectPkGroupCfg()).catch(() => {});
    });
    row.querySelector('.pkg-pick-gift').addEventListener('click', async () => {
      syncPkGroupMembersFromDom();
      const p = pkGroupCfg.participants.find(x => x.creatorId === creator.id || x.id === creator.id) || pkGroupParticipantForCreator(creator);
      const picked = await GiftPicker.open({
        title: `🎁 Chọn quà cho ${p.name}`,
        multi: pkGroupCfg.playMode === 'fixed',
        selected: (p.gifts || []).map(g => String(g.giftId || g.id || '')),
      });
      const gifts = Array.isArray(picked) ? picked : (picked ? [picked] : []);
      if (!gifts.length) return;
      p.gifts = gifts.map(g => g.giftName ? g : giftToPkGift(g));
      p.giftOverride = true; // chọn tay = ghi đè, không bám mặc định nữa
      const idx = pkGroupCfg.participants.findIndex(x => x.creatorId === p.creatorId || x.id === p.id);
      if (idx >= 0) pkGroupCfg.participants[idx] = p;
      else pkGroupCfg.participants.push(p);
      renderPkGroupMembers();
      schedulePkGroupAutoSave();
    });
    row.querySelector('.pkg-reset-gift')?.addEventListener('click', () => {
      syncPkGroupMembersFromDom();
      const p = pkGroupCfg.participants.find(x => x.creatorId === creator.id || x.id === creator.id);
      if (!p) return;
      p.giftOverride = false; // gỡ ghi đè → tự về quà mặc định
      const def = creatorDefaultGift(creator);
      p.gifts = def ? [def] : [];
      renderPkGroupMembers();
      schedulePkGroupAutoSave();
      toast(`🔄 ${p.name || creator.nickname || creator.tiktokId} về quà mặc định`, 'success');
    });
    row.querySelector('.pkg-add-point').addEventListener('click', async () => {
      syncPkGroupMembersFromDom();
      const p = pkGroupCfg.participants.find(x => x.creatorId === creator.id || x.id === creator.id);
      if (p) await window.api.pkgroup.addPoints(p.id, 1);
    });
    row.querySelector('.pkg-test-gift').addEventListener('click', async () => {
      await window.api.pkgroup.setConfig(collectPkGroupCfg());
      const p = pkGroupCfg.participants.find(x => x.creatorId === creator.id || x.id === creator.id);
      if (!p) { toast('Cần tích chọn thành viên trước', 'error'); return; }
      const res = await window.api.pkgroup.testGift(p.id);
      if (!res) { toast('Không test được quà thành viên này', 'error'); return; }
      toast(`Test ${p.name}: +${formatNumber(res.points)}${res.giftName ? ` (${res.giftName})` : ''}`, 'success');
    });
    row.querySelector('.pkg-move-up').addEventListener('click', () => movePkGroupParticipant(creator.id, -1));
    row.querySelector('.pkg-move-down').addEventListener('click', () => movePkGroupParticipant(creator.id, 1));
  });
}

function movePkGroupParticipant(creatorId, dir) {
  syncPkGroupMembersFromDom();
  const idx = pkGroupCfg.participants.findIndex(p => (p.creatorId || p.id) === creatorId);
  if (idx < 0) { toast('Cần tích chọn thành viên trước', 'error'); return; }
  const next = idx + dir;
  if (next < 0 || next >= pkGroupCfg.participants.length) return;
  const [item] = pkGroupCfg.participants.splice(idx, 1);
  pkGroupCfg.participants.splice(next, 0, item);
  renderPkGroupMembers();
  schedulePkGroupAutoSave();
}

function enforcePkGroupMvpInput(changedRow) {
  const changedInput = changedRow.querySelector('.pkg-streak-input');
  const changedValue = Math.max(0, Number(changedInput?.value) || 0);
  if (changedInput) changedInput.value = changedValue;
  if (changedValue <= 0) return;
  const changedId = changedRow.dataset.id;
  const activeOwner = (pkGroupCfg?.participants || []).find(p => Number(p.streak) > 0);
  if (!activeOwner || (activeOwner.creatorId || activeOwner.id) === changedId) return;
  changedInput.value = 0;
  const activeName = activeOwner.name || activeOwner.tiktokId || 'Creator đang MVP';
  toast(`Cần đưa MVP của ${activeName} về 0 trước khi chuyển MVP`, 'error');
}

function normalizePkGroupMvpInputs() {
  const activeRows = $$('#pkgMembers .pkg-member').filter(row => (Number(row.querySelector('.pkg-streak-input')?.value) || 0) > 0);
  if (activeRows.length <= 1) return true;
  const activeOwner = (pkGroupCfg?.participants || []).find(p => Number(p.streak) > 0);
  const keepId = activeOwner ? (activeOwner.creatorId || activeOwner.id) : activeRows[0].dataset.id;
  activeRows.forEach(row => {
    if (row.dataset.id !== keepId) row.querySelector('.pkg-streak-input').value = 0;
  });
  toast('Chỉ được có 1 Creator MVP > 0. Hãy đưa MVP hiện tại về 0 trước khi chuyển.', 'error');
  return false;
}

function syncPkGroupMembersFromDom() {
  if (!pkGroupCfg) return;
  normalizePkGroupMvpInputs();
  pkGroupCfg.creatorColors = { ...(pkGroupCfg.creatorColors || {}) };
  const prev = new Map((pkGroupCfg.participants || []).map(p => [p.creatorId || p.id, p]));
  const participants = [];
  $$('#pkgMembers .pkg-member').forEach(row => {
    const checked = row.querySelector('input[type="checkbox"]')?.checked;
    if (!checked) return;
    const c = creators.find(x => x.id === row.dataset.id);
    if (!c) return;
    const old = prev.get(c.id) || pkGroupParticipantForCreator(c);
    const color = normalizeHexColor(row.querySelector('.pkg-color')?.value, old.color || '#FE2C55');
    pkGroupCfg.creatorColors[c.id] = color;
    // Không override → luôn đồng bộ lại quà mặc định hiện tại của creator
    const isOverride = !!old.giftOverride && isRealGift(old.gifts?.[0]);
    let gifts = old.gifts || [];
    if (!isOverride) {
      const def = creatorDefaultGift(c);
      gifts = def ? [def] : [];
    }
    participants.push({
      ...old,
      id: old.id || c.id,
      creatorId: c.id,
      tiktokId: c.tiktokId || '',
      avatar: c.avatar || old.avatar || '../logo/hp-logo.png',
      name: row.querySelector('.pkg-name')?.value.trim() || c.nickname || c.tiktokId || 'Creator',
      color,
      giftOverride: isOverride,
      gifts,
      streak: Math.max(0, Number(row.querySelector('.pkg-streak-input')?.value) || 0),
    });
  });
  pkGroupCfg.participants = participants;
}

function schedulePkGroupAutoSave() {
  clearTimeout(pkGroupConfigAutoTimer);
  pkGroupConfigAutoTimer = setTimeout(async () => {
    try { if (pkGroupCfg) await window.api.pkgroup.setConfig(collectPkGroupCfg()); } catch {}
  }, 250);
}

function wirePkGroupTab() {
  $('#pkgGroup').addEventListener('change', () => {
    pkGroupCfg.groupId = $('#pkgGroup').value;
    pkGroupCfg.participants = [];
    renderPkGroupMembers();
    schedulePkGroupAutoSave();
  });
  $('#pkgSeparatedGap').addEventListener('input', async () => {
    $('#pkgSeparatedGapValue').textContent = `${$('#pkgSeparatedGap').value}px`;
    syncPkGroupMembersFromDom();
    if (pkGroupCfg) {
      pkGroupCfg.separatedGap = Math.max(0, Math.min(800, Number($('#pkgSeparatedGap').value) || 0));
      try { await window.api.pkgroup.setConfig(collectPkGroupCfg()); } catch {}
    }
  });
  $('#pkgOverlayScale').addEventListener('input', async () => {
    $('#pkgOverlayScaleValue').textContent = `${$('#pkgOverlayScale').value}%`;
    syncPkGroupMembersFromDom();
    if (pkGroupCfg) {
      pkGroupCfg.overlayScale = Math.max(80, Math.min(300, Number($('#pkgOverlayScale').value) || 100));
      try { await window.api.pkgroup.setConfig(collectPkGroupCfg()); } catch {}
    }
  });
  ['pkgContent','pkgLayoutMode','pkgPlayMode','pkgPointsBy','pkgNoteEnabled','pkgNoteText','pkgNoteBg','pkgNoteColor','pkgNoteSpeed','pkgNoteEffect','pkgDurH','pkgDurM','pkgDurS','pkgPrep','pkgDelay','pkgTextSize','pkgNameSize','pkgGiftSize'].forEach(id => {
    const el = $('#' + id);
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input', () => { syncPkGroupMembersFromDom(); schedulePkGroupAutoSave(); renderPkGroupMembers(); });
  });
  $('#pkgSmartColor').addEventListener('change', () => {
    pkGroupCfg.smartColor = $('#pkgSmartColor').checked;
    if (pkGroupCfg.smartColor) autoAssignPkgColors();
    else schedulePkGroupAutoSave();
  });
  $('#pkgAutoColor').addEventListener('click', autoAssignPkgColors);
  $('#pkgSaveCfg').addEventListener('click', updatePkGroupConfig);
  $('#pkgStart').addEventListener('click', async () => {
    if ($('#pkgStart').dataset.running === 'true') { await window.api.pkgroup.stop(); return; }
    const cfg = collectPkGroupCfg();
    if (!cfg.participants.length) { toast('Cần tích ít nhất 1 creator', 'error'); return; }
    await window.api.pkgroup.setConfig(cfg);
    await window.api.pkgroup.start();
  });
  $('#pkgReset').addEventListener('click', async () => { await window.api.pkgroup.reset(); });
  $('#pkgCopyUrl').addEventListener('click', async () => {
    const url = await window.api.pkgroup.getUrl();
    await window.api.shell.copyText(url);
    toast('📋 Đã copy link PK Nhóm', 'success');
  });
}

async function updatePkGroupConfig() {
  await window.api.pkgroup.setConfig(collectPkGroupCfg());
  toast('🔄 Đã cập nhật PK Nhóm', 'success');
}

function collectPkGroupCfg() {
  syncPkGroupMembersFromDom();
  const h = Number($('#pkgDurH').value) || 0;
  const m = Number($('#pkgDurM').value) || 0;
  const s = Number($('#pkgDurS').value) || 0;
  return {
    ...pkGroupCfg,
    content: $('#pkgContent').value.trim() || 'PK NHÓM',
    groupId: $('#pkgGroup').value,
    layoutMode: $('#pkgLayoutMode').value,
    playMode: $('#pkgPlayMode').value,
    pointsBy: $('#pkgPointsBy').value,
    noteEnabled: $('#pkgNoteEnabled').checked,
    noteText: $('#pkgNoteText').value.trim(),
    noteBgColor: $('#pkgNoteBg').value,
    noteTextColor: $('#pkgNoteColor').value,
    noteSpeedSec: Math.max(6, Number($('#pkgNoteSpeed').value) || 16),
    noteEffect: $('#pkgNoteEffect').value,
    separatedGap: Math.max(0, Math.min(800, Number($('#pkgSeparatedGap').value) || 0)),
    autoTextContrast: !!$('#ovlAutoTextContrast')?.checked,
    durationSec: Math.max(5, h * 3600 + m * 60 + s),
    prepSec: Number($('#pkgPrep').value) || 0,
    delaySec: Number($('#pkgDelay').value) || 0,
    textSize: Number($('#pkgTextSize').value),
    nameSize: Math.max(60, Math.min(200, Number($('#pkgNameSize').value) || 100)),
    giftSize: Number($('#pkgGiftSize').value),
    overlayScale: Math.max(80, Math.min(300, Number($('#pkgOverlayScale').value) || 100)),
    creatorColors: pkGroupCfg.creatorColors || {},
  };
}

function renderPkGroupPreview(st = {}) {
  const participants = st.participants || pkGroupCfg?.participants || [];
  if (pkGroupCfg && Array.isArray(st.participants) && ['grace', 'finished'].includes(st.status)) {
    const streakById = new Map(st.participants.map(p => [p.id || p.creatorId, Number(p.streak) || 0]));
    pkGroupCfg.participants = (pkGroupCfg.participants || []).map(p => ({ ...p, streak: streakById.get(p.id) ?? streakById.get(p.creatorId) ?? 0 }));
    $$('#pkgMembers .pkg-member').forEach(row => {
      const p = pkGroupCfg.participants.find(x => (x.creatorId || x.id) === row.dataset.id);
      const input = row.querySelector('.pkg-streak-input');
      if (input && p) input.value = Number(p.streak) || 0;
    });
  }
  const sec = Math.ceil((st.remainingMs || 0) / 1000);
  const statusText = st.status === 'prestart' ? `Sắp bắt đầu — ${sec}s`
    : st.status === 'running' ? `Đang đấu — ${sec}s`
    : st.status === 'grace' ? 'ĐANG TÍNH ĐIỂM'
    : st.status === 'finished' ? 'Đã kết thúc'
    : 'Chờ bắt đầu';
  const running = st.status === 'prestart' || st.status === 'running' || st.status === 'grace';
  const startBtn = $('#pkgStart');
  if (startBtn) {
    startBtn.dataset.running = running ? 'true' : 'false';
    startBtn.textContent = running ? '■ DỪNG' : '▶ BẮT ĐẦU';
    startBtn.classList.toggle('primary', !running);
    startBtn.classList.toggle('warn', running);
  }
  const total = participants.reduce((sum, p) => sum + (Number(p.score) || 0), 0);
  const max = Math.max(1, ...participants.map(p => Number(p.score) || 0));
  $('#pkgPreview').innerHTML = `<div class="pkg-preview-box"><b>${escapeHtml(statusText)}</b>${participants.map(p => {
    const score = Number(p.score) || 0;
    const width = (st.layoutMode || pkGroupCfg?.layoutMode) === 'separated' ? Math.max(4, score / max * 100) : Math.max(4, total ? score / total * 100 : 100 / Math.max(1, participants.length));
    const scoreColor = width >= 50 ? textColorForPreview(p.color || '#FE2C55') : '#111827';
    return `<div class="pkg-preview-row"><span style="color:${escapeAttr(p.color || '#FE2C55')}">${escapeHtml(p.name || 'Creator')}</span><div><i style="width:${width}%;background:${escapeAttr(p.color || '#FE2C55')}"></i><b style="color:${escapeAttr(scoreColor)}">${formatNumber(score)}</b></div></div>`;
  }).join('')}</div>`;
}

function textColorForPreview(bg) {
  const m = String(bg || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return ((0.299 * r + 0.587 * g + 0.114 * b) / 255) > 0.62 ? '#111827' : '#ffffff';
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
  $('#rkOverlayScale').value = st.overlayScale || 100;
  $('#rkOverlayScaleValue').textContent = `${$('#rkOverlayScale').value}%`;
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
    overlayScale: Math.max(80, Math.min(300, Number($('#rkOverlayScale').value) || 100)),
    activeGroupId,
  });
  $('#rkOverlayScale').addEventListener('input', () => { $('#rkOverlayScaleValue').textContent = `${$('#rkOverlayScale').value}%`; updateRkRealtime(); });
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
    visibleCreators().filter(c => c.hideObs && !visibleIds.has(c.id)).forEach(c => {
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
      </div>` : `<div class="rk-scorebox readonly">${r.hideScore || st.hideAllScores ? '<span class="rk-pts muted" title="Ẩn điểm">•••</span>' : `<span class="rk-pts">${formatNumber(r.points)}</span>`}${st.showRound === false ? '' : `<span class="rk-round-chip">R${Number(r.round) || 0}</span>`}</div>`}
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
    } else if (key === 'voteActive' && c.voteActive && scoreLinkRanking) {
      // Bỏ VOTE khi đang liên kết → xóa Creator bên Tính điểm để 2 bên vẫn khớp
      $('#scCreatorName').value = '';
      $('#scCreatorAvatar').value = '';
      if ($('#scCreatorSelect')) $('#scCreatorSelect').value = '';
      await window.api.score.setConfig(collectScoreCfg());
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
  $('#scScoreFontSize').value = Math.max(12, Math.min(48, Number(st.scoreFontSize) || 18));
  $('#scContentColor').value = st.contentColor || '#f0eef6';
  $('#scOverColor').value = st.overColor || '#ff0000';
  $('#scBarColor1').value = st.barColor1 || '#b93678';
  $('#scBarColor2').value = st.barColor2 || '#ff8ed1';
  $('#scWaveColor').value = st.waveColor || '#ffffff';
  $('#scBigThreshold').value = st.bigGiftThreshold || 500;
  $('#scPointsBy').value = st.pointsBy || 'diamond';
  $('#scOverlayScale').value = st.overlayScale || 100;
  $('#scOverlayScaleValue').textContent = `${$('#scOverlayScale').value}%`;
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
    scoreFontSize: Math.max(12, Math.min(48, Number($('#scScoreFontSize').value) || 18)),
    contentColor: $('#scContentColor').value,
    overColor: $('#scOverColor').value,
    barColor1: $('#scBarColor1').value,
    barColor2: $('#scBarColor2').value,
    waveColor: $('#scWaveColor').value,
    bigGiftThreshold: Math.max(1, Number($('#scBigThreshold').value) || 500),
    pointsBy: $('#scPointsBy').value,
    overlayScale: Math.max(80, Math.min(300, Number($('#scOverlayScale').value) || 100)),
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
  sel.innerHTML = '<option value="">— Chọn Creator —</option>' + visibleCreators()
    .slice()
    .sort((a, b) => (a.nickname || a.tiktokId || '').localeCompare(b.nickname || b.tiktokId || '', 'vi'))
    .map(c => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.nickname || c.tiktokId)}</option>`)
    .join('');
  sel.value = current;
}

async function applyScoreCreatorSelect() {
  const c = creators.find(x => x.id === $('#scCreatorSelect').value);
  $('#scCreatorName').value = c ? (c.nickname || c.tiktokId || '') : '';
  $('#scCreatorAvatar').value = c ? creatorAvatarValue(c) : '';
  renderScPreview({ ...(latestScoreState || collectScoreCfg()), ...collectScoreCfg(), score: latestScoreState?.score || 0, status: latestScoreState?.status || 'idle', timeText: latestScoreState?.timeText || '00:00' });
  scheduleScoreAutoSave();
  // Khi bật liên kết: chọn Creator bên Tính điểm cũng tự VOTE bên Thi đấu nhóm để 2 bên đồng bộ
  if (scoreLinkRanking) await syncScoreSelectToVote(c);
}

// Đồng bộ lựa chọn Creator bên 🎯 Tính điểm → VOTE bên 🏆 Thi đấu nhóm
async function syncScoreSelectToVote(c) {
  if (isLinkedScoreRunning()) {
    // Đang chạy Tính điểm liên kết → VOTE bị khóa, khôi phục dropdown theo Creator đang VOTE
    const voted = getVotedCreator();
    if ($('#scCreatorSelect')) $('#scCreatorSelect').value = voted?.id || '';
    toast('Đang chạy Tính điểm liên kết, VOTE đang bị khóa', 'error');
    return;
  }
  const voted = getVotedCreator();
  if (!c) {
    // Bỏ chọn Creator → bỏ VOTE để 2 bên vẫn khớp nhau
    if (voted) {
      await window.api.creators.upsert({ ...voted, voteActive: false });
      await refreshCreators();
      const st = await window.api.ranking.getState();
      renderRkPreview(st);
      renderScoreBridge();
    }
    return;
  }
  if (voted && voted.id === c.id) return; // đã VOTE đúng Creator, không cần làm lại
  await window.api.ranking.setActive('');
  for (const other of creators) {
    if (other.id !== c.id && other.voteActive) await window.api.creators.upsert({ ...other, voteActive: false });
  }
  await updateRankingCreator(c.id, {
    voteActive: true,
    __history: { at: Date.now(), label: 'VOTE ON (Tính điểm)' },
  }, `VOTE: ${c.nickname || c.tiktokId}`);
  const fresh = creators.find(x => x.id === c.id) || c;
  await applyAutoTargetForVote({ ...fresh, voteActive: true });
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
  $('#scOverlayScale').addEventListener('input', () => { $('#scOverlayScaleValue').textContent = `${$('#scOverlayScale').value}%`; scheduleScoreAutoSave(); });
  ['scPrep','scDelay','scTheme','scSize','scBarStyle','scHideAvatar','scHideCreator','scTimeColor','scScoreFontSize','scContentColor','scOverColor','scBarColor1','scBarColor2','scWaveColor'].forEach(id => {
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
          ${st.creatorAvatar ? `<img class="js-avatar" src="${escapeAttr(st.creatorAvatar)}" />` : '<span>HP</span>'}
          <strong>${escapeHtml(st.creatorName || 'Creator')}</strong>
        </div>
        <div class="score-review-score" style="font-size:${Math.max(12, Math.min(48, Number(st.scoreFontSize) || 18))}px">Điểm: ${formatNumber(score)}/${formatNumber(target)}</div>
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
  const [pk, pkg, rk, sc] = await Promise.all([
    window.api.pkduo.getUrl(), window.api.pkgroup.getUrl(), window.api.ranking.getUrl(), window.api.score.getUrl(),
  ]);
  $('#urlPk').value = pk; $('#urlPkg').value = pkg; $('#urlRk').value = rk; $('#urlSc').value = sc;
  await refreshReviewButtons();
}

async function refreshReviewButtons() {
  const state = await window.api.review.getState().catch(() => ({}));
  $$('[data-review-toggle]').forEach(btn => {
    const type = btn.dataset.reviewToggle;
    const open = !!state[type]?.open;
    btn.classList.toggle('is-on', open);
    btn.textContent = open ? 'Đóng Review' : '🖥 Review';
  });
  $$('[data-review-top]').forEach(btn => {
    const type = btn.dataset.reviewTop;
    const on = state[type]?.alwaysOnTop !== false;
    btn.classList.toggle('is-on', on);
    btn.textContent = on ? '📌 Nổi bật' : '📍 Thường';
  });
  $$('[data-review-click]').forEach(btn => {
    const type = btn.dataset.reviewClick;
    const on = !!state[type]?.clickThrough;
    btn.classList.toggle('is-on', on);
    btn.textContent = on ? '🖱 Đang xuyên' : '🖱 Xuyên';
  });
  $$('[data-review-bg]').forEach(input => {
    const type = input.dataset.reviewBg;
    const bg = state[type]?.background || 'transparent';
    input.value = /^#[0-9a-f]{6}$/i.test(bg) ? bg : '#000000';
    input.classList.toggle('is-transparent', bg === 'transparent');
  });
  $$('[data-review-alpha]').forEach(input => {
    const type = input.dataset.reviewAlpha;
    input.value = Math.round((Number(state[type]?.backgroundAlpha) || 0) * 100);
    input.disabled = (state[type]?.background || 'transparent') === 'transparent';
  });
  $$('[data-review-bg-clear]').forEach(btn => {
    const type = btn.dataset.reviewBgClear;
    btn.classList.toggle('is-on', (state[type]?.background || 'transparent') === 'transparent');
  });
}

function wireOverlaysTab() {
  if (!reviewStateTimer) reviewStateTimer = setInterval(refreshReviewButtons, 1000);

  $$('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const v = $('#' + b.dataset.copy).value;
    await window.api.shell.copyText(v);
    toast('📋 Đã copy', 'success');
  }));

  $$('[data-review-toggle]').forEach(btn => btn.addEventListener('click', async () => {
    const type = btn.dataset.reviewToggle;
    const state = await window.api.review.getState().catch(() => ({}));
    const r = state[type]?.open ? await window.api.review.close(type) : await window.api.review.open(type);
    if (!r?.ok) { toast(r?.error || 'Không thao tác được Overlay Review', 'error'); return; }
    await refreshReviewButtons();
    toast(state[type]?.open ? 'Đã đóng Overlay Review' : 'Đã mở Overlay Review', 'success');
  }));

  $$('[data-review-top]').forEach(btn => btn.addEventListener('click', async () => {
    const type = btn.dataset.reviewTop;
    const state = await window.api.review.getState().catch(() => ({}));
    const next = state[type]?.alwaysOnTop === false;
    await window.api.review.setAlwaysOnTop(type, next);
    await refreshReviewButtons();
    toast(next ? 'Overlay Review luôn nổi' : 'Overlay Review không luôn nổi', 'success');
  }));

  $$('[data-review-click]').forEach(btn => btn.addEventListener('click', async () => {
    const type = btn.dataset.reviewClick;
    const state = await window.api.review.getState().catch(() => ({}));
    const next = !state[type]?.clickThrough;
    const r = await window.api.review.setClickThrough(type, next);
    if (!r?.ok) { toast(r?.error || 'Không bật được xuyên chuột', 'error'); return; }
    await refreshReviewButtons();
    toast(next ? 'Review cho chuột xuyên qua lớp dưới' : 'Review nhận chuột/kéo thả lại', 'success');
  }));

  $$('[data-review-bg]').forEach(input => input.addEventListener('input', async () => {
    const alpha = Number($(`[data-review-alpha="${input.dataset.reviewBg}"]`)?.value || 100) / 100;
    const r = await window.api.review.setBackground(input.dataset.reviewBg, input.value, alpha);
    if (!r?.ok) { toast(r?.error || 'Không đổi được màu nền Review', 'error'); return; }
    await refreshReviewButtons();
  }));

  $$('[data-review-alpha]').forEach(input => input.addEventListener('input', async () => {
    const color = $(`[data-review-bg="${input.dataset.reviewAlpha}"]`)?.value || '#000000';
    const r = await window.api.review.setBackground(input.dataset.reviewAlpha, color, Number(input.value) / 100);
    if (!r?.ok) { toast(r?.error || 'Không đổi được độ trong suốt Review', 'error'); return; }
    await refreshReviewButtons();
  }));

  $$('[data-review-bg-clear]').forEach(btn => btn.addEventListener('click', async () => {
    const r = await window.api.review.setBackground(btn.dataset.reviewBgClear, 'transparent', 0);
    if (!r?.ok) { toast(r?.error || 'Không đổi được màu nền Review', 'error'); return; }
    await refreshReviewButtons();
    toast('Review trở về nền trong suốt', 'success');
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
        autoTextContrast: $('#ovlAutoTextContrast').checked,
      },
    });
    if (pkGroupCfg) {
      pkGroupCfg.autoTextContrast = $('#ovlAutoTextContrast').checked;
      await window.api.pkgroup.setConfig(collectPkGroupCfg());
    }
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
  $('#ovlAutoTextContrast').checked = !!ov.autoTextContrast;
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

async function refreshDataBackupHint() {
  const el = $('#dataBackupHint');
  if (!el) return;
  try {
    const c = await window.api.data.counts();
    el.innerHTML = `📦 Hiện có: <b>${c.creators}</b> Creator · <b>${c.groups}</b> Nhóm`;
  } catch { el.textContent = '📦 Không đọc được số lượng dữ liệu'; }
}

function wireDataBackup() {
  $('#btnExportData')?.addEventListener('click', async () => {
    const res = await window.api.data.export();
    if (res?.ok) toast(`Đã xuất ${res.creators} Creator + ${res.groups} Nhóm`, 'success');
    else if (res?.reason && res.reason !== 'canceled') toast('Xuất dữ liệu thất bại', 'error');
  });
  $('#btnImportData')?.addEventListener('click', async () => {
    if (!confirm('Nhập dữ liệu từ file? Creator/Nhóm trùng ID sẽ được cập nhật, dữ liệu mới sẽ được thêm (không xoá dữ liệu hiện có).')) return;
    const res = await window.api.data.import();
    if (res?.ok) {
      toast(`Nhập xong: +${res.creatorsAdded} / ↻${res.creatorsUpdated} Creator, +${res.groupsAdded} / ↻${res.groupsUpdated} Nhóm`, 'success');
      creators = await window.api.creators.list();
      groups = await window.api.groups.list();
      renderCreators?.();
      renderGroups?.();
      renderPkGroupGroupSelect?.();
      refreshDataBackupHint();
    } else if (res?.reason === 'parse') toast('File không hợp lệ', 'error');
    else if (res?.reason === 'empty') toast('File không có dữ liệu Creator/Nhóm', 'error');
    else if (res?.reason && res.reason !== 'canceled') toast('Nhập dữ liệu thất bại', 'error');
  });
  refreshDataBackupHint();
}

function wireSettingsTab() {
  wireDataBackup();
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

// ============================================================
// LỊCH SỬ trận đấu — modal xem lại + xuất CSV (đối chiếu)
// ============================================================
let historyCurrentFilter = null; // null = tất cả | 'group' | 'duo'
function histPad(n) { return String(n).padStart(2, '0'); }
function histFmtDate(ms) { const d = new Date(Number(ms) || 0); return `${histPad(d.getDate())}/${histPad(d.getMonth() + 1)}/${d.getFullYear()}`; }
function histFmtTime(ms) { const d = new Date(Number(ms) || 0); return `${histPad(d.getHours())}:${histPad(d.getMinutes())}`; }

async function openHistory(filter) {
  historyCurrentFilter = filter || null;
  $('#histTitle').textContent = filter === 'group' ? '📜 Lịch sử PK Nhóm'
    : filter === 'duo' ? '📜 Lịch sử PK Đôi' : '📜 Lịch sử trận đấu';
  $('#historyModal').classList.add('is-open');
  await renderHistory();
}
function closeHistory() { $('#historyModal').classList.remove('is-open'); }

async function renderHistory() {
  const body = $('#histBody');
  if (!body) return;
  const list = await window.api.history.list(historyCurrentFilter ? { type: historyCurrentFilter } : undefined);
  $('#histCount').textContent = `${list.length} trận`;
  if (!list.length) {
    body.innerHTML = '<div class="hist-empty">Chưa có trận nào được lưu.<br/>Kết thúc một trận PK để tự động lưu vào đây.</div>';
    return;
  }
  body.innerHTML = list.map(m => {
    const typeClass = m.type === 'duo' ? 'duo' : 'group';
    const typeLabel = m.type === 'duo' ? 'PK Đôi' : 'PK Nhóm';
    const parts = (m.participants || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    const items = parts.map((p, i) => {
      const isWin = m.type === 'duo'
        ? (m.winnerSide && m.winnerSide !== 'draw' && p.name === m.winnerName)
        : (p.name === m.winnerName && (p.score || 0) > 0);
      return `<span class="hist-item${isWin ? ' win' : ''}"><b>${i + 1}.</b><i class="d" style="background:${escapeAttr(p.color || '#888')}"></i>${escapeHtml(p.name || '—')} <em>${formatNumber(p.score || 0)}</em></span>`;
    }).join('<span class="sep">|</span>');
    const sub = [m.groupName, m.pointsBy === 'count' ? 'Số quà' : 'Coin'].filter(Boolean).join(' · ');
    return `<div class="hist-card">
      <div class="hist-card-head">
        <span class="hist-badge ${typeClass}">${typeLabel}</span>
        <span class="hist-round">Vòng ${m.roundNo || 1}</span>
        <span class="hist-title">${escapeHtml(m.content || '')}</span>
        <span class="hist-meta">${histFmtDate(m.finishedAt)} ${histFmtTime(m.finishedAt)}</span>
        <button class="hist-del" data-id="${escapeAttr(m.id)}" title="Xóa trận này">✕</button>
      </div>
      ${sub ? `<div class="hist-sub">${escapeHtml(sub)}</div>` : ''}
      <div class="hist-line">${items}</div>
    </div>`;
  }).join('');
  body.querySelectorAll('.hist-del').forEach(btn => {
    btn.addEventListener('click', async () => { await window.api.history.remove(btn.dataset.id); renderHistory(); });
  });
}

function wireHistoryUI() {
  $('#pkgHistory')?.addEventListener('click', () => openHistory('group'));
  $('#pkHistory')?.addEventListener('click', () => openHistory('duo'));
  $('#histClose')?.addEventListener('click', closeHistory);
  $('#historyModal')?.addEventListener('click', (e) => { if (e.target === $('#historyModal')) closeHistory(); });
  $('#histExport')?.addEventListener('click', async () => {
    const res = await window.api.history.export(historyCurrentFilter ? { type: historyCurrentFilter } : undefined);
    if (res?.ok) toast(`Đã xuất ${res.count} trận ra file CSV`, 'success');
    else if (res?.reason === 'empty') toast('Chưa có trận nào để xuất', 'error');
    else if (res?.reason && res.reason !== 'canceled') toast('Xuất file thất bại', 'error');
  });
  $('#histClear')?.addEventListener('click', async () => {
    const label = historyCurrentFilter === 'group' ? 'PK Nhóm' : historyCurrentFilter === 'duo' ? 'PK Đôi' : 'tất cả';
    if (!confirm(`Xóa toàn bộ lịch sử ${label}? Không thể hoàn tác.`)) return;
    await window.api.history.clear(historyCurrentFilter ? { type: historyCurrentFilter } : undefined);
    renderHistory();
  });
  window.api.on('history:changed', () => { if ($('#historyModal')?.classList.contains('is-open')) renderHistory(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#historyModal')?.classList.contains('is-open')) closeHistory(); });
}

init().catch(e => { console.error(e); toast('Lỗi init: ' + e.message, 'error'); });
