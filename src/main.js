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
const CONFIG_DIR = app.isPackaged ? path.join(USER_DATA_DIR, 'config') : path.join(ROOT, 'config');
const SHIPPED_CONFIG_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'config')
  : path.join(ROOT, 'config');
const SETTINGS_PATH = path.join(CONFIG_DIR, 'settings.json');
const CREATORS_PATH = path.join(CONFIG_DIR, 'creators.json');
const GROUPS_PATH = path.join(CONFIG_DIR, 'groups.json');
const PK_DUO_PATH = path.join(CONFIG_DIR, 'pk-duo.json');
const PK_GROUP_PATH = path.join(CONFIG_DIR, 'pk-group.json');
const GIFT_MASTER_PATH = path.join(CONFIG_DIR, 'gift-master.json');
const SHIPPED_GIFT_MASTER_PATH = path.join(SHIPPED_CONFIG_DIR, 'gift-master.json');
const GIFT_MASTER_SHEET = 'https://docs.google.com/spreadsheets/d/1Fv9Jdno_pPMTx_-tnwSfRObm1r1wKds_gaMBnfCDm4M/gviz/tq?tqx=out:csv&sheet=DANH%20SACH%20QUA';
const GITHUB_RELEASES_API = 'https://api.github.com/repos/hpmediaoffifical/HP-Talent-Show/releases/latest';
const GITHUB_RELEASES_URL = 'https://github.com/hpmediaoffifical/HP-Talent-Show/releases/latest';
const BANNER_SHEET = 'https://docs.google.com/spreadsheets/d/1g0oNn60BJjp5s8SN_7_vrrUPidw8HtX0xKsS2OP0waM/gviz/tq?tqx=out:csv&sheet=Banner';
const TICKER_SHEET = 'https://docs.google.com/spreadsheets/d/1g0oNn60BJjp5s8SN_7_vrrUPidw8HtX0xKsS2OP0waM/gviz/tq?tqx=out:csv&sheet=CH%E1%BB%AE%20TH%C3%94NG%20B%C3%81O';

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
let settings = loadSettings();
const reviewWindows = new Map();
let creatorAvatarRefreshTimer = null;
let creatorAvatarRefreshRunning = false;
const CREATOR_AVATAR_TTL_MS = 6 * 60 * 60 * 1000;
const CREATOR_AVATAR_RETRY_MS = 10 * 60 * 1000;

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
    lastUsername: '',
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
    },
    reviewWindows: {},
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

function isDefaultAvatar(value) {
  const s = String(value || '').trim();
  return !s || s === '../logo/hp-logo.png' || s === '/logo.png' || /logo[\\/]hp-logo\.(png|ico)$/i.test(s);
}

function creatorAvatarNeedsRefresh(c, now = Date.now()) {
  const id = String(c?.tiktokId || '').trim().replace(/^@/, '');
  if (!id) return false;
  if (c.avatarFetchFailedAt && now - Number(c.avatarFetchFailedAt) < CREATOR_AVATAR_RETRY_MS) return false;
  if (isDefaultAvatar(c.avatar)) return true;
  if (!c.avatarFetchedAt) return true;
  return now - Number(c.avatarFetchedAt) > CREATOR_AVATAR_TTL_MS;
}

function scheduleCreatorAvatarRefresh(delay = 80) {
  clearTimeout(creatorAvatarRefreshTimer);
  creatorAvatarRefreshTimer = setTimeout(() => refreshCreatorAvatars().catch(() => {}), delay);
}

