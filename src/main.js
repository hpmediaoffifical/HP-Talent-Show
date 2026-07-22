// HP Talent Show — Electron main process.
// - TikTok LIVE bridge (qua TikTokClient)
// - OBS overlay server (localhost SSE)
// - Persistent store: creators, groups, settings, pkDuo cfg, ranking cfg, score cfg
// - Engines: PkDuoEngine, RankingEngine, ScoreEngine (đều ăn gift events từ TikTok)

const { app, BrowserWindow, ipcMain, shell, clipboard, nativeImage, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { TikTokClient } = require('./tiktok-client');
const { ObsOverlayServer } = require('./obs-overlay-server');

const ROOT = path.join(__dirname, '..');
const USER_DATA_DIR = app.getPath('userData');

// Chặn CRASH toàn cục: một lỗi lẻ (vd icon kéo-thả không load) không được làm sập app đang LIVE.
process.on('uncaughtException', (err) => {
  try { console.error('[uncaughtException]', err); } catch {}
  try { broadcast('log', { source: 'main', message: 'Đã chặn lỗi (không crash): ' + (err && err.message || err) }); } catch {}
});
process.on('unhandledRejection', (reason) => {
  try { console.error('[unhandledRejection]', reason); } catch {}
});
const CONFIG_DIR = app.isPackaged ? path.join(USER_DATA_DIR, 'config') : path.join(ROOT, 'config');
const SHIPPED_CONFIG_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'config')
  : path.join(ROOT, 'config');
const SETTINGS_PATH = path.join(CONFIG_DIR, 'settings.json');
const CREATORS_PATH = path.join(CONFIG_DIR, 'creators.json');
const GROUPS_PATH = path.join(CONFIG_DIR, 'groups.json');
const PK_DUO_PATH = path.join(CONFIG_DIR, 'pk-duo.json');
const PK_GROUP_PATH = path.join(CONFIG_DIR, 'pk-group.json');
const MUSIC_LIST_PATH = path.join(CONFIG_DIR, 'music-list.json');
const STICKER_PATH = path.join(CONFIG_DIR, 'sticker-dance.json');
const MVP_HONOR_PATH = path.join(CONFIG_DIR, 'mvp-honor.json');
const LUCKY_WHEEL_PATH = path.join(CONFIG_DIR, 'lucky-wheel.json');
const GROUP_PROFILES_PATH = path.join(CONFIG_DIR, 'group-profiles.json');
const MATCH_HISTORY_PATH = path.join(CONFIG_DIR, 'match-history.json');
const GIFT_MASTER_PATH = path.join(CONFIG_DIR, 'gift-master.json');
const SHIPPED_GIFT_MASTER_PATH = path.join(SHIPPED_CONFIG_DIR, 'gift-master.json');
const GIFT_MASTER_SHEET = 'https://docs.google.com/spreadsheets/d/1Fv9Jdno_pPMTx_-tnwSfRObm1r1wKds_gaMBnfCDm4M/gviz/tq?tqx=out:csv&sheet=DANH%20SACH%20QUA';
const GITHUB_RELEASES_API = 'https://api.github.com/repos/hpmediaoffifical/HP-Talent-Show/releases/latest';
const GITHUB_RELEASES_URL = 'https://github.com/hpmediaoffifical/HP-Talent-Show/releases/latest';
const BANNER_SHEET = 'https://docs.google.com/spreadsheets/d/1g0oNn60BJjp5s8SN_7_vrrUPidw8HtX0xKsS2OP0waM/gviz/tq?tqx=out:csv&sheet=Banner';
const TICKER_SHEET = 'https://docs.google.com/spreadsheets/d/1g0oNn60BJjp5s8SN_7_vrrUPidw8HtX0xKsS2OP0waM/gviz/tq?tqx=out:csv&sheet=CH%E1%BB%AE%20TH%C3%94NG%20B%C3%81O';
const COMPACT_UI_VERSION = 1;
const MAIN_WINDOW_DEFAULT_BOUNDS = { width: 1120, height: 780 };
const MAIN_WINDOW_MIN_BOUNDS = { width: 900, height: 620 };
const MAIN_WINDOW_MAX_BOUNDS = { width: 1280, height: 860 };

try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}

// Bootstrap: nếu packaged và user-config chưa có gift-master.json, copy từ shipped
if (app.isPackaged) {
  try {
    if (!fs.existsSync(GIFT_MASTER_PATH) && fs.existsSync(SHIPPED_GIFT_MASTER_PATH)) {
      fs.copyFileSync(SHIPPED_GIFT_MASTER_PATH, GIFT_MASTER_PATH);
    }
  } catch {}
}

if (process.platform === 'win32') app.setAppUserModelId('com.hp.talentshow');

const ICON_ICO = path.join(ROOT, 'logo', 'hp-logo.ico');
const ICON_PNG = path.join(ROOT, 'logo', 'hp-logo.png');
const APP_ICON = fs.existsSync(ICON_ICO) ? ICON_ICO : (fs.existsSync(ICON_PNG) ? ICON_PNG : null);

let win = null;
let ttClient = null;
let overlayServer = null;
let pkDuoEngine = null;
let pkGroupEngine = null;
let rankingEngine = null;
let scoreEngine = null;
let stickerEngine = null;
let mvpHonorEngine = null;
let luckyWheelEngine = null;
let settings = loadSettings();
const reviewWindows = new Map();

// =================================================================
// JSON store helpers
// =================================================================
function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function saveJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}
function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function loadSettings() {
  const def = {
    overlayToken: crypto.randomBytes(18).toString('hex'),
    overlayPort: 18282,
    signApiKey: '',
    sessionId: '',
    ttTargetIdc: 'useast2a',
    compactUiVersion: COMPACT_UI_VERSION,
    lastUsername: '',
    autoConnect: false,
    windowBounds: null,
    overlay: {
      width: 2160,
      height: 3840,
      bg: 'transparent', // 'transparent' | 'chroma'
      chroma: '#00FF00',
      showHost: false,
    },
    ranking: null,
    score: null,
    scoreLinkRanking: false,
    scoreLinkVoteLock: false,
    audio: {
      gameSoundEnabled: true,
      startSound: '',
      warningSound: '',
      goalSound: '',
      successSound: '',
      failSound: '',
      outputDeviceId: 'default',
      waitingSound: '',
      waitingVolume: 100,
      preEffectSound: '',
      preEffectVolume: 100,
      preEffectEnabled: false,
    },
    reviewWindows: {},
    // OBS WebSocket (obs-websocket v5) — chỉ dùng để RESET (refresh cache) các Browser Source
    // trỏ tới overlay localhost của app. autoReset = tự reset mỗi lần khởi động app.
    obs: {
      wsPort: 4455,
      wsPassword: '',
      autoReset: true,
    },
    license: {
      key: '',
      vip: '',
      expiresAt: '',
      status: '',
      activatedAt: 0,
      checkedAt: 0,
      deviceId: '',
    },
  };
  const raw = loadJson(SETTINGS_PATH, null);
  if (!raw) { saveJson(SETTINGS_PATH, def); return def; }
  return { ...def, ...raw };
}

function avatarCacheKey(value) {
  const s = String(value || '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  try {
    const u = new URL(s);
    return crypto.createHash('sha1').update(u.host + u.pathname).digest('hex');
  } catch {
    return '';
  }
}

// Lúc mở app: tải & lưu ĐĨA avatar của MỌI creator/nhóm đang có URL (thường còn hạn ~2 ngày).
// Sau đó OBS luôn phục vụ avatar từ đĩa → không phụ thuộc TikTok (hết hạn/chặn) → hết avatar trắng.
// Chạy tuần tự có nghỉ để không "dội" TikTok CDN. Bỏ qua ảnh đã có trên đĩa (primeAvatar tự kiểm).
let _primedAvatars = false;
async function primeStoredAvatars() {
  if (_primedAvatars || !overlayServer) return;
  _primedAvatars = true;
  const urls = [];
  try { for (const c of loadCreators()) if (c.avatar) urls.push(c.avatar); } catch {}
  try { for (const g of loadGroups()) if (g.avatar) urls.push(g.avatar); } catch {}
  const seen = new Set();
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    try { await overlayServer.primeAvatar(u); } catch {}
    await new Promise(r => setTimeout(r, 120)); // nghỉ nhẹ giữa các lần tải
  }
}

// PK Đôi/PK Nhóm lưu snapshot Creator để vẫn hoạt động khi không mở tab cấu hình.
// Khi hồ sơ lấy được avatar mới, đồng bộ snapshot và phát state ngay cho OBS.
function syncBattleAvatarReferences(creators) {
  const byId = new Map((creators || []).map(c => [c.id, c]));
  let duoChanged = false;
  for (const team of [pkDuoEngine?.config?.teamA, pkDuoEngine?.config?.teamB]) {
    const creator = team && byId.get(team.creatorId);
    if (creator?.avatar && (team.creatorAvatar !== creator.avatar || team.creatorAvatarKey !== creator.avatarCacheKey)) {
      team.creatorAvatar = creator.avatar;
      team.creatorAvatarKey = creator.avatarCacheKey || avatarCacheKey(creator.avatar);
      duoChanged = true;
    }
  }
  if (duoChanged) {
    savePkDuoConfig(pkDuoEngine.config);
    pkDuoEngine._emit();
  }

  const participants = pkGroupEngine?.config?.participants;
  let groupChanged = false;
  if (Array.isArray(participants)) {
    for (const participant of participants) {
      const creator = byId.get(participant.creatorId || participant.id);
      if (creator?.avatar && (participant.avatar !== creator.avatar || participant.avatarKey !== creator.avatarCacheKey)) {
        participant.avatar = creator.avatar;
        participant.avatarKey = creator.avatarCacheKey || avatarCacheKey(creator.avatar);
        groupChanged = true;
      }
    }
  }
  if (groupChanged) {
    savePkGroupConfig(pkGroupEngine.config);
    pkGroupEngine._emit();
  }
}
function saveSettings() { saveJson(SETTINGS_PATH, settings); }

function getDeviceId() {
  const raw = [os.hostname(), os.userInfo().username, USER_DATA_DIR].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase();
}

// Renderer only needs a recognizable reference, never the full license key or device ID.
function maskSensitiveValue(value) {
  const chars = Array.from(String(value || ''));
  if (!chars.length) return '';
  return `${chars.slice(0, 2).join('')}******${chars.slice(-2).join('')}`;
}

function publicLicenseState(state = {}) {
  const license = { ...(state.license || {}), deviceId: state.license?.deviceId || getDeviceId() };
  return {
    ...state,
    license: {
      ...license,
      key: maskSensitiveValue(license.key),
      deviceId: maskSensitiveValue(license.deviceId),
    },
  };
}

function parseLicenseDate(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59, 999);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}


// HP KEY (hpvn.media) - thay backend Google Sheet. Cau hinh: hpkey/config.js
// + hpkey/public-key.js. Giu nguyen shape { ok, license } => gate khong phai sua.
async function validateLicenseKey(key) {
  const cleanKey = String(key || '').trim();
  if (!cleanKey) return { ok: false, error: 'Vui lòng nhập KEY bản quyền.' };
  const r = await require('../hpkey/validate').validateLicenseKey(cleanKey, getDeviceId());
  if (!r.ok) {
    // Mat mang -> ném lỗi để checkStoredLicense xử lý offline grace (theo expiresAt đã lưu)
    if (r._offline) throw new Error(r.error);
    return r;
  }
  const license = { ...r.license, activatedAt: settings.license?.activatedAt || Date.now() };
  settings.license = license;
  saveSettings();
  return { ok: true, license };
}

async function checkStoredLicense() {
  const key = settings.license?.key || '';
  if (!key) return { ok: false, activated: false, error: 'Chưa kích hoạt KEY bản quyền.', license: { ...(settings.license || {}), deviceId: getDeviceId() } };
  try {
    return await validateLicenseKey(key);
  } catch (e) {
    const expires = parseLicenseDate(settings.license?.expiresAt);
    const offlineOk = expires && expires.getTime() >= Date.now();
    return {
      ok: !!offlineOk,
      offline: true,
      error: offlineOk ? 'Không kiểm tra được sheet, dùng trạng thái bản quyền đã lưu.' : (e.message || String(e)),
      license: { ...(settings.license || {}), deviceId: getDeviceId() },
    };
  }
}

function versionParts(v) {
  return String(v || '').replace(/^v/i, '').split(/[.-]/).map(x => parseInt(x, 10) || 0);
}