async function refreshCreatorAvatars() {
  if (creatorAvatarRefreshRunning || !ttClient) return;
  creatorAvatarRefreshRunning = true;
  try {
    let list = loadCreators();
    const now = Date.now();
    const targets = list.filter(c => creatorAvatarNeedsRefresh(c, now));
    if (!targets.length) return;
    let changed = false;
    for (const c of targets) {
      const id = String(c.tiktokId || '').trim().replace(/^@/, '');
      if (!id) continue;
      try {
        const p = await ttClient.fetchProfile(id);
        const idx = list.findIndex(x => x.id === c.id);
        if (idx < 0) continue;
        if (p?.found && p.avatar) {
          list[idx] = {
            ...list[idx],
            avatar: p.avatar,
            channelName: p.nickname || list[idx].channelName || list[idx].nickname || id,
            avatarFetchedAt: Date.now(),
            avatarSource: p.source || 'profile',
            avatarFetchFailedAt: 0,
          };
          changed = true;
        } else {
          list[idx] = { ...list[idx], avatarFetchFailedAt: Date.now() };
          changed = true;
        }
      } catch {
        const idx = list.findIndex(x => x.id === c.id);
        if (idx >= 0) {
          list[idx] = { ...list[idx], avatarFetchFailedAt: Date.now() };
          changed = true;
        }
      }
    }
    if (changed) {
      saveCreators(list);
      rankingEngine?._emit();
      scoreEngine?._emit?.();
    }
  } finally {
    creatorAvatarRefreshRunning = false;
  }
}
function saveSettings() { saveJson(SETTINGS_PATH, settings); }

function getDeviceId() {
  const raw = [os.hostname(), os.userInfo().username, USER_DATA_DIR].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase();
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
  pkgroup: { title: 'Review PK Nhóm', getUrl: () => overlayServer?.getPkGroupUrl(), width: 1280, height: 420 },
  score: { title: 'Review Tính điểm', getUrl: () => overlayServer?.getScoreUrl(), width: 900, height: 300 },
  ranking: { title: 'Review Thi đấu', getUrl: () => overlayServer?.getRankingUrl(), width: 420, height: 900 },
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
    minWidth: 220,
    minHeight: 120,
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
function loadPkDuoConfig() { return loadJson(PK_DUO_PATH, null); }
function savePkDuoConfig(cfg) { saveJson(PK_DUO_PATH, cfg); }
function loadPkGroupConfig() { return loadJson(PK_GROUP_PATH, null); }
function savePkGroupConfig(cfg) { saveJson(PK_GROUP_PATH, cfg); }

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
  constructor({ onState }) {
    this.onState = onState;
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
    };
    this.state = {
      status: 'idle', // 'idle' | 'prestart' | 'running' | 'grace' | 'finished'
      remainingMs: 0,
      scoreA: 0, scoreB: 0,
      startedAt: 0,
      endsAt: 0,
      userTeams: {}, // userId -> 'A' | 'B' (cho joinMode)
      graceElapsedMs: 0,
    };
    this._tick = null;
  }
  setConfig(patch) { this.config = { ...this.config, ...patch }; this._emit(); }
  getStateForOverlay() {
    return {
      status: this.state.status,
      remainingMs: this.state.remainingMs,
      startedAt: this.state.startedAt,
      scoreA: this.state.scoreA,
      scoreB: this.state.scoreB,
      teamA: this.config.teamA,
      teamB: this.config.teamB,
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
    };
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
    this._runTicker();
  }
  stop() {
    this.state.status = 'finished';
    this.state.remainingMs = 0;
    this.state.userTeams = {};
    this._clearTicker();
    this._emit();
  }
  reset() {
    this._clearTicker();
    this.state = { status: 'idle', remainingMs: 0, scoreA: 0, scoreB: 0, startedAt: 0, endsAt: 0, userTeams: {}, graceElapsedMs: 0 };
    this._emit();
  }
  addPoints(side, points) {
    if (side === 'A') this.state.scoreA += Number(points) || 0;
    else if (side === 'B') this.state.scoreB += Number(points) || 0;
    this._emit();
  }
  // Route 1 gift event → cộng cho phe nào
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
          if (this.state.userTeams[user] === side) {
            delete this.state.userTeams[user];
            this._emit();
            return;
          }
          this.state.userTeams[user] = side;
          this._emit();
          return;
        }
        side = this.state.userTeams[user] || null;
      }
    }
    if (!side) return;
    if (side === 'A') this.state.scoreA += pts;
    else this.state.scoreB += pts;
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
          // Vào grace period nếu config.delaySec > 0
          if ((this.config.delaySec || 0) > 0) {
            this.state.status = 'grace';
            this.state.userTeams = {};
            this.state.graceElapsedMs = 0;
            this.state.remainingMs = 0;
          } else {
            this.state.status = 'finished';
            this.state.userTeams = {};
            this._clearTicker();
          }
        } else if (this.state.status === 'grace' && Math.abs(this.state.remainingMs) >= (this.config.delaySec || 0) * 1000) {
          this.state.status = 'finished';
          this.state.userTeams = {};
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
  constructor({ onState }) {
    this.onState = onState;
    this.config = {
      content: 'PK NHÓM',
      groupId: '',
      layoutMode: 'joined', // joined | separated
      playMode: 'fixed', // fixed | join
      pointsBy: 'diamond',
      noteEnabled: false,
      noteText: 'Tặng 01 quà để chọn Creator, sau đó lên gì cũng tính điểm. Tặng lần 2 hoặc quà Creator khác để hủy bỏ hoặc hết trận sẽ tự hủy',
      noteBgColor: '#1f2430',
      noteTextColor: '#ffffff',
      noteSpeedSec: 16,
      noteEffect: 'soft',
      separatedGap: 180,
      autoTextContrast: false,
      durationSec: 90,
      prepSec: 3,
      delaySec: 5,
      textSize: 20,
      giftSize: 42,
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
    const participants = this.config.participants.map(p => ({
      ...p,
      score: Number(this.state.scores[p.id]) || 0,
      streak: Number(this.state.streaks[p.id]) || 0,
    }));
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
    this._runTicker();
  }
  stop() {
    this._finalizeRound();
    this.state.status = 'finished';
    this.state.remainingMs = 0;
    this.state.userTeams = {};
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
  routeGift(ev) {
    if (this.state.status !== 'running') return;
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
          if (this.state.userTeams[user] === target.id) delete this.state.userTeams[user];
          else this.state.userTeams[user] = target.id;
          this._emit();
          return;
        }
        target = participants.find(p => p.id === this.state.userTeams[user]) || null;
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
          this._finalizeRound();
          if ((this.config.delaySec || 0) > 0) {
            this.state.status = 'grace';
            this.state.userTeams = {};
            this.state.graceElapsedMs = 0;
            this.state.remainingMs = 0;
          } else {
            this.state.status = 'finished';
            this.state.userTeams = {};
            this._clearTicker();
          }
        } else if (this.state.status === 'grace' && Math.abs(this.state.remainingMs) >= (this.config.delaySec || 0) * 1000) {
          this.state.status = 'finished';
          this.state.userTeams = {};
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
    let rows = [];
    if (this.config.mode === 'creator') {
      rows = creators.filter(c => !c.hideObs).map(c => {
        const sc = this.scores[c.id] || {};
        const g = groups.find(x => x.id === c.groupId);
        return {
          id: c.id,
          name: c.nickname || c.tiktokId,
          avatar: c.avatar || '',
          initials: this._buildInitials(c.nickname || c.tiktokId),
          points: sc.points || Number(c.contestPoints) || 0,
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
      rows = groups.map(g => {
        const sc = this.scores[g.id] || {};
        return {
          id: g.id,
          name: g.name,
          avatar: g.avatar || '',
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
      overlayScale: this.config.overlayScale,
      rows,
      active: activeRow ? { name: activeRow.name, avatar: activeRow.avatar, initials: activeRow.initials, points: activeRow.points } : null,
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
  const bounds = isUsableWindowBounds(settings.windowBounds) ? settings.windowBounds : {};
  win = new BrowserWindow({
    width: bounds.width || 1480,
    height: bounds.height || 920,
    x: bounds.x, y: bounds.y,
    minWidth: 1180,
    minHeight: 720,
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
  });
  const savedPk = loadPkDuoConfig();
  if (savedPk) pkDuoEngine.setConfig(savedPk);
  pkGroupEngine = new PkGroupEngine({
    onState: (st) => {
      overlayServer?.sendPkGroup(st);
      broadcast('pkgroup:state', st);
    },
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
  scheduleCreatorAvatarRefresh(500);
  scoreEngine = new ScoreEngine({
    onState: (st) => {
      overlayServer?.sendScore(st);
      broadcast('score:state', st);
    },
  });
  if (settings.score) scoreEngine.setConfig(settings.score);

  // Phát state khởi tạo cho overlay khi mới connect
  pkDuoEngine._emit();
  pkGroupEngine._emit();
  rankingEngine._emit();
  scoreEngine._emit();
}

function bootstrapTikTok() {
  ttClient = new TikTokClient();
  ttClient.on('connected', (info) => broadcast('tt:connected', info));
  ttClient.on('disconnected', (info) => broadcast('tt:disconnected', info));
  ttClient.on('error', (info) => broadcast('tt:error', info));
  ttClient.on('chat', (d) => broadcast('tt:chat', d));
  ttClient.on('gift', (d) => {
    broadcast('tt:gift', d);
    // Route vào engines (chỉ route khi streak kết thúc để tránh double-count khi user combo)
    if (d.shouldProcess) {
      pkDuoEngine?.routeGift(d);
      pkGroupEngine?.routeGift(d);
      rankingEngine?.routeGift(d);
      scoreEngine?.routeGift(d);
    }
  });
  ttClient.on('like', (d) => broadcast('tt:like', d));
  ttClient.on('member', (d) => broadcast('tt:member', d));
  ttClient.on('follow', (d) => broadcast('tt:follow', d));
  ttClient.on('share', (d) => broadcast('tt:share', d));
  ttClient.on('roomUser', (d) => broadcast('tt:roomUser', d));
}

async function bootstrapOverlay() {
  overlayServer = new ObsOverlayServer({
    root: ROOT,
    port: settings.overlayPort,
    token: settings.overlayToken,
    onLog: (m) => broadcast('log', { source: 'overlay', message: m }),
  });
  await overlayServer.start();
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
    scheduleCreatorAvatarRefresh();
    return loadCreators();
  });
  ipcMain.handle('creators:upsert', (_e, creator) => {
    const list = loadCreators();
    const cid = creator.id;
    const idx = cid ? list.findIndex(c => c.id === cid) : -1;
    const now = Date.now();
    if (idx >= 0) list[idx] = { ...list[idx], ...creator, id: cid };
    else list.push({ createdAt: now, ...creator, id: uid('c_') });
    saveCreators(list);
    scheduleCreatorAvatarRefresh();
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
    if (idx >= 0) list[idx] = { ...list[idx], ...group, id: gid };
    else list.push({ createdAt: now, ...group, id: uid('g_') });
    saveGroups(list);
    rankingEngine?._emit();
    return list;
  });
  ipcMain.handle('groups:remove', (_e, id) => {
    const key = String(id || '');
    const list = loadGroups().filter(g => g.id !== key && g.tiktokId !== key);
    // Unset groupId trên creator thuộc group này
    const creators = loadCreators().map(c => c.groupId === id ? { ...c, groupId: '' } : c);
    saveCreators(creators);
    saveGroups(list);
    rankingEngine?._emit();
    return list;
  });

  // PK Duo
  ipcMain.handle('pkduo:getState', () => pkDuoEngine.getStateForOverlay());
  ipcMain.handle('pkduo:setConfig', (_e, cfg) => { pkDuoEngine.setConfig(cfg); savePkDuoConfig(pkDuoEngine.config); return pkDuoEngine.config; });
  ipcMain.handle('pkduo:start', () => { pkDuoEngine.start(); return true; });
  ipcMain.handle('pkduo:stop', () => { pkDuoEngine.stop(); return true; });
  ipcMain.handle('pkduo:reset', () => { pkDuoEngine.reset(); return true; });
  ipcMain.handle('pkduo:addPoints', (_e, { side, points }) => { pkDuoEngine.addPoints(side, points); return true; });
  ipcMain.handle('pkduo:getUrl', () => overlayServer.getPkDuoUrl());

  // PK Group
  ipcMain.handle('pkgroup:getState', () => pkGroupEngine.getStateForOverlay());
  ipcMain.handle('pkgroup:setConfig', (_e, cfg) => { pkGroupEngine.setConfig(cfg); savePkGroupConfig(pkGroupEngine.config); return pkGroupEngine.config; });
  ipcMain.handle('pkgroup:start', () => { pkGroupEngine.start(); return true; });
  ipcMain.handle('pkgroup:stop', () => { pkGroupEngine.stop(); return true; });
  ipcMain.handle('pkgroup:reset', () => { pkGroupEngine.reset(); return true; });
  ipcMain.handle('pkgroup:addPoints', (_e, { id, points }) => { pkGroupEngine.addPoints(id, points); return true; });
  ipcMain.handle('pkgroup:testGift', (_e, { id }) => pkGroupEngine.testGift(id));
  ipcMain.handle('pkgroup:getUrl', () => overlayServer.getPkGroupUrl());

  // Ranking
  ipcMain.handle('ranking:getState', () => {
    scheduleCreatorAvatarRefresh();
    return rankingEngine.getStateForOverlay();
  });
  ipcMain.handle('ranking:setConfig', (_e, cfg) => {
    rankingEngine.setConfig(cfg);
    settings.ranking = { ...rankingEngine.config };
    saveSettings();
    scheduleCreatorAvatarRefresh();
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
  ipcMain.handle('review:getState', () => getReviewState());

  // Settings
  ipcMain.handle('settings:get', () => ({
    lastUsername: settings.lastUsername,
    signApiKey: settings.signApiKey ? '•••' : '',
    sessionId: settings.sessionId ? '•••' : '',
    ttTargetIdc: settings.ttTargetIdc,
    overlayPort: settings.overlayPort,
    overlay: { ...(settings.overlay || {}) },
    audio: { ...(settings.audio || {}) },
    scoreLinkRanking: !!settings.scoreLinkRanking,
    scoreLinkVoteLock: !!settings.scoreLinkVoteLock,
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
      if (typeof patch.scoreLinkRanking === 'boolean') settings.scoreLinkRanking = patch.scoreLinkRanking;
      if (typeof patch.scoreLinkVoteLock === 'boolean') settings.scoreLinkVoteLock = patch.scoreLinkVoteLock;
      saveSettings();
    }
    return true;
  });

  // License + updates
  ipcMain.handle('license:get', () => ({ ...(settings.license || {}), deviceId: getDeviceId(), appVersion: app.getVersion() }));
  ipcMain.handle('license:activate', async (_e, key) => validateLicenseKey(key));
  ipcMain.handle('license:check', async () => checkStoredLicense());
  ipcMain.handle('license:clear', () => {
    settings.license = { key: '', vip: '', expiresAt: '', status: '', activatedAt: 0, checkedAt: 0, deviceId: getDeviceId() };
    saveSettings();
    return { ok: true, license: settings.license };
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
  ipcMain.handle('shell:pickAudio', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Chọn file âm thanh',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }],
    });
    if (r.canceled || !r.filePaths?.[0]) return '';
    return r.filePaths[0];
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
    if (!file || !fs.existsSync(file)) return;
    event.sender.startDrag({ file, icon: file });
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