function compareVersions(a, b) {
  const av = versionParts(a), bv = versionParts(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const d = (av[i] || 0) - (bv[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function checkForUpdate() {
  const current = app.getVersion();
  const res = await fetch(GITHUB_RELEASES_API, { headers: { 'User-Agent': 'HP Talent Show' } });
  if (!res.ok) throw new Error('GitHub Releases HTTP ' + res.status);
  const release = await res.json();
  const latest = String(release.tag_name || release.name || '').replace(/^v/i, '') || current;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find(a => /HP-Talent-Show-Setup-.*\.exe$/i.test(a.name || '')) || assets.find(a => /\.exe$/i.test(a.name || '')) || null;
  return {
    ok: true,
    current,
    latest,
    hasUpdate: compareVersions(latest, current) > 0,
    name: release.name || release.tag_name || '',
    notes: release.body || '',
    pageUrl: release.html_url || GITHUB_RELEASES_URL,
    downloadUrl: asset?.browser_download_url || '',
    assetName: asset?.name || '',
  };
}

async function downloadAndInstallUpdate(downloadUrl, assetName = '') {
  if (!downloadUrl) {
    await shell.openExternal(GITHUB_RELEASES_URL);
    return { ok: false, opened: true, error: 'Không tìm thấy file installer, đã mở trang release.' };
  }
  const dir = path.join(USER_DATA_DIR, 'updates');
  fs.mkdirSync(dir, { recursive: true });
  const safeName = String(assetName || path.basename(new URL(downloadUrl).pathname) || 'HP-Talent-Show-Setup.exe').replace(/[\\/:*?"<>|]/g, '_');
  const file = path.join(dir, safeName);
  const res = await fetch(downloadUrl, { headers: { 'User-Agent': 'HP Talent Show' } });
  if (!res.ok) throw new Error('Không tải được bản cập nhật HTTP ' + res.status);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  await shell.openPath(file);
  setTimeout(() => app.quit(), 1200);
  return { ok: true, file };
}

function isUsableWindowBounds(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return false;
  const rect = { x: bounds.x, y: bounds.y, width: Math.max(80, bounds.width), height: Math.max(80, bounds.height) };
  return screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return rect.x < a.x + a.width && rect.x + rect.width > a.x && rect.y < a.y + a.height && rect.y + rect.height > a.y;
  });
}

function rememberWindowBounds() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  try {
    settings.windowBounds = win.getBounds();
    saveSettings();
  } catch {}
}

const REVIEW_META = {
  pkduo: { title: 'Review PK Đôi', getUrl: () => overlayServer?.getPkDuoUrl(), width: 900, height: 320 },
  pkduofx: { title: 'Review PK Đôi FX', getUrl: () => overlayServer?.getPkDuoFxUrl(), width: 338, height: 600 },
  pkgroup: { title: 'Review PK Nhóm', getUrl: () => overlayServer?.getPkGroupUrl(), width: 1280, height: 420 },
  score: { title: 'Review Tính điểm', getUrl: () => overlayServer?.getScoreUrl(), width: 900, height: 300 },
  ranking: { title: 'Review Thi đấu', getUrl: () => overlayServer?.getRankingUrl(), width: 420, height: 900 },
  rankinggrid: { title: 'Review Thi đấu ngang', getUrl: () => overlayServer?.getRankingUrl() + '&grid=1', width: 1280, height: 520 },
  stickerdance: { title: 'Review Đập Trứng', getUrl: () => overlayServer?.getStickerUrl(), width: 900, height: 380 },
  mvphonor: { title: 'Review MVP Honor', getUrl: () => overlayServer?.getMvpHonorUrl(), width: 540, height: 720 },
  luckywheel: { title: 'Review Vòng Quay', getUrl: () => overlayServer?.getLuckyWheelUrl(), width: 760, height: 760 },
};

function normalizeReviewBg(value) {
  const s = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(s) ? s : 'transparent';
}

function normalizeReviewAlpha(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function reviewCssBackground(type) {
  const saved = settings.reviewWindows?.[type] || {};
  const bg = normalizeReviewBg(saved.background);
  if (bg === 'transparent') return 'transparent';
  const alpha = normalizeReviewAlpha(saved.backgroundAlpha ?? 1);
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function reviewUrlFor(type) {
  const base = REVIEW_META[type]?.getUrl?.();
  if (!base) return '';
  const u = new URL(base);
  u.searchParams.set('review', '1');
  u.searchParams.set('reviewBg', reviewCssBackground(type));
  return u.toString();
}

function saveReviewBounds(type, rw) {
  if (!rw || rw.isDestroyed()) return;
  settings.reviewWindows = settings.reviewWindows || {};
  settings.reviewWindows[type] = {
    ...(settings.reviewWindows[type] || {}),
    bounds: rw.getBounds(),
    alwaysOnTop: rw.isAlwaysOnTop(),
  };
  saveSettings();
}

// Cửa sổ Review là frameless và trong suốt. Nếu giữ kích thước mặc định sau
// khi overlay được thu nhỏ, phần trong suốt còn lại vẫn chặn chuột của desktop.
function fitReviewWindowToContent(sender, width, height) {
  const rw = BrowserWindow.fromWebContents(sender);
  if (!rw || rw.isDestroyed() || ![...reviewWindows.values()].includes(rw)) return { ok: false };
  const rawWidth = Number(width), rawHeight = Number(height);
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight)) return { ok: false };
  const w = Math.max(80, Math.min(10000, Math.round(rawWidth)));
  const h = Math.max(80, Math.min(10000, Math.round(rawHeight)));
  const current = rw.getContentBounds();
  if (Math.abs(current.width - w) <= 1 && Math.abs(current.height - h) <= 1) return { ok: true };
  rw.setContentSize(w, h);
  return { ok: true };
}

function openReviewWindow(type) {
  const meta = REVIEW_META[type];
  if (!meta) return { ok: false, error: 'Overlay Review không hợp lệ.' };
  const existing = reviewWindows.get(type);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return { ok: true, open: true, alwaysOnTop: existing.isAlwaysOnTop() };
  }
  const saved = settings.reviewWindows?.[type] || {};
  const bounds = isUsableWindowBounds(saved.bounds) ? saved.bounds : {};
  const rw = new BrowserWindow({
    width: bounds.width || meta.width,
    height: bounds.height || meta.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 80,
    minHeight: 80,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    skipTaskbar: false,
    hasShadow: false,
    alwaysOnTop: saved.alwaysOnTop !== false,
    title: meta.title,
    backgroundColor: '#00000000',
    icon: APP_ICON || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  reviewWindows.set(type, rw);
  rw.setMenu(null);
  rw.setAlwaysOnTop(saved.alwaysOnTop !== false, saved.alwaysOnTop !== false ? 'screen-saver' : 'normal');
  rw.setIgnoreMouseEvents(!!saved.clickThrough, { forward: true });
  rw.loadURL(reviewUrlFor(type));
  let timer = null;
  const scheduleSave = () => {
    clearTimeout(timer);
    timer = setTimeout(() => saveReviewBounds(type, rw), 250);
  };
  rw.on('move', scheduleSave);
  rw.on('resize', scheduleSave);
  rw.on('close', () => saveReviewBounds(type, rw));
  rw.on('closed', () => reviewWindows.delete(type));
  return { ok: true, open: true, alwaysOnTop: rw.isAlwaysOnTop() };
}

function closeReviewWindow(type) {
  const rw = reviewWindows.get(type);
  if (rw && !rw.isDestroyed()) rw.close();
  return { ok: true, open: false };
}

function setReviewAlwaysOnTop(type, value) {
  const rw = reviewWindows.get(type);
  const on = !!value;
  settings.reviewWindows = settings.reviewWindows || {};
  settings.reviewWindows[type] = { ...(settings.reviewWindows[type] || {}), alwaysOnTop: on };
  if (rw && !rw.isDestroyed()) {
    rw.setAlwaysOnTop(on, on ? 'screen-saver' : 'normal');
    saveReviewBounds(type, rw);
  } else {
    saveSettings();
  }
  return { ok: true, alwaysOnTop: on, open: !!(rw && !rw.isDestroyed()) };
}

function setReviewClickThrough(type, value) {
  if (!REVIEW_META[type]) return { ok: false, error: 'Overlay Review không hợp lệ.' };
  const on = !!value;
  const rw = reviewWindows.get(type);
  settings.reviewWindows = settings.reviewWindows || {};
  settings.reviewWindows[type] = { ...(settings.reviewWindows[type] || {}), clickThrough: on };
  if (rw && !rw.isDestroyed()) rw.setIgnoreMouseEvents(on, { forward: true });
  saveSettings();
  return { ok: true, clickThrough: on, open: !!(rw && !rw.isDestroyed()) };
}

function setReviewBackground(type, value, alpha) {
  if (!REVIEW_META[type]) return { ok: false, error: 'Overlay Review không hợp lệ.' };
  const background = normalizeReviewBg(value);
  const backgroundAlpha = background === 'transparent' ? 0 : normalizeReviewAlpha(alpha ?? settings.reviewWindows?.[type]?.backgroundAlpha ?? 1);
  const rw = reviewWindows.get(type);
  settings.reviewWindows = settings.reviewWindows || {};
  settings.reviewWindows[type] = { ...(settings.reviewWindows[type] || {}), background, backgroundAlpha };
  saveSettings();
  if (rw && !rw.isDestroyed()) rw.loadURL(reviewUrlFor(type));
  return { ok: true, background, backgroundAlpha, open: !!(rw && !rw.isDestroyed()) };
}

function getReviewState() {
  const state = {};
  for (const type of Object.keys(REVIEW_META)) {
    const rw = reviewWindows.get(type);
    state[type] = {
      open: !!(rw && !rw.isDestroyed()),
      alwaysOnTop: rw && !rw.isDestroyed() ? rw.isAlwaysOnTop() : settings.reviewWindows?.[type]?.alwaysOnTop !== false,
      clickThrough: !!settings.reviewWindows?.[type]?.clickThrough,
      background: normalizeReviewBg(settings.reviewWindows?.[type]?.background),
      backgroundAlpha: normalizeReviewAlpha(settings.reviewWindows?.[type]?.backgroundAlpha ?? (settings.reviewWindows?.[type]?.background ? 1 : 0)),
      bounds: rw && !rw.isDestroyed() ? rw.getBounds() : settings.reviewWindows?.[type]?.bounds || null,
    };
  }
  return state;
}

// =================================================================
// Creators / Groups store
// =================================================================
function loadCreators() {
  const list = loadJson(CREATORS_PATH, []) || [];
  let changed = false;
  for (const c of list) {
    if (!c.id) {
      c.id = uid('c_');
      changed = true;
    }
  }
  if (changed) saveCreators(list);
  return list;
}
function saveCreators(list) { saveJson(CREATORS_PATH, list); }
function loadGroups() {
  const list = loadJson(GROUPS_PATH, []) || [];
  let changed = false;
  for (const g of list) {
    if (!g.id) {
      g.id = uid('g_');
      changed = true;
    }
  }
  if (changed) saveGroups(list);
  return list;
}
function saveGroups(list) { saveJson(GROUPS_PATH, list); }
// Hồ sơ nhóm: mỗi nhóm (theo group.id) lưu THÔNG SỐ RIÊNG — cấu hình PK Nhóm,
// quà mặc định, thống kê trận. Đổi nhóm là tự nạp lại thông số của nhóm đó.
function loadGroupProfiles() {
  const obj = loadJson(GROUP_PROFILES_PATH, {});
  return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
}
function saveGroupProfiles(map) {
  saveJson(GROUP_PROFILES_PATH, (map && typeof map === 'object' && !Array.isArray(map)) ? map : {});
}
function loadPkDuoConfig() { return loadJson(PK_DUO_PATH, null); }
function savePkDuoConfig(cfg) { saveJson(PK_DUO_PATH, cfg); }
function loadPkGroupConfig() { return loadJson(PK_GROUP_PATH, null); }
function savePkGroupConfig(cfg) { saveJson(PK_GROUP_PATH, cfg); }
function loadMusicList() { return loadJson(MUSIC_LIST_PATH, null); }
function saveMusicList(cfg) { saveJson(MUSIC_LIST_PATH, cfg); }
function loadStickerConfig() { return loadJson(STICKER_PATH, null); }
function saveStickerConfig(cfg) { saveJson(STICKER_PATH, cfg); }
function loadMvpHonorConfig() { return loadJson(MVP_HONOR_PATH, null); }
function saveMvpHonorConfig(cfg) { saveJson(MVP_HONOR_PATH, cfg); }
function loadLuckyWheelConfig() { return loadJson(LUCKY_WHEEL_PATH, null); }
function saveLuckyWheelConfig(cfg) { saveJson(LUCKY_WHEEL_PATH, cfg); }

// =================================================================
// Match history — lưu LỊCH SỬ mỗi trận PK (Nhóm/Đôi) để đối chiếu + xuất file
// =================================================================
const MATCH_HISTORY_MAX = 500;
function loadMatchHistory() {
  const list = loadJson(MATCH_HISTORY_PATH, []);
  return Array.isArray(list) ? list : [];
}
function saveMatchHistory(list) {
  saveJson(MATCH_HISTORY_PATH, (Array.isArray(list) ? list : []).slice(-MATCH_HISTORY_MAX));
}
// Nhận bản ghi thô từ engine → bổ sung tên nhóm, gắn id, lưu và báo cho renderer.
function appendMatchHistory(rec) {
  if (!rec) return;
  const entry = { id: uid('m_'), savedAt: Date.now(), ...rec };
  if (entry.type === 'group' && entry.groupId && !entry.groupName) {
    const g = (loadGroups() || []).find(x => x.id === entry.groupId);
    entry.groupName = g ? g.name : '';
  }
  const list = loadMatchHistory();
  list.push(entry);
  saveMatchHistory(list);
  // Cộng dồn thống kê vào hồ sơ nhóm (số trận + tổng điểm) cho PK Nhóm.
  if (entry.type === 'group' && entry.groupId) {
    try {
      const map = loadGroupProfiles();
      const gid = String(entry.groupId);
      const cur = (map[gid] && typeof map[gid] === 'object') ? map[gid] : {};
      const stats = (cur.stats && typeof cur.stats === 'object') ? cur.stats : {};
      const total = (entry.participants || []).reduce((s, p) => s + (Number(p.score) || 0), 0);
      cur.stats = {
        matches: (Number(stats.matches) || 0) + 1,
        totalScore: (Number(stats.totalScore) || 0) + total,
        lastPlayedAt: entry.finishedAt || Date.now(),
      };
      cur.updatedAt = Date.now();
      map[gid] = cur;
      saveGroupProfiles(map);
    } catch {}
  }
  broadcast('history:changed', entry);
}

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDate(ms) { const d = new Date(Number(ms) || 0); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; }
function fmtTime(ms) { const d = new Date(Number(ms) || 0); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }
function csvCell(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }

// Xuất lịch sử ra CSV (1 dòng / mỗi người chơi / mỗi trận) — mở được bằng Excel.
function buildHistoryCsv(list) {
  const now = Date.now();
  const lines = [];
  lines.push(csvCell('HP Talent Show — Lịch sử trận đấu'));
  lines.push([csvCell('Thời gian xuất'), csvCell(`${fmtDate(now)} ${fmtTime(now)}`)].join(','));
  lines.push([csvCell('Số trận'), csvCell(list.length)].join(','));
  lines.push('');
  const header = ['Ngày', 'Giờ kết thúc', 'Loại', 'Tiêu đề', 'Nhóm', 'Vòng', 'Thời lượng (giây)', 'Tính điểm', 'Tên', 'TikTok ID', 'Điểm', 'Hạng', 'MVP (chuỗi)', 'Kết quả'];
  lines.push(header.map(csvCell).join(','));
  const ordered = list.slice().sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  for (const m of ordered) {
    const typeLabel = m.type === 'duo' ? 'PK Đôi' : 'PK Nhóm';
    const pointsLabel = m.pointsBy === 'count' ? 'Số quà' : 'Coin';
    const parts = (m.participants || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    parts.forEach((p, i) => {
      const isWinner = m.type === 'duo'
        ? (m.winnerSide && m.winnerSide !== 'draw' && p.name === m.winnerName)
        : (p.name === m.winnerName && (p.score || 0) > 0);
      lines.push([
        fmtDate(m.finishedAt), fmtTime(m.finishedAt), typeLabel, m.content || '', m.groupName || '',
        m.roundNo || '', m.durationSec || '', pointsLabel, p.name || '', p.tiktokId || '',
        p.score || 0, i + 1, p.streak || '', isWinner ? 'Thắng' : (m.winnerSide === 'draw' ? 'Hòa' : ''),
      ].map(csvCell).join(','));
    });
  }
  return '﻿' + lines.join('\r\n'); // BOM để Excel đọc đúng tiếng Việt
}

// =================================================================
// Gift master store — danh sách quà TikTok (id, name, icon, webm, diamond)
// Bundled trong app, có thể refresh từ Google Sheet bằng IPC.
// =================================================================
let giftMaster = { fetchedAt: 0, gifts: [], byId: new Map(), byName: new Map() };
function loadGiftMaster() {
  let raw = loadJson(GIFT_MASTER_PATH, null);
  if ((!raw || !Array.isArray(raw.gifts)) && fs.existsSync(SHIPPED_GIFT_MASTER_PATH)) {
    raw = loadJson(SHIPPED_GIFT_MASTER_PATH, null);
  }
  if (!raw || !Array.isArray(raw.gifts)) {
    giftMaster = { fetchedAt: 0, gifts: [], byId: new Map(), byName: new Map() };
    return;
  }
  const byId = new Map();
  const byName = new Map();
  for (const g of raw.gifts) {
    if (g.id) byId.set(String(g.id), g);
    if (g.name) byName.set(String(g.name).toLowerCase(), g);
  }
  giftMaster = { fetchedAt: raw.fetchedAt || 0, gifts: raw.gifts, byId, byName };
}
function lookupGift(idOrName) {
  if (!idOrName) return null;
  const s = String(idOrName).trim();
  return giftMaster.byId.get(s) || giftMaster.byName.get(s.toLowerCase()) || null;
}

// Parse CSV string → array of {id, name, icon, webm, diamond}
function parseGiftCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { field += c; }
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') {}
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else { field += c; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = (r[0] || '').trim();
    const name = (r[1] || '').trim();
    if (!id || !name) continue;
    out.push({
      id, name,
      icon: (r[2] || '').trim(),
      webm: (r[3] || '').trim(),
      diamond: parseInt((r[4] || '0').trim(), 10) || 0,
    });
  }
  return out;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { field += c; }
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') {}
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else { field += c; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normalizeImageUrl(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  const driveFile = s.match(/drive\.google\.com\/file\/d\/([^/]+)/i)?.[1];
  if (driveFile) return `https://drive.google.com/uc?export=view&id=${driveFile}`;
  const driveOpen = s.match(/[?&]id=([^&]+)/i)?.[1];
  if (/drive\.google\.com/i.test(s) && driveOpen) return `https://drive.google.com/uc?export=view&id=${driveOpen}`;
  return s;
}

async function fetchBanners() {
  const res = await fetch(BANNER_SHEET);
  if (!res.ok) throw new Error('Banner Sheet HTTP ' + res.status);
  const rows = parseCsvRows(await res.text());
  return rows.slice(1).map((r, i) => ({
    id: `banner-${i}`,
    image: normalizeImageUrl(r[0]),
    link: String(r[1] || '').trim(),
    note: String(r[2] || '').trim(),
  })).filter(b => b.image);
}

function truthySheetFlag(value) {
  const s = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'x', '✓', '✔', 'checked', 'duyet', 'duyệt'].includes(s);
}

function parseSheetDate(value, endOfDay = false) {
  const s = String(value || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const year = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    const date = new Date(year, Number(m[2]) - 1, Number(m[1]));
    if (endOfDay) date.setHours(23, 59, 59, 999);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) date.setHours(23, 59, 59, 999);
  return date;
}

async function fetchTickers() {
  const res = await fetch(TICKER_SHEET);
  if (!res.ok) throw new Error('Ticker Sheet HTTP ' + res.status);
  const rows = parseCsvRows(await res.text());
  const now = new Date();
  return rows.slice(1).map((r, i) => {
    const text = String(r[0] || '').trim();
    const start = parseSheetDate(r[1]);
    const end = parseSheetDate(r[2], true);
    const quick = truthySheetFlag(r[3]);
    const inDateRange = start && end && now >= start && now <= end;
    return { id: `ticker-${i}`, text, active: quick || inDateRange };
  }).filter(t => t.text && t.active);
}

async function refreshGiftMaster() {
  const res = await fetch(GIFT_MASTER_SHEET);
  if (!res.ok) throw new Error('Sheet HTTP ' + res.status);
  const csv = await res.text();
  const gifts = parseGiftCsv(csv);
  if (gifts.length === 0) throw new Error('Sheet trả về rỗng — kiểm tra quyền chia sẻ public.');
  const data = { fetchedAt: Date.now(), source: GIFT_MASTER_SHEET, sheet: 'DANH SACH QUA', gifts };
  saveJson(GIFT_MASTER_PATH, data);
  loadGiftMaster();
  return { count: gifts.length, fetchedAt: data.fetchedAt };
}

// Creator shape:
// { id, tiktokId, nickname, avatar, groupId, defaultGiftIcon, defaultGiftId, defaultGiftName, createdAt }
// Group shape:
// { id, name, color, defaultGiftIcon, defaultGiftId, defaultGiftName, createdAt }

// =================================================================
// Engines
// =================================================================
class PkDuoEngine {
  constructor({ onState, onResult, getCreators }) {
    this.onState = onState;
    this.onResult = onResult;
    // Lấy danh sách creator hiện tại để resolve avatar realtime (không đông cứng snapshot).
    this.getCreators = typeof getCreators === 'function' ? getCreators : () => [];
    this.config = {
      teamA: { name: 'TEAM A', color: '#FE2C55', gifts: [] },
      teamB: { name: 'TEAM B', color: '#25F4EE', gifts: [] },
      durationSec: 90,
      prepSec: 3,
      delaySec: 5,
      joinMode: false, // false = fixed by gift, true = chosen by first gift sent
      pointsBy: 'diamond',
      content: 'PK ĐÔI',
      bgColor: '#000000',
      bgOpacity: 88,
      giftSize: 46,
      textSize: 21,
      overlayScale: 100,
      startSound: '',
      warningSound: '',
      teamASound: '',
      teamBSound: '',
      drawSound: '',
      giftDisplayMode: 'scroll',
      // Overlay FX toàn màn hình (1080x1920): các field này chỉ overlay FX dùng,
      // banner PK Đôi cũ bỏ qua. fxMode: 'both'|'push'|'affliction'; fxStyle: 'auto'|'freeze'|'fire'|'water'|'dim'.
      // fxThreshold = % chênh điểm bắt đầu bật hiệu ứng; fxMaxGap = % chênh để hiệu ứng đạt tối đa.
      fxEnabled: true,
      fxMode: 'both',
      fxStyle: 'auto',
      fxThreshold: 8,
      fxMaxGap: 30,
      fxIntensityCap: 100,
      championsEnabled: true, // Vinh danh TOP 3 người tặng quà trên overlay banner
    };
    this.state = {
      status: 'idle', // 'idle' | 'prestart' | 'running' | 'grace' | 'finished'
      remainingMs: 0,
      scoreA: 0, scoreB: 0,
      startedAt: 0,
      endsAt: 0,
      userTeams: {}, // userId -> 'A' | 'B' (cho joinMode)
      graceElapsedMs: 0,
      roundNo: 0,
      historySaved: false,
      gifters: { A: new Map(), B: new Map() }, // side -> Map(userKey -> {uniqueId,nickname,avatar,total}) để vinh danh TOP tặng quà
    };
    this._tick = null;
  }
  setConfig(patch) { this.config = { ...this.config, ...patch }; this._emit(); }
  // Avatar leader lấy realtime từ hồ sơ creator theo creatorId. Snapshot creatorAvatar trong
  // config có thể cũ (đổi nhóm / avatar về sau mới tải) → luôn ưu tiên avatar hiện tại của creator.
  _resolveTeamAvatar(team) {
    if (!team) return team;
    const byId = new Map((this.getCreators() || []).map(c => [c.id, c]));
    const creator = team.creatorId && byId.get(team.creatorId);
    const avatar = (creator && creator.avatar) || team.creatorAvatar || '';
    const creatorAvatarKey = (creator && creator.avatarCacheKey) || avatarCacheKey(avatar);
    return avatar === team.creatorAvatar && creatorAvatarKey === team.creatorAvatarKey
      ? team
      : { ...team, creatorAvatar: avatar, creatorAvatarKey };
  }
  getStateForOverlay() {
    return {
      status: this.state.status,
      remainingMs: this.state.remainingMs,
      startedAt: this.state.startedAt,
      scoreA: this.state.scoreA,
      scoreB: this.state.scoreB,
      teamA: this._resolveTeamAvatar(this.config.teamA),
      teamB: this._resolveTeamAvatar(this.config.teamB),
      durationSec: this.config.durationSec,
      prepSec: this.config.prepSec,
      delaySec: this.config.delaySec,
      joinMode: this.config.joinMode,
      pointsBy: this.config.pointsBy,
      bgColor: this.config.bgColor,
      bgOpacity: this.config.bgOpacity,
      giftSize: this.config.giftSize,
      textSize: this.config.textSize,
      overlayScale: this.config.overlayScale,
      content: this.config.content,
      push: this._pushPercent(),
      startSound: this.config.startSound,
      warningSound: this.config.warningSound,
      teamASound: this.config.teamASound,
      teamBSound: this.config.teamBSound,
      drawSound: this.config.drawSound,
      giftDisplayMode: this.config.giftDisplayMode,
      roundNo: this.state.roundNo,
      // Cấu hình overlay FX toàn màn hình (chỉ overlay FX đọc)
      fxEnabled: this.config.fxEnabled,
      fxMode: this.config.fxMode,
      fxStyle: this.config.fxStyle,
      fxThreshold: this.config.fxThreshold,
      fxMaxGap: this.config.fxMaxGap,
      fxIntensityCap: this.config.fxIntensityCap,
      // TOP 3 người tặng quà mỗi bên (vinh danh) — sort giảm dần theo điểm đóng góp.
      // Có thể Bật/tắt qua config.championsEnabled (mặc định bật).
      topA: this.config.championsEnabled !== false ? this._topGifters('A') : [],
      topB: this.config.championsEnabled !== false ? this._topGifters('B') : [],
    };
  }
  _resetGifters() { this.state.gifters = { A: new Map(), B: new Map() }; }
  // Cộng dồn điểm đóng góp của 1 người tặng vào đúng bên (key theo uniqueId, fallback nickname).
  _addGifter(side, ev, pts) {
    const key = ev.uniqueId || ev.nickname;
    const m = this.state.gifters?.[side];
    if (!key || !m) return;
    let g = m.get(key);
    if (!g) { g = { uniqueId: ev.uniqueId || '', nickname: ev.nickname || ev.uniqueId || '', avatar: ev.avatar || '', total: 0 }; m.set(key, g); }
    if (ev.avatar) {
      g.avatar = ev.avatar;       // avatar mới nhất
    }
    if (ev.nickname) g.nickname = ev.nickname;
    g.total += Number(pts) || 0;
  }
  // TOP 3 người tặng nhiều nhất của 1 bên.
  _topGifters(side) {
    const m = this.state.gifters?.[side];
    if (!m || !m.size) return [];
    return [...m.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 3)
      // Gift event v2 hay thiếu avatar → bù từ _avatarCache (nạp từ chat/join) để không hiện ô đen.
      .map(g => {
        const avatar = g.avatar || _avatarCache.get(String(g.uniqueId)) || '';
        return { uniqueId: g.uniqueId, nickname: g.nickname, avatar, total: Math.round(g.total) };
      });
  }
  // Push formula theo spec: ((A - B) / (A + B)) * 42 — clamp [-42, 42]
  _pushPercent() {
    const tot = this.state.scoreA + this.state.scoreB;
    if (tot <= 0) return 0;
    const raw = ((this.state.scoreA - this.state.scoreB) / tot) * 42;
    return Math.max(-42, Math.min(42, Math.round(raw * 10) / 10));
  }
  start() {
    if (this.state.status === 'running' || this.state.status === 'prestart') return;
    this.state.status = 'prestart';
    this.state.remainingMs = (this.config.prepSec || 0) * 1000;
    this.state.scoreA = 0; this.state.scoreB = 0;
    this.state.userTeams = {};
    this.state.graceElapsedMs = 0;
    this.state.startedAt = Date.now();
    this.state.roundNo = (Number(this.state.roundNo) || 0) + 1;
    this.state.historySaved = false;
    this._resetGifters();
    this._runTicker();
  }
  stop() {
    this.state.status = 'finished';
    this.state.remainingMs = 0;
    this.state.userTeams = {};
    this._recordHistory();
    this._clearTicker();
    this._emit();
  }
  reset() {
    this._clearTicker();
    this.state = { status: 'idle', remainingMs: 0, scoreA: 0, scoreB: 0, startedAt: 0, endsAt: 0, userTeams: {}, graceElapsedMs: 0, roundNo: 0, historySaved: false, gifters: { A: new Map(), B: new Map() } };
    this._emit();
  }
  // Ghi LỊCH SỬ trận PK Đôi (1 lần/trận, chỉ khi đã bắt đầu thật).
  _recordHistory() {
    if (this.state.historySaved || !this.state.startedAt) return;
    this.state.historySaved = true;
    const a = { name: this.config.teamA?.name || 'TEAM A', score: Number(this.state.scoreA) || 0, color: this.config.teamA?.color || '' };
    const b = { name: this.config.teamB?.name || 'TEAM B', score: Number(this.state.scoreB) || 0, color: this.config.teamB?.color || '' };
    const winnerSide = a.score === b.score ? 'draw' : (a.score > b.score ? 'A' : 'B');
    if (typeof this.onResult === 'function') {
      this.onResult({
        type: 'duo',
        content: this.config.content || 'PK ĐÔI',
        roundNo: this.state.roundNo || 0,
        startedAt: this.state.startedAt || 0,
        finishedAt: Date.now(),
        durationSec: this.config.durationSec || 0,
        pointsBy: this.config.pointsBy || 'diamond',
        winnerSide,
        winnerName: winnerSide === 'draw' ? '' : (winnerSide === 'A' ? a.name : b.name),
        participants: [a, b],
      });
    }
  }
  addPoints(side, points) {
    if (side === 'A') this.state.scoreA += Number(points) || 0;
    else if (side === 'B') this.state.scoreB += Number(points) || 0;
    this._emit();
  }
  // Route 1 gift event → cộng cho phe nào.
  // Tính điểm khi 'running' VÀ trong Delay 'grace' (để bắt quà trễ do mạng chậm).
  // Chỉ ngừng khi Delay hết hẳn (status 'finished').
  routeGift(ev) {
    if (this.state.status !== 'running' && this.state.status !== 'grace') return;
    const pts = this.config.pointsBy === 'diamond'
      ? Math.max(1, resolveDiamond(ev)) * Math.max(1, Number(ev.repeatCount) || 1)
      : Math.max(1, Number(ev.repeatCount) || 1);
    const inA = (this.config.teamA.gifts || []).some(g => giftMatches(g, ev));
    const inB = (this.config.teamB.gifts || []).some(g => giftMatches(g, ev));
    let side = inA && !inB ? 'A' : (inB && !inA ? 'B' : null);

    if (this.config.joinMode) {
      const user = ev.uniqueId || ev.userId;
      if (user) {
        if (side) {
          // Quà kích hoạt: (re)gán phe rồi vẫn tính điểm full cho phe đó
          this.state.userTeams[user] = side;
        } else {
          side = this.state.userTeams[user] || null;
        }
      }
    }
    if (!side) return;
    if (side === 'A') this.state.scoreA += pts;
    else this.state.scoreB += pts;
    this._addGifter(side, ev, pts);
    this._emit();
  }
  _runTicker() {
    this._clearTicker();
    this._tick = setInterval(() => {
      if (this.state.status === 'grace') {
        this.state.graceElapsedMs = Math.min((this.config.delaySec || 0) * 1000, (this.state.graceElapsedMs || 0) + 250);
        this.state.remainingMs = -this.state.graceElapsedMs;
      } else {
        this.state.remainingMs = Math.max(0, this.state.remainingMs - 250);
      }
      if (this.state.remainingMs <= 0) {
        if (this.state.status === 'prestart') {
          this.state.status = 'running';
          this.state.remainingMs = (this.config.durationSec || 300) * 1000;
          this.state.endsAt = Date.now() + this.state.remainingMs;
        } else if (this.state.status === 'running') {
          // Vào grace period nếu config.delaySec > 0 — VẪN tính điểm để bắt quà trễ,
          // giữ userTeams để quà join-mode trễ vẫn định tuyến đúng.
          if ((this.config.delaySec || 0) > 0) {
            this.state.status = 'grace';
            this.state.graceElapsedMs = 0;
            this.state.remainingMs = 0;
          } else {
            this.state.status = 'finished';
            this.state.userTeams = {};
            this._recordHistory();
            this._clearTicker();
          }
        } else if (this.state.status === 'grace' && Math.abs(this.state.remainingMs) >= (this.config.delaySec || 0) * 1000) {
          this.state.status = 'finished';
          this.state.userTeams = {};
          this._recordHistory();
          this._clearTicker();
        }
      }
      this._emit();
    }, 250);
    this._emit();
  }
  _clearTicker() { if (this._tick) { clearInterval(this._tick); this._tick = null; } }
  _emit() { try { this.onState(this.getStateForOverlay()); } catch {} }
}

class PkGroupEngine {
  constructor({ onState, onResult, getCreators }) {
    this.onState = onState;
    this.onResult = onResult;
    // Lấy danh sách creator hiện tại để resolve avatar realtime (không đông cứng snapshot).
    this.getCreators = typeof getCreators === 'function' ? getCreators : () => [];
    this.config = {
      content: 'PK NHÓM',
      groupId: '',
      layoutMode: 'joined', // joined | separated
      playMode: 'fixed', // fixed | join
      pointsBy: 'diamond',
      noteEnabled: false,
      noteText: 'Tặng quà chỉ định để chọn Creator (vẫn được tính điểm), sau đó lên gì cũng tính cho Creator đó. Tặng quà Creator khác để chuyển, hết trận sẽ tự hủy',
      noteBgColor: '#1f2430',
      noteTextColor: '#ffffff',
      noteSpeedSec: 16,
      noteEffect: 'soft',
      separatedGap: 180,
      autoTextContrast: false,
      durationSec: 90,
      prepSec: 3,
      delaySec: 5,
      textSize: 30,
      nameSize: 100,
      giftSize: 60,
      overlayScale: 100,
      participants: [],
    };
    this.state = {
      status: 'idle',
      remainingMs: 0,
      startedAt: 0,
      endsAt: 0,
      scores: {},
      userTeams: {},
      graceElapsedMs: 0,
      roundNo: 0,
      lastWinnerId: '',
      streaks: {},
      resultHandled: false,
      historySaved: false,
      boostId: '',
      boostAt: 0,
      boostDir: 'right',
    };
    this._tick = null;
  }
  setConfig(patch) {
    this.config = { ...this.config, ...(patch || {}) };
    this.config.participants = Array.isArray(this.config.participants) ? this.config.participants : [];
    if (!['prestart', 'running', 'grace'].includes(this.state.status)) {
      this.state.streaks = Object.fromEntries(this.config.participants.map(p => [p.id, Number(p.streak) || 0]));
    }
    this._emit();
  }
  getStateForOverlay() {
    // Avatar bám realtime theo creatorId — snapshot participant.avatar có thể cũ khi đổi nhóm
    // hoặc avatar mới tải về sau; luôn ưu tiên avatar hiện tại của creator để OBS hiển thị đúng.
    const byId = new Map((this.getCreators() || []).map(c => [c.id, c]));
    const participants = this.config.participants.map(p => {
      const creator = byId.get(p.creatorId || p.id);
      return {
        ...p,
        avatar: (creator && creator.avatar) || p.avatar || '',
        avatarKey: (creator && creator.avatarCacheKey) || avatarCacheKey((creator && creator.avatar) || p.avatar || ''),
        score: Number(this.state.scores[p.id]) || 0,
        streak: Number(this.state.streaks[p.id]) || 0,
      };
    });
    return {
      status: this.state.status,
      remainingMs: this.state.remainingMs,
      startedAt: this.state.startedAt,
      participants,
      boostId: this.state.boostId,
      boostAt: this.state.boostAt,
      boostDir: this.state.boostDir,
      content: this.config.content,
      groupId: this.config.groupId,
      layoutMode: this.config.layoutMode,
      playMode: this.config.playMode,
      pointsBy: this.config.pointsBy,
      noteEnabled: this.config.noteEnabled,
      noteText: this.config.noteText,
      noteBgColor: this.config.noteBgColor,
      noteTextColor: this.config.noteTextColor,
      noteSpeedSec: this.config.noteSpeedSec,
      noteEffect: this.config.noteEffect,
      separatedGap: this.config.separatedGap,
      autoTextContrast: this.config.autoTextContrast,
      durationSec: this.config.durationSec,
      prepSec: this.config.prepSec,
      delaySec: this.config.delaySec,
      textSize: this.config.textSize,
      nameSize: this.config.nameSize,
      giftSize: this.config.giftSize,
      overlayScale: this.config.overlayScale,
    };
  }
  start() {
    if (this.state.status === 'running' || this.state.status === 'prestart') return;
    const scores = {};
    for (const p of this.config.participants || []) scores[p.id] = 0;
    this.state.status = 'prestart';
    this.state.remainingMs = (this.config.prepSec || 0) * 1000;
    this.state.startedAt = Date.now();
    this.state.endsAt = 0;
    this.state.scores = scores;
    if ((Number(this.state.roundNo) || 0) <= 0) {
      this.state.streaks = Object.fromEntries((this.config.participants || []).map(p => [p.id, Number(p.streak) || 0]));
    }
    this.state.userTeams = {};
    this.state.graceElapsedMs = 0;
    this.state.roundNo = (Number(this.state.roundNo) || 0) + 1;
    this.state.resultHandled = false;
    this.state.historySaved = false;
    this._runTicker();
  }
  stop() {
    this._finalizeRound();
    this.state.status = 'finished';
    this.state.remainingMs = 0;
    this.state.userTeams = {};
    this._recordHistory();
    this._clearTicker();
    this._emit();
  }
  reset() {
    this._clearTicker();
    this.state = {
      status: 'idle',
      remainingMs: 0,
      startedAt: 0,
      endsAt: 0,
      scores: {},
      userTeams: {},
      graceElapsedMs: 0,
      roundNo: 0,
      lastWinnerId: '',
      streaks: {},
      resultHandled: false,
      historySaved: false,
      boostId: '',
      boostAt: 0,
      boostDir: 'right',
    };
    this._emit();
  }
  addPoints(id, points) {
    if (!id) return;
    const beforeScores = { ...(this.state.scores || {}) };
    const beforeRank = this._rankIndex(id, beforeScores);
    const beforeScore = Number(beforeScores[id]) || 0;
    this.state.scores[id] = (Number(this.state.scores[id]) || 0) + (Number(points) || 0);
    const afterScore = Number(this.state.scores[id]) || 0;
    const afterRank = this._rankIndex(id, this.state.scores);
    if ((Number(points) || 0) > 0 && afterRank >= 0 && beforeRank >= 0 && afterRank < beforeRank) {
      const participants = this.config.participants || [];
      const selfIndex = participants.findIndex(p => p.id === id);
      const passed = participants
        .map((p, order) => ({ id: p.id, order, score: Number(beforeScores[p.id]) || 0 }))
        .filter(p => p.id !== id && p.score > beforeScore && p.score <= afterScore)
        .sort((a, b) => b.score - a.score)[0];
      this.state.boostId = id;
      this.state.boostAt = Date.now();
      this.state.boostDir = passed && selfIndex >= 0 && passed.order < selfIndex ? 'left' : 'right';
    }
    this._emit();
  }
  _rankIndex(id, scores) {
    const ranked = (this.config.participants || []).map((p, order) => ({ id: p.id, score: Number(scores?.[p.id]) || 0, order }))
      .sort((a, b) => b.score - a.score || a.order - b.order);
    return ranked.findIndex(x => x.id === id);
  }
  testGift(id) {
    const participant = (this.config.participants || []).find(p => p.id === id || p.creatorId === id);
    if (!participant) return false;
    const gift = (participant.gifts || [])[0] || {};
    const points = this.config.pointsBy === 'diamond'
      ? Math.max(1, Number(gift.diamond) || 1)
      : 1;
    this.addPoints(participant.id, points);
    return { points, giftName: gift.giftName || gift.name || '' };
  }
  // Tính điểm khi 'running' VÀ trong Delay 'grace' (bắt quà trễ). Ngừng khi 'finished'.
  routeGift(ev) {
    if (this.state.status !== 'running' && this.state.status !== 'grace') return;
    const participants = this.config.participants || [];
    if (!participants.length) return;
    const pts = this.config.pointsBy === 'diamond'
      ? Math.max(1, resolveDiamond(ev)) * Math.max(1, Number(ev.repeatCount) || 1)
      : Math.max(1, Number(ev.repeatCount) || 1);
    let target = participants.find(p => (p.gifts || []).some(g => giftMatches(g, ev))) || null;
    if (this.config.playMode === 'join') {
      const user = ev.uniqueId || ev.userId;
      if (user) {
        if (target) {
          // Quà kích hoạt: (re)gán Creator rồi vẫn tính điểm full cho Creator đó
          this.state.userTeams[user] = target.id;
        } else {
          target = participants.find(p => p.id === this.state.userTeams[user]) || null;
        }
      }
    }
    if (!target) return;
    this.addPoints(target.id, pts);
  }
  _finalizeRound() {
    if (this.state.resultHandled) return;
    this.state.resultHandled = true;
    const entries = (this.config.participants || []).map(p => ({ id: p.id, score: Number(this.state.scores[p.id]) || 0 }));
    const max = Math.max(0, ...entries.map(x => x.score));
    const winners = entries.filter(x => x.score > 0 && x.score === max);
    if (winners.length !== 1) return;
    const winnerId = winners[0].id;
    const streaks = {};
    streaks[winnerId] = (Number(this.state.streaks[winnerId]) || 0) + 1;
    this.state.streaks = streaks;
    this.config.participants = (this.config.participants || []).map(p => ({ ...p, streak: Number(streaks[p.id]) || 0 }));
    this.state.lastWinnerId = winnerId;
  }
  // Ghi 1 bản ghi LỊCH SỬ khi trận kết thúc (chỉ 1 lần/trận, chỉ khi đã bắt đầu thật).
  _recordHistory() {
    if (this.state.historySaved || !this.state.startedAt) return;
    this.state.historySaved = true;
    const participants = (this.config.participants || []).map(p => ({
      name: p.name || p.tiktokId || 'Creator',
      tiktokId: p.tiktokId || '',
      score: Number(this.state.scores[p.id]) || 0,
      streak: Number(this.state.streaks?.[p.id]) || 0,
      color: p.color || '',
    })).sort((a, b) => b.score - a.score);
    const winner = participants[0] && participants[0].score > 0 ? participants[0] : null;
    if (typeof this.onResult === 'function') {
      this.onResult({
        type: 'group',
        content: this.config.content || 'PK NHÓM',
        groupId: this.config.groupId || '',
        roundNo: this.state.roundNo || 0,
        startedAt: this.state.startedAt || 0,
        finishedAt: Date.now(),
        durationSec: this.config.durationSec || 0,
        pointsBy: this.config.pointsBy || 'diamond',
        winnerName: winner ? winner.name : '',
        winnerTiktokId: winner ? winner.tiktokId : '',
        participants,
      });
    }
  }
  _runTicker() {
    this._clearTicker();
    this._tick = setInterval(() => {
      if (this.state.status === 'grace') {
        this.state.graceElapsedMs = Math.min((this.config.delaySec || 0) * 1000, (this.state.graceElapsedMs || 0) + 250);
        this.state.remainingMs = -this.state.graceElapsedMs;
      } else {
        this.state.remainingMs = Math.max(0, this.state.remainingMs - 250);
      }
      if (this.state.remainingMs <= 0) {
        if (this.state.status === 'prestart') {
          this.state.status = 'running';
          this.state.remainingMs = (this.config.durationSec || 300) * 1000;
          this.state.endsAt = Date.now() + this.state.remainingMs;
        } else if (this.state.status === 'running') {
          // Hết giờ: nếu có Delay thì vào grace, VẪN tính điểm để bắt quà trễ;
          // chỉ chốt MVP/kết quả (_finalizeRound) khi Delay hết hẳn.
          if ((this.config.delaySec || 0) > 0) {
            this.state.status = 'grace';
            this.state.graceElapsedMs = 0;
            this.state.remainingMs = 0;
          } else {
            this._finalizeRound();
            this.state.status = 'finished';
            this.state.userTeams = {};
            this._recordHistory();
            this._clearTicker();
          }
        } else if (this.state.status === 'grace' && Math.abs(this.state.remainingMs) >= (this.config.delaySec || 0) * 1000) {
          this._finalizeRound();
          this.state.status = 'finished';
          this.state.userTeams = {};
          this._recordHistory();
          this._clearTicker();
        }
      }
      this._emit();
    }, 250);
    this._emit();
  }
  _clearTicker() { if (this._tick) { clearInterval(this._tick); this._tick = null; } }
  _emit() { try { this.onState(this.getStateForOverlay()); } catch {} }
}

function colorFromId(id) {
  if (!id) return '#FE2C55';
  let hash = 0;
  for (let i = 0; i < String(id).length; i++) hash = (hash << 5) - hash + String(id).charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 72%, 52%)`;
}

function giftMatches(rule, ev) {
  if (!rule) return false;
  if (rule.giftId && String(rule.giftId) === String(ev.giftId)) return true;
  if (rule.giftName && rule.giftName.toLowerCase() === String(ev.giftName || '').toLowerCase()) return true;
  return false;
}

// Resolve diamond cho gift event: ưu tiên giá trị từ TikTok event, fallback master list
function resolveDiamond(ev) {
  if (Number(ev.diamondCount) > 0) return Number(ev.diamondCount);
  const g = lookupGift(ev.giftId) || lookupGift(ev.giftName);
  return g ? Number(g.diamond) || 0 : 0;
}

// ----------------- STICKER DANCE -----------------
// Bảng lưới rows×cols, mỗi ô gán 1 quà + nhãn chữ + số đếm. Engine giữ CẤU HÌNH lưới và
// SỐ LIỆU RUNTIME theo giftId, phát state qua SSE để overlay OBS tự vẽ (giống PkGroupEngine).
// - received: tổng quà đã nhận (cho mọi ô, kể cả quà không có clip nhạc).
// - performed: số clip/hiệu ứng của quà đó đã phát XONG (renderer báo về qua signal) — dùng cho đếm lùi.
// - performingId (ngoài rt): giftId DUY NHẤT đang biểu diễn (để phóng to icon). Chỉ 1 quà diễn một lúc
//   nên lưu thẳng id thay vì bộ đếm +/- — tránh icon "kẹt to" khi lệch tín hiệu start/end.
class StickerEngine {
  constructor({ onState }) {
    this.onState = onState;
    this.config = {
      content: 'STICKER DANCE',
      rows: 3,
      cols: 6,
      countMode: 'cumulative', // 'cumulative' (đếm tăng) | 'countdown' (đếm lùi = đang chờ biểu diễn)
      labelPos: 'bottom',      // 'top' | 'bottom'
      cells: [],               // [{ row, col, giftId, giftName, icon, diamond, text }]
      bg: '#2b2f3a',
      bgOpacity: 55,
      iconSize: 66,
      textSize: 14,
      overlayScale: 100,
      gap: 14,
      colGap: 14,              // khoảng cách NGANG (giữa cột)
      rowGap: 14,              // khoảng cách DỌC (giữa hàng)
      animIcon: true,
      enlargeTop: true,        // phóng to quà nhiều điểm nhất
      perfBg: 'gold',          // hiệu ứng NỀN ô đang biểu diễn: none|gold|pink|blue|dark
      perfBorder: 'glow',      // hiệu ứng VIỀN ô đang biểu diễn: none|glow|neon|rainbow|ring
      perfSparkle: false,      // hạt lấp lánh quanh ô đang biểu diễn
      perfRipple: false,       // vòng sáng lan toả
      perfShine: false,        // tia sáng quét ngang panel
      perfNotes: false,        // nốt nhạc bay lên
      showMedals: true,        // huy chương 🥇🥈🥉 cho 3 ô nhiều điểm nhất
      showPerfBanner: true,    // dải ruy-băng "ĐANG DIỄN" trên ô đang biểu diễn
      showCrown: true,         // vương miện 👑 trên ô nhiều điểm nhất
      showLevelUp: true,       // hiệu ứng "LEVEL UP" khi ô đạt mục tiêu
      eggWhenZero: true,       // count=0 → hiện QUẢ TRỨNG thay số 0; có quà → trứng nở ra ("đập trứng")
      eggSize: 85,             // cỡ quả trứng (% so với icon), 40–140
      eggSkin: 'ivory',        // skin vỏ trứng: ivory|gold|pink|blue|dino (khủng long đốm)
      eggSkinRandom: false,    // true → mỗi ô bốc skin ngẫu nhiên, đổi lại mỗi lần trứng tái tạo
      streakEnabled: false,    // GIỮ CHUỖI: quà còn "máu chuỗi" được ưu tiên lên diễn
      streakSeconds: 10,       // thời lượng thanh máu chuỗi (giây)
      streakSteal: true,       // CƯỚP CHUỖI: cắt ngang quà đang phát khi quà khác còn máu vượt số lượng
      streakBarColor: 'tiktok',// màu thanh máu chuỗi: tiktok (hồng đỏ) | blue (xanh) | health (xanh→đỏ theo mức)
    };
    this.rt = {}; // giftId -> { received, performed, points }
    // Chỉ MỘT quà biểu diễn tại một thời điểm (là 'current' của hàng đợi nhạc bên renderer).
    // Lưu thẳng giftId đang diễn thay vì đếm +/- (bộ đếm dễ lệch → icon kẹt to khi thiếu/thừa 1 tín hiệu).
    this.performingId = '';
    this.queuedByGift = {}; // giftId -> số lượt đang chờ/đang phát trong HÀNG ĐỢI HIỆU ỨNG (nguồn cho đếm lùi)
    this.streaks = {}; // giftId -> mốc hết chuỗi (ms, Date.now); renderer đẩy sang để overlay vẽ thanh máu
  }
  setConfig(patch) {
    this.config = { ...this.config, ...(patch || {}) };
    this.config.cells = Array.isArray(this.config.cells) ? this.config.cells : [];
    this._emit();
  }
  reset() { this.rt = {}; this.performingId = ''; this._emit(); }
  // Renderer đẩy toàn bộ số lượt còn trong hàng đợi (theo giftId) mỗi khi hàng đợi đổi.
  // Đây là NGUỒN SỰ THẬT cho chế độ "Đếm lùi" → khớp tuyệt đối với "Đang chờ" và tự trừ dần khi phát.
  setQueued(pending) {
    const next = {};
    if (pending && typeof pending === 'object') {
      for (const k of Object.keys(pending)) next[String(k)] = Math.max(0, Number(pending[k]) || 0);
    }
    this.queuedByGift = next;
    this._emit();
  }
  // Renderer đẩy mốc hết chuỗi (ms) theo giftId mỗi khi có quà làm đầy máu → overlay vẽ thanh máu cạn dần.
  setStreaks(streaks) {
    const next = {};
    if (streaks && typeof streaks === 'object') {
      for (const k of Object.keys(streaks)) next[String(k)] = Math.max(0, Number(streaks[k]) || 0);
    }
    this.streaks = next;
    this._emit();
  }
  _rtFor(giftId) {
    const k = String(giftId || '');
    if (!this.rt[k]) this.rt[k] = { received: 0, performed: 0, points: 0 };
    return this.rt[k];
  }
  routeGift(ev) {
    const rep = Math.max(1, Number(ev.repeatCount) || 1);
    const dia = Math.max(0, resolveDiamond(ev));
    let matched = false;
    for (const c of (this.config.cells || [])) {
      if (giftMatches(c, ev)) {
        const rt = this._rtFor(c.giftId);
        rt.received += rep;
        rt.points += dia * rep;
        matched = true;
      }
    }
    if (matched) this._emit();
  }
  // Renderer báo trạng thái phát clip (chỉ với quà có clip trong DANH SÁCH NHẠC):
  //  perform-start → đang biểu diễn; perform-end → phát xong (đếm lùi thì performed++).
  signal({ type, giftId, pending, streaks } = {}) {
    if (type === 'queue') { this.setQueued(pending); return; }
    if (type === 'streak') { this.setStreaks(streaks); return; }
    if (!giftId) return;
    const rt = this._rtFor(giftId);
    const gid = String(giftId || '');
    if (type === 'perform-start') {
      // Quà mới lên diễn = nguồn sự thật; ghi đè thẳng nên không thể "kẹt to" vì thừa tín hiệu.
      this.performingId = gid;
    } else if (type === 'perform-end') {
      // Chỉ tắt khi đúng quà đang diễn (đề phòng tín hiệu kết thúc trễ của quà cũ xoá nhầm quà mới).
      if (this.performingId === gid) this.performingId = '';
      if (this.config.countMode === 'countdown') rt.performed += 1;
    } else return;
    this._emit();
  }
  getStateForOverlay() {
    const rows = Math.max(1, Math.min(20, Number(this.config.rows) || 1));
    const cols = Math.max(1, Math.min(20, Number(this.config.cols) || 1));
    const mode = this.config.countMode === 'countdown' ? 'countdown' : 'cumulative';
    const cells = (this.config.cells || []).map(c => {
      const rt = this._rtFor(c.giftId);
      // Đếm lùi = số lượt của quà này còn trong HÀNG ĐỢI HIỆU ỨNG (đang chờ + đang phát); Đếm tăng = tổng đã nhận.
      const count = mode === 'countdown' ? (this.queuedByGift[String(c.giftId || '')] || 0) : rt.received;
      return {
        row: Number(c.row) || 0,
        col: Number(c.col) || 0,
        giftId: c.giftId || '',
        giftName: c.giftName || '',
        icon: c.icon || '',
        diamond: Number(c.diamond) || 0,
        text: c.text || '',
        target: Math.max(0, Number(c.target) || 0),
        special: !!c.special,
        count,
        points: rt.points,
        performing: !!this.performingId && this.performingId === String(c.giftId || ''),
        streakUntil: Number(this.streaks[String(c.giftId || '')]) || 0,
        rank: 0,
      };
    });
    // Xếp hạng (top để phóng to + vương miện, huy chương Top 3): ưu tiên theo ĐIỂM (kim cương quà thật).
    // Khi CHƯA ai có điểm (vd đang thử bằng nút phát nhạc, chưa nhận quà thật) → xếp theo SỐ ĐẾM đang hiện
    // để các hiệu ứng vẫn xuất hiện thay vì "im lặng".
    const anyPoints = cells.some(c => (c.points || 0) > 0);
    const rankVal = c => (anyPoints ? (c.points || 0) : (c.count || 0));
    let topGiftId = '', topVal = 0;
    for (const c of cells) { const v = rankVal(c); if (v > topVal) { topVal = v; topGiftId = String(c.giftId || ''); } }
    // Huy chương: xếp hạng 3 ô đứng đầu (giá trị > 0). Sort trên bản sao mảng nhưng vẫn tham chiếu
    // CÙNG object nên gán rank phản ánh thẳng vào cells.
    if (this.config.showMedals !== false) {
      [...cells].filter(c => rankVal(c) > 0).sort((a, b) => rankVal(b) - rankVal(a))
        .slice(0, 3).forEach((c, i) => { c.rank = i + 1; });
    }
    return {
      content: this.config.content || 'STICKER DANCE',
      rows, cols,
      countMode: mode,
      labelPos: this.config.labelPos === 'top' ? 'top' : 'bottom',
      cells,
      topGiftId: (this.config.enlargeTop !== false && topVal > 0) ? topGiftId : '',
      crownGiftId: (this.config.showCrown !== false && topVal > 0) ? topGiftId : '',
      bg: this.config.bg || '#2b2f3a',
      bgOpacity: Number.isFinite(Number(this.config.bgOpacity)) ? Number(this.config.bgOpacity) : 55,
      iconSize: Number(this.config.iconSize) || 66,
      textSize: Number(this.config.textSize) || 14,
      overlayScale: Number(this.config.overlayScale) || 100,
      gap: Number.isFinite(Number(this.config.gap)) ? Number(this.config.gap) : 14,
      colGap: Number.isFinite(Number(this.config.colGap)) ? Number(this.config.colGap) : (Number.isFinite(Number(this.config.gap)) ? Number(this.config.gap) : 14),
      rowGap: Number.isFinite(Number(this.config.rowGap)) ? Number(this.config.rowGap) : (Number.isFinite(Number(this.config.gap)) ? Number(this.config.gap) : 14),
      animIcon: this.config.animIcon !== false,
      perfBg: ['none', 'gold', 'pink', 'blue', 'dark'].includes(this.config.perfBg) ? this.config.perfBg : 'gold',
      perfBorder: ['none', 'glow', 'neon', 'rainbow', 'ring'].includes(this.config.perfBorder) ? this.config.perfBorder : 'glow',
      perfSparkle: !!this.config.perfSparkle,
      perfRipple: !!this.config.perfRipple,
      perfShine: !!this.config.perfShine,
      perfNotes: !!this.config.perfNotes,
      showMedals: this.config.showMedals !== false,
      showPerfBanner: this.config.showPerfBanner !== false,
      showLevelUp: this.config.showLevelUp !== false,
      eggWhenZero: this.config.eggWhenZero !== false,
      eggSize: Math.max(40, Math.min(140, Number(this.config.eggSize) || 85)),
      eggSkin: ['ivory', 'gold', 'pink', 'blue', 'dino'].includes(this.config.eggSkin) ? this.config.eggSkin : 'ivory',
      eggSkinRandom: !!this.config.eggSkinRandom,
      streakOn: !!this.config.streakEnabled,
      streakDur: Math.max(1, Math.min(120, Number(this.config.streakSeconds) || 10)) * 1000,
      streakBarColor: ['tiktok', 'blue', 'health'].includes(this.config.streakBarColor) ? this.config.streakBarColor : 'tiktok',
    };
  }
  _emit() { try { this.onState(this.getStateForOverlay()); } catch {} }
}

// ----------------- MVP Honor (thẻ vinh danh avatar: Creator idol TOP / User cống hiến) -----------------
// Config-only engine (như StickerEngine): renderer là "nguồn sự thật", engine chỉ chuẩn hoá + phát cho overlay.
// Thẻ mode='creator' → avatar/tên lấy REALTIME từ Hồ sơ Creator theo creatorId (đổi ảnh Creator là thẻ đổi theo).
// Thẻ mode='user' → avatar là ảnh tải lên (data URL) hoặc URL người xem, tên & chữ do người dùng gõ.
const _mvpNum = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const _mvpClamp = (v, min, max, d) => Math.max(min, Math.min(max, _mvpNum(v, d)));
const _mvpHex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : d);
class MvpHonorEngine {
  constructor({ onState, getCreators, primeAvatar }) {
    this.onState = onState;
    this.getCreators = typeof getCreators === 'function' ? getCreators : () => [];
    this.primeAvatar = typeof primeAvatar === 'function' ? primeAvatar : () => {};
    this.config = { cards: [] };
  }
  setConfig(patch) {
    this.config = { ...this.config, ...(patch || {}) };
    this.config.cards = Array.isArray(this.config.cards) ? this.config.cards : [];
    this._emit();
  }
  reset() { this.config.cards = []; this._emit(); }
  _resolveCard(c, byId) {
    let avatar = c.avatar || '';
    let name = c.name || '';
    const mode = c.mode === 'user' ? 'user' : 'creator';
    if (mode === 'creator' && c.creatorId) {
      const cr = byId.get(String(c.creatorId));
      if (cr) {
        avatar = cr.avatar || avatar;            // avatar Creator mới nhất
        if (!name) name = cr.nickname || cr.tiktokId || '';
      }
    }
    if (avatar && /^https?:\/\//i.test(avatar)) { try { this.primeAvatar(avatar); } catch {} }
    return {
      id: c.id,
      mode,
      avatar,
      name,
      text: typeof c.text === 'string' ? c.text : '',
      frame: c.frame || '',
      layout: c.layout === 'vertical' ? 'vertical' : 'horizontal',
      avatarSize: _mvpClamp(c.avatarSize, 60, 400, 150),
      frameScale: _mvpClamp(c.frameScale, 80, 300, 150),
      fontSize: _mvpClamp(c.fontSize, 12, 140, 40),
      color: _mvpHex(c.color, '#ffffff'),
      textStyle: ['solid', 'gradient', 'neon', 'plaque'].includes(c.textStyle) ? c.textStyle : 'solid',
      bgColor: _mvpHex(c.bgColor, '#e84c88'),
      bgColor2: _mvpHex(c.bgColor2, '#7a3cff'),
      bgOpacity: _mvpClamp(c.bgOpacity, 0, 100, 100),
      entryAnim: ['none', 'popBounce', 'zoomFade', 'slideRight', 'slideUp'].includes(c.entryAnim) ? c.entryAnim : 'popBounce',
      showName: !!c.showName,
      overlay: {
        x: _mvpNum(c.overlay?.x, 120),
        y: _mvpNum(c.overlay?.y, 200),
        scale: _mvpClamp(c.overlay?.scale, 0.2, 4, 1),
        rot: _mvpClamp(c.overlay?.rot, -180, 180, 0),
      },
    };
  }
  getStateForOverlay() {
    const creators = this.getCreators() || [];
    const byId = new Map(creators.map(c => [String(c.id), c]));
    const cards = (this.config.cards || [])
      .filter(c => c && c.show !== false)
      .map(c => this._resolveCard(c, byId));
    const canvas = ['1:1', '3:4', '9:16'].includes(this.config.canvas) ? this.config.canvas : '3:4';
    return { cards, canvas };
  }
  _emit() { try { this.onState(this.getStateForOverlay()); } catch {} }
}

// ----------------- Vòng quay may mắn (Lucky Wheel) -----------------
// Ô = thông tin do người dùng ghi (phần thưởng / hình phạt / ghi chú). Quay ĐỀU nhau (random đồng xác suất),
// máy chủ chọn ô trúng rồi phát lệnh quay {spinId, index, duration} qua SSE → overlay OBS quay tới đúng ô đó.
// Kết quả lưu vào history (kèm tên người quay) để dựng lịch sử + bảng thống kê.
const _LW_PALETTE = ['#ff3d71', '#00e0c7', '#7a5cff', '#ff9f1c', '#2ec4ff', '#ff5db1', '#38d67a', '#ffd23f', '#c86bff', '#4c8dff'];
function _lwHex(v, def) { return /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? v : def; }
function _lwNum(v, def, min, max) { let n = Number(v); if (!isFinite(n)) n = def; return Math.max(min, Math.min(max, n)); }
class LuckyWheelEngine {
  constructor({ onState }) {
    this.onState = onState;
    this.config = {
      title: 'VÒNG QUAY MAY MẮN',
      style: 'neon',            // neon | gold | pastel | dark
      spinSeconds: 5,
      sound: true,
      confetti: true,
      showResult: true,
      segments: [],             // [{ id, text, note, type: reward|penalty|info, color }]
      history: [],              // [{ id, time, member, segId, text, note, type }]
    };
    this.spin = null;           // { spinId, index, duration, startAt, spinner:{name,avatar} }
    this._seq = 0;
  }
  setConfig(patch) {
    const p = patch || {};
    this.config = { ...this.config, ...p };
    if (!Array.isArray(this.config.segments)) this.config.segments = [];
    if (!Array.isArray(this.config.history)) this.config.history = [];
    this._emit();
  }
  reset() { this.spin = null; this._emit(); }
  clearHistory() { this.config.history = []; this._emit(); }
  doSpin({ spinner } = {}) {
    const segs = this.config.segments || [];
    if (!segs.length) return null;
    const index = Math.floor(Math.random() * segs.length);
    const seg = segs[index] || {};
    const duration = _lwNum(this.config.spinSeconds, 5, 2, 15);
    this._seq += 1;
    const spinId = 'sp_' + Date.now().toString(36) + '_' + this._seq;
    const sp = (spinner && spinner.name) ? { name: String(spinner.name), avatar: String(spinner.avatar || '') } : null;
    this.spin = { spinId, index, duration, startAt: Date.now(), spinner: sp };
    const rec = {
      id: spinId,
      time: new Date().toISOString(),
      member: sp ? sp.name : '',
      segId: seg.id || '', text: seg.text || '', note: seg.note || '', type: seg.type || 'info',
    };
    this.config.history.unshift(rec);
    if (this.config.history.length > 300) this.config.history.length = 300;
    this._emit();
    return { spinId, index, record: rec };
  }
  getStateForOverlay() {
    const c = this.config;
    return {
      title: c.title || '',
      style: ['neon', 'gold', 'pastel', 'dark'].includes(c.style) ? c.style : 'neon',
      spinSeconds: _lwNum(c.spinSeconds, 5, 2, 15),
      sound: c.sound !== false,
      confetti: c.confetti !== false,
      showResult: c.showResult !== false,
      segments: (c.segments || []).map((s, i) => ({
        id: s.id, text: String(s.text || ''), note: String(s.note || ''),
        type: ['reward', 'penalty', 'info'].includes(s.type) ? s.type : 'info',
        color: _lwHex(s.color, _LW_PALETTE[i % _LW_PALETTE.length]),
      })),
      spin: this.spin,
    };
  }
  _emit() { try { this.onState(this.getStateForOverlay()); } catch {} }
}

// ----------------- Ranking (BXH theo creator hoặc nhóm) -----------------
// Schema theo spec BIGO port: rows[] với {id, rank, name, avatar, initials, points,
// round, giftIconId, giftIcon, giftName, hideScore, lost, active, activePoints}
class RankingEngine {
  constructor({ onState, getCreators, getGroups }) {
    this.onState = onState;
    this.getCreators = getCreators;
    this.getGroups = getGroups;
    this.config = {
      mode: 'creator', // 'creator' | 'group'
      title: 'TOP IDOL',
      maxRows: 10,
      rankFrom: 1,
      rankTo: 0,
      pointsBy: 'diamond',
      nameMode: 'two-line', // 'two-line' | 'marquee'
      streakColor: '#67e8f9',
      overlayBgColor: '#2a2d37',
      overlayBgOpacity: 74,
      hideAllScores: false,
      showRank: true,
      showAvatar: true,
      showGift: true,
      showRound: true,
      gridRows: 3,
      gridCols: 3,
      gridFlow: 'row',
      avatarScale: 130,
      giftScale: 145,
      overlayScale: 100,
    };
    // Snapshot scores tích lũy theo round
    this.round = 0;
    this.scores = {}; // key (creatorId hoặc groupId) -> { points, lastGiftId, lastGiftIcon, lastGiftName }
    this.activeId = null;
  }
  setConfig(patch) { this.config = { ...this.config, ...patch }; this._emit(); }
  reset() { this.scores = {}; this.activeId = null; this._emit(); }
  startRound() { this.round++; this.scores = {}; this._emit(); }
  setActive(id) { this.activeId = id; this._emit(); }

  routeGift(ev) {
    const pts = this.config.pointsBy === 'diamond'
      ? Math.max(1, resolveDiamond(ev)) * Math.max(1, Number(ev.repeatCount) || 1)
      : Math.max(1, Number(ev.repeatCount) || 1);
    const creators = this.getCreators();
    const voted = this.config.mode === 'creator' ? creators.find(c => !!c.voteActive) : null;
    // Khi có Creator đang VOTE, mọi điểm trong phiên vote chỉ cộng cho Creator đó.
    const matched = voted ? [voted] : creators.filter(c =>
      (c.defaultGiftId && String(c.defaultGiftId) === String(ev.giftId)) ||
      (c.defaultGiftName && c.defaultGiftName.toLowerCase() === String(ev.giftName || '').toLowerCase())
    );
    if (matched.length === 0) return;
    for (const c of matched) {
      const key = this.config.mode === 'group' ? (c.groupId || '_nogroup') : c.id;
      if (!this.scores[key]) this.scores[key] = { points: 0, lastGiftId: '', lastGiftIcon: '', lastGiftName: '' };
      this.scores[key].points += pts;
      this.scores[key].lastGiftId = String(ev.giftId || '');
      this.scores[key].lastGiftIcon = ev.giftIcon || '';
      this.scores[key].lastGiftName = ev.giftName || '';
      this.activeId = key; // user vừa tặng quà → highlight
    }
    this._emit();
  }

  _buildInitials(name) {
    return String(name || '').trim().split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase().slice(0, 2);
  }

  getStateForOverlay() {
    const creators = this.getCreators();
    const groups = this.getGroups();
    const activeGroupId = this.config.activeGroupId || '';
    let rows = [];
    if (this.config.mode === 'creator') {
      rows = creators.filter(c => !c.hideObs && (!activeGroupId || c.groupId === activeGroupId)).map(c => {
        const sc = this.scores[c.id] || {};
        const g = groups.find(x => x.id === c.groupId);
        return {
          id: c.id,
          name: c.nickname || c.tiktokId,
          avatar: c.avatar || '',
          avatarKey: c.avatarCacheKey || avatarCacheKey(c.avatar),
          avatarVersion: Number(c.avatarFetchedAt) || 0,
          initials: this._buildInitials(c.nickname || c.tiktokId),
          // Keep manually entered points visible while the LIVE round is receiving gifts.
          points: (Number(c.contestPoints) || 0) + (Number(sc.points) || 0),
          round: Number.isFinite(Number(c.voteRound)) ? Number(c.voteRound) : this.round,
          giftIconId: sc.lastGiftId || c.defaultGiftId || '',
          giftIcon: sc.lastGiftIcon || c.defaultGiftIcon || '',
          giftName: sc.lastGiftName || c.defaultGiftName || '',
          groupName: g?.name || '',
          groupColor: g?.color || colorFromId(g?.tiktokId || g?.id || ''),
          hideScore: !!c.hideScore,
          lost: !!c.lost,
          voteActive: !!c.voteActive,
          active: this.activeId === c.id || !!c.voteActive,
        };
      });
    } else {
      rows = groups.filter(g => !activeGroupId || g.id === activeGroupId).map(g => {
        const sc = this.scores[g.id] || {};
        return {
          id: g.id,
          name: g.name,
          avatar: g.avatar || '',
          avatarKey: g.avatarCacheKey || avatarCacheKey(g.avatar),
          avatarVersion: Number(g.avatarFetchedAt) || Number(g.updatedAt) || 0,
          initials: this._buildInitials(g.name),
          points: sc.points || 0,
          round: this.round,
          giftIconId: sc.lastGiftId || '',
          giftIcon: sc.lastGiftIcon || '',
          giftName: sc.lastGiftName || '',
          groupColor: g.color || colorFromId(g.tiktokId || g.id),
          hideScore: false,
          lost: false,
          active: this.activeId === g.id,
        };
      });
    }
    rows.sort((a, b) => b.points - a.points);
    rows.forEach((r, i) => { r.rank = i + 1; });
    const allRows = rows.slice();
    const fromRank = Math.max(1, Number(this.config.rankFrom) || 1);
    const toRank = Math.max(0, Number(this.config.rankTo) || 0);
    if (fromRank > 1 || toRank > 0) {
      rows = rows.filter(r => r.rank >= fromRank && (toRank <= 0 || r.rank <= toRank));
    }
    const maxRows = Number(this.config.maxRows) || 0;
    if (maxRows > 0) rows = rows.slice(0, maxRows);

    // Active panel (cuối overlay)
    let activeRow = null;
    if (this.activeId) {
      activeRow = allRows.find(r => r.id === this.activeId);
    }
    if (!activeRow) activeRow = allRows.find(r => r.active);
    return {
      title: this.config.title,
      mode: this.config.mode,
      maxRows: this.config.maxRows,
      rankFrom: this.config.rankFrom,
      rankTo: this.config.rankTo,
      pointsBy: this.config.pointsBy,
      nameMode: this.config.nameMode,
      streakColor: this.config.streakColor,
      overlayBgColor: this.config.overlayBgColor,
      overlayBgOpacity: this.config.overlayBgOpacity,
      hideAllScores: this.config.hideAllScores,
      showRank: this.config.showRank,
      showAvatar: this.config.showAvatar,
      showGift: this.config.showGift,
      showRound: this.config.showRound,
      gridRows: this.config.gridRows,
      gridCols: this.config.gridCols,
      gridFlow: this.config.gridFlow,
      avatarScale: this.config.avatarScale,
      giftScale: this.config.giftScale,
      overlayScale: this.config.overlayScale,
      rows,
      active: activeRow ? { name: activeRow.name, avatar: activeRow.avatar, avatarKey: activeRow.avatarKey, avatarVersion: activeRow.avatarVersion, initials: activeRow.initials, points: activeRow.points } : null,
    };
  }
  _emit() { try { this.onState(this.getStateForOverlay()); } catch {} }
}

// ----------------- Score (challenge gọi quà đạt mục tiêu) -----------------
// State machine: idle → prestart → running → grace → success | failed
class ScoreEngine {
  constructor({ onState }) {
    this.onState = onState;
    this.config = {
      target: 1000,
      durationMs: 180000, // 3 phút mặc định
      prepSec: 3,
      delayMs: 5000,
      creatorName: '',
      creatorAvatar: '',
      content: '',
      themePreset: 'douyin',
      overlaySize: 'medium',
      barStyle: 'pill',
      compactMode: false,
      timeColor: '#ffffff',
      scoreFontSize: 18,
      contentColor: '#f0eef6',
      overColor: '#ff0000',
      barColor1: '#b93678',
      barColor2: '#ff8ed1',
      waveColor: '#ffffff',
      bigGiftThreshold: 500,
      showGiftUser: true,
      showTopUsers: true,
      showSpeed: false,
      hideAvatar: false,
      hideCreator: false,
      milestoneGradientEnabled: false,
      colorByProgress: false,
      customMilestoneValues: [],
      startSound: '',
      warningSound: '',
      goalSound: '',
      successSound: '',
      failSound: '',
      pointsBy: 'diamond',
      overlayScale: 100,
    };
    this.state = {
      score: 0,
      status: 'idle', // idle | prestart | running | grace | success | failed
      endAt: 0,
      runStartedAt: 0,
      lastAdd: 0,
      lastAddUser: '',
      recentGifts: [],
      topUsers: [], // [{ user, points }]
      resultAt: 0,
    };
    this._tick = null;
  }
  setConfig(patch) {
    this.config = { ...this.config, ...patch };
    this._emit();
  }
  reset() {
    this._clearTicker();
    this.state = { score: 0, status: 'idle', endAt: 0, runStartedAt: 0, lastAdd: 0, lastAddUser: '', recentGifts: [], topUsers: [], resultAt: 0 };
    this._emit();
  }
  start() {
    if (this.state.status === 'running' || this.state.status === 'prestart') return;
    this.state.status = 'prestart';
    this.state.score = 0;
    this.state.lastAdd = 0;
    this.state.lastAddUser = '';
    this.state.recentGifts = [];
    this.state.topUsers = [];
    this.state.endAt = Date.now() + (this.config.prepSec || 0) * 1000;
    this.state.runStartedAt = 0;
    this._runTicker();
  }
  stop() {
    this._clearTicker();
    this.state.status = (this.state.score >= this.config.target) ? 'success' : 'failed';
    this.state.resultAt = Date.now();
    this._emit();
  }
  addPoints(points, user = {}) {
    const pts = Number(points) || 0;
    if (!pts) return;
    this.state.score = Math.max(0, this.state.score + pts);
    this.state.lastAdd = pts;
    this.state.lastAddUser = user.nickname || user.uniqueId || 'Test user';
    this.state.recentGifts = [{
      user: user.nickname || user.uniqueId || 'Test user',
      userId: user.uniqueId || 'test-user',
      avatar: user.avatar || '../logo/hp-logo.png',
      giftName: pts > 0 ? 'Test cộng điểm' : 'Test trừ điểm',
      giftIcon: '',
      repeat: 1,
      points: pts,
      at: Date.now(),
    }, ...(this.state.recentGifts || [])].slice(0, 6);
    const userKey = user.uniqueId || user.nickname || 'test-user';
    let top = this.state.topUsers.find(t => t.user === userKey);
    if (!top) { top = { user: userKey, nickname: user.nickname || 'Test user', avatar: user.avatar || '../logo/hp-logo.png', points: 0 }; this.state.topUsers.push(top); }
    top.points = Math.max(0, top.points + pts);
    top.nickname = user.nickname || top.nickname || userKey;
    top.avatar = user.avatar || top.avatar || '../logo/hp-logo.png';
    this.state.topUsers = this.state.topUsers.filter(t => t.points > 0).sort((a, b) => b.points - a.points).slice(0, 5);
    this._emit();
  }
  routeGift(ev) {
    if (this.state.status !== 'running' && this.state.status !== 'grace') return;
    const pts = this.config.pointsBy === 'diamond'
      ? Math.max(1, resolveDiamond(ev)) * Math.max(1, Number(ev.repeatCount) || 1)
      : Math.max(1, Number(ev.repeatCount) || 1);
    this.state.score += pts;
    this.state.lastAdd = pts;
    this.state.lastAddUser = ev.nickname || ev.uniqueId || '';
    this.state.recentGifts = [{
      user: ev.nickname || ev.uniqueId || 'Ẩn danh',
      userId: ev.uniqueId || '',
      avatar: ev.avatar || '',
      giftName: ev.giftName || 'Quà',
      giftIcon: ev.giftIcon || '',
      repeat: Math.max(1, Number(ev.repeatCount) || 1),
      points: pts,
      at: Date.now(),
    }, ...(this.state.recentGifts || [])].slice(0, 6);
    // Top users
    const userKey = ev.uniqueId || ev.nickname;
    if (userKey) {
      let top = this.state.topUsers.find(t => t.user === userKey);
      if (!top) { top = { user: userKey, nickname: ev.nickname || userKey, avatar: ev.avatar || '', points: 0 }; this.state.topUsers.push(top); }
      top.points += pts;
      top.nickname = ev.nickname || top.nickname || userKey;
      top.avatar = ev.avatar || top.avatar || '';
      this.state.topUsers.sort((a, b) => b.points - a.points);
      this.state.topUsers = this.state.topUsers.slice(0, 5);
    }
    // Check success ngay trong grace
    if (this.state.score >= this.config.target && this.state.status === 'grace') {
      this.state.status = 'success';
      this.state.resultAt = Date.now();
      this._clearTicker();
    }
    this._emit();
  }
  _runTicker() {
    this._clearTicker();
    this._tick = setInterval(() => {
      const now = Date.now();
      if (this.state.status === 'prestart') {
        if (now >= this.state.endAt) {
          this.state.status = 'running';
          this.state.runStartedAt = now;
          this.state.endAt = now + this.config.durationMs;
        }
      } else if (this.state.status === 'running') {
        if (now >= this.state.endAt) {
          if (this.state.score >= this.config.target) {
            this.state.status = 'success';
            this.state.resultAt = now;
            this._clearTicker();
          } else if ((this.config.delayMs || 0) > 0) {
            this.state.status = 'grace';
            this.state.endAt = now + this.config.delayMs;
          } else {
            this.state.status = 'failed';
            this.state.resultAt = now;
            this._clearTicker();
          }
        }
      } else if (this.state.status === 'grace') {
        if (now >= this.state.endAt) {
          this.state.status = this.state.score >= this.config.target ? 'success' : 'failed';
          this.state.resultAt = now;
          this._clearTicker();
        }
      }
      this._emit();
    }, 250);
    this._emit();
  }
  _clearTicker() { if (this._tick) { clearInterval(this._tick); this._tick = null; } }
  getStateForOverlay() {
    const remainingMs = (this.state.status === 'running' || this.state.status === 'grace')
      ? Math.max(0, this.state.endAt - Date.now()) : 0;
    const sec = Math.ceil(remainingMs / 1000);
    const timeText = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    return {
      ...this.config,
      score: this.state.score,
      status: this.state.status,
      endAt: this.state.endAt,
      runStartedAt: this.state.runStartedAt,
      lastAdd: this.state.lastAdd,
      lastAddUser: this.state.lastAddUser,
      recentGifts: this.state.recentGifts,
      topUsers: this.state.topUsers,
      resultAt: this.state.resultAt,
      timeText,
      remainingMs,
    };
  }
  _emit() { try { this.onState(this.getStateForOverlay()); } catch {} }
}

// Score theme presets — port từ BIGO spec
const SCORE_THEMES = {
  douyin:  ['#b93678', '#ff8ed1', '#ffffff', '#ff0000'],
  vip:     ['#b76b00', '#ffd36a', '#fff4c1', '#ffea7a'],
  neon:    ['#00a6ff', '#35ffcf', '#e7ffff', '#70fff0'],
  battle:  ['#8f101f', '#ff4b4b', '#ffe1e1', '#ff3b3b'],
  luxury:  ['#4c2a85', '#c79cff', '#f6edff', '#d7b8ff'],
  minimal: ['#6b7280', '#d1d5db', '#ffffff', '#ffffff'],
};

// =================================================================
// Window + IPC
// =================================================================
function createWindow() {
  const compactMigration = settings.compactUiVersion !== COMPACT_UI_VERSION;
  const savedBounds = !compactMigration && isUsableWindowBounds(settings.windowBounds) ? settings.windowBounds : {};
  const bounds = {
    ...savedBounds,
    width: Math.min(MAIN_WINDOW_MAX_BOUNDS.width, Math.max(MAIN_WINDOW_MIN_BOUNDS.width, Math.round(Number(savedBounds.width) || MAIN_WINDOW_DEFAULT_BOUNDS.width))),
    height: Math.min(MAIN_WINDOW_MAX_BOUNDS.height, Math.max(MAIN_WINDOW_MIN_BOUNDS.height, Math.round(Number(savedBounds.height) || MAIN_WINDOW_DEFAULT_BOUNDS.height))),
  };
  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x, y: bounds.y,
    minWidth: MAIN_WINDOW_MIN_BOUNDS.width,
    minHeight: MAIN_WINDOW_MIN_BOUNDS.height,
    maxWidth: MAIN_WINDOW_MAX_BOUNDS.width,
    maxHeight: MAIN_WINDOW_MAX_BOUNDS.height,
    maximizable: false,
    icon: APP_ICON || undefined,
    title: 'HP Talent Show',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  if (compactMigration || !isUsableWindowBounds(settings.windowBounds)) {
    settings.compactUiVersion = COMPACT_UI_VERSION;
    settings.windowBounds = bounds;
    saveSettings();
  }

  let boundsTimer = null;
  const scheduleBoundsSave = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(rememberWindowBounds, 250);
  };
  win.on('move', scheduleBoundsSave);
  win.on('resize', scheduleBoundsSave);
  win.on('close', rememberWindowBounds);

  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

function broadcast(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function bootstrapEngines() {
  pkDuoEngine = new PkDuoEngine({
    onState: (st) => {
      overlayServer?.sendPkDuo(st);
      broadcast('pkduo:state', st);
    },
    onResult: appendMatchHistory,
    getCreators: loadCreators,
  });
  const savedPk = loadPkDuoConfig();
  if (savedPk) pkDuoEngine.setConfig(savedPk);
  pkGroupEngine = new PkGroupEngine({
    onState: (st) => {
      overlayServer?.sendPkGroup(st);
      broadcast('pkgroup:state', st);
    },
    onResult: appendMatchHistory,
    getCreators: loadCreators,
  });
  const savedPkGroup = loadPkGroupConfig();
  if (savedPkGroup) pkGroupEngine.setConfig(savedPkGroup);
  rankingEngine = new RankingEngine({
    onState: (st) => {
      overlayServer?.sendRanking(st);
      broadcast('ranking:state', st);
    },
    getCreators: loadCreators,
    getGroups: loadGroups,
  });
  if (settings.ranking) rankingEngine.setConfig(settings.ranking);
  rankingEngine.config.activeGroupId = ''; // Luôn khởi động ở chế độ TALENT SHOW (mở tất cả)
  scoreEngine = new ScoreEngine({
    onState: (st) => {
      overlayServer?.sendScore(st);
      broadcast('score:state', st);
    },
  });
  if (settings.score) scoreEngine.setConfig(settings.score);
  stickerEngine = new StickerEngine({
    onState: (st) => {
      overlayServer?.sendSticker(st);
      broadcast('stickerdance:state', st);
    },
  });
  const savedSticker = loadStickerConfig();
  if (savedSticker) stickerEngine.setConfig(savedSticker);
  mvpHonorEngine = new MvpHonorEngine({
    onState: (st) => {
      overlayServer?.sendMvpHonor(st);
      broadcast('mvphonor:state', st);
    },
    getCreators: loadCreators,
    primeAvatar: (url) => overlayServer?.primeAvatar(url),
  });
  const savedMvpHonor = loadMvpHonorConfig();
  if (savedMvpHonor) mvpHonorEngine.setConfig(savedMvpHonor);
  luckyWheelEngine = new LuckyWheelEngine({
    onState: (st) => {
      overlayServer?.sendLuckyWheel(st);
      broadcast('luckywheel:state', st);
    },
  });
  const savedLuckyWheel = loadLuckyWheelConfig();
  if (savedLuckyWheel) luckyWheelEngine.setConfig(savedLuckyWheel);

  // Phát state khởi tạo cho overlay khi mới connect
  pkDuoEngine._emit();
  pkGroupEngine._emit();
  rankingEngine._emit();
  scoreEngine._emit();
  stickerEngine._emit();
  mvpHonorEngine._emit();
  luckyWheelEngine._emit();
}

// Cache avatar theo user — TikTok hay gửi GIFT event THIẾU avatar (user data tối giản);
// ta lưu avatar từ chat/join/… (có avatar) rồi bù cho gift để vinh danh TOP hiện đúng ảnh.
const _avatarCache = new Map(); // userKey -> avatar url
function _cacheAvatar(ev) {
  const key = ev && (ev.uniqueId || ev.userId);
  if (!key || !ev.avatar) return;
  _avatarCache.set(String(key), ev.avatar);
  if (_avatarCache.size > 3000) _avatarCache.delete(_avatarCache.keys().next().value); // cap chống phình
}
function _fillAvatar(ev) {
  if (ev && !ev.avatar) {
    const key = ev.uniqueId || ev.userId;
    const cached = key && _avatarCache.get(String(key));
    if (cached) ev.avatar = cached;
  }
  return ev;
}

function bootstrapTikTok() {
  ttClient = new TikTokClient();
  ttClient.on('connected', (info) => broadcast('tt:connected', info));
  ttClient.on('disconnected', (info) => { _avatarCache.clear(); broadcast('tt:disconnected', info); });
  ttClient.on('error', (info) => broadcast('tt:error', info));
  ttClient.on('chat', (d) => { _cacheAvatar(d); broadcast('tt:chat', d); });
  ttClient.on('gift', (d) => {
    _cacheAvatar(d);   // gift có avatar thì lưu lại
    _fillAvatar(d);    // gift thiếu avatar thì bù từ cache
    if (d.avatar) overlayServer?.primeAvatar(d.avatar); // lưu đĩa avatar người tặng (champion PK) ngay
    broadcast('tt:gift', d);
    // Route vào engines (chỉ route khi streak kết thúc để tránh double-count khi user combo)
    if (d.shouldProcess) {
      pkDuoEngine?.routeGift(d);
      pkGroupEngine?.routeGift(d);
      rankingEngine?.routeGift(d);
      scoreEngine?.routeGift(d);
      stickerEngine?.routeGift(d);
    }
  });
  ttClient.on('like', (d) => { _cacheAvatar(d); broadcast('tt:like', d); });
  ttClient.on('member', (d) => { _cacheAvatar(d); broadcast('tt:member', d); });
  ttClient.on('follow', (d) => { _cacheAvatar(d); broadcast('tt:follow', d); });
  ttClient.on('share', (d) => { _cacheAvatar(d); broadcast('tt:share', d); });
  ttClient.on('roomUser', (d) => broadcast('tt:roomUser', d));
}

async function bootstrapOverlay() {
  overlayServer = new ObsOverlayServer({
    root: ROOT,
    port: settings.overlayPort,
    token: settings.overlayToken,
    cacheDir: path.join(CONFIG_DIR, 'avatar-cache'),
    normalizeAvatar: (buf) => {
      const image = nativeImage.createFromBuffer(buf);
      return image.isEmpty() ? buf : image.toPNG();
    },
    onLog: (m) => broadcast('log', { source: 'overlay', message: m }),
  });
  await overlayServer.start();
  // Lưu sẵn avatar các creator/nhóm ra đĩa (không chặn khởi động).
  setTimeout(() => primeStoredAvatars().catch(() => {}), 1500);
}

// =================================================================
// IPC handlers
// =================================================================
function registerIpc() {
  // TikTok
  ipcMain.handle('tt:connect', async (_e, { username, opts }) => {
    // === VIP allow-list: chỉ cho kết nối các TikTok ID trong danh sách của key ===
    const _lic = settings.license || {};
    if (String(_lic.vip || '').toUpperCase() === 'VIP'
        && Array.isArray(_lic.allowedIds) && _lic.allowedIds.length) {
      const _u = String(username || '').replace(/^@/, '').toLowerCase().trim();
      if (_lic.allowedIds.indexOf(_u) < 0) {
        return { ok: false, error: 'TikTok ID này không nằm trong danh sách được phép của key VIP.\nLIÊN HỆ HP MEDIA ĐỂ ĐƯỢC HỖ TRỢ', _vipNotAllowed: true };
      }
    }
    const merged = {
      signApiKey: settings.signApiKey || undefined,
      sessionId: settings.sessionId || undefined,
      ttTargetIdc: settings.ttTargetIdc || undefined,
      ...(opts || {}),
    };
    const info = await ttClient.connect(username, merged);
    settings.lastUsername = username;
    saveSettings();
    return info;
  });
  ipcMain.handle('tt:disconnect', async () => { await ttClient.disconnect(); return true; });
  ipcMain.handle('tt:status', () => ({ connected: ttClient?.isConnected(), info: ttClient?.roomInfo || null }));
  ipcMain.handle('tt:fetchProfile', async (_e, { username }) => ttClient.fetchProfile(username));

  // Creators
  ipcMain.handle('creators:list', () => {
    return loadCreators();
  });
  ipcMain.handle('creators:upsert', (_e, creator) => {
    const list = loadCreators();
    const cid = creator.id;
    const idx = cid ? list.findIndex(c => c.id === cid) : -1;
    const now = Date.now();
    const previous = idx >= 0 ? list[idx] : null;
    const saved = { ...(previous || { createdAt: now }), ...creator, id: cid || uid('c_') };
    if (saved.avatar && saved.avatar !== previous?.avatar) {
      saved.avatarFetchedAt = now;
      saved.avatarSource = 'creator-profile';
      saved.avatarFetchFailedAt = 0;
    }
    saved.avatarCacheKey = avatarCacheKey(saved.avatar);
    if (idx >= 0) list[idx] = saved;
    else list.push(saved);
    saveCreators(list);
    if (saved.avatar) overlayServer?.primeAvatar(saved.avatar);
    syncBattleAvatarReferences(list);
    rankingEngine?._emit();
    return list;
  });
  ipcMain.handle('creators:remove', (_e, id) => {
    const key = String(id || '');
    const list = loadCreators().filter(c => c.id !== key && c.tiktokId !== key);
    saveCreators(list);
    rankingEngine?._emit();
    return list;
  });

  // Groups
  ipcMain.handle('groups:list', () => loadGroups());
  ipcMain.handle('groups:upsert', (_e, group) => {
    const list = loadGroups();
    const gid = group.id;
    const idx = gid ? list.findIndex(g => g.id === gid) : -1;
    const now = Date.now();
    const previous = idx >= 0 ? list[idx] : null;
    const saved = { ...(previous || { createdAt: now }), ...group, id: gid || uid('g_') };
    if (saved.avatar && saved.avatar !== previous?.avatar) saved.avatarFetchedAt = now;
    saved.avatarCacheKey = avatarCacheKey(saved.avatar);
    if (idx >= 0) list[idx] = saved;
    else list.push(saved);
    saveGroups(list);
    if (saved.avatar) overlayServer?.primeAvatar(saved.avatar);
    rankingEngine?._emit();
    return list;
  });
  ipcMain.handle('groups:remove', (_e, id) => {
    const key = String(id || '');
    const removed = loadGroups().filter(g => g.id === key || g.tiktokId === key);
    const list = loadGroups().filter(g => g.id !== key && g.tiktokId !== key);
    // Unset groupId trên creator thuộc group này
    const creators = loadCreators().map(c => c.groupId === id ? { ...c, groupId: '' } : c);
    saveCreators(creators);
    saveGroups(list);
    // Xoá luôn hồ sơ nhóm (thông số riêng) của các nhóm bị xoá
    try {
      const profiles = loadGroupProfiles();
      let changed = false;
      for (const g of removed) { if (g.id && profiles[g.id]) { delete profiles[g.id]; changed = true; } }
      if (profiles[key]) { delete profiles[key]; changed = true; }
      if (changed) saveGroupProfiles(profiles);
    } catch {}
    rankingEngine?._emit();
    return list;
  });

  // Hồ sơ nhóm — thông số riêng theo từng nhóm
  ipcMain.handle('groupProfiles:getAll', () => loadGroupProfiles());
  ipcMain.handle('groupProfiles:save', (_e, { groupId, patch } = {}) => {
    const gid = String(groupId || '');
    if (!gid) return null;
    const map = loadGroupProfiles();
    const cur = (map[gid] && typeof map[gid] === 'object') ? map[gid] : {};
    const next = { ...cur, ...(patch || {}), updatedAt: Date.now() };
    map[gid] = next;
    saveGroupProfiles(map);
    return next;
  });

  // Sao lưu / khôi phục dữ liệu Creator + Nhóm (xuất/nhập 1 file JSON)
  ipcMain.handle('data:counts', () => ({ creators: loadCreators().length, groups: loadGroups().length }));
  ipcMain.handle('data:export', async () => {
    const payload = {
      app: 'HP Talent Show',
      version: app.getVersion(),
      exportedAt: Date.now(),
      creators: loadCreators(),
      groups: loadGroups(),
      groupProfiles: loadGroupProfiles(),
    };
    const stamp = fmtDate(Date.now()).replace(/\//g, '-');
    const res = await dialog.showSaveDialog(win, {
      title: 'Xuất dữ liệu Creator + Nhóm',
      defaultPath: `HP-Talent-Data-${stamp}.json`,
      filters: [{ name: 'HP Talent Data', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, reason: 'canceled' };
    try {
      fs.writeFileSync(res.filePath, JSON.stringify(payload, null, 2), 'utf8');
      return { ok: true, filePath: res.filePath, creators: payload.creators.length, groups: payload.groups.length };
    } catch (err) {
      return { ok: false, reason: String(err && err.message || err) };
    }
  });
  ipcMain.handle('data:import', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Nhập dữ liệu Creator + Nhóm',
      filters: [{ name: 'HP Talent Data', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths?.[0]) return { ok: false, reason: 'canceled' };
    let data;
    try { data = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8')); } catch { return { ok: false, reason: 'parse' }; }
    const inGroups = Array.isArray(data.groups) ? data.groups : [];
    const inCreators = Array.isArray(data.creators) ? data.creators : [];
    if (!inGroups.length && !inCreators.length) return { ok: false, reason: 'empty' };
    // Gộp theo id (không xoá dữ liệu sẵn có): trùng id thì cập nhật, mới thì thêm.
    const gMap = new Map(loadGroups().map(g => [g.id, g]));
    let gAdd = 0, gUpd = 0;
    for (const g of inGroups) {
      if (!g) continue;
      const id = g.id || uid('g_');
      if (gMap.has(id)) { gMap.set(id, { ...gMap.get(id), ...g, id }); gUpd++; }
      else { gMap.set(id, { createdAt: Date.now(), ...g, id }); gAdd++; }
    }
    saveGroups([...gMap.values()]);
    const cMap = new Map(loadCreators().map(c => [c.id, c]));
    let cAdd = 0, cUpd = 0;
    for (const c of inCreators) {
      if (!c) continue;
      const id = c.id || uid('c_');
      if (cMap.has(id)) { cMap.set(id, { ...cMap.get(id), ...c, id }); cUpd++; }
      else { cMap.set(id, { createdAt: Date.now(), ...c, id }); cAdd++; }
    }
    saveCreators([...cMap.values()]);
    // Gộp hồ sơ nhóm (thông số riêng) nếu có trong file nhập
    if (data.groupProfiles && typeof data.groupProfiles === 'object' && !Array.isArray(data.groupProfiles)) {
      const pMap = loadGroupProfiles();
      for (const [gid, prof] of Object.entries(data.groupProfiles)) {
        if (!gid || !prof || typeof prof !== 'object') continue;
        pMap[gid] = { ...(pMap[gid] || {}), ...prof };
      }
      saveGroupProfiles(pMap);
    }
    rankingEngine?._emit();
    return { ok: true, creatorsAdded: cAdd, creatorsUpdated: cUpd, groupsAdded: gAdd, groupsUpdated: gUpd };
  });

  // PK Duo
  ipcMain.handle('pkduo:getState', () => pkDuoEngine.getStateForOverlay());
  ipcMain.handle('pkduo:setConfig', (_e, cfg) => { pkDuoEngine.setConfig(cfg); savePkDuoConfig(pkDuoEngine.config); return pkDuoEngine.config; });
  ipcMain.handle('pkduo:start', () => { pkDuoEngine.start(); return true; });
  ipcMain.handle('pkduo:stop', () => { pkDuoEngine.stop(); return true; });
  ipcMain.handle('pkduo:reset', () => { pkDuoEngine.reset(); return true; });
  ipcMain.handle('pkduo:addPoints', (_e, { side, points }) => { pkDuoEngine.addPoints(side, points); return true; });
  ipcMain.handle('pkduo:getUrl', () => overlayServer.getPkDuoUrl());
  ipcMain.handle('pkduo:getFxUrl', () => overlayServer.getPkDuoFxUrl());

  // PK Group
  ipcMain.handle('pkgroup:getState', () => pkGroupEngine.getStateForOverlay());
  ipcMain.handle('pkgroup:setConfig', (_e, cfg) => { pkGroupEngine.setConfig(cfg); savePkGroupConfig(pkGroupEngine.config); return pkGroupEngine.config; });
  ipcMain.handle('pkgroup:start', () => { pkGroupEngine.start(); return true; });
  ipcMain.handle('pkgroup:stop', () => { pkGroupEngine.stop(); return true; });
  ipcMain.handle('pkgroup:reset', () => { pkGroupEngine.reset(); return true; });
  ipcMain.handle('pkgroup:addPoints', (_e, { id, points }) => { pkGroupEngine.addPoints(id, points); return true; });
  ipcMain.handle('pkgroup:testGift', (_e, { id }) => pkGroupEngine.testGift(id));
  ipcMain.handle('pkgroup:getUrl', () => overlayServer.getPkGroupUrl());

  // DANH SÁCH NHẠC (quà → clip audio). Audio phát ở renderer; main chỉ lưu cấu hình.
  ipcMain.handle('musiclist:getState', () => loadMusicList() || { items: [], duckWaiting: true, bgEnabled: false });
  ipcMain.handle('musiclist:setConfig', (_e, cfg) => { const c = cfg || {}; saveMusicList(c); return c; });

  // STICKER DANCE
  ipcMain.handle('stickerdance:getState', () => stickerEngine.getStateForOverlay());
  // getConfig trả về cấu hình GỐC (TALENT SHOW) trong file — engine live có thể đang là
  // cấu hình của một nhóm (nạp qua :apply) nên không dùng engine.config làm nguồn base.
  ipcMain.handle('stickerdance:getConfig', () => loadStickerConfig() || stickerEngine.config);
  ipcMain.handle('stickerdance:setConfig', (_e, cfg) => { stickerEngine.setConfig(cfg); saveStickerConfig(stickerEngine.config); return stickerEngine.config; });
  // apply: nạp cấu hình lên engine (để OBS đổi ngay) NHƯNG không ghi file gốc —
  // dùng khi hiển thị cấu hình riêng của một nhóm (lưu ở group-profiles.json).
  ipcMain.handle('stickerdance:apply', (_e, cfg) => { stickerEngine.setConfig(cfg); return stickerEngine.config; });
  ipcMain.handle('stickerdance:reset', () => { stickerEngine.reset(); return true; });
  ipcMain.handle('stickerdance:getUrl', () => overlayServer.getStickerUrl());
  ipcMain.handle('stickerdance:signal', (_e, sig) => { stickerEngine.signal(sig || {}); return true; });

  // ===== MVP Honor (thẻ vinh danh) =====
  ipcMain.handle('mvphonor:getState', () => mvpHonorEngine?.getStateForOverlay());
  ipcMain.handle('mvphonor:getConfig', () => loadMvpHonorConfig() || mvpHonorEngine?.config || { cards: [] });
  ipcMain.handle('mvphonor:setConfig', (_e, cfg) => { mvpHonorEngine?.setConfig(cfg); saveMvpHonorConfig(mvpHonorEngine?.config); return mvpHonorEngine?.config; });
  ipcMain.handle('mvphonor:reset', () => { mvpHonorEngine?.reset(); saveMvpHonorConfig(mvpHonorEngine?.config); return true; });
  ipcMain.handle('mvphonor:getUrl', () => overlayServer?.getMvpHonorUrl());

  ipcMain.handle('luckywheel:getState', () => luckyWheelEngine?.getStateForOverlay());
  ipcMain.handle('luckywheel:getConfig', () => loadLuckyWheelConfig() || luckyWheelEngine?.config || { segments: [], history: [] });
  ipcMain.handle('luckywheel:setConfig', (_e, cfg) => { luckyWheelEngine?.setConfig(cfg); saveLuckyWheelConfig(luckyWheelEngine?.config); return luckyWheelEngine?.config; });
  ipcMain.handle('luckywheel:spin', (_e, opts) => { const r = luckyWheelEngine?.doSpin(opts || {}); saveLuckyWheelConfig(luckyWheelEngine?.config); return r; });
  ipcMain.handle('luckywheel:clearHistory', () => { luckyWheelEngine?.clearHistory(); saveLuckyWheelConfig(luckyWheelEngine?.config); return true; });
  ipcMain.handle('luckywheel:reset', () => { luckyWheelEngine?.reset(); return true; });
  ipcMain.handle('luckywheel:getUrl', () => overlayServer?.getLuckyWheelUrl());

  // Match history (LỊCH SỬ trận đấu)
  ipcMain.handle('history:list', (_e, filter) => {
    let list = loadMatchHistory();
    if (filter && filter.type) list = list.filter(m => m.type === filter.type);
    return list.slice().sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  });
  ipcMain.handle('history:clear', (_e, filter) => {
    if (filter && filter.type) saveMatchHistory(loadMatchHistory().filter(m => m.type !== filter.type));
    else saveMatchHistory([]);
    return true;
  });
  ipcMain.handle('history:remove', (_e, id) => {
    saveMatchHistory(loadMatchHistory().filter(m => m.id !== id));
    return true;
  });
  ipcMain.handle('history:export', async (_e, filter) => {
    let list = loadMatchHistory();
    if (filter && filter.type) list = list.filter(m => m.type === filter.type);
    if (!list.length) return { ok: false, reason: 'empty' };
    const stamp = `${fmtDate(Date.now()).replace(/\//g, '-')}`;
    const suffix = filter && filter.type ? (filter.type === 'duo' ? '-PK-Doi' : '-PK-Nhom') : '';
    const res = await dialog.showSaveDialog(win, {
      title: 'Xuất lịch sử trận đấu',
      defaultPath: `Lich-su-PK${suffix}-${stamp}.csv`,
      filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, reason: 'canceled' };
    try {
      fs.writeFileSync(res.filePath, buildHistoryCsv(list), 'utf8');
      return { ok: true, filePath: res.filePath, count: list.length };
    } catch (err) {
      return { ok: false, reason: String(err && err.message || err) };
    }
  });

  // Ranking
  ipcMain.handle('ranking:getState', () => {
    return rankingEngine.getStateForOverlay();
  });
  ipcMain.handle('ranking:setConfig', (_e, cfg) => {
    rankingEngine.setConfig(cfg);
    settings.ranking = { ...rankingEngine.config };
    saveSettings();
    return rankingEngine.config;
  });
  ipcMain.handle('ranking:reset', () => {
    const list = loadCreators().map(c => ({ ...c, contestPoints: 0 }));
    saveCreators(list);
    rankingEngine.reset();
    rankingEngine._emit();
    return true;
  });
  ipcMain.handle('ranking:startRound', () => {
    const list = loadCreators().map(c => ({ ...c, voteRound: (Number(c.voteRound) || 0) + 1 }));
    saveCreators(list);
    rankingEngine.startRound();
    rankingEngine._emit();
    return list.reduce((max, c) => Math.max(max, Number(c.voteRound) || 0), rankingEngine.round);
  });
  ipcMain.handle('ranking:resetRound', () => {
    const list = loadCreators().map(c => ({ ...c, voteRound: 0 }));
    saveCreators(list);
    rankingEngine.round = 0;
    rankingEngine._emit();
    return 0;
  });
  ipcMain.handle('ranking:setActive', (_e, id) => { rankingEngine.setActive(id); return true; });
  ipcMain.handle('ranking:getUrl', () => overlayServer.getRankingUrl());
  ipcMain.handle('ranking:getGridUrl', () => overlayServer.getRankingUrl() + '&grid=1');

  // Score
  ipcMain.handle('score:getState', () => scoreEngine.getStateForOverlay());
  ipcMain.handle('score:setConfig', (_e, cfg) => { scoreEngine.setConfig(cfg); settings.score = scoreEngine.config; saveSettings(); return scoreEngine.config; });
  ipcMain.handle('score:start', () => { scoreEngine.start(); return true; });
  ipcMain.handle('score:stop', () => { scoreEngine.stop(); return true; });
  ipcMain.handle('score:reset', () => { scoreEngine.reset(); return true; });
  ipcMain.handle('score:addPoints', (_e, { points, user } = {}) => { scoreEngine.addPoints(points, user); return true; });
  ipcMain.handle('score:getUrl', () => overlayServer.getScoreUrl());

  // Overlay Review windows
  ipcMain.handle('review:open', (_e, type) => openReviewWindow(type));
  ipcMain.handle('review:close', (_e, type) => closeReviewWindow(type));
  ipcMain.handle('review:alwaysOnTop', (_e, { type, value }) => setReviewAlwaysOnTop(type, value));
  ipcMain.handle('review:clickThrough', (_e, { type, value }) => setReviewClickThrough(type, value));
  ipcMain.handle('review:background', (_e, { type, value, alpha }) => setReviewBackground(type, value, alpha));
  ipcMain.handle('review:fitContent', (e, { width, height } = {}) => fitReviewWindowToContent(e.sender, width, height));
  ipcMain.handle('review:getState', () => getReviewState());

  // Settings
  ipcMain.handle('settings:get', () => ({
    lastUsername: settings.lastUsername,
    autoConnect: !!settings.autoConnect,
    signApiKey: settings.signApiKey ? '•••' : '',
    sessionId: settings.sessionId ? '•••' : '',
    ttTargetIdc: settings.ttTargetIdc,
    overlayPort: settings.overlayPort,
    overlay: { ...(settings.overlay || {}) },
    audio: { ...(settings.audio || {}) },
    scoreLinkRanking: !!settings.scoreLinkRanking,
    scoreLinkVoteLock: !!settings.scoreLinkVoteLock,
    // Không trả mật khẩu OBS ra renderer — chỉ báo đã có hay chưa.
    obs: {
      wsPort: settings.obs?.wsPort ?? 4455,
      autoReset: settings.obs?.autoReset !== false,
      hasPassword: !!(settings.obs?.wsPassword),
    },
  }));
  ipcMain.handle('settings:set', (_e, patch) => {
    if (patch && typeof patch === 'object') {
      for (const k of ['signApiKey', 'sessionId', 'ttTargetIdc']) {
        if (typeof patch[k] === 'string') settings[k] = patch[k];
      }
      if (patch.overlay && typeof patch.overlay === 'object') {
        settings.overlay = { ...(settings.overlay || {}), ...patch.overlay };
      }
      if (patch.audio && typeof patch.audio === 'object') {
        settings.audio = { ...(settings.audio || {}), ...patch.audio };
      }
      if (typeof patch.autoConnect === 'boolean') settings.autoConnect = patch.autoConnect;
      if (typeof patch.scoreLinkRanking === 'boolean') settings.scoreLinkRanking = patch.scoreLinkRanking;
      if (typeof patch.scoreLinkVoteLock === 'boolean') settings.scoreLinkVoteLock = patch.scoreLinkVoteLock;
      if (patch.obs && typeof patch.obs === 'object') {
        settings.obs = settings.obs || {};
        const o = patch.obs;
        if (o.wsPort !== undefined) {
          const p = parseInt(o.wsPort, 10);
          if (p > 0 && p < 65536) settings.obs.wsPort = p;
        }
        // Chỉ ghi đè mật khẩu khi có nhập (để trống = giữ nguyên, không xóa nhầm).
        if (typeof o.wsPassword === 'string' && o.wsPassword.length) settings.obs.wsPassword = o.wsPassword;
        if (typeof o.autoReset === 'boolean') settings.obs.autoReset = o.autoReset;
      }
      saveSettings();
    }
    return true;
  });

  // OBS WebSocket auth — tính chuỗi xác thực v5 bằng mật khẩu lưu ở main (renderer không thấy mật khẩu).
  // auth = base64(sha256( base64(sha256(password + salt)) + challenge ))
  ipcMain.handle('obs:authString', (_e, { salt, challenge } = {}) => {
    const pw = settings.obs?.wsPassword || '';
    const secret = crypto.createHash('sha256').update(pw + String(salt || '')).digest('base64');
    return crypto.createHash('sha256').update(secret + String(challenge || '')).digest('base64');
  });

  // License + updates
  ipcMain.handle('license:get', () => publicLicenseState({ license: { ...(settings.license || {}), deviceId: getDeviceId(), appVersion: app.getVersion() } }).license);
  ipcMain.handle('license:activate', async (_e, key) => publicLicenseState(await validateLicenseKey(key)));
  ipcMain.handle('license:check', async () => publicLicenseState(await checkStoredLicense()));
  ipcMain.handle('license:clear', () => {
    settings.license = { key: '', vip: '', expiresAt: '', status: '', activatedAt: 0, checkedAt: 0, deviceId: getDeviceId() };
    saveSettings();
    return publicLicenseState({ ok: true, license: settings.license });
  });
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('updates:check', async () => checkForUpdate());
  ipcMain.handle('updates:install', async (_e, info = {}) => downloadAndInstallUpdate(info.downloadUrl, info.assetName));

  // Gift Master
  ipcMain.handle('gifts:list', () => ({
    fetchedAt: giftMaster.fetchedAt,
    count: giftMaster.gifts.length,
    gifts: giftMaster.gifts,
  }));
  ipcMain.handle('gifts:byId', (_e, idOrName) => lookupGift(idOrName));
  ipcMain.handle('gifts:refresh', async () => {
    try {
      const r = await refreshGiftMaster();
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('banner:list', async () => {
    try {
      const banners = await fetchBanners();
      return { ok: true, banners };
    } catch (e) {
      return { ok: false, error: e.message || String(e), banners: [] };
    }
  });

  ipcMain.handle('ticker:list', async () => {
    try {
      const tickers = await fetchTickers();
      return { ok: true, tickers };
    } catch (e) {
      return { ok: false, error: e.message || String(e), tickers: [] };
    }
  });

  // Shell
  ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));
  ipcMain.handle('shell:copyText', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
  // Hộp thoại xác nhận CÓ/KHÔNG (native). Trả về true nếu bấm CÓ.
  ipcMain.handle('shell:confirm', async (_e, opts = {}) => {
    const r = await dialog.showMessageBox(win, {
      type: opts.type || 'warning',
      buttons: ['Có', 'Không'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: opts.title || 'Xác nhận',
      message: opts.message || 'Bạn có chắc chắn?',
      detail: opts.detail || '',
    });
    return r.response === 0;
  });
  ipcMain.handle('shell:pickAudio', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Chọn file âm thanh',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }],
    });
    if (r.canceled || !r.filePaths?.[0]) return '';
    return r.filePaths[0];
  });
  ipcMain.handle('shell:pickAudios', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Chọn một hoặc nhiều file âm thanh',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }],
    });
    if (r.canceled || !Array.isArray(r.filePaths)) return [];
    return r.filePaths;
  });
  ipcMain.handle('shell:prepareGiftDrag', async (_e, { url, giftId, giftName }) => {
    if (!url) return null;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error('Không tải được icon quà');
    const ct = res.headers.get('content-type') || '';
    const ext = ct.includes('webp') ? 'webp' : ct.includes('jpeg') ? 'jpg' : ct.includes('gif') ? 'gif' : 'png';
    const safe = String(giftId || giftName || 'gift').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    const dir = path.join(USER_DATA_DIR, 'drag-cache');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${safe}.${ext}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(file, buf);
    return file;
  });
  ipcMain.on('shell:startGiftDrag', (event, file) => {
    // startDrag NÉM lỗi nếu icon không load được (Windows thường không load .webp làm icon kéo)
    // → phải dựng nativeImage an toàn + fallback logo, và bọc try/catch để KHÔNG crash main process.
    try {
      if (!file || !fs.existsSync(file)) return;
      let icon = nativeImage.createFromPath(file);
      if (!icon || icon.isEmpty()) { try { icon = nativeImage.createFromBuffer(fs.readFileSync(file)); } catch {} }
      if ((!icon || icon.isEmpty()) && APP_ICON) icon = nativeImage.createFromPath(ICON_PNG);
      if (!icon || icon.isEmpty()) return; // không có icon hợp lệ thì thôi, đừng để startDrag ném
      icon = icon.resize({ width: 48, height: 48 });
      event.sender.startDrag({ file, icon });
    } catch (err) {
      try { broadcast('log', { source: 'drag', message: 'startDrag lỗi (bỏ qua): ' + (err && err.message) }); } catch {}
    }
  });
}

// =================================================================
// App lifecycle
// =================================================================
app.whenReady().then(async () => {
  if (APP_ICON && process.platform === 'win32') {
    try { app.setAppUserModelId('com.hp.talentshow'); } catch {}
  }
  loadGiftMaster();
  registerIpc();
  bootstrapEngines();
  bootstrapTikTok();
  await bootstrapOverlay();
  // Overlay server sẵn sàng SAU khi engine đã nạp config đã lưu → phát lại state một lần
  // để OBS/Review nhận ĐÚNG cấu hình ngay khi kết nối, không phải chờ lần chỉnh sửa kế tiếp.
  pkDuoEngine?._emit(); pkGroupEngine?._emit(); rankingEngine?._emit(); scoreEngine?._emit(); stickerEngine?._emit(); mvpHonorEngine?._emit(); luckyWheelEngine?._emit();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

  // HP KEY - check key real-time: cam key tren admin -> dong app trong <= RECHECK_SECONDS
  try {
    require('../hpkey/core').startWatch({
      getKey: () => settings.license?.key || '',
      onRevoked: (reason) => {
        try {
          dialog.showErrorBox('Bản quyền bị thu hồi',
            'KEY của bạn đã bị khóa/thu hồi hoặc hết hạn (' + reason + ').\n' +
            'Ứng dụng sẽ đóng. Liên hệ HP Media để được hỗ trợ.');
        } catch (_) {}
        app.quit();
        setTimeout(() => { try { app.exit(0); } catch (_) {} }, 1500);
      },
    });
  } catch (e) { console.warn('[hpkey] watch init failed:', e && e.message); }
});

app.on('window-all-closed', () => {
  try { ttClient?.disconnect(); } catch {}
  try { overlayServer?.stop(); } catch {}
  if (process.platform !== 'darwin') app.quit();
});
