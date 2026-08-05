// HP GROUP LIVE — Electron main process.
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
const hostsSetup = require('./hosts-setup');

const ROOT = path.join(__dirname, '..');
// Đổi tên hiển thị app → "HP GROUP LIVE" NHƯNG giữ nguyên thư mục dữ liệu cũ.
// Electron lấy userData theo app.getName() (= productName). Đổi productName sẽ trỏ userData sang
// thư mục mới và bỏ rơi toàn bộ config cũ ở %APPDATA%/HP Talent Show. Ghim lại về tên cũ để bản
// cập nhật đọc đúng creators/groups/settings đã lưu (phải đặt TRƯỚC khi gọi getPath('userData')).
try { app.setPath('userData', path.join(app.getPath('appData'), 'HP Talent Show')); } catch {}
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
// Assets đóng gói kèm app (extraResources → resources/assets khi cài; ./assets khi chạy dev).
const SHIPPED_ASSETS_DIR = app.isPackaged ? path.join(process.resourcesPath, 'assets') : path.join(ROOT, 'assets');
// Âm thanh "trước khi phát hiệu ứng" mặc định đi kèm bản cài (mỗi máy tự có, không cần chọn file).
const DEFAULT_PRE_EFFECT_SOUND = path.join(SHIPPED_ASSETS_DIR, 'sounds', 'ping-nhacho.mp3');
const SETTINGS_PATH = path.join(CONFIG_DIR, 'settings.json');
const CREATORS_PATH = path.join(CONFIG_DIR, 'creators.json');
const GROUPS_PATH = path.join(CONFIG_DIR, 'groups.json');
const PK_DUO_PATH = path.join(CONFIG_DIR, 'pk-duo.json');
const KC_DUO_PATH = path.join(CONFIG_DIR, 'kc-duo.json');
const PK_GROUP_PATH = path.join(CONFIG_DIR, 'pk-group.json');
const MUSIC_LIST_PATH = path.join(CONFIG_DIR, 'music-list.json');
const STICKER_PATH = path.join(CONFIG_DIR, 'sticker-dance.json');
const MVP_HONOR_PATH = path.join(CONFIG_DIR, 'mvp-honor.json');
const LUCKY_WHEEL_PATH = path.join(CONFIG_DIR, 'lucky-wheel.json');
const GIFT_MENU_PATH = path.join(CONFIG_DIR, 'gift-menu.json');
const INTERACT_PATH = path.join(CONFIG_DIR, 'interact-feed.json');
const DANCE_VIDEO_PATH = path.join(CONFIG_DIR, 'dance-video.json');
const GROUP_PROFILES_PATH = path.join(CONFIG_DIR, 'group-profiles.json');
const MATCH_HISTORY_PATH = path.join(CONFIG_DIR, 'match-history.json');
const SCORE_HISTORY_PATH = path.join(CONFIG_DIR, 'score-history.json');
const RANKING_HISTORY_PATH = path.join(CONFIG_DIR, 'ranking-history.json');
const RANKING_APPLY_LOG_PATH = path.join(CONFIG_DIR, 'ranking-apply-log.json');
// Trạng thái ĐANG CHẠY (điểm số LIVE của các engine) — ghi liên tục để chống mất khi văng/mất điện.
const LIVE_RUNTIME_PATH = path.join(CONFIG_DIR, 'live-runtime.json');
const KC_DATA_PATH = path.join(CONFIG_DIR, 'kc-data.json');
const KC_MONTHS_PATH = path.join(CONFIG_DIR, 'kc-months.json');
const GIFT_MASTER_PATH = path.join(CONFIG_DIR, 'gift-master.json');
const SHIPPED_GIFT_MASTER_PATH = path.join(SHIPPED_CONFIG_DIR, 'gift-master.json');
const GIFT_MASTER_SHEET = 'https://docs.google.com/spreadsheets/d/1Fv9Jdno_pPMTx_-tnwSfRObm1r1wKds_gaMBnfCDm4M/gviz/tq?tqx=out:csv&sheet=DANH%20SACH%20QUA';
const GITHUB_RELEASES_API = 'https://api.github.com/repos/hpmediaoffifical/H-P-T-a-l-e-n-t-S-h-o-w/releases/latest';
const GITHUB_RELEASES_URL = 'https://github.com/hpmediaoffifical/H-P-T-a-l-e-n-t-S-h-o-w/releases/latest';
const BANNER_SHEET = 'https://docs.google.com/spreadsheets/d/1g0oNn60BJjp5s8SN_7_vrrUPidw8HtX0xKsS2OP0waM/gviz/tq?tqx=out:csv&sheet=Banner';
const TICKER_SHEET = 'https://docs.google.com/spreadsheets/d/1g0oNn60BJjp5s8SN_7_vrrUPidw8HtX0xKsS2OP0waM/gviz/tq?tqx=out:csv&sheet=CH%E1%BB%AE%20TH%C3%94NG%20B%C3%81O';
// KIM CƯƠNG TỔNG: sheet DAILY DATA — cột C = username (khớp tiktokId nhóm), cột H = Kim cương, cột A = giai đoạn.
const DAILY_DATA_SHEET = 'https://docs.google.com/spreadsheets/d/1QhB83R3hHM8giqpiVPkxI27WYigg0yH4n_B9dtQSF9Y/gviz/tq?tqx=out:csv&sheet=DAILY%20DATA';
// Các sheet "THÁNG 1".."THÁNG 12" — cùng cấu trúc DAILY DATA. Dùng cho chart 6 tháng ở Hồ Sơ Nhóm.
const MONTHLY_SHEET = (m) => `https://docs.google.com/spreadsheets/d/1QhB83R3hHM8giqpiVPkxI27WYigg0yH4n_B9dtQSF9Y/gviz/tq?tqx=out:csv&sheet=TH%C3%81NG%20${m}`;
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
let isQuitting = false; // true khi app đang thoát theo chương trình → bỏ qua hộp thoại xác nhận đóng
let quitPromptOpen = false; // true khi popup xác nhận thoát (renderer) đang mở → tránh gửi trùng
let ttClient = null;

// Dialog gốc — chỉ dùng khi renderer không hiển thị được popup đẹp (treo/đang tải/crash).
function nativeQuitConfirm() {
  if (!win || win.isDestroyed()) return;
  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: ['Thoát hẳn', 'Hủy'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'Thoát HP GROUP LIVE?',
    message: 'Bạn có chắc muốn thoát ứng dụng?',
    detail: 'Khi thoát, overlay OBS và các cửa sổ popup (Review) sẽ NGƯNG hoạt động.',
  });
  if (choice === 0) { isQuitting = true; app.quit(); }
}

// Kết quả popup thoát từ renderer: true = Thoát hẳn, false = Ở lại.
ipcMain.on('app:confirmQuitResult', (_e, ok) => {
  quitPromptOpen = false;
  if (ok) { isQuitting = true; app.quit(); }
  else if (win && !win.isDestroyed()) win.focus();
});
let overlayServer = null;
let pkDuoEngine = null;
let kcDuoEngine = null;
let pkGroupEngine = null;
let rankingEngine = null;
let scoreEngine = null;
let stickerEngine = null;
let mvpHonorEngine = null;
let luckyWheelEngine = null;
let missionTrioEngine = null;
let cardFlipEngine = null;
let danceVideoEngine = null;
// Menu Quà (thông tin quà) — chỉ hiển thị, không có engine/game state: config CHÍNH là state overlay.
let giftMenuConfig = { items: [] };
// TƯƠNG TÁC + QUÀ (overlay gộp chat + quà thành 1 cột dọc 1080×1920). Config CHÍNH là state overlay.
const INTERACT_DEFAULT = {
  showGift: true,      // 🎁 QUÀ TẶNG (cột trên)
  showChat: true,      // 💬 TƯƠNG TÁC (cột dưới)
  splitRatio: 0.5,     // tỉ lệ chiều cao dành cho cột QUÀ (0.1..0.9) — kéo vạch chia để đổi
  newest: 'top',       // vị trí bình luận/quà MỚI: 'top' (trên cùng) | 'bottom' (dưới cùng)
  bgColor: '#000000',
  bgOpacity: 55,       // 0..100 (độ đậm nền)
  avatarSize: 56,
  nameSize: 30,
  commentSize: 34,     // cỡ chữ bình luận
  giftSize: 32,        // cỡ chữ dòng quà (tên quà / số lần / KC)
  showAvatar: true,    // hiện avatar
  showGiftName: true,  // hiện tên quà (cạnh icon)
  showRepeat: true,    // hiện số lần tặng
  showCoin: true,      // hiện số KC
};
let interactConfig = { ...INTERACT_DEFAULT };
let settings = loadSettings();
const reviewWindows = new Map();
let playlistWindow = null; // Cửa sổ DANH SÁCH PHÁT tách rời (chỉ xem), nhận dữ liệu realtime từ renderer chính.

// =================================================================
// JSON store helpers
// =================================================================
function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function saveJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const json = JSON.stringify(data, null, 2);
  // Ghi NGUYÊN TỬ: ghi ra file tạm rồi đổi tên (rename thay thế nguyên tử trên Windows qua libuv).
  // → crash/tắt máy/mất điện giữa chừng KHÔNG làm hỏng file cũ (chỉ mất lần ghi mới nhất).
  const tmp = p + '.tmp';
  try {
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, p);
  } catch {
    // Dự phòng: rename lỗi (file bị khoá bởi antivirus/OneDrive…) → ghi thẳng (không tệ hơn cách cũ).
    try { fs.writeFileSync(p, json, 'utf8'); } catch {}
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
  }
}
function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// =================================================================
// LƯU TRẠNG THÁI ĐANG CHẠY (điểm số LIVE) — chống mất khi văng/mất điện
// -----------------------------------------------------------------
// Cấu hình (config) của mỗi engine đã được lưu file riêng, NHƯNG điểm số tích
// luỹ realtime (this.scores / this.state) chỉ nằm trong RAM → văng đột ngột là
// mất sạch, mở lại chỉ còn snapshot cũ. Ở đây ghi LIÊN TỤC toàn bộ state runtime
// của Ranking/Tính điểm/PK Đôi/Giữ-Đổi/PK Nhóm xuống live-runtime.json (ghi
// nguyên tử qua saveJson) rồi KHÔI PHỤC khi mở lại → dù crash vẫn tiếp tục đúng
// điểm ngay thời điểm đó (tối đa mất ~0.6s do gộp ghi, flush=0 khi thoát êm).
let _runtimeSaveTimer = null;
let _runtimeDirty = false;
function collectLiveRuntime() {
  const out = { savedAt: Date.now(), v: 1 };
  try { if (rankingEngine) out.ranking = rankingEngine.snapshotRuntime(); } catch {}
  try { if (scoreEngine) out.score = scoreEngine.snapshotRuntime(); } catch {}
  try { if (pkDuoEngine) out.pkduo = pkDuoEngine.snapshotRuntime(); } catch {}
  try { if (kcDuoEngine) out.kcduo = kcDuoEngine.snapshotRuntime(); } catch {}
  try { if (pkGroupEngine) out.pkgroup = pkGroupEngine.snapshotRuntime(); } catch {}
  return out;
}
function saveLiveRuntimeNow() {
  _runtimeDirty = false;
  if (_runtimeSaveTimer) { clearTimeout(_runtimeSaveTimer); _runtimeSaveTimer = null; }
  try { saveJson(LIVE_RUNTIME_PATH, collectLiveRuntime()); } catch {}
}
// Gộp các nhịp emit dồn dập (ticker 250ms + bão quà) thành tối đa 1 lần ghi / 600ms.
// KHÔNG reset timer mỗi lần gọi → luôn có mốc ghi trong vòng 600ms kể cả khi hoạt động liên tục.
function scheduleLiveRuntimeSave() {
  _runtimeDirty = true;
  if (_runtimeSaveTimer) return;
  _runtimeSaveTimer = setTimeout(() => { _runtimeSaveTimer = null; if (_runtimeDirty) saveLiveRuntimeNow(); }, 600);
}
function flushLiveRuntime() { if (_runtimeDirty || _runtimeSaveTimer) saveLiveRuntimeNow(); }
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
    lastActiveGroupId: null,
    talentShowUsername: '',
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
    // Tự nhận diện Creator NHẬN quà trong LIVE nhóm (theo toUserId) → tự cộng điểm, khỏi chọn phe.
    autoRecognizeRecipient: true,
    missionTrio: null,
    cardFlip: null,
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
      preEffectSound: DEFAULT_PRE_EFFECT_SOUND, // mặc định = âm "ping" đóng gói kèm app
      preEffectVolume: 100,
      preEffectEnabled: true,
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
  return ensureDefaultSounds({ ...def, ...raw });
}
// Đảm bảo âm "trước hiệu ứng" mặc định (ping) luôn có trên mọi máy:
//  - Chưa chọn gì → dùng ping đóng gói + bật sẵn.
//  - Đang trỏ tới ping cũ nhưng file không còn (app di chuyển/cài lại) → trỏ lại ping hiện tại.
function ensureDefaultSounds(s) {
  try {
    const a = s.audio = s.audio || {};
    const cur = String(a.preEffectSound || '').replace(/^file:\/\/\//i, '');
    if (!cur) { a.preEffectSound = DEFAULT_PRE_EFFECT_SOUND; if (a.preEffectEnabled == null) a.preEffectEnabled = true; }
    else if (/ping-nhacho\.mp3$/i.test(cur) && !fs.existsSync(cur) && fs.existsSync(DEFAULT_PRE_EFFECT_SOUND)) {
      a.preEffectSound = DEFAULT_PRE_EFFECT_SOUND;
    }
  } catch {}
  return s;
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
  const res = await fetch(GITHUB_RELEASES_API, { headers: { 'User-Agent': 'HP GROUP LIVE' } });
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
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const tryUnlink = (p) => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} };
  const safeName = String(assetName || path.basename(new URL(downloadUrl).pathname) || 'HP-GROUP-LIVE-Setup.exe').replace(/[\\/:*?"<>|]/g, '_');
  // Dọn rác lần cập nhật trước (bản .part dở hoặc .exe cùng tên còn bị khoá) để rename không đụng file cũ.
  tryUnlink(path.join(dir, safeName));
  tryUnlink(path.join(dir, safeName + '.part'));
  // Nếu .exe cũ vẫn còn (không xoá nổi vì bị khoá) thì chọn tên đích khác để rename không thất bại.
  let file = path.join(dir, safeName);
  if (fs.existsSync(file)) {
    const ext = path.extname(safeName), stem = safeName.slice(0, safeName.length - ext.length);
    for (let i = 1; i < 50 && fs.existsSync(file); i++) file = path.join(dir, `${stem}-${i}${ext}`);
  }
  const tmp = file + '.part';
  tryUnlink(tmp);
  // fetch (undici) tự theo chuỗi redirect (github.com → release-assets.githubusercontent.com).
  const res = await fetch(downloadUrl, { headers: { 'User-Agent': 'HP GROUP LIVE' }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error('Không tải được bản cập nhật HTTP ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0;
  const sendProgress = (received, pct) => { try { win?.webContents?.send('updates:progress', { received, total, pct }); } catch {} };
  // Tải theo LUỒNG ghi thẳng ra đĩa (không buffer cả file vào RAM) + báo tiến độ % cho renderer.
  const { once } = require('events');
  const out = fs.createWriteStream(tmp);
  let received = 0, lastPct = -1, lastAt = 0;
  sendProgress(0, 0);
  try {
    for await (const chunk of res.body) {
      received += chunk.length;
      if (!out.write(chunk)) await once(out, 'drain');
      const pct = total ? Math.floor(received / total * 100) : 0;
      const now = Date.now();
      if (pct !== lastPct && now - lastAt >= 120) { lastPct = pct; lastAt = now; sendProgress(received, pct); }
    }
    out.end();
    await once(out, 'finish');
  } catch (e) {
    out.destroy();
    try { fs.unlinkSync(tmp); } catch {}
    throw new Error('Tải bản cập nhật bị gián đoạn: ' + (e.message || e));
  }
  // Đổi tên .part -> .exe. Antivirus (Defender…) hay quét & khoá file .exe vừa ghi xong,
  // khiến rename ném EPERM tức thời -> thử lại nhiều lần với backoff cho AV nhả file.
  let renamed = false, lastErr = null;
  for (let i = 0; i < 10; i++) {
    try { fs.renameSync(tmp, file); renamed = true; break; }
    catch (e) { lastErr = e; await sleep(300 + i * 250); }
  }
  // Dự phòng: rename mãi không được thì copy nội dung sang file đích rồi xoá .part.
  if (!renamed) {
    try { fs.copyFileSync(tmp, file); tryUnlink(tmp); renamed = true; }
    catch (e) { lastErr = e; }
  }
  if (!renamed) {
    tryUnlink(tmp);
    // Cùng đường: mở trang tải để cài thủ công + gợi ý loại trừ thư mục khỏi antivirus.
    try { await shell.openExternal(GITHUB_RELEASES_URL); } catch {}
    throw new Error('Không đổi tên được bản cập nhật (bị phần mềm diệt virus khoá file). '
      + 'Hãy tải & cài thủ công từ trang vừa mở, hoặc loại trừ thư mục cập nhật khỏi antivirus. Chi tiết: '
      + (lastErr?.message || lastErr));
  }
  sendProgress(total || received, 100);
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
  kcduo: { title: 'Review Giữ/Đổi', getUrl: () => overlayServer?.getKcDuoUrl(), width: 900, height: 320 },
  pkduofx: { title: 'Review PK Đôi FX', getUrl: () => overlayServer?.getPkDuoFxUrl(), width: 338, height: 600 },
  pkgroup: { title: 'Review PK Nhóm', getUrl: () => overlayServer?.getPkGroupUrl(), width: 1280, height: 420 },
  score: { title: 'Review Tính điểm', getUrl: () => overlayServer?.getScoreUrl(), width: 900, height: 300 },
  scorebar: { title: 'Review Tính điểm · ĐƯỜNG ĐUA', getUrl: () => overlayServer?.getScoreBarUrl(), width: 900, height: 300 },
  scorecard: { title: 'Review Tính điểm · KÊU GỌI', getUrl: () => overlayServer?.getScoreCardUrl(), width: 520, height: 360 },
  scoretimer: { title: 'Review Tính điểm · THỜI GIAN', getUrl: () => overlayServer?.getScoreTimerUrl(), width: 900, height: 260 },
  ranking: { title: 'Review Thi đấu', getUrl: () => overlayServer?.getRankingUrl(), width: 420, height: 900 },
  rankinggrid: { title: 'Review Thi đấu ngang', getUrl: () => overlayServer?.getRankingUrl() + '&grid=1', width: 1280, height: 520 },
  stickerdance: { title: 'Review Đập Trứng', getUrl: () => overlayServer?.getStickerUrl(), width: 900, height: 380 },
  mvphonor: { title: 'Review MVP Honor', getUrl: () => overlayServer?.getMvpHonorUrl(), width: 540, height: 720 },
  luckywheel: { title: 'Review Vòng Quay', getUrl: () => overlayServer?.getLuckyWheelUrl(), width: 760, height: 760 },
  giftmenu: { title: 'Review Menu Quà', getUrl: () => overlayServer?.getGiftMenuUrl(), width: 520, height: 760 },
  missiontrio: { title: 'Review NHIỆM VỤ · BỘ BA', getUrl: () => overlayServer?.getMissionTrioUrl(), width: 720, height: 320 },
  cardflip: { title: 'Review THẺ BÀI', getUrl: () => overlayServer?.getCardFlipUrl(), width: 1040, height: 320 },
  cardflipfx: { title: 'Review THẺ BÀI · Lật 3D', getUrl: () => overlayServer?.getCardFlipFxUrl(), width: 720, height: 405 },
  dancevideo: { title: 'Review NHẠC DANCE · WEBM 1', getUrl: () => overlayServer?.getDanceVideoUrl('webm1'), width: 540, height: 960 },
  dancevideo2: { title: 'Review NHẠC DANCE · WEBM 2', getUrl: () => overlayServer?.getDanceVideoUrl('webm2'), width: 540, height: 960 },
  dancevideo3: { title: 'Review NHẠC DANCE · WEBM 3', getUrl: () => overlayServer?.getDanceVideoUrl('webm3'), width: 540, height: 960 },
  interact: { title: 'Review TƯƠNG TÁC + QUÀ', getUrl: () => overlayServer?.getInteractUrl(), width: 432, height: 768 },
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

// ===== Cửa sổ DANH SÁCH PHÁT tách rời (chỉ xem) =====
// Mở 1 cửa sổ độc lập hiển thị y hệt DANH SÁCH PHÁT (đang phát + hàng chờ). Dữ liệu do renderer
// chính đẩy sang qua 'playlist:push' (main chuyển tiếp vào 'playlist:update'). Mở lần nữa = focus.
function openPlaylistWindow() {
  if (playlistWindow && !playlistWindow.isDestroyed()) { playlistWindow.show(); playlistWindow.focus(); requestPlaylistState(); return { ok: true, open: true }; }
  const saved = isUsableWindowBounds(settings.playlistWindowBounds) ? settings.playlistWindowBounds : {};
  playlistWindow = new BrowserWindow({
    width: saved.width || 460,
    height: saved.height || 640,
    x: saved.x, y: saved.y,
    minWidth: 300,
    minHeight: 260,
    resizable: true,
    movable: true,
    skipTaskbar: false,
    title: 'DANH SÁCH PHÁT — HP GROUP LIVE',
    backgroundColor: '#1a1330',
    icon: APP_ICON || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  playlistWindow.removeMenu();
  playlistWindow.loadFile(path.join(ROOT, 'renderer', 'playlist-window.html'));
  let ptimer = null;
  const saveBounds = () => {
    if (!playlistWindow || playlistWindow.isDestroyed()) return;
    settings.playlistWindowBounds = playlistWindow.getBounds();
    saveSettings();
  };
  const schedule = () => { clearTimeout(ptimer); ptimer = setTimeout(saveBounds, 300); };
  playlistWindow.on('move', schedule);
  playlistWindow.on('resize', schedule);
  playlistWindow.on('close', saveBounds);
  playlistWindow.on('closed', () => { playlistWindow = null; });
  // Nạp xong → xin renderer chính đẩy trạng thái hiện tại sang ngay.
  playlistWindow.webContents.on('did-finish-load', () => requestPlaylistState());
  return { ok: true, open: true };
}
// Nhờ renderer chính gửi lại trạng thái DANH SÁCH PHÁT hiện tại (để cửa sổ mới có nội dung ngay).
function requestPlaylistState() { try { if (win && !win.isDestroyed()) win.webContents.send('playlist:requestState'); } catch {} }

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
function saveCreators(list) { saveJson(CREATORS_PATH, list); _creatorUserIdMap = null; _creatorNameIndex = null; _creatorByIdMap = null; }

// Tổng MVP PK Nhóm tách khỏi `streak`: mỗi Creator có một tổng riêng cho từng nhóm để đổi
// nhóm không làm lẫn thành tích. Không suy diễn từ chuỗi cũ vì chuỗi không phải tổng số MVP.
const PKG_MVP_DEFAULT_GROUP = '__default__';
const PKG_MVP_TOTAL_MAX = 999999;
function pkGroupMvpKey(groupId) { return String(groupId || PKG_MVP_DEFAULT_GROUP); }
function normalizePkGroupMvpTotal(value) {
  return Math.max(0, Math.min(PKG_MVP_TOTAL_MAX, Math.floor(Number(value) || 0)));
}
function getPkGroupMvpTotal(creator, groupId) {
  const totals = creator?.pkGroupMvpTotals;
  if (!totals || typeof totals !== 'object' || Array.isArray(totals)) return 0;
  return normalizePkGroupMvpTotal(totals[pkGroupMvpKey(groupId)]);
}
function setPkGroupMvpTotal(creatorId, groupId, total) {
  const cid = String(creatorId || '');
  if (!cid) return null;
  const list = loadCreators();
  const index = list.findIndex(c => String(c.id || '') === cid);
  if (index < 0) return null;
  const key = pkGroupMvpKey(groupId);
  const creator = list[index];
  const totals = creator.pkGroupMvpTotals && typeof creator.pkGroupMvpTotals === 'object' && !Array.isArray(creator.pkGroupMvpTotals)
    ? { ...creator.pkGroupMvpTotals }
    : {};
  const next = normalizePkGroupMvpTotal(total);
  totals[key] = next;
  list[index] = { ...creator, pkGroupMvpTotals: totals };
  saveCreators(list);
  return { creatorId: cid, groupId: key, total: next };
}
function addPkGroupMvpTotal(creatorId, groupId, delta = 1) {
  const creator = getCreatorById(creatorId);
  if (!creator) return null;
  return setPkGroupMvpTotal(creator.id, groupId, getPkGroupMvpTotal(creator, groupId) + (Number(delta) || 0));
}

// Nhận diện Creator NHẬN quà trong LIVE nhóm từ gift event (toMemberId + toMemberNickname).
// Cache lười, tự huỷ khi creators đổi (saveCreators).
let _creatorUserIdMap = null;   // userId(số) → creatorId
let _creatorNameIndex = null;   // [{ id, userId, keys:[tên chuẩn hoá...] }]
let _creatorByIdMap = null;     // creatorId → creator (tra O(1), tránh đọc đĩa mỗi nhịp quà ở addLivePoints)
let _learnRecipientArmed = false; // "Học ID": true = chộp recipientMemberId của quà kế tiếp

// Chuẩn hoá tên để khớp mềm: bỏ dấu tiếng Việt, emoji, khoảng trắng/ký tự lạ, thường hoá.
function normRecipientName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');
}
function buildCreatorIndex() {
  if (_creatorUserIdMap && _creatorNameIndex && _creatorByIdMap) return;
  _creatorUserIdMap = new Map();
  _creatorNameIndex = [];
  _creatorByIdMap = new Map();
  for (const c of loadCreators()) {
    if (!c || !c.id) continue;
    _creatorByIdMap.set(String(c.id), c);
    if (c.userId) _creatorUserIdMap.set(String(c.userId), c.id);
    const keys = [...new Set([normRecipientName(c.nickname), normRecipientName(c.channelName), normRecipientName(c.tiktokId)].filter(k => k && k.length >= 2))];
    _creatorNameIndex.push({ id: c.id, userId: c.userId ? String(c.userId) : '', keys });
  }
}
// Tra Creator theo id có CACHE (buildCreatorIndex tự dựng, saveCreators tự huỷ). Dùng cho hot-path
// addLivePoints để không đọc đĩa mỗi nhịp quà khi Liên kết bật + nhiều nhóm/Creator.
function getCreatorById(id) {
  const key = String(id || '');
  if (!key) return null;
  buildCreatorIndex();
  return _creatorByIdMap.get(key) || null;
}
// Ghi userId (đã học từ luồng gift) vào Creator để lần sau khớp CHÍNH XÁC theo ID.
function learnCreatorUserId(creatorId, userId) {
  try {
    const list = loadCreators();
    const idx = list.findIndex(c => c.id === creatorId);
    if (idx < 0 || String(list[idx].userId || '') === String(userId)) return;
    list[idx].userId = String(userId);
    saveCreators(list);
  } catch {}
}
// Trả creatorId của người nhận quà: ưu tiên ID số (toMemberId), fallback khớp TÊN co-host (tự học ID).
function resolveRecipientCreatorId(ev) {
  const mid = ev.recipientMemberId;
  const mname = ev.recipientMemberName;
  if (!mid && !mname) return '';
  buildCreatorIndex();
  if (mid && _creatorUserIdMap.has(String(mid))) return _creatorUserIdMap.get(String(mid));
  if (mname) {
    const n = normRecipientName(mname);
    if (n.length >= 2) {
      for (const c of _creatorNameIndex) {
        if (c.keys.some(k => n === k || n.includes(k) || k.includes(n))) {
          if (mid && c.userId !== String(mid)) learnCreatorUserId(c.id, String(mid)); // tự học
          return c.id;
        }
      }
    }
  }
  return '';
}
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
function loadKcDuoConfig() { return loadJson(KC_DUO_PATH, null); }
function saveKcDuoConfig(cfg) { saveJson(KC_DUO_PATH, cfg); }
// Ghi chú PK Nhóm: các câu MẶC ĐỊNH CŨ → tự nâng cấp sang câu mới khi load (chỉ đổi nếu đang là
// text mặc định cũ; user tự sửa thì giữ nguyên). Giúp máy đang cài text cũ tự cập nhật sau khi mở app.
const PKG_OLD_NOTES = [
  'Tặng quà chỉ định để chọn Creator (vẫn được tính điểm), sau đó lên gì cũng tính cho Creator đó. Tặng quà Creator khác để chuyển, hết trận sẽ tự hủy',
  'Tặng 01 quà để chọn Creator, sau đó lên gì cũng tính điểm. Tặng lần 2 hoặc quà Creator khác để hủy bỏ hoặc hết trận sẽ tự hủy',
];
const PKG_NEW_NOTE = 'Chọn Creator tại hộp quà tặng trong App trước khi tặng quà để đảm bảo điểm hoạt động đúng tính năng';
function loadPkGroupConfig() {
  const cfg = loadJson(PK_GROUP_PATH, null);
  if (cfg && typeof cfg.noteText === 'string' && PKG_OLD_NOTES.includes(cfg.noteText.trim())) cfg.noteText = PKG_NEW_NOTE;
  return cfg;
}
function savePkGroupConfig(cfg) { saveJson(PK_GROUP_PATH, cfg); }
function loadMusicList() { return loadJson(MUSIC_LIST_PATH, null); }
function saveMusicList(cfg) { saveJson(MUSIC_LIST_PATH, cfg); }
function loadStickerConfig() { return loadJson(STICKER_PATH, null); }
function saveStickerConfig(cfg) { saveJson(STICKER_PATH, cfg); }
function loadMvpHonorConfig() { return loadJson(MVP_HONOR_PATH, null); }
function saveMvpHonorConfig(cfg) { saveJson(MVP_HONOR_PATH, cfg); }
function loadLuckyWheelConfig() { return loadJson(LUCKY_WHEEL_PATH, null); }
function saveLuckyWheelConfig(cfg) { saveJson(LUCKY_WHEEL_PATH, cfg); }
function loadGiftMenuConfig() { return loadJson(GIFT_MENU_PATH, null); }
function saveGiftMenuConfig(cfg) { saveJson(GIFT_MENU_PATH, cfg); }
function loadInteractConfig() { return loadJson(INTERACT_PATH, null); }
function saveInteractConfig(cfg) { saveJson(INTERACT_PATH, cfg); }
// Chuẩn hoá config overlay TƯƠNG TÁC: kẹp số về khoảng hợp lệ + BẮT BUỘC ≥1 cột bật (không tắt cả 2).
function normalizeInteractConfig(raw) {
  const c = { ...INTERACT_DEFAULT, ...(raw && typeof raw === 'object' ? raw : {}) };
  let showGift = c.showGift !== false;
  let showChat = c.showChat !== false;
  if (!showGift && !showChat) showChat = true; // không cho tắt cả 2
  const clamp = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; };
  return {
    showGift, showChat,
    splitRatio: clamp(c.splitRatio, 0.1, 0.9, INTERACT_DEFAULT.splitRatio),
    newest: c.newest === 'bottom' ? 'bottom' : 'top',
    bgColor: /^#[0-9a-f]{6}$/i.test(String(c.bgColor)) ? c.bgColor : INTERACT_DEFAULT.bgColor,
    bgOpacity: Math.round(clamp(c.bgOpacity, 0, 100, INTERACT_DEFAULT.bgOpacity)),
    avatarSize: Math.round(clamp(c.avatarSize, 20, 140, INTERACT_DEFAULT.avatarSize)),
    nameSize: Math.round(clamp(c.nameSize, 14, 80, INTERACT_DEFAULT.nameSize)),
    commentSize: Math.round(clamp(c.commentSize, 14, 90, INTERACT_DEFAULT.commentSize)),
    giftSize: Math.round(clamp(c.giftSize, 14, 90, INTERACT_DEFAULT.giftSize)),
    showAvatar: c.showAvatar !== false,
    showGiftName: c.showGiftName !== false,
    showRepeat: c.showRepeat !== false,
    showCoin: c.showCoin !== false,
  };
}
function loadDanceVideoConfig() { return loadJson(DANCE_VIDEO_PATH, null); }
function saveDanceVideoConfig(cfg) { saveJson(DANCE_VIDEO_PATH, cfg); }

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
  // Trận này kết thúc khi đang BẬT Liên kết THI ĐẤU NHÓM? → điểm đã cộng LIVE (và có thể Chốt vòng).
  // Ghi cờ để khi áp điểm từ Lịch sử sẽ CẢNH BÁO tránh cộng ĐÔI. (Toggle giữa trận là ca hiếm.)
  try {
    const links = getRankingLinks();
    entry.liveLinked = entry.type === 'group' ? !!links.pkgroup : (entry.type === 'duo' ? !!links.pkduo : false);
  } catch {}
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

// =================================================================
// LIÊN KẾT ĐIỂM: cộng điểm 1 trận PK (Đôi/Nhóm) vào THI ĐẤU NHÓM.
// Nguyên tắc an toàn:
//  - Nguồn chuẩn = match-history (mỗi trận có id riêng).
//  - Idempotent: trận đã áp (match.applied) thì KHÔNG cộng lần 2.
//  - Có audit trail: mỗi Creator được cộng đều ghi gameplayHistory kèm matchId.
//  - Hoàn tác được: match.applied.entries lưu đúng delta đã cộng cho từng Creator
//    → khi hoàn tác chỉ việc trừ lại đúng số đó.
// =================================================================
function _normName(s) { return String(s || '').trim().toLowerCase(); }

// Tìm Creator khớp cho 1 participant. Ưu tiên: chỉ định tay (mapping) → tiktokId → tên.
function _resolveCreatorForParticipant(creators, participant, index, mapping) {
  const forcedId = mapping ? (mapping[String(index)] ?? mapping[participant.tiktokId]) : null;
  if (forcedId) {
    const hit = creators.find(c => c.id === forcedId || c.tiktokId === forcedId);
    if (hit) return hit;
  }
  const tik = _normName(participant.tiktokId);
  if (tik) {
    const hit = creators.find(c => _normName(c.tiktokId) === tik);
    if (hit) return hit;
  }
  const nm = _normName(participant.name);
  if (nm) {
    const hit = creators.find(c => _normName(c.nickname) === nm || _normName(c.tiktokId) === nm);
    if (hit) return hit;
  }
  return null;
}

// Cộng điểm trận vào contestPoints của Creator. mapping (tùy chọn, dùng cho PK Đôi):
//   { "<chỉ số phe>": creatorId } hoặc { "<tiktokId>": creatorId }.
function applyMatchPointsToRanking(matchId, mapping = {}) {
  const list = loadMatchHistory();
  const idx = list.findIndex(m => m.id === matchId);
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const match = list[idx];
  if (match.applied) return { ok: false, reason: 'already-applied' };
  // ĐẢM BẢO chỉ cộng 1 lần: trận đã cộng điểm LIVE (Liên kết bật) thì KHÔNG cho áp tay nữa (chặn hẳn,
  // không có tuỳ chọn ghi đè) → tuyệt đối không cộng đôi. Trên UI nút "Áp điểm" cũng bị ẩn cho trận này.
  if (match.liveLinked) return { ok: false, reason: 'live-linked' };
  const parts = Array.isArray(match.participants) ? match.participants : [];
  const creators = loadCreators();
  const now = Date.now();
  const label = `${match.content || (match.type === 'duo' ? 'PK ĐÔI' : 'PK NHÓM')} • vòng ${match.roundNo || 1}`;
  // Gom điểm theo creatorId (đề phòng 2 participant trỏ cùng 1 Creator).
  const byCreator = new Map(); // creatorId -> { delta }
  const unmatched = [];        // { name, score }
  parts.forEach((p, i) => {
    const score = Number(p.score) || 0;
    const cr = _resolveCreatorForParticipant(creators, p, i, mapping);
    if (!cr) { if (score !== 0) unmatched.push({ name: p.name || p.tiktokId || '?', score }); return; }
    const cur = byCreator.get(cr.id) || { delta: 0 };
    cur.delta += score;
    byCreator.set(cr.id, cur);
  });
  if (byCreator.size === 0) return { ok: false, reason: 'no-match', unmatched };
  const entries = []; // { creatorId, tiktokId, name, delta } — dùng để hoàn tác
  for (const [cid, { delta }] of byCreator) {
    const cIdx = creators.findIndex(c => c.id === cid);
    if (cIdx < 0) continue;
    const before = Number(creators[cIdx].contestPoints) || 0;
    const after = Math.max(0, before + delta);
    const realDelta = after - before;
    const hist = Array.isArray(creators[cIdx].gameplayHistory) ? creators[cIdx].gameplayHistory : [];
    creators[cIdx] = {
      ...creators[cIdx],
      contestPoints: after,
      gameplayHistory: [{ at: now, before, delta: realDelta, after, label, matchId }, ...hist].slice(0, 30),
    };
    entries.push({ creatorId: cid, tiktokId: creators[cIdx].tiktokId || '', name: creators[cIdx].nickname || creators[cIdx].tiktokId || '', delta: realDelta });
  }
  saveCreators(creators);
  match.applied = { at: now, entries };
  list[idx] = match;
  saveMatchHistory(list);
  rankingEngine?._emit();
  broadcast('history:changed', match);
  return { ok: true, applied: entries, unmatched };
}

// Hoàn tác: trừ lại đúng số điểm đã cộng ở lần áp, xoá dấu match.applied.
function unapplyMatchPointsFromRanking(matchId) {
  const list = loadMatchHistory();
  const idx = list.findIndex(m => m.id === matchId);
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const match = list[idx];
  if (!match.applied || !Array.isArray(match.applied.entries)) return { ok: false, reason: 'not-applied' };
  const creators = loadCreators();
  const now = Date.now();
  const label = `Hoàn tác: ${match.content || (match.type === 'duo' ? 'PK ĐÔI' : 'PK NHÓM')} • vòng ${match.roundNo || 1}`;
  for (const e of match.applied.entries) {
    const cIdx = creators.findIndex(c => c.id === e.creatorId || (e.tiktokId && c.tiktokId === e.tiktokId));
    if (cIdx < 0) continue;
    const before = Number(creators[cIdx].contestPoints) || 0;
    const after = Math.max(0, before - (Number(e.delta) || 0));
    const realDelta = after - before;
    const hist = Array.isArray(creators[cIdx].gameplayHistory) ? creators[cIdx].gameplayHistory : [];
    creators[cIdx] = {
      ...creators[cIdx],
      contestPoints: after,
      gameplayHistory: [{ at: now, before, delta: realDelta, after, label, matchId }, ...hist].slice(0, 30),
    };
  }
  saveCreators(creators);
  delete match.applied;
  list[idx] = match;
  saveMatchHistory(list);
  rankingEngine?._emit();
  broadcast('history:changed', match);
  return { ok: true };
}

// =================================================================
// SỔ ÁP ĐIỂM chung (Tính điểm / Đập Trứng·Dance / Chốt vòng) — mỗi lần áp là 1 "batch"
// có id riêng, lưu bền vững để đối chiếu + hoàn tác chính xác từng lần, kể cả sau khi
// khởi động lại. gameplayHistory của Creator cũng gắn applyId để soi lại.
// =================================================================
const APPLY_LOG_MAX = 500;
function loadApplyLog() { const l = loadJson(RANKING_APPLY_LOG_PATH, []); return Array.isArray(l) ? l : []; }
function saveApplyLog(list) { saveJson(RANKING_APPLY_LOG_PATH, (Array.isArray(list) ? list : []).slice(-APPLY_LOG_MAX)); }

// Cộng 1 batch delta vào contestPoints nhiều Creator + ghi sổ. rawEntries: [{ creatorId, delta }].
function applyDeltaBatchToCreators(rawEntries, { label, source }) {
  const creators = loadCreators();
  const now = Date.now();
  const applyId = uid('ap_');
  const byCreator = new Map();
  for (const e of (rawEntries || [])) {
    if (!e || !e.creatorId) continue;
    byCreator.set(e.creatorId, (byCreator.get(e.creatorId) || 0) + (Number(e.delta) || 0));
  }
  const entries = [];
  for (const [cid, delta] of byCreator) {
    if (!delta) continue;
    const cIdx = creators.findIndex(c => c.id === cid);
    if (cIdx < 0) continue;
    const before = Number(creators[cIdx].contestPoints) || 0;
    const after = Math.max(0, before + delta);
    const realDelta = after - before;
    const hist = Array.isArray(creators[cIdx].gameplayHistory) ? creators[cIdx].gameplayHistory : [];
    creators[cIdx] = {
      ...creators[cIdx],
      contestPoints: after,
      gameplayHistory: [{ at: now, before, delta: realDelta, after, label, applyId }, ...hist].slice(0, 30),
    };
    entries.push({ creatorId: cid, tiktokId: creators[cIdx].tiktokId || '', name: creators[cIdx].nickname || creators[cIdx].tiktokId || '', delta: realDelta });
  }
  if (!entries.length) return { ok: false, reason: 'no-match' };
  saveCreators(creators);
  const log = loadApplyLog();
  const batch = { id: applyId, at: now, source: source || 'manual', label: label || '', entries };
  log.push(batch);
  saveApplyLog(log);
  rankingEngine?._emit();
  return { ok: true, batch };
}

// Hoàn tác 1 batch: trừ lại đúng delta đã cộng, xoá batch khỏi sổ.
function undoApplyBatch(applyId) {
  const log = loadApplyLog();
  const idx = log.findIndex(b => b.id === applyId);
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const batch = log[idx];
  const creators = loadCreators();
  const now = Date.now();
  const label = `Hoàn tác: ${batch.label || 'áp điểm'}`;
  for (const e of (batch.entries || [])) {
    const cIdx = creators.findIndex(c => c.id === e.creatorId || (e.tiktokId && c.tiktokId === e.tiktokId));
    if (cIdx < 0) continue;
    const before = Number(creators[cIdx].contestPoints) || 0;
    const after = Math.max(0, before - (Number(e.delta) || 0));
    const realDelta = after - before;
    const hist = Array.isArray(creators[cIdx].gameplayHistory) ? creators[cIdx].gameplayHistory : [];
    creators[cIdx] = {
      ...creators[cIdx],
      contestPoints: after,
      gameplayHistory: [{ at: now, before, delta: realDelta, after, label, applyId }, ...hist].slice(0, 30),
    };
  }
  saveCreators(creators);
  log.splice(idx, 1);
  saveApplyLog(log);
  rankingEngine?._emit();
  return { ok: true };
}

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDate(ms) { const d = new Date(Number(ms) || 0); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; }
function fmtTime(ms) { const d = new Date(Number(ms) || 0); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }
function csvCell(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }

// Xuất lịch sử ra CSV (1 dòng / mỗi người chơi / mỗi trận) — mở được bằng Excel.
function buildHistoryCsv(list) {
  const now = Date.now();
  const lines = [];
  lines.push(csvCell('HP GROUP LIVE — Lịch sử trận đấu'));
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
// Lịch sử 🎯 Tính điểm (mỗi lượt 1 idol) + 🏆 THI ĐẤU NHÓM (mốc chụp cả bảng)
// =================================================================
const SCORE_HISTORY_MAX = 1000;
const RANKING_HISTORY_MAX = 500;
function loadScoreHistory() { const l = loadJson(SCORE_HISTORY_PATH, []); return Array.isArray(l) ? l : []; }
function saveScoreHistory(l) { saveJson(SCORE_HISTORY_PATH, (Array.isArray(l) ? l : []).slice(-SCORE_HISTORY_MAX)); }
function loadRankingHistory() { const l = loadJson(RANKING_HISTORY_PATH, []); return Array.isArray(l) ? l : []; }
function saveRankingHistory(l) { saveJson(RANKING_HISTORY_PATH, (Array.isArray(l) ? l : []).slice(-RANKING_HISTORY_MAX)); }

// CSV Lịch sử Tính điểm — cột chính: Tên idol, TikTok ID, Điểm (+ thống kê phụ)
function buildScoreHistoryCsv(list) {
  const now = Date.now();
  const lines = [];
  lines.push(csvCell('HP GROUP LIVE — Lịch sử 🎯 Tính điểm'));
  lines.push([csvCell('Thời gian xuất'), csvCell(`${fmtDate(now)} ${fmtTime(now)}`)].join(','));
  lines.push([csvCell('Số lượt'), csvCell(list.length)].join(','));
  lines.push('');
  const header = ['Tên idol', 'TikTok ID', 'Điểm', 'Mục tiêu', 'Kết quả', 'Ngày', 'Giờ'];
  lines.push(header.map(csvCell).join(','));
  const ordered = list.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  for (const e of ordered) {
    const kq = e.status === 'success' ? 'Đạt' : e.status === 'failed' ? 'Chưa đạt' : (e.status || '');
    lines.push([
      e.name || '', e.tiktokId || '', Number(e.points) || 0, e.target || '', kq, fmtDate(e.at), fmtTime(e.at),
    ].map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

// CSV Lịch sử THI ĐẤU NHÓM — mỗi mốc: 1 dòng/người, có Điểm sàn + Điểm dư + KIM CƯƠNG TƯƠI.
// KC Tươi = Điểm sàn + (Điểm − Điểm sàn) × hệ số. Dưới sàn (Điểm < sàn) → giữ nguyên Điểm.
function buildRankingHistoryCsv(list, heSo) {
  const k = Math.max(1, Number(heSo) || 2);
  const now = Date.now();
  const lines = [];
  lines.push(csvCell('HP GROUP LIVE — Lịch sử 🏆 THI ĐẤU NHÓM'));
  lines.push([csvCell('Thời gian xuất'), csvCell(`${fmtDate(now)} ${fmtTime(now)}`)].join(','));
  lines.push([csvCell('Số mốc'), csvCell(list.length)].join(','));
  lines.push([csvCell('Hệ số KC Tươi'), csvCell(`x${k}`)].join(','));
  lines.push([csvCell('Công thức'), csvCell('KIM CƯƠNG TƯƠI = Điểm sàn + (Điểm − Điểm sàn) × hệ số; dưới sàn = giữ nguyên Điểm')].join(','));
  lines.push('');
  const header = ['Ngày', 'Giờ', 'Mốc', 'Điểm sàn', 'Hạng', 'Tên idol', 'TikTok ID', 'Nhóm', 'Round', 'Điểm', 'Điểm dư', 'Hệ số', 'KIM CƯƠNG TƯƠI'];
  lines.push(header.map(csvCell).join(','));
  const ordered = list.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  for (const snap of ordered) {
    const floor = Number(snap.floor) || 0;
    const rows = (snap.rows || []).slice().sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0));
    rows.forEach((r, i) => {
      const pts = Number(r.points) || 0;
      const du = Math.max(0, pts - floor);
      const kc = pts >= floor ? floor + du * k : pts;
      lines.push([
        fmtDate(snap.at), fmtTime(snap.at), snap.label || '', floor, i + 1,
        r.name || '', r.tiktokId || '', r.groupName || '', Number(r.round) || 0,
        pts, du, `x${k}`, Math.round(kc),
      ].map(csvCell).join(','));
    });
  }
  return '﻿' + lines.join('\r\n');
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

// ===== KIM CƯƠNG TỔNG theo nhóm =====
// Đọc sheet DAILY DATA, khớp tiktokId KÊNH ĐẠI DIỆN của từng nhóm với cột C (username),
// lấy Kim cương ở cột H. Trả về map theo groupId + tổng toàn bộ để xếp hạng / gắn vương miện.
function loadKcData() {
  return loadJson(KC_DATA_PATH, null);
}

async function fetchGroupDiamonds() {
  const res = await fetch(DAILY_DATA_SHEET);
  if (!res.ok) throw new Error('DAILY DATA Sheet HTTP ' + res.status);
  const rows = parseCsvRows(await res.text());
  if (rows.length < 2) throw new Error('Sheet DAILY DATA rỗng — kiểm tra quyền chia sẻ public.');
  // Map username(lowercase) -> { kc, period, deltaPct }. Trùng username thì lấy dòng đầu (kênh đại diện duy nhất).
  // deltaPct = cột "Kim cương - so với tháng trước" (index 22) — % ĐÃ chuẩn hóa theo kỳ, KHÔNG tự trừ 2 số tuyệt đối.
  const map = new Map();
  for (let r = 1; r < rows.length; r++) {
    const uname = String(rows[r][2] || '').trim().toLowerCase();
    if (!uname || map.has(uname)) continue;
    const kc = parseInt(String(rows[r][7] || '').replace(/[^\d-]/g, ''), 10) || 0;
    const period = String(rows[r][0] || '').trim();
    const dRaw = String(rows[r][22] || '').replace('%', '').replace(',', '.').trim();
    const deltaPct = dRaw === '' ? null : (Number.isFinite(parseFloat(dRaw)) ? parseFloat(dRaw) : null);
    map.set(uname, { kc, period, deltaPct });
  }
  const groups = loadGroups();
  const byGroup = {};
  let total = 0;
  let period = '';
  // Tổng "so với tháng trước": suy ra baseline cùng kỳ tháng trước = kc / (1 + delta/100) rồi gộp lại.
  let baseSum = 0, curSumForDelta = 0;
  for (const g of groups) {
    const key = String(g.tiktokId || '').trim().toLowerCase();
    const hit = key ? map.get(key) : null;
    const kc = hit ? hit.kc : null;
    const deltaPct = hit ? hit.deltaPct : null;
    byGroup[g.id] = { groupId: g.id, tiktokId: g.tiktokId || '', kc, deltaPct };
    if (kc != null) {
      total += kc;
      if (!period && hit.period) period = hit.period;
      if (deltaPct != null) {
        const base = kc / (1 + deltaPct / 100);
        if (Number.isFinite(base) && base > 0) { baseSum += base; curSumForDelta += kc; }
      }
    }
  }
  const totalDeltaPct = baseSum > 0 ? (curSumForDelta / baseSum - 1) * 100 : null;
  const data = { fetchedAt: Date.now(), source: DAILY_DATA_SHEET, sheet: 'DAILY DATA', period, total, totalDeltaPct, byGroup };
  saveJson(KC_DATA_PATH, data);
  return data;
}

// Chuỗi Kim cương theo tháng (THÁNG 1..12) cho từng nhóm — chỉ dùng ở Hồ Sơ Nhóm (chart 6 tháng).
function loadKcMonths() {
  return loadJson(KC_MONTHS_PATH, null);
}

async function fetchGroupMonthly() {
  const groups = loadGroups();
  const keys = groups.map(g => ({ id: g.id, key: String(g.tiktokId || '').trim().toLowerCase() }));
  // Tải song song 12 sheet tháng; tháng chưa có dữ liệu (tương lai) trả rỗng → bỏ qua.
  const months = await Promise.all(Array.from({ length: 12 }, (_, i) => i + 1).map(async (m) => {
    try {
      const res = await fetch(MONTHLY_SHEET(m));
      if (!res.ok) return { m, map: null };
      const rows = parseCsvRows(await res.text());
      const map = new Map();
      for (let r = 1; r < rows.length; r++) {
        const u = String(rows[r][2] || '').trim().toLowerCase();
        if (!u || map.has(u)) continue;
        map.set(u, parseInt(String(rows[r][7] || '').replace(/[^\d-]/g, ''), 10) || 0);
      }
      return { m, map: map.size ? map : null };
    } catch { return { m, map: null }; }
  }));
  const byMonth = {};
  months.forEach(({ m, map }) => { if (map) byMonth[m] = map; });
  const byGroup = {};
  for (const { id, key } of keys) {
    const arr = [];
    for (let m = 1; m <= 12; m++) { const mp = byMonth[m]; if (mp && mp.has(key)) arr.push({ m, kc: mp.get(key) }); }
    byGroup[id] = arr;
  }
  const data = { fetchedAt: Date.now(), source: 'THÁNG 1..12', byGroup };
  saveJson(KC_MONTHS_PATH, data);
  return data;
}

// Creator shape:
// { id, tiktokId, nickname, avatar, groupId, defaultGiftIcon, defaultGiftId, defaultGiftName, createdAt }
// Group shape:
// { id, name, color, defaultGiftIcon, defaultGiftId, defaultGiftName, createdAt }

// =================================================================
// Engines
// =================================================================
class PkDuoEngine {
  constructor({ onState, onResult, getCreators, onConfigChange, onRankingPoints }) {
    this.onState = onState;
    this.onResult = onResult;
    // Gọi khi engine tự sửa config (VD: cập nhật chuỗi WIN sau trận) → main lưu file + báo renderer.
    this.onConfigChange = typeof onConfigChange === 'function' ? onConfigChange : null;
    // Liên kết THI ĐẤU NHÓM: mỗi quà quy về 1 phe có creatorId → cộng realtime cho Creator đó.
    this.onRankingPoints = typeof onRankingPoints === 'function' ? onRankingPoints : null;
    // Lấy danh sách creator hiện tại để resolve avatar realtime (không đông cứng snapshot).
    this.getCreators = typeof getCreators === 'function' ? getCreators : () => [];
    this.config = {
      teamA: { name: 'TEAM A', color: '#FE2C55', gifts: [], winStreak: 0 },
      teamB: { name: 'TEAM B', color: '#25F4EE', gifts: [], winStreak: 0 },
      durationSec: 90,
      prepSec: 3,
      delaySec: 5,
      joinMode: false, // false = fixed by gift, true = chosen by first gift sent
      creatorLive: false, // (legacy) chế độ TikTok cũ — nay chuyển thành cờ tiktokCombine kết hợp
      tiktokCombine: true, // 📡 Kết hợp TikTok: MẶC ĐỊNH BẬT — ưu tiên cộng theo NGƯỜI NHẬN thật (recipientCreatorId), không khớp thì rơi về chế độ nền (user bỏ tích thì nhớ)
      linkRanking: false, // ☑️ Liên kết với THI ĐẤU NHÓM: cộng realtime điểm phe cho Creator
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
      championNames: false, // Hiện tên người tặng TOP1 (MVP) dưới avatar
      arrowStyle: 'random', // Skin mũi tên: classic | core | rope | cannon | random (random = tự đổi mỗi vòng). Mặc định Ngẫu nhiên.
      // Đánh dấu "người vào trận" kiểu chọn nhân vật game (2 phe đối đầu → luôn đánh dấu cả 2).
      // random | arrow | lock | spotlight | versus | off. Mặc định Ngẫu nhiên.
      selectFx: 'random',
      // 🎨 Skin mùa lễ (chỉ trang trí, auto = theo ngày). Xử lý ở overlay-skin.js.
      skin: 'auto',
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
      arrowStyleActive: '', // skin đã chốt cho vòng hiện tại khi arrowStyle='random'
      selectFxActive: '',   // kiểu FX đánh dấu đã chốt cho vòng hiện tại khi selectFx='random'
      historySaved: false,
      gifters: { A: new Map(), B: new Map() }, // side -> Map(userKey -> {uniqueId,nickname,avatar,total}) để vinh danh TOP tặng quà
    };
    this._tick = null;
    this._comboRepeats = new Map(); // khoá combo theo người+quà (đếm delta, không mất quà khi gói chốt rớt)
  }
  setConfig(patch) { this.config = { ...this.config, ...patch }; migrateTiktokMode(this.config); this._emit(); }
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
      tiktokCombine: this.config.tiktokCombine !== false,
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
      championNames: this.config.championNames === true,
      arrowStyle: this._resolveArrowStyle(),
      // PK Đôi luôn có đúng 2 phe → luôn đánh dấu cả 2 (overlay tự ẩn khi status idle/finished).
      selectFx: this._resolveSelectFx(),
      skin: this.config.skin || 'auto',
    };
  }
  // Skin mũi tên hiển thị: 'random' → chốt 1 skin động cho mỗi vòng (start() gọi lại để đổi vòng sau).
  _resolveArrowStyle() {
    const pool = ['classic', 'core', 'rope', 'cannon'];
    if (this.config.arrowStyle === 'random') {
      const rnd = ['core', 'rope', 'cannon'];
      if (!rnd.includes(this.state.arrowStyleActive)) this.state.arrowStyleActive = rnd[Math.floor(Math.random() * rnd.length)];
      return this.state.arrowStyleActive;
    }
    return pool.includes(this.config.arrowStyle) ? this.config.arrowStyle : 'classic';
  }
  // Kiểu FX đánh dấu người vào trận: 'random' → chốt 1 kiểu cho mỗi vòng; 'off' → tắt hẳn.
  _resolveSelectFx() {
    const pool = ['arrow', 'lock', 'spotlight', 'versus'];
    if (this.config.selectFx === 'off') return 'off';
    if (this.config.selectFx === 'random') {
      if (!pool.includes(this.state.selectFxActive)) this.state.selectFxActive = pool[Math.floor(Math.random() * pool.length)];
      return this.state.selectFxActive;
    }
    return pool.includes(this.config.selectFx) ? this.config.selectFx : 'arrow';
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
    // 'random' → đổi skin mũi tên ngẫu nhiên mỗi vòng (đỡ mất công chọn tay).
    if (this.config.arrowStyle === 'random') { const rnd = ['core', 'rope', 'cannon']; this.state.arrowStyleActive = rnd[Math.floor(Math.random() * rnd.length)]; }
    if (this.config.selectFx === 'random') { const rnd = ['arrow', 'lock', 'spotlight', 'versus']; this.state.selectFxActive = rnd[Math.floor(Math.random() * rnd.length)]; }
    this.state.historySaved = false;
    this._resetGifters();
    this._comboRepeats.clear();
    this._runTicker();
  }
  stop() {
    this.state.status = 'finished';
    this.state.remainingMs = 0;
    this.state.userTeams = {};
    this._comboRepeats.clear();
    this._recordHistory();
    this._clearTicker();
    this._emit();
  }
  // Chống mất khi văng: chụp/khôi phục điểm 2 phe + TOP người tặng (Map → mảng để ghi JSON) + đồng hồ.
  snapshotRuntime() {
    const s = this.state;
    return { state: { ...s, gifters: { A: [...(s.gifters?.A || new Map())], B: [...(s.gifters?.B || new Map())] } } };
  }
  restoreRuntime(snap, opts = {}) {
    if (!snap || !snap.state) return;
    const s = snap.state;
    const toMap = (arr) => new Map(Array.isArray(arr) ? arr : []);
    this.state = { ...this.state, ...s, gifters: { A: toMap(s.gifters?.A), B: toMap(s.gifters?.B) } };
    // Chỉ chạy TIẾP đồng hồ khi phiên trước vừa lưu (crash-relaunch nhanh). Mở lại muộn (opts.resume=false)
    // thì đóng băng: vẫn giữ đủ điểm nhưng KHÔNG để trận cũ tự đếm về 0 rồi âm thầm ghi lịch sử/chuỗi WIN.
    if (opts.resume && ['prestart', 'running', 'grace'].includes(this.state.status)) this._runTicker();
  }
  reset() {
    this._clearTicker();
    this._comboRepeats.clear();
    this.state = { status: 'idle', remainingMs: 0, scoreA: 0, scoreB: 0, startedAt: 0, endsAt: 0, userTeams: {}, graceElapsedMs: 0, roundNo: 0, arrowStyleActive: '', selectFxActive: '', historySaved: false, gifters: { A: new Map(), B: new Map() } };
    this._emit();
  }
  // RESET TẤT CẢ: reset trận + XOÁ luôn chuỗi WIN (winStreak) của cả 2 phe. Lưu file + báo renderer.
  resetAll() {
    this.reset();
    if (this.config.teamA) this.config.teamA.winStreak = 0;
    if (this.config.teamB) this.config.teamB.winStreak = 0;
    if (this.onConfigChange) { try { this.onConfigChange(); } catch {} }
    this._emit();
  }
  // Ghi LỊCH SỬ trận PK Đôi (1 lần/trận, chỉ khi đã bắt đầu thật).
  _recordHistory() {
    if (this.state.historySaved || !this.state.startedAt) return;
    this.state.historySaved = true;
    const a = { name: this.config.teamA?.name || 'TEAM A', score: Number(this.state.scoreA) || 0, color: this.config.teamA?.color || '' };
    const b = { name: this.config.teamB?.name || 'TEAM B', score: Number(this.state.scoreB) || 0, color: this.config.teamB?.color || '' };
    const winnerSide = a.score === b.score ? 'draw' : (a.score > b.score ? 'A' : 'B');
    // Chuỗi WIN: bên thắng +1, bên thua về 0 (mất chữ WIN); HÒA giữ nguyên chuỗi 2 bên.
    // Lưu vào config để overlay hiện realtime và nhớ qua các trận; onConfigChange lo phần ghi file + báo renderer.
    if (winnerSide === 'A' || winnerSide === 'B') {
      const winTeam = winnerSide === 'A' ? this.config.teamA : this.config.teamB;
      const loseTeam = winnerSide === 'A' ? this.config.teamB : this.config.teamA;
      if (winTeam) winTeam.winStreak = (Number(winTeam.winStreak) || 0) + 1;
      if (loseTeam) loseTeam.winStreak = 0;
      if (this.onConfigChange) { try { this.onConfigChange(); } catch {} }
    }
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
    const pts = Number(points) || 0;
    if (side === 'A') this.state.scoreA += pts;
    else if (side === 'B') this.state.scoreB += pts;
    // Liên kết BXH: điểm cộng/trừ TAY hoặc nút Test cũng chảy realtime vào THI ĐẤU NHÓM (giống quà thật
    // ở routeGift). Nhờ vậy thanh PK Đôi và bảng xếp hạng LUÔN khớp, khỏi ghi chú tay rồi áp sau.
    if (pts && this.config.linkRanking && this.onRankingPoints) {
      const team = side === 'A' ? this.config.teamA : this.config.teamB;
      if (team && team.creatorId) this.onRankingPoints(team.creatorId, pts, {});
    }
    this._emit();
  }
  // Test quà: cộng/trừ cho phe A/B điểm của quà phe đó × số lượng (dùng nút thử trong app).
  // sign < 0 = TRỪ (lỡ cộng sai); trừ có kẹp về 0, không cho điểm âm.
  testGift(side, qty = 1, sign = 1) {
    const s = side === 'A' ? 'A' : (side === 'B' ? 'B' : null);
    if (!s) return false;
    const team = s === 'A' ? this.config.teamA : this.config.teamB;
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    const gift = ((team && (team.gifts || team.joinGifts)) || [])[0] || {};
    const per = this.config.pointsBy === 'diamond' ? Math.max(1, Number(gift.diamond) || 1) : 1;
    let points = per * n;
    if (sign < 0) {
      const cur = s === 'A' ? (Number(this.state.scoreA) || 0) : (Number(this.state.scoreB) || 0);
      points = -Math.min(cur, points); // không cho điểm âm
    }
    this.addPoints(s, points);
    return { points, qty: n, giftName: gift.giftName || gift.name || '' };
  }
  // Route 1 gift event → cộng cho phe nào.
  // Tính điểm khi 'running' VÀ trong Delay 'grace' (để bắt quà trễ do mạng chậm).
  // Chỉ ngừng khi Delay hết hẳn (status 'finished').
  routeGift(ev) {
    if (this.state.status !== 'running' && this.state.status !== 'grace') return;
    // Đếm theo delta để KHÔNG mất combo khi gói chốt repeatEnd rớt/muộn (xem comboDelta).
    const repeat = comboDelta(this._comboRepeats, ev);
    if (!repeat) return;
    const pts = this.config.pointsBy === 'diamond'
      ? Math.max(1, resolveDiamond(ev)) * repeat
      : repeat;
    let side;
    // 📡 Kết hợp TikTok: ưu tiên NGƯỜI NHẬN thật (recipientCreatorId từ toMemberId/tên). Quà nhắm
    // đúng Creator của phe nào → cộng ngay, khỏi phụ thuộc bảng quà. Không nhắm ai → rơi về chế độ nền.
    if (this.config.tiktokCombine) {
      const rc = ev.recipientCreatorId;
      side = rc ? (this.config.teamA?.creatorId === rc ? 'A' : (this.config.teamB?.creatorId === rc ? 'B' : null)) : null;
    }
    if (!side) {
      // Cố Định / Chọn Phe: khớp bảng quà như cũ.
      const inA = (this.config.teamA.gifts || []).some(g => giftMatches(g, ev));
      const inB = (this.config.teamB.gifts || []).some(g => giftMatches(g, ev));
      side = inA && !inB ? 'A' : (inB && !inA ? 'B' : null);
      if (this.config.joinMode) {
        const user = ev.uniqueId || ev.userId;
        if (user) {
          if (side) this.state.userTeams[user] = side; // Quà kích hoạt: (re)gán phe
          else side = this.state.userTeams[user] || null;
        }
      }
    }
    if (!side) return;
    if (side === 'A') this.state.scoreA += pts;
    else this.state.scoreB += pts;
    this._addGifter(side, ev, pts);
    // Liên kết BXH: cộng realtime cho Creator gắn với phe này (nếu có).
    if (this.config.linkRanking && this.onRankingPoints) {
      const team = side === 'A' ? this.config.teamA : this.config.teamB;
      if (team && team.creatorId) this.onRankingPoints(team.creatorId, pts, ev);
    }
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

// GIỮ / ĐỔI (Keep/Change): trò "giữ ghế" người đang diễn. Phe A = GIỮ (giữ người hiện tại),
// phe B = ĐỔI (đổi sang người mới). Kế thừa cơ chế tính điểm PK Đôi (Chọn Phe 1 quà + TikTok
// theo UID người nhận trong LIVE nhóm) nhưng BỎ avatar/champions/FX. Thêm: ngưỡng "lật kèo"
// (lợi thế người đương nhiệm), chuỗi "trụ vững ghế" (defendStreak), tên người kế, số vòng đã chạy.
// Sắp lại danh sách tên theo THỨ TỰ LƯỢT DIỄN đã lưu (order): tên có trong order lên trước đúng thứ tự;
// tên chưa xếp (thành viên mới / lạ) nối vào cuối theo thứ tự gốc. Tên trong order không còn tồn tại bị bỏ.
function orderNamesByRotation(names, order) {
  const set = new Set(names), seen = new Set(), out = [];
  for (const n of (Array.isArray(order) ? order : [])) {
    const s = String(n || '').trim();
    if (s && set.has(s) && !seen.has(s)) { out.push(s); seen.add(s); }
  }
  for (const n of names) if (!seen.has(n)) { out.push(n); seen.add(n); }
  return out;
}

class KcDuoEngine {
  constructor({ onState, getCreators, onConfigChange, onRankingPoints }) {
    this.onState = onState;
    this.onConfigChange = typeof onConfigChange === 'function' ? onConfigChange : null;
    this.onRankingPoints = typeof onRankingPoints === 'function' ? onRankingPoints : null;
    this.getCreators = typeof getCreators === 'function' ? getCreators : () => [];
    this.config = {
      // Mặc định GIỮ = HOA HỒNG (Rose TikTok, id 5655); ĐỔI để trống cho MC chọn quà khác (2 phe không trùng).
      teamA: { name: 'KEEP/GIỮ', color: '#FE2C55', gifts: [{ giftName: 'Rose', giftId: '5655', icon: 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/eba3a9bb85c33e017f3648eaf88d7189~tplv-obj.webp', diamond: 1 }] }, // Keep — đỏ hồng TikTok
      teamB: { name: 'CHANGE/ĐỔI', color: '#00D5FF', gifts: [] }, // Change — xanh dương TikTok (0,213,255)
      performerName: '', // người đang diễn (ghế nóng) — hiện trên thanh máu
      nextName: '',      // người kế tiếp — nhập trước; khi ĐỔI thắng thì lên ghế
      rotationOrder: [], // thứ tự lượt diễn (mảng tên) — MC xếp theo vị trí thật; điều khiển gợi ý người kế tiếp
      rotationSkip: [],  // tên các thành viên OFFLINE / không tham gia — bị bỏ qua khi xoay vòng chọn người kế
      defendStreak: 0,   // số vòng người đang diễn giữ được ghế (reset khi ĐỔI thắng)
      totalRounds: 0,    // tổng số vòng đã chạy (Số vòng)
      flipMargin: 0,     // ngưỡng lật kèo: ĐỔI phải VƯỢT GIỮ hơn mức này mới thắng (0 = chỉ cần hơn)
      flipMarginMode: 'percent', // 'percent' (% tổng điểm) | 'point' (điểm tuyệt đối)
      durationSec: 90,
      prepSec: 3,
      delaySec: 5,
      joinMode: false,    // false = cố định theo quà; true = Chọn Phe (quà kích hoạt)
      creatorLive: false, // (legacy) chế độ TikTok cũ — nay chuyển thành cờ tiktokCombine kết hợp
      tiktokCombine: true, // 📡 Kết hợp TikTok: MẶC ĐỊNH BẬT — ưu tiên cộng theo NGƯỜI NHẬN thật (recipientCreatorId), không khớp thì rơi về chế độ nền (user bỏ tích thì nhớ)
      linkRanking: false,
      pointsBy: 'diamond',
      content: 'GIỮ / ĐỔI',
      timerPos: 'center', // vị trí đồng hồ giữa nội dung A/B: center | left | right
      bgColor: '#000000',
      bgOpacity: 88,
      giftSize: 46,
      textSize: 21,
      overlayScale: 200,
      startSound: '',
      warningSound: '',
      keepSound: '',   // GIỮ thắng
      changeSound: '', // ĐỔI thắng
      drawSound: '',
      giftDisplayMode: 'scroll',
      skin: 'auto',
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
      winnerSide: '', // 'A' (GIỮ giữ ghế) | 'B' (ĐỔI người mới) — chốt lúc kết thúc
    };
    this._tick = null;
    // Theo dõi combo x10/x1000 theo từng người+quà để cộng phần CHÊNH LỆCH mỗi nhịp (không mất, không đúp).
    this._comboRepeats = new Map();
  }
  setConfig(patch) {
    this.config = { ...this.config, ...patch };
    this.config.teamA = { ...(this.config.teamA || {}), name: 'KEEP/GIỮ', nameOverride: true };
    this.config.teamB = { ...(this.config.teamB || {}), name: 'CHANGE/ĐỔI', nameOverride: true };
    migrateTiktokMode(this.config);
    this._emit();
  }
  // Ngưỡng điểm ĐỔI cần vượt GIỮ để lật ghế (theo % tổng điểm hoặc điểm tuyệt đối).
  _flipRequired() {
    const m = Math.max(0, Number(this.config.flipMargin) || 0);
    if (this.config.flipMarginMode === 'point') return m;
    const tot = (Number(this.state.scoreA) || 0) + (Number(this.state.scoreB) || 0);
    return tot * m / 100;
  }
  // Ai thắng: 'B' (ĐỔI) chỉ khi vượt GIỮ hơn ngưỡng; còn lại (kể cả HÒA / dưới ngưỡng) → 'A' (GIỮ giữ ghế).
  _decideWinner() {
    const a = Number(this.state.scoreA) || 0, b = Number(this.state.scoreB) || 0;
    return (b - a) > this._flipRequired() ? 'B' : 'A';
  }
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
      creatorLive: this.config.creatorLive,
      tiktokCombine: this.config.tiktokCombine !== false,
      pointsBy: this.config.pointsBy,
      bgColor: this.config.bgColor,
      bgOpacity: this.config.bgOpacity,
      giftSize: this.config.giftSize,
      textSize: this.config.textSize,
      overlayScale: this.config.overlayScale,
      content: this.config.content,
      timerPos: this.config.timerPos || 'center',
      push: this._pushPercent(),
      startSound: this.config.startSound,
      warningSound: this.config.warningSound,
      keepSound: this.config.keepSound,
      changeSound: this.config.changeSound,
      drawSound: this.config.drawSound,
      giftDisplayMode: this.config.giftDisplayMode,
      roundNo: this.state.roundNo,
      totalRounds: Math.max(0, Number(this.config.totalRounds) || 0),
      defendStreak: Math.max(0, Number(this.config.defendStreak) || 0),
      performerName: this.config.performerName || '',
      nextName: this.config.nextName || '',
      rotationOrder: Array.isArray(this.config.rotationOrder) ? this.config.rotationOrder : [],
      rotationSkip: Array.isArray(this.config.rotationSkip) ? this.config.rotationSkip : [],
      flipMargin: Math.max(0, Number(this.config.flipMargin) || 0),
      flipMarginMode: this.config.flipMarginMode || 'percent',
      winnerSide: this.state.winnerSide || '',
      skin: this.config.skin || 'auto',
    };
  }
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
    this.state.winnerSide = '';
    this._comboRepeats.clear();
    this._runTicker();
  }
  stop() {
    this.state.status = 'finished';
    this.state.remainingMs = 0;
    this.state.userTeams = {};
    this._comboRepeats.clear();
    this._recordResult();
    this._clearTicker();
    this._emit();
  }
  // Chống mất khi văng: chụp/khôi phục điểm GIỮ/ĐỔI + đồng hồ (chuỗi trụ vững/tổng vòng nằm ở config, lưu riêng).
  snapshotRuntime() { return { state: this.state }; }
  restoreRuntime(s, opts = {}) {
    if (!s || !s.state || typeof s.state !== 'object') return;
    this.state = { ...this.state, ...s.state };
    // Chỉ chạy tiếp đồng hồ khi phiên trước vừa lưu; mở lại muộn thì đóng băng (khỏi tự chốt vòng ngoài ý muốn).
    if (opts.resume && ['prestart', 'running', 'grace'].includes(this.state.status)) this._runTicker();
  }
  reset() {
    // Reset trận nhưng GIỮ chuỗi trụ vững + tổng vòng + tên người diễn (giống PK giữ winStreak).
    this._clearTicker();
    this._comboRepeats.clear();
    this.state = { status: 'idle', remainingMs: 0, scoreA: 0, scoreB: 0, startedAt: 0, endsAt: 0, userTeams: {}, graceElapsedMs: 0, roundNo: 0, historySaved: false, winnerSide: '' };
    this._emit();
  }
  // RESET TẤT CẢ: reset trận + XOÁ chuỗi trụ vững, tổng vòng và người kế. Lưu file + báo renderer.
  resetAll() {
    this.reset();
    this.config.defendStreak = 0;
    this.config.totalRounds = 0;
    this.config.nextName = '';
    if (this.onConfigChange) { try { this.onConfigChange(); } catch {} }
    this._emit();
  }
  // Chốt kết quả 1 lần/trận: cập nhật chuỗi trụ vững, tổng vòng, đưa người kế lên ghế nếu ĐỔI thắng.
  _recordResult() {
    if (this.state.historySaved || !this.state.startedAt) return;
    this.state.historySaved = true;
    const winnerSide = this._decideWinner();
    this.state.winnerSide = winnerSide;
    this.config.totalRounds = (Number(this.config.totalRounds) || 0) + 1;
    if (winnerSide === 'A') {
      // GIỮ thắng: người đương nhiệm giữ ghế → chuỗi trụ vững +1.
      this.config.defendStreak = (Number(this.config.defendStreak) || 0) + 1;
    } else {
      // ĐỔI thắng: đổi người → chuỗi về 0; người kế (nếu đã nhập) lên ghế.
      this.config.defendStreak = 0;
      const next = String(this.config.nextName || '').trim();
      if (next) this.config.performerName = next;
      // Tự đề xuất người kế tiếp mới (xoay vòng, không trùng người đang diễn) thay cho việc bỏ trống
      // để MC phải tự chọn. Đây chỉ là GỢI Ý mặc định — MC vẫn đổi lại được ở ô "Người kế tiếp".
      this.config.nextName = this._suggestNextName(this.config.performerName);
    }
    if (this.onConfigChange) { try { this.onConfigChange(); } catch {} }
  }
  // Gợi ý người kế tiếp từ danh sách thành viên các nhóm đang dùng (2 phe), xoay vòng theo vị trí
  // người đang diễn để cảm giác lần lượt và KHÔNG trùng người đang diễn. Trả '' nếu không có ai khác.
  _suggestNextName(currentPerformer) {
    const cur = String(currentPerformer || '').trim();
    const groupIds = [...new Set([this.config.teamA?.groupId, this.config.teamB?.groupId].filter(Boolean).map(String))];
    let members = this.getCreators() || [];
    if (groupIds.length) members = members.filter(c => groupIds.includes(String(c.groupId || '')));
    let names = [...new Set(members.map(c => String(c.nickname || c.tiktokId || '').trim()).filter(Boolean))];
    // Xếp theo THỨ TỰ LƯỢT DIỄN đã lưu để xoay vòng đúng vị trí thật (hàng ngang / vòng tròn).
    names = orderNamesByRotation(names, this.config.rotationOrder);
    // Bỏ qua người OFFLINE / không tham gia (rotationSkip) khi chọn người kế — nhưng vẫn giữ trong
    // danh sách để tính vị trí xoay vòng (chỉ không được CHỌN làm người kế).
    const skip = new Set((Array.isArray(this.config.rotationSkip) ? this.config.rotationSkip : []).map(n => String(n || '').trim()));
    if (!names.length) return '';
    // Xoay vòng: lấy người NGAY SAU người đang diễn còn tham gia; không có thì lấy người đầu khác còn tham gia.
    const idx = names.indexOf(cur);
    if (idx >= 0) {
      for (let i = 1; i <= names.length; i++) {
        const cand = names[(idx + i) % names.length];
        if (cand && cand !== cur && !skip.has(cand)) return cand;
      }
    }
    return names.find(n => n !== cur && !skip.has(n)) || '';
  }
  addPoints(side, points) {
    const pts = Number(points) || 0;
    if (side === 'A') this.state.scoreA += pts;
    else if (side === 'B') this.state.scoreB += pts;
    // Liên kết BXH: dồn về 🎤 Người đang diễn (khớp routeGift) — test/cộng-tay cũng realtime vào THI ĐẤU NHÓM.
    if (pts && this.config.linkRanking && this.onRankingPoints) {
      const cid = this._performerCreatorId();
      if (cid) this.onRankingPoints(cid, pts, {});
    }
    this._emit();
  }
  testGift(side, qty = 1, sign = 1) {
    const s = side === 'A' ? 'A' : (side === 'B' ? 'B' : null);
    if (!s) return false;
    const team = s === 'A' ? this.config.teamA : this.config.teamB;
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    const gift = ((team && (team.gifts || team.joinGifts)) || [])[0] || {};
    const per = this.config.pointsBy === 'diamond' ? Math.max(1, Number(gift.diamond) || 1) : 1;
    let points = per * n;
    if (sign < 0) {
      const cur = s === 'A' ? (Number(this.state.scoreA) || 0) : (Number(this.state.scoreB) || 0);
      points = -Math.min(cur, points);
    }
    this.addPoints(s, points);
    return { points, qty: n, giftName: gift.giftName || gift.name || '' };
  }
  // Tra 🎤 Người đang diễn (theo tên đã chọn) về creatorId trong nhóm đã chọn để cộng ranking ĐÚNG người.
  // Không khớp (chưa chọn / khách lạ ngoài nhóm) → '' → bỏ qua cộng ranking (theo lựa chọn của MC).
  _performerCreatorId() {
    const name = String(this.config.performerName || '').trim();
    if (!name) return '';
    const groupIds = [...new Set([this.config.teamA?.groupId, this.config.teamB?.groupId].filter(Boolean).map(String))];
    let members = this.getCreators() || [];
    if (groupIds.length) members = members.filter(c => groupIds.includes(String(c.groupId || '')));
    const exact = members.find(c => String(c.nickname || c.tiktokId || '').trim() === name);
    if (exact) return exact.id || '';
    const key = normRecipientName(name); // khớp mềm: bỏ dấu/emoji/khoảng trắng lạ
    const soft = members.find(c => normRecipientName(String(c.nickname || c.tiktokId || '')) === key);
    return soft ? (soft.id || '') : '';
  }
  routeGift(ev) {
    if (this.state.status !== 'running' && this.state.status !== 'grace') return;
    const repeat = comboDelta(this._comboRepeats, ev);
    if (!repeat) return;
    const pts = this.config.pointsBy === 'diamond'
      ? Math.max(1, resolveDiamond(ev)) * repeat
      : repeat;
    let side;
    // 📡 Kết hợp TikTok: ưu tiên NGƯỜI NHẬN thật (recipientCreatorId từ toMemberId). Không nhắm ai → chế độ nền.
    if (this.config.tiktokCombine) {
      const rc = ev.recipientCreatorId;
      side = rc ? (this.config.teamA?.creatorId === rc ? 'A' : (this.config.teamB?.creatorId === rc ? 'B' : null)) : null;
    }
    if (!side) {
      const inA = (this.config.teamA.gifts || []).some(g => giftMatches(g, ev));
      const inB = (this.config.teamB.gifts || []).some(g => giftMatches(g, ev));
      side = inA && !inB ? 'A' : (inB && !inA ? 'B' : null);
      if (this.config.joinMode) {
        const user = ev.uniqueId || ev.userId;
        if (user) {
          if (side) this.state.userTeams[user] = side;
          else side = this.state.userTeams[user] || null;
        }
      }
    }
    if (!side) return;
    if (side === 'A') this.state.scoreA += pts;
    else this.state.scoreB += pts;
    if (this.config.linkRanking && this.onRankingPoints) {
      // Điểm ranking DỒN VỀ 🎤 Người đang diễn (cả quà GIỮ lẫn ĐỔI) — hợp luồng xoay vòng lượt diễn,
      // vì mọi tương tác trong lượt là do người đang diễn tạo ra. Thanh máu GIỮ/ĐỔI vẫn tách phe như cũ.
      // Chưa chọn / tra không ra người diễn → bỏ qua, KHÔNG cộng (tránh cộng nhầm creator phe).
      const cid = this._performerCreatorId();
      if (cid) this.onRankingPoints(cid, pts, ev);
    }
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
          if ((this.config.delaySec || 0) > 0) {
            this.state.status = 'grace';
            this.state.graceElapsedMs = 0;
            this.state.remainingMs = 0;
          } else {
            this.state.status = 'finished';
            this.state.userTeams = {};
            this._recordResult();
            this._clearTicker();
          }
        } else if (this.state.status === 'grace' && Math.abs(this.state.remainingMs) >= (this.config.delaySec || 0) * 1000) {
          this.state.status = 'finished';
          this.state.userTeams = {};
          this._recordResult();
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
  constructor({ onState, onResult, getCreators, onRankingPoints, onConfigChange, onMvpAward }) {
    this.onState = onState;
    this.onResult = onResult;
    this.onConfigChange = typeof onConfigChange === 'function' ? onConfigChange : null;
    this.onMvpAward = typeof onMvpAward === 'function' ? onMvpAward : null;
    // Liên kết THI ĐẤU NHÓM: mỗi quà quy về 1 participant (là Creator) → cộng realtime cho Creator đó.
    this.onRankingPoints = typeof onRankingPoints === 'function' ? onRankingPoints : null;
    // Lấy danh sách creator hiện tại để resolve avatar realtime (không đông cứng snapshot).
    this.getCreators = typeof getCreators === 'function' ? getCreators : () => [];
    this.config = {
      content: 'PK NHÓM',
      groupId: '',
      layoutMode: 'joined', // joined | separated
      playMode: 'fixed', // fixed | join
      creatorLive: false, // (legacy) chế độ TikTok cũ — nay chuyển thành cờ tiktokCombine kết hợp
      tiktokCombine: true, // 📡 Kết hợp TikTok: MẶC ĐỊNH BẬT — ưu tiên cộng theo NGƯỜI NHẬN thật (recipientCreatorId), không khớp thì rơi về chế độ nền (user bỏ tích thì nhớ)
      linkRanking: false, // ☑️ Liên kết với THI ĐẤU NHÓM: cộng realtime điểm participant cho Creator
      pointsBy: 'diamond',
      noteEnabled: false,
      noteText: 'Chọn Creator tại hộp quà tặng trong App trước khi tặng quà để đảm bảo điểm hoạt động đúng tính năng',
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
      showMvpTotals: false,
      // Đánh dấu "người vào trận" kiểu chọn nhân vật game — CHỈ hiện khi chọn subset (ít hơn full nhóm),
      // đủ full thì tự ẩn. random | arrow | lock | spotlight | versus | off. Mặc định Ngẫu nhiên.
      selectFx: 'random',
      // 🎨 Skin mùa lễ cho thanh máu — CHỈ trang trí (khung/hạt/màu), không đụng logic điểm/độ rộng.
      // auto = tự chọn theo ngày; none = mặc định; noel|halloween|newyear|tet|valentine|trungthu|birthday.
      skin: 'auto',
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
      selectFxActive: '', // kiểu FX đánh dấu đã chốt cho vòng hiện tại khi selectFx='random'
      lastWinnerId: '',
      streaks: {},
      resultHandled: false,
      historySaved: false,
      boostId: '',
      boostAt: 0,
      boostDir: 'right',
      // id participant -> Map(userKey -> {uniqueId,nickname,avatar,total}) để vinh danh TOP người tặng quà.
      gifters: {},
    };
    this._tick = null;
    this._comboRepeats = new Map(); // khoá combo theo người+quà (đếm delta, không mất quà khi gói chốt rớt)
  }
  setConfig(patch) {
    this.config = { ...this.config, ...(patch || {}) };
    migrateTiktokMode(this.config);
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
        mvpTotal: getPkGroupMvpTotal(creator, this.config.groupId),
        // TOP 3 người tặng nhiều nhất cho Creator này — overlay xếp avatar chồng nửa lên nhau.
        topDonors: this.config.donorsEnabled !== false ? this._topDonors(p.id) : [],
      };
    });
    // "Subset" = số người vào trận ÍT HƠN tổng thành viên nhóm → đánh dấu người vào trận cho "thật".
    // Đủ full (tất cả thành viên nhóm cùng đấu) → không đánh dấu. Không chọn nhóm (Talent Show) thì
    // roster=0 → coi như subset khi có ≥2 người (danh sách tự tay chọn).
    const gid = String(this.config.groupId || '');
    const rosterTotal = gid ? (this.getCreators() || []).filter(c => String(c.groupId || '') === gid).length : 0;
    const selectSubset = participants.length >= 2 && (!rosterTotal || participants.length < rosterTotal);
    // 📡 Kết hợp TikTok: overlay tự bật ghi chú hướng dẫn chọn Creator (câu riêng), trừ khi user đã
    // đặt một ghi chú KHÁC. Nhờ vậy bật Kết hợp TikTok là note tự đúng nội dung.
    let noteEnabled = this.config.noteEnabled;
    let noteText = this.config.noteText;
    if (this.config.tiktokCombine) {
      const t = String(noteText || '').trim();
      if (!t || PKG_OLD_NOTES.includes(t) || t === PKG_NEW_NOTE) { noteText = PKG_NEW_NOTE; noteEnabled = true; }
    }
    return {
      status: this.state.status,
      remainingMs: this.state.remainingMs,
      startedAt: this.state.startedAt,
      participants,
      selectFx: this._resolveSelectFx(),
      selectSubset,
      boostId: this.state.boostId,
      boostAt: this.state.boostAt,
      boostDir: this.state.boostDir,
      content: this.config.content,
      groupId: this.config.groupId,
      layoutMode: this.config.layoutMode,
      playMode: this.config.playMode,
      creatorLive: false, // overlay LUÔN hiển thị theo chế độ nền (Cố định/Chọn phe) — Kết hợp TikTok chỉ chạy ngầm phần tính điểm
      tiktokCombine: this.config.tiktokCombine !== false,
      pointsBy: this.config.pointsBy,
      noteEnabled,
      noteText,
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
      showMvpTotals: !!this.config.showMvpTotals,
      skin: this.config.skin || 'auto',
    };
  }
  // Kiểu FX đánh dấu người vào trận: 'random' → chốt 1 kiểu cho mỗi vòng; 'off' → tắt hẳn.
  _resolveSelectFx() {
    const pool = ['arrow', 'lock', 'spotlight', 'versus'];
    if (this.config.selectFx === 'off') return 'off';
    if (this.config.selectFx === 'random') {
      if (!pool.includes(this.state.selectFxActive)) this.state.selectFxActive = pool[Math.floor(Math.random() * pool.length)];
      return this.state.selectFxActive;
    }
    return pool.includes(this.config.selectFx) ? this.config.selectFx : 'arrow';
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
    if (this.config.selectFx === 'random') { const rnd = ['arrow', 'lock', 'spotlight', 'versus']; this.state.selectFxActive = rnd[Math.floor(Math.random() * rnd.length)]; }
    this.state.resultHandled = false;
    this.state.historySaved = false;
    this._resetGifters();
    this._comboRepeats.clear();
    this._runTicker();
  }
  stop() {
    this._finalizeRound();
    this.state.status = 'finished';
    this.state.remainingMs = 0;
    this.state.userTeams = {};
    this._comboRepeats.clear();
    this._recordHistory();
    this._clearTicker();
    this._emit();
  }
  // Chống mất khi văng: chụp/khôi phục điểm + chuỗi WIN + TOP người tặng (mỗi participant có 1 Map → mảng).
  snapshotRuntime() {
    const s = this.state;
    const gifters = {};
    for (const k of Object.keys(s.gifters || {})) gifters[k] = [...(s.gifters[k] || new Map())];
    return { state: { ...s, gifters } };
  }
  restoreRuntime(snap, opts = {}) {
    if (!snap || !snap.state || typeof snap.state !== 'object') return;
    const s = snap.state;
    const gifters = {};
    for (const k of Object.keys(s.gifters || {})) gifters[k] = new Map(Array.isArray(s.gifters[k]) ? s.gifters[k] : []);
    this.state = { ...this.state, ...s, gifters };
    // Chỉ chạy tiếp đồng hồ khi phiên trước vừa lưu; mở lại muộn thì đóng băng — tránh trận cũ tự chốt vòng
    // rồi âm thầm cộng chuỗi WIN + ghi MVP vĩnh viễn vào hồ sơ Creator (onMvpAward) ngay khi mở app.
    if (opts.resume && ['prestart', 'running', 'grace'].includes(this.state.status)) this._runTicker();
  }
  reset() {
    this._clearTicker();
    this._comboRepeats.clear();
    // GIỮ chuỗi WIN qua Reset: Reset chỉ xoá điểm/trạng thái trận, KHÔNG xoá thành tích chuỗi thắng.
    // (Overlay đọc streak từ state.streaks — nếu wipe thì huy hiệu MVP về 0 dù config vẫn còn.)
    // Chuỗi chỉ về 0 khi THUA ở _finalizeRound, giống winStreak của PK Đôi.
    const keepStreaks = { ...(this.state.streaks || {}) };
    this.state = {
      status: 'idle',
      remainingMs: 0,
      startedAt: 0,
      endsAt: 0,
      scores: {},
      userTeams: {},
      graceElapsedMs: 0,
      roundNo: 0,
      selectFxActive: '',
      lastWinnerId: '',
      streaks: keepStreaks,
      resultHandled: false,
      historySaved: false,
      boostId: '',
      boostAt: 0,
      boostDir: 'right',
      gifters: {},
    };
    this._emit();
  }
  // RESET TẤT CẢ: reset trận + XOÁ luôn chuỗi WIN (state.streaks + config.participants[].streak).
  // IPC handler lo lưu file config sau khi gọi.
  resetAll() {
    this.reset();
    this.state.streaks = {};
    this.config.participants = (this.config.participants || []).map(p => ({ ...p, streak: 0 }));
    this._emit();
  }
  addPoints(id, points, ev = {}) {
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
    // Liên kết BXH: MỌI đường cộng điểm (quà thật qua routeGift, nút Test, cộng tay) đều đi qua addPoints
    // → 1 nguồn duy nhất đẩy realtime vào THI ĐẤU NHÓM cho Creator của participant (routeGift KHÔNG cộng lại
    // để tránh đếm đôi). Nhờ vậy thanh PK Nhóm và bảng xếp hạng LUÔN khớp.
    const pts = Number(points) || 0;
    if (pts && this.config.linkRanking && this.onRankingPoints) {
      const part = (this.config.participants || []).find(p => p.id === id);
      const cid = (part && (part.creatorId || part.id)) || id;
      if (cid) this.onRankingPoints(cid, pts, ev);
    }
    this._emit();
  }
  _rankIndex(id, scores) {
    const ranked = (this.config.participants || []).map((p, order) => ({ id: p.id, score: Number(scores?.[p.id]) || 0, order }))
      .sort((a, b) => b.score - a.score || a.order - b.order);
    return ranked.findIndex(x => x.id === id);
  }
  _resetGifters() { this.state.gifters = {}; }
  // Cộng dồn điểm đóng góp của 1 người tặng vào đúng Creator (key theo uniqueId, fallback nickname).
  _addGifter(id, ev, pts) {
    if (!id) return;
    const key = ev.uniqueId || ev.nickname;
    if (!key) return;
    if (!this.state.gifters) this.state.gifters = {};
    let m = this.state.gifters[id];
    if (!m) { m = new Map(); this.state.gifters[id] = m; }
    let g = m.get(key);
    if (!g) { g = { uniqueId: ev.uniqueId || '', nickname: ev.nickname || ev.uniqueId || '', avatar: ev.avatar || '', total: 0 }; m.set(key, g); }
    if (ev.avatar) g.avatar = ev.avatar;       // avatar mới nhất
    if (ev.nickname) g.nickname = ev.nickname;
    g.total += Number(pts) || 0;
  }
  // TOP 3 người tặng nhiều nhất cho 1 Creator. Gift event hay thiếu avatar → bù từ _avatarCache.
  _topDonors(id) {
    const m = this.state.gifters?.[id];
    if (!m || !m.size) return [];
    return [...m.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 3)
      .map(g => {
        const avatar = g.avatar || _avatarCache.get(String(g.uniqueId)) || '';
        return { uniqueId: g.uniqueId, nickname: g.nickname, avatar, avatarKey: avatarCacheKey(avatar), total: Math.round(g.total) };
      });
  }
  // sign < 0 = TRỪ (lỡ cộng sai); trừ có kẹp về 0, không cho điểm âm.
  testGift(id, qty = 1, sign = 1) {
    const participant = (this.config.participants || []).find(p => p.id === id || p.creatorId === id);
    if (!participant) return false;
    const gift = (participant.gifts || [])[0] || {};
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    const per = this.config.pointsBy === 'diamond'
      ? Math.max(1, Number(gift.diamond) || 1)
      : 1;
    let points = per * n;
    if (sign < 0) {
      const cur = Number(this.state.scores?.[participant.id]) || 0;
      points = -Math.min(cur, points); // không cho điểm âm
    }
    this.addPoints(participant.id, points);
    return { points, qty: n, giftName: gift.giftName || gift.name || '' };
  }
  // Tính điểm khi 'running' VÀ trong Delay 'grace' (bắt quà trễ). Ngừng khi 'finished'.
  routeGift(ev) {
    if (this.state.status !== 'running' && this.state.status !== 'grace') return;
    const participants = this.config.participants || [];
    if (!participants.length) return;
    // Đếm theo delta để KHÔNG mất combo khi gói chốt repeatEnd rớt/muộn (xem comboDelta).
    const repeat = comboDelta(this._comboRepeats, ev);
    if (!repeat) return;
    const pts = this.config.pointsBy === 'diamond'
      ? Math.max(1, resolveDiamond(ev)) * repeat
      : repeat;
    let target;
    // 📡 Kết hợp TikTok: ưu tiên NGƯỜI NHẬN thật (recipientCreatorId). Không nhắm ai → chế độ nền.
    if (this.config.tiktokCombine) {
      const rc = ev.recipientCreatorId;
      target = rc ? (participants.find(p => (p.creatorId || p.id) === rc) || null) : null;
    }
    if (!target) {
      target = participants.find(p => (p.gifts || []).some(g => giftMatches(g, ev))) || null;
      if (this.config.playMode === 'join') {
        const user = ev.uniqueId || ev.userId;
        if (user) {
          if (target) this.state.userTeams[user] = target.id; // Quà kích hoạt: (re)gán Creator
          else target = participants.find(p => p.id === this.state.userTeams[user]) || null;
        }
      }
    }
    if (!target) return;
    // addPoints tự đẩy realtime vào THI ĐẤU NHÓM (Liên kết BXH) — 1 nguồn duy nhất, khỏi cộng lại ở đây.
    // Truyền ev thật để giữ dedup token + icon/tên quà hiện trên hàng Creator ở BXH.
    this.addPoints(target.id, pts, ev);
    this._addGifter(target.id, ev, pts);
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
    const winner = (this.config.participants || []).find(p => p.id === winnerId);
    try { this.onConfigChange?.(this.config); } catch {}
    try {
      this.onMvpAward?.({
        creatorId: winner?.creatorId || winnerId,
        groupId: this.config.groupId || '',
        roundNo: this.state.roundNo || 0,
      });
    } catch {}
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

// Nâng cấp cấu hình cũ: chế độ TikTok trước đây là 1 lựa chọn loại trừ (creatorLive=true, thay
// bảng quà). Nay TikTok là cờ KẾT HỢP (tiktokCombine) chồng lên chế độ nền (Cố Định/Chọn Phe).
// Bản lưu cũ có creatorLive=true → bật tiktokCombine, giữ chế độ nền Cố Định (joinMode/playMode giữ nguyên).
function migrateTiktokMode(cfg) {
  if (cfg && cfg.creatorLive) {
    cfg.tiktokCombine = true;
    cfg.creatorLive = false;
  }
  return cfg;
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

// Combo x10/x1000 (giftType 1): TikTok gửi NHIỀU nhịp repeatCount tăng dần rồi 1 gói chốt repeatEnd.
// Hàm này trả về SỐ QUÀ MỚI của nhịp hiện tại (delta) để cộng NGAY — KHÔNG chờ gói chốt. Nhờ vậy
// KHÔNG mất quà khi TikTok gửi gói repeatEnd muộn HOẶC rớt mạng (chính là lỗi "tặng 2 quà chỉ nhận 1":
// gói chốt của combo thứ 2 bị rớt → cách cũ gate theo shouldProcess bỏ luôn quà đó). Mỗi combo khoá
// riêng theo NGƯỜI + QUÀ nên nhiều người combo cùng lúc vẫn đúng (không đúp, không bỏ sót).
//   • Quà KHÔNG combo (giftType != 1): trả thẳng repeatCount (mỗi event là 1 lần độc lập).
//   • Trả 0 = nhịp này đã cộng ở lần trước rồi → engine phải bỏ qua (return).
// LƯU Ý: engine dùng hàm này PHẢI được gọi trên MỌI nhịp quà (không gate theo shouldProcess nữa).
function comboDelta(map, ev) {
  const repeat = Math.max(1, Number(ev.repeatCount) || 1);
  if (Number(ev.giftType) !== 1) return repeat;
  const key = `${ev.uniqueId || ev.nickname || ev.avatar || 'anonymous'}:${ev.giftId || ev.giftName || 'gift'}`;
  const previous = map.get(key);
  let delta = repeat;
  if (previous) {
    if (repeat > previous.count) delta = repeat - previous.count;
    // Counter của một combo chỉ tăng. Quay về 1 nghĩa là combo MỚI, kể cả khi
    // repeatEnd của combo trước bị rớt và người dùng tặng tiếp ngay lập tức.
    else if (repeat < previous.count || (repeat === 1 && !ev.repeatEnd)) delta = repeat;
    else delta = 0;
  }
  if (ev.repeatEnd) map.delete(key);
  else map.set(key, { count: repeat });
  return delta;
}

// ----------------- STICKER DANCE -----------------
// Bảng lưới rows×cols, mỗi ô gán 1 quà + nhãn chữ + số đếm. Engine giữ CẤU HÌNH lưới và
// SỐ LIỆU RUNTIME theo giftId, phát state qua SSE để overlay OBS tự vẽ (giống PkGroupEngine).
// - received: tổng quà đã nhận (cho mọi ô, kể cả quà không có clip nhạc).
// - performed: số clip/hiệu ứng của quà đó đã phát XONG (renderer báo về qua signal) — dùng cho đếm lùi.
// - performingId (ngoài rt): giftId DUY NHẤT đang biểu diễn (để phóng to icon). Chỉ 1 quà diễn một lúc
//   nên lưu thẳng id thay vì bộ đếm +/- — tránh icon "kẹt to" khi lệch tín hiệu start/end.
class StickerEngine {
  constructor({ onState, onRankingPoints, getCreators }) {
    this.onState = onState;
    // Liên kết THI ĐẤU NHÓM: mỗi quà rơi vào ô có creatorId (hoặc quà = Quà mặc định của Creator)
    // → cộng realtime cho Creator đó.
    this.onRankingPoints = typeof onRankingPoints === 'function' ? onRankingPoints : null;
    this.getCreators = typeof getCreators === 'function' ? getCreators : () => [];
    this.config = {
      content: 'STICKER DANCE',
      linkRanking: false, // ☑️ Liên kết với THI ĐẤU NHÓM: cộng realtime điểm ô quà cho Creator gắn ô
      rows: 3,
      cols: 5,
      countMode: 'countdown',  // 'cumulative' (đếm tăng) | 'countdown' (đếm lùi = đang chờ biểu diễn)
      labelPos: 'top',         // 'top' | 'bottom'
      labelLong: 'scroll',     // Hàng DÀI: 'scroll' (chạy ngang, mặc định) | 'clip' (cắt …). Enter = xuống dòng luôn được giữ.
      labelScrollSpeed: 3,     // tốc độ chạy ngang khi labelLong='scroll' (1..10)
      cells: [],               // [{ row, col, giftId, giftName, icon, diamond, text }]
      bg: '#1f1f1f',
      bgOpacity: 79,
      iconSize: 79,
      textSize: 18,
      overlayScale: 100,
      gap: 14,
      colGap: 9,               // khoảng cách NGANG (giữa cột)
      rowGap: -19,             // khoảng cách DỌC (giữa hàng)
      animIcon: false,
      enlargeTop: true,        // phóng to quà nhiều điểm nhất
      perfBg: 'gold',          // hiệu ứng NỀN ô đang biểu diễn: none|gold|pink|blue|dark
      perfBorder: 'ring',      // hiệu ứng VIỀN ô đang biểu diễn: none|glow|neon|rainbow|ring
      perfName: 'random',      // kiểu NHÃN TÊN người đang diễn: random|pill|metal|rainbow|eq|lights
      perfSparkle: true,       // hạt lấp lánh quanh ô đang biểu diễn
      perfRipple: true,        // vòng sáng lan toả
      perfShine: true,         // tia sáng quét ngang panel
      perfNotes: true,         // nốt nhạc bay lên
      showMedals: true,        // huy chương 🥇🥈🥉 cho 3 ô nhiều điểm nhất
      showCrown: true,         // vương miện 👑 trên ô nhiều điểm nhất
      showLevelUp: true,       // hiệu ứng "LEVEL UP" khi ô đạt mục tiêu
      eggWhenZero: true,       // count=0 → hiện QUẢ TRỨNG thay số 0; có quà → trứng nở ra ("đập trứng")
      eggSize: 56,             // cỡ quả trứng (% so với icon), 40–140
      eggSkin: 'dino',         // skin vỏ trứng: ivory|gold|pink|blue|dino (khủng long đốm)
      eggSkinRandom: true,     // true → mỗi ô bốc skin ngẫu nhiên, đổi lại mỗi lần trứng tái tạo
      streakEnabled: true,     // GIỮ CHUỖI: quà còn "máu chuỗi" được ưu tiên lên diễn
      streakSeconds: 10,       // thời lượng thanh máu chuỗi (giây)
      streakSteal: true,       // CƯỚP CHUỖI: cắt ngang quà đang phát khi quà khác còn máu vượt số lượng
      streakBarColor: 'tiktok',// màu thanh máu chuỗi: tiktok (hồng đỏ) | blue (xanh) | health (xanh→đỏ theo mức)
    };
    this.rt = {}; // giftId -> { received, performed, points }
    // Chỉ MỘT quà biểu diễn tại một thời điểm (là 'current' của hàng đợi nhạc bên renderer).
    // Lưu thẳng giftId đang diễn thay vì đếm +/- (bộ đếm dễ lệch → icon kẹt to khi thiếu/thừa 1 tín hiệu).
    this.performingId = '';
    this.queuedByGift = {}; // giftId -> số lượt đang chờ/đang phát trong HÀNG ĐỢI HIỆU ỨNG (nguồn cho đếm lùi)
    this.queuedByGiftName = {}; // tên quà (thường hoá) -> số lượt; dự phòng khi giftId mục nhạc lệch giftId ô lưới
    this.streaks = {}; // giftId -> mốc hết chuỗi (ms, Date.now); renderer đẩy sang để overlay vẽ thanh máu
    this._comboRepeats = new Map(); // khoá combo theo người+quà (đếm delta, không mất quà khi gói chốt rớt)
  }
  setConfig(patch) {
    this.config = { ...this.config, ...(patch || {}) };
    this.config.cells = Array.isArray(this.config.cells) ? this.config.cells : [];
    this._emit();
  }
  reset() { this.rt = {}; this.performingId = ''; this.queuedByGift = {}; this.queuedByGiftName = {}; this._comboRepeats.clear(); this._emit(); }
  // Renderer đẩy toàn bộ số lượt còn trong hàng đợi (theo giftId) mỗi khi hàng đợi đổi.
  // Đây là NGUỒN SỰ THẬT cho chế độ "Đếm lùi" → khớp tuyệt đối với "Đang chờ" và tự trừ dần khi phát.
  setQueued(pending, pendingByName) {
    const next = {};
    if (pending && typeof pending === 'object') {
      for (const k of Object.keys(pending)) next[String(k)] = Math.max(0, Number(pending[k]) || 0);
    }
    this.queuedByGift = next;
    const nextN = {};
    if (pendingByName && typeof pendingByName === 'object') {
      for (const k of Object.keys(pendingByName)) nextN[String(k).toLowerCase()] = Math.max(0, Number(pendingByName[k]) || 0);
    }
    this.queuedByGiftName = nextN;
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
    // Đếm theo delta để KHÔNG mất combo khi gói chốt repeatEnd rớt/muộn (xem comboDelta).
    const rep = comboDelta(this._comboRepeats, ev);
    if (!rep) return;
    const dia = Math.max(0, resolveDiamond(ev));
    let matched = false;
    for (const c of (this.config.cells || [])) {
      if (giftMatches(c, ev)) {
        const rt = this._rtFor(c.giftId);
        rt.received += rep;
        rt.points += dia * rep;
        matched = true;
        // Liên kết BXH: cộng realtime cho Creator gắn ô này. Ưu tiên c.creatorId, không có thì
        // suy ra từ Quà mặc định của Creator (đúng cách nút "👤 Creator" dựng danh sách).
        if (this.config.linkRanking && this.onRankingPoints) {
          let cid = c.creatorId;
          if (!cid) {
            const cr = (this.getCreators() || []).find(x =>
              (x.defaultGiftId && String(x.defaultGiftId) === String(c.giftId || '')) ||
              (x.defaultGiftName && _normName(x.defaultGiftName) === _normName(c.giftName)));
            cid = cr && cr.id;
          }
          if (cid) this.onRankingPoints(cid, dia * rep, ev);
        }
      }
    }
    if (matched) this._emit();
  }
  // Renderer báo trạng thái phát clip (chỉ với quà có clip trong DANH SÁCH NHẠC):
  //  perform-start → đang biểu diễn; perform-end → phát xong (đếm lùi thì performed++).
  signal({ type, giftId, pending, pendingByName, streaks } = {}) {
    if (type === 'queue') { this.setQueued(pending, pendingByName); return; }
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
      // Khớp theo giftId trước, lệch thì khớp theo TÊN (giống cách phát nhạc) → quà gán nhạc vẫn nở trứng.
      const count = mode === 'countdown'
        ? (this.queuedByGift[String(c.giftId || '')] || this.queuedByGiftName[String(c.giftName || '').toLowerCase()] || 0)
        : rt.received;
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
      labelLong: this.config.labelLong === 'clip' ? 'clip' : 'scroll',
      labelScrollSpeed: Math.max(1, Math.min(10, Number(this.config.labelScrollSpeed) || 4)),
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
      perfName: ['random', 'pill', 'metal', 'rainbow', 'eq', 'lights'].includes(this.config.perfName) ? this.config.perfName : 'random',
      perfSparkle: !!this.config.perfSparkle,
      perfRipple: !!this.config.perfRipple,
      perfShine: !!this.config.perfShine,
      perfNotes: !!this.config.perfNotes,
      showMedals: this.config.showMedals !== false,
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
      layout: ['horizontal', 'vertical', 'attached'].includes(c.layout) ? c.layout : 'attached',
      avatarSize: _mvpClamp(c.avatarSize, 60, 400, 150),
      frameScale: _mvpClamp(c.frameScale, 80, 300, 150),
      nameSize: _mvpClamp(c.nameSize, 12, 120, 40),
      fontSize: _mvpClamp(c.fontSize, 12, 140, 40),
      color: _mvpHex(c.color, '#ffffff'),
      textStyle: ['solid', 'gradient', 'neon', 'plaque'].includes(c.textStyle) ? c.textStyle : 'solid',
      bgColor: _mvpHex(c.bgColor, '#e84c88'),
      bgColor2: _mvpHex(c.bgColor2, '#7a3cff'),
      bgOpacity: _mvpClamp(c.bgOpacity, 0, 100, 100),
      entryAnim: ['none', 'popBounce', 'zoomFade', 'slideRight', 'slideUp', 'flip', 'dropBounce', 'spotlight', 'zoomShake'].includes(c.entryAnim) ? c.entryAnim : 'popBounce',
      showName: !!c.showName,
      showText: c.showText !== false,
      usePlaqueImg: c.usePlaqueImg !== false,
      celebrate: !!c.celebrate,
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
    const canvas = ['1:1', '3:4', '9:16'].includes(this.config.canvas) ? this.config.canvas : '1:1';
    const reveal = {
      revealNonce: _mvpNum(this.config.revealNonce, 0),
      revealStagger: _mvpClamp(this.config.revealStagger, 0, 5, 0.6),
      revealAutoHide: _mvpClamp(this.config.revealAutoHide, 0, 120, 0),
      revealSound: this.config.revealSound !== false,
      revealExit: ['fade', 'slideDown', 'zoomOut'].includes(this.config.revealExit) ? this.config.revealExit : 'fade',
      autoPlay: !!this.config.autoPlay,   // AUTO: xoay vòng liên tục từng khung avatar
    };
    return { cards, canvas, ...reveal };
  }
  _emit() { try { this.onState(this.getStateForOverlay()); } catch {} }
}

// ----------------- Vòng quay may mắn (Lucky Wheel) -----------------
// Ô = thông tin do người dùng ghi (phần thưởng / hình phạt / ghi chú). Mỗi ô có trọng số quay riêng,
// máy chủ chọn ô trúng rồi phát lệnh quay {spinId, index, landingOffset, edgeCatch, duration} qua SSE → overlay OBS quay tới đúng ô đó.
// Kết quả lưu vào history (kèm tên người quay) để dựng lịch sử + bảng thống kê.
const _LW_PALETTE = ['#ff3d71', '#00e0c7', '#7a5cff', '#ff9f1c', '#2ec4ff', '#ff5db1', '#38d67a', '#ffd23f', '#c86bff', '#4c8dff'];
const _LW_OVERLAY_REVISION = 13;
function _lwHex(v, def) { return /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? v : def; }
function _lwNum(v, def, min, max) { let n = Number(v); if (!isFinite(n)) n = def; return Math.max(min, Math.min(max, n)); }
class LuckyWheelEngine {
  constructor({ onState }) {
    this.onState = onState;
    this.config = {
      title: 'VÒNG QUAY MAY MẮN',
      showTitle: true,          // hiện tiêu đề trên OBS/Review
      style: 'neon',            // neon | gold | pastel | dark
      fontScale: 100,           // % cỡ chữ trên ô (50–200)
      spinSeconds: 5,
      slowSec: 3,               // độ "chậm rải dần" ở đoạn cuối (0–6): càng lớn càng bò từng chút rồi mới dừng
      sound: true,
      confetti: true,
      showResult: true,
      showCount: true,          // hiện bộ đếm lượt quay trên OBS
      edgeStops: true,          // thỉnh thoảng dừng sát vạch ngăn ô, nhưng vẫn trong ô trúng
      autoRemove: false,        // quay trúng ô nào thì tự xoá ô đó (bốc số/rút thăm không lặp) — bảng điều khiển xử lý
      spinCount: 0,             // số lượt đã quay (trừ tay được khi xoá lượt lỗi)
      selectedSpinner: null,    // người đang chọn trước khi quay, để tâm vòng quay đồng bộ với bảng điều khiển
      segments: [],             // [{ id, text, note, type: reward|penalty|info, color, weight, jackpot }]
      history: [],              // [{ id, time, member, segId, text, note, type }]
    };
    this.spin = null;           // { spinId, index, landingOffset, edgeCatch, result, duration, startAt, spinner:{name,avatar} }
    this._seq = 0;
    this._stateRevision = 0;    // chặn HTTP fallback trả state cũ sau event SSE mới hơn
  }
  setConfig(patch) {
    const p = patch || {};
    this.config = { ...this.config, ...p };
    if (!Array.isArray(this.config.segments)) this.config.segments = [];
    this.config.segments = this.config.segments.map((s, i) => ({
      ...s,
      weight: _lwNum(s?.weight, 10, 1, 100),
      jackpot: s?.jackpot === true,
      won: s?.won === true,     // xám trong danh sách app (không ảnh hưởng OBS)
      drawn: s?.drawn === true, // đã loại khỏi vòng quay (OBS lọc theo cờ này)
      color: _lwHex(s?.color, _LW_PALETTE[i % _LW_PALETTE.length]),
    }));
    const selected = this.config.selectedSpinner;
    this.config.selectedSpinner = selected?.name ? { id: String(selected.id || ''), name: String(selected.name), avatar: String(selected.avatar || '') } : null;
    if (!Array.isArray(this.config.history)) this.config.history = [];
    this._emit();
  }
  reset() { this.spin = null; this._emit(); }
  clearHistory() { this.config.history = []; this.config.spinCount = 0; this._emit(); }
  setCount(n) { this.config.spinCount = Math.max(0, Math.round(Number(n) || 0)); this._emit(); }
  adjustCount(delta) { this.config.spinCount = Math.max(0, (this.config.spinCount || 0) + (Math.round(Number(delta) || 0))); this._emit(); }
  removeHistory(id) {
    const before = (this.config.history || []).length;
    this.config.history = (this.config.history || []).filter(h => h && h.id !== id);
    // Xoá lượt lỗi bằng tay → tự trừ bộ đếm để số lượt luôn đúng.
    if (this.config.history.length < before) this.config.spinCount = Math.max(0, (this.config.spinCount || 0) - 1);
    this._emit();
  }
  doSpin({ spinner } = {}) {
    // Vòng quay chỉ gồm ô CHƯA quay (drawn=false). index trả về tính theo tập này để
    // OBS/preview (vẽ đúng tập này) dừng khớp ô. Ô đã quay do bảng điều khiển làm xám.
    const segs = (this.config.segments || []).filter(s => !s.drawn);
    if (!segs.length) return null;
    const totalWeight = segs.reduce((sum, seg) => sum + _lwNum(seg.weight, 10, 1, 100), 0);
    let pick = Math.random() * totalWeight;
    let index = segs.length - 1;
    for (let i = 0; i < segs.length; i++) {
      pick -= _lwNum(segs[i].weight, 10, 1, 100);
      if (pick < 0) { index = i; break; }
    }
    const seg = segs[index] || {};
    const duration = _lwNum(this.config.spinSeconds, 5, 2, 15);
    const slowSec = _lwNum(this.config.slowSec, 3, 0, 6);
    // Độ lệch tính theo nửa ô (-.5 đến .5). Một phần lượt cố ý sát vạch,
    // nhưng luôn chừa biên để kết quả chọn ở đây không bao giờ đổi sang ô khác.
    const nearEdge = this.config.edgeStops !== false && Math.random() < 0.32;
    const offsetMin = nearEdge ? 0.37 : 0.04;
    const offsetMax = nearEdge ? 0.465 : 0.34;
    const landingOffset = (Math.random() < 0.5 ? -1 : 1) * (offsetMin + Math.random() * (offsetMax - offsetMin));
    // Chỉ các lượt sát vạch nhất mới có nhịp "mắc kim". Cờ này được gửi cho mọi client
    // để preview và OBS cùng vượt vạch rồi bật lại về ô đã chọn.
    const edgeCatch = nearEdge && Math.abs(landingOffset) > 0.425;
    this._seq += 1;
    const spinId = 'sp_' + Date.now().toString(36) + '_' + this._seq;
    const sp = (spinner && spinner.name) ? { name: String(spinner.name), avatar: String(spinner.avatar || '') } : null;
    // Snapshot bất biến: mọi overlay hiển thị đúng kết quả đã chốt, không phụ thuộc
    // danh sách ô có bị sửa trong lúc quay hay client nhận state chậm.
    const result = { id: seg.id || '', text: seg.text || '', note: seg.note || '', type: seg.type || 'info', jackpot: seg.jackpot === true };
    this.spin = { spinId, index, landingOffset, edgeCatch, result, duration, slowSec, startAt: Date.now(), spinner: sp };
    const rec = {
      id: spinId,
      time: new Date().toISOString(),
      member: sp ? sp.name : '',
      segId: result.id, text: result.text, note: result.note, type: result.type,
    };
    this.config.history.unshift(rec);
    if (this.config.history.length > 300) this.config.history.length = 300;
    this.config.spinCount = (this.config.spinCount || 0) + 1;
    this._emit();
    return { spinId, index, landingOffset, edgeCatch, record: rec, spinCount: this.config.spinCount };
  }
  getStateForOverlay() {
    const c = this.config;
    return {
      overlayRevision: _LW_OVERLAY_REVISION,
      stateRevision: this._stateRevision,
      title: c.title || '',
      showTitle: c.showTitle !== false,
      style: ['neon', 'gold', 'pastel', 'dark'].includes(c.style) ? c.style : 'neon',
      fontScale: _lwNum(c.fontScale, 100, 50, 200),
      spinSeconds: _lwNum(c.spinSeconds, 5, 2, 15),
      slowSec: _lwNum(c.slowSec, 3, 0, 6),
      sound: c.sound !== false,
      confetti: c.confetti !== false,
      showResult: c.showResult !== false,
      showCount: c.showCount !== false,
      edgeStops: c.edgeStops !== false,
      spinCount: Math.max(0, Math.round(Number(c.spinCount) || 0)),
      selectedSpinner: c.selectedSpinner,
      // Chỉ gửi ô CHƯA quay → vòng quay trên OBS bỏ hẳn ô đã quay (đồng bộ với index doSpin).
      segments: (c.segments || []).filter(s => !s.drawn).map((s, i) => ({
        id: s.id, text: String(s.text || ''), note: String(s.note || ''),
        type: ['reward', 'penalty', 'info'].includes(s.type) ? s.type : 'info',
        color: _lwHex(s.color, _LW_PALETTE[i % _LW_PALETTE.length]),
        weight: _lwNum(s.weight, 10, 1, 100),
        jackpot: s.jackpot === true,
      })),
      spin: this.spin,
    };
  }
  _emit() {
    this._stateRevision += 1;
    try { this.onState(this.getStateForOverlay()); } catch {}
  }
}

// ----------------- Ranking (BXH theo creator hoặc nhóm) -----------------
// Schema theo spec BIGO port: rows[] với {id, rank, name, avatar, initials, points,
// round, giftIconId, giftIcon, giftName, hideScore, lost, active, activePoints}
class RankingEngine {
  constructor({ onState, getCreators, getGroups, getActiveFighters, getCreatorById }) {
    this.onState = onState;
    this.getCreators = getCreators;
    this.getGroups = getGroups;
    // Tra Creator theo id (có cache) — dùng ở addLivePoints để đổi creatorId→group + xác thực id.
    this.getCreatorById = typeof getCreatorById === 'function' ? getCreatorById : (id) => this.getCreators().find(x => String(x.id) === String(id)) || null;
    // Ai đang thi đấu PK (Đôi/Nhóm) đã Liên kết → đánh dấu hàng Creator đó bằng FX chọn nhân vật.
    this.getActiveFighters = typeof getActiveFighters === 'function' ? getActiveFighters : () => null;
    this.config = {
      mode: 'creator', // 'creator' | 'group'
      title: 'TOP IDOL',
      maxRows: 10,
      rankFrom: 1,
      rankTo: 0,
      pointsBy: 'diamond',
      nameMode: 'two-line', // 'two-line' | 'marquee'
      nameMaxChars: 6, // Chạy chữ khi tên DÀI HƠN số ký tự này (đếm code-point: emoji/dấu cách = 1). User chỉnh.
      // Mặc định 6: bảng ôm sát vùng điểm hơn; tên ~7 ký tự trở lên tự cuộn, tên ngắn (≤6) đứng yên.
      streakColor: '#67e8f9',
      overlayTitleColor: '#ffffff',
      overlayBgColor: '#2a2d37',
      overlayBoardColor: '#000000',
      overlayBgOpacity: 70,
      overlayBoardOpacity: 75,
      activeBgColor: '#ffca3a',  // (A) màu nền hàng được VOTE (tách riêng khỏi màu viền Active)
      activeBgOpacity: 55,       // (A) độ đậm nền Active % (mờ nhẹ ↔ đậm)
      activeBgFx: 'gold',        // (B) kiểu FX độc lập: shine|neon|gold|rainbow|royal|plasma|flash|live
      activeBarSync: false,      // đồng bộ Màu nền + Kiểu FX sang Thanh dưới (người dẫn đầu)
      hideAllScores: false,
      showRank: true,
      showAvatar: true,
      showGift: true,
      showRound: true,
      showGroupName: true,      // hiện tên NHÓM dưới tên idol; tự tắt khi chọn riêng 1 nhóm (đỡ lặp, thanh gọn hơn)
      showTopColors: true,      // tô màu nền kim-bạc-đồng cho TOP 1/2/3; tắt = nền đồng đều, chỉ khác vương miện bên trái
      showPerfOrder: true,      // STT từ Vòng quay: tắt chỉ ẩn trên OBS, không xoá dữ liệu Creator
      showActive: true,         // thanh xanh dưới cùng: người dẫn đầu/đang nổi bật (dọc + ngang)
      gridRows: 3,
      gridCols: 3,
      gridFlow: 'row',
      avatarScale: 130,
      giftScale: 145,
      overlayScale: 100,
      scoreFloor: 0,           // Điểm sàn cộng vào Mục tiêu tự tính khi VOTE (0 = tính bình thường)
      skin: 'auto',            // 🎨 Skin mùa lễ (chỉ trang trí; auto = theo ngày). Xử lý ở overlay-skin.js.
    };
    // Snapshot scores tích lũy theo round
    this.round = 0;
    this.scores = {}; // key (creatorId hoặc groupId) -> { points, lastGiftId, lastGiftIcon, lastGiftName }
    this.activeId = null;
    this._comboRepeats = new Map(); // khoá combo theo người+quà (đếm delta, không mất quà khi gói chốt rớt)
  }
  setConfig(patch) { this.config = { ...this.config, ...patch }; this._emit(); }
  // Chống mất khi văng: chụp/khôi phục điểm tích luỹ realtime (config lưu riêng, không đụng ở đây).
  snapshotRuntime() { return { round: this.round, scores: this.scores, activeId: this.activeId }; }
  restoreRuntime(s) {
    if (!s || typeof s !== 'object') return;
    if (s.scores && typeof s.scores === 'object') this.scores = s.scores;
    if (Number.isFinite(Number(s.round))) this.round = Number(s.round);
    if (s.activeId != null) this.activeId = s.activeId;
  }
  reset() { this.scores = {}; this.activeId = null; this._comboRepeats.clear(); this._emit(); }
  startRound() { this.round++; this.scores = {}; this._comboRepeats.clear(); this._emit(); }
  setActive(id) { this.activeId = id; this._emit(); }

  // Cộng điểm LIVE cho 1 Creator từ nguồn bên ngoài (trò chơi đang Liên kết THI ĐẤU NHÓM).
  // Điểm vào cùng "scores" như quà mặc định → hiện realtime; Chốt vòng gom vào điểm chính thức.
  addLivePoints(creatorId, points, ev = {}) {
    let key = String(creatorId || '');
    const pts = Number(points) || 0;
    if (!key || !pts) return;
    // XÁC THỰC creatorId có thật không. Trò chơi có thể còn gắn Creator đã bị xoá/đổi id → điểm rơi
    // vào "bucket mồ côi" mà KHÔNG hàng nào đọc (creator mode đọc scores[c.id], group mode đọc
    // scores[groupId]) → mất im lặng. Cảnh báo ra console để soi được thay vì âm thầm sai/lệch.
    const creator = this.getCreatorById(key);
    if (!creator) {
      console.warn('[ranking] addLivePoints: creatorId không khớp Creator nào →', key,
        '(điểm liên kết realtime sẽ KHÔNG hiện; kiểm tra lại phe/participant/ô quà đã gắn Creator)');
    }
    // Chế độ NHÓM: gom điểm theo NHÓM của Creator (khớp routeGift + overlay đọc scores[groupId]).
    // Không resolve được Creator → dồn vào '_nogroup' (vẫn HIỆN được) thay vì key lạ (vô hình).
    if (this.config.mode === 'group') {
      key = creator ? String(creator.groupId || '_nogroup') : '_nogroup';
    }
    if (!this.scores[key]) this.scores[key] = { points: 0, lastGiftId: '', lastGiftIcon: '', lastGiftName: '' };
    this.scores[key].points += pts;
    if (ev.giftId) this.scores[key].lastGiftId = String(ev.giftId || '');
    if (ev.giftIcon) this.scores[key].lastGiftIcon = ev.giftIcon || '';
    if (ev.giftName) this.scores[key].lastGiftName = ev.giftName || '';
    this.activeId = key;
    this._emit();
  }

  // suppressAuto=true: có trò chơi đang Liên kết → NGƯNG tự cộng theo quà mặc định (tránh cộng trùng).
  // voteStarted=false: đã VOTE nhưng CHƯA có hiệu lệnh BẮT ĐẦU (Tính điểm chạy / trận Liên kết chạy)
  //   → VOTE chỉ ĐÁNH DẤU hàng, TUYỆT ĐỐI không cộng điểm từ quà. Tránh vừa bấm VOTE là có người
  //   tặng quà tự lên điểm trong khi chưa phát lệnh bắt đầu.
  routeGift(ev, suppressAuto = false, voteStarted = true) {
    const creators = this.getCreators();
    const voted = this.config.mode === 'creator' ? creators.find(c => !!c.voteActive) : null;
    // Có Creator đang VOTE nhưng chưa có hiệu lệnh bắt đầu → không nhận điểm (chỉ giữ highlight qua voteActive).
    if (voted && !voteStarted) return;
    if (suppressAuto && !voted) return;
    // Tắt ô "Quà" = ngưng TỰ cộng điểm theo quà mặc định. Vẫn cho VOTE (chấm thủ công) hoạt động,
    // vì khi có Creator đang VOTE mọi điểm được điều khiển có chủ đích, không phải auto theo quà.
    if (this.config.showGift === false && !voted) return;
    // Đếm theo delta để KHÔNG mất combo khi gói chốt repeatEnd rớt/muộn (xem comboDelta).
    const repeat = comboDelta(this._comboRepeats, ev);
    if (!repeat) return;
    const pts = this.config.pointsBy === 'diamond'
      ? Math.max(1, resolveDiamond(ev)) * repeat
      : repeat;
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
    // Người đang thi đấu PK (Đôi/Nhóm) đã Liên kết → đánh dấu hàng của họ (chỉ chế độ Creator).
    const fighters = this.config.mode === 'creator' ? this.getActiveFighters() : null;
    let rows = [];
    if (this.config.mode === 'creator') {
      rows = creators.filter(c => !c.hideObs && (!activeGroupId || c.groupId === activeGroupId)).map(c => {
        const sc = this.scores[c.id] || {};
        const g = groups.find(x => x.id === c.groupId);
        return {
          id: c.id,
          inMatch: !!(fighters && fighters.ids.has(String(c.id))),
          matchTeam: fighters ? (fighters.teamOf.get(String(c.id)) || '') : '', // 'A'/'B' (PK Đôi) → màu phe
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
          perfOrder: Number(c.perfOrder) || 0, // Số thứ tự thi đấu (gán từ VÒNG QUAY) — chip góc trên-trái
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
      nameMaxChars: Math.max(3, Math.min(40, Number(this.config.nameMaxChars) || 6)),
      streakColor: this.config.streakColor,
      overlayTitleColor: this.config.overlayTitleColor,
      overlayBgColor: this.config.overlayBgColor,
      overlayBoardColor: this.config.overlayBoardColor,
      overlayBgOpacity: this.config.overlayBgOpacity,
      overlayBoardOpacity: this.config.overlayBoardOpacity,
      activeBgColor: this.config.activeBgColor,
      activeBgOpacity: this.config.activeBgOpacity,
      activeBgFx: this.config.activeBgFx,
      activeBarSync: this.config.activeBarSync,
      hideAllScores: this.config.hideAllScores,
      showRank: this.config.showRank,
      showAvatar: this.config.showAvatar,
      showGift: this.config.showGift,
      showRound: this.config.showRound,
      showGroupName: this.config.showGroupName !== false,
      showTopColors: this.config.showTopColors !== false,
      showPerfOrder: this.config.showPerfOrder !== false,
      showActive: this.config.showActive,
      gridRows: this.config.gridRows,
      gridCols: this.config.gridCols,
      gridFlow: this.config.gridFlow,
      avatarScale: this.config.avatarScale,
      giftScale: this.config.giftScale,
      overlayScale: this.config.overlayScale,
      scoreFloor: this.config.scoreFloor,
      skin: this.config.skin || 'auto',
      rows,
      // Kiểu FX đánh dấu người đang thi đấu PK (Đôi/Nhóm) đã Liên kết — 'off' nếu không có ai đang đấu.
      selectFx: fighters ? fighters.fx : 'off',
      active: activeRow ? { name: activeRow.name, avatar: activeRow.avatar, avatarKey: activeRow.avatarKey, avatarVersion: activeRow.avatarVersion, initials: activeRow.initials, points: activeRow.points } : null,
    };
  }
  _emit() { try { this.onState(this.getStateForOverlay()); } catch {} }
}

// ----------------- Score (challenge gọi quà đạt mục tiêu) -----------------
// State machine: idle → prestart → running → grace → success | failed
const SCORE_THEME_IDS = new Set(['douyin', 'vip', 'neon', 'battle', 'luxury', 'sunset', 'ocean', 'candy']);
const SCORE_THEME_FALLBACK = { themePreset: 'douyin', barColor1: '#b93678', barColor2: '#ff8ed1', waveColor: '#ffffff', overColor: '#ffffff' };
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
      creatorId: '', // id Creator đang tính điểm — để lọc quà theo người nhận (LIVE nhóm)
      content: '',
      themePreset: 'douyin',
      skin: 'auto', // 🎨 Skin mùa lễ (chỉ trang trí; auto = theo tháng/sự kiện). Xử lý ở overlay-skin.js.
      overlaySize: 'medium',
      barStyle: 'pill',
      cardLayout: false, // (cũ, giữ tương thích) false = Thanh ngang · true = Thẻ HUD góc
      scoreLayout: 'bar', // KIỂU: 'bar' ĐƯỜNG ĐUA · 'card' KÊU GỌI · 'timer' THỜI GIAN
      timerTop5: true, // THỜI GIAN: hiện cụm TOP 5 người tặng (avatar nửa chồng nhau) ở góc trên
      timerTailColor: '#a15cf0', // THỜI GIAN: màu lem cuối thanh (trong suốt dần về đồng hồ)
      timerFinalTick: true, // THỜI GIAN: tiếng "tick" 10 giây cuối
      compactMode: false,
      timeColor: '#ffffff',
      scoreFontSize: 18,
      contentColor: '#f0eef6',
      overColor: '#ffffff',
      barColor1: '#b93678',
      barColor2: '#ff8ed1',
      waveColor: '#ffffff',
      bigGiftThreshold: 500,
      showGiftUser: true,
      showTopUsers: true,
      showSpeed: false,
      hideAvatar: false,
      hideCreator: false,
      colorByProgress: false,
      kpiX2: false,
      kpiMult: 2,
      showRemaining: false,
      fxGlowBorder: false,
      fxGlass: false,
      fxSparkle: false,
      // FX riêng thẻ KÊU GỌI — BẬT sẵn cho bản release (cấu hình cũ không có key này → giữ mặc định bật khi cập nhật)
      fxSpotlight: true,
      fxAvatarAura: true,
      fxScoreBounce: true,
      fxFloatPoints: true,
      fxCardBreathe: true,
      fxLiquid: true,
      cardBgOpacity: 88,
      barBorderColor: '#ffffff',
      barBorderOpacity: 50,
      barBorderWidth: 1,
      startSound: '',
      warningSound: '',
      goalSound: '',
      successSound: '',
      failSound: '',
      pointsBy: 'diamond',
      overlayScale: 100,
      // ĐƯỜNG ĐUA (Douyin): người chạy theo màu chủ đề (bar) — bật ép hồng TikTok nếu muốn giữ nguyên chất Douyin.
      runnerForcePink: false,
      runnerBadgeMode: 'points', // points | combo | gift  (điểm / số combo / icon quà + số)
      avatarThreshold: 1000,     // quà ≥ ngưỡng này → hiện avatar người tặng trong huy hiệu
      runnerDust: true,          // bụi trắng "chờ tăng tốc" (tắt cho nhẹ OBS máy yếu)
      dashSound: '',             // tiếng "vút" khi quà lớn bứt tốc (tùy chọn)
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
    this._comboRepeats = new Map();
  }
  setConfig(patch = {}) {
    // Mốc thưởng đã bị loại bỏ; bỏ qua cấu hình cũ còn lưu trên máy người dùng.
    const { milestones, customMilestoneValues, milestoneGradientEnabled, ...next } = patch || {};
    if (Object.prototype.hasOwnProperty.call(next, 'themePreset') && next.themePreset !== 'custom' && !SCORE_THEME_IDS.has(next.themePreset)) Object.assign(next, SCORE_THEME_FALLBACK);
    this.config = { ...this.config, ...next };
    this._emit();
  }
  // Chống mất khi văng: chụp/khôi phục điểm + đồng hồ đang đếm (endAt là mốc tuyệt đối nên tiếp đúng giờ còn lại).
  snapshotRuntime() { return { state: this.state }; }
  restoreRuntime(s, opts = {}) {
    if (!s || !s.state || typeof s.state !== 'object') return;
    this.state = { ...this.state, ...s.state };
    // Chỉ chạy tiếp đồng hồ khi phiên trước vừa lưu; mở lại muộn thì đóng băng số điểm (khỏi tự tính thắng/thua).
    if (opts.resume && ['prestart', 'running', 'grace'].includes(this.state.status)) this._runTicker();
  }
  reset() {
    this._clearTicker();
    this._comboRepeats.clear();
    this.state = { score: 0, status: 'idle', endAt: 0, runStartedAt: 0, lastAdd: 0, lastAddUser: '', recentGifts: [], topUsers: [], resultAt: 0 };
    this._emit();
  }
  start() {
    if (this.state.status === 'running' || this.state.status === 'prestart') return;
    const now = Date.now();
    const prepMs = Math.max(0, Number(this.config.prepSec) || 0) * 1000;
    this.state.status = prepMs > 0 ? 'prestart' : 'running';
    this.state.score = 0;
    this.state.lastAdd = 0;
    this.state.lastAddUser = '';
    this.state.recentGifts = [];
    this.state.topUsers = [];
    this._comboRepeats.clear();
    this.state.endAt = prepMs > 0 ? now + prepMs : now + Math.max(0, Number(this.config.durationMs) || 0);
    this.state.runStartedAt = prepMs > 0 ? 0 : now;
    this._runTicker();
  }
  stop() {
    this._clearTicker();
    this._comboRepeats.clear();
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
    const repeat = comboDelta(this._comboRepeats, ev);
    if (!repeat) return;
    const pts = this.config.pointsBy === 'diamond'
      ? Math.max(1, resolveDiamond(ev)) * repeat
      : repeat;
    this.state.score += pts;
    this.state.lastAdd = pts;
    this.state.lastAddUser = ev.nickname || ev.uniqueId || '';
    this.state.recentGifts = [{
      user: ev.nickname || ev.uniqueId || 'Ẩn danh',
      userId: ev.uniqueId || '',
      avatar: ev.avatar || '',
      giftName: ev.giftName || 'Quà',
      giftIcon: ev.giftIcon || '',
      repeat,
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
      lastAddAvatar: this.state.recentGifts?.[0]?.avatar || '',
      lastAddRepeat: this.state.recentGifts?.[0]?.repeat || 0,
      lastAddIcon: this.state.recentGifts?.[0]?.giftIcon || '',
      lastAddAt: this.state.recentGifts?.[0]?.at || 0,
      recentGifts: this.state.recentGifts,
      topUsers: this.state.topUsers,
      resultAt: this.state.resultAt,
      timeText,
      remainingMs,
    };
  }
  _emit() { try { this.onState(this.getStateForOverlay()); } catch {} }
}

// ----------------- NHIỆM VỤ · BỘ BA (3 KPI: người tặng quà / tim / điểm) -----------------
// Đếm phiên theo toàn phòng: BẮT ĐẦU = mở đếm + reset về 0, Reset = về 0 + dừng.
// - donors: SỐ NGƯỜI khác nhau đã tặng quà (Set uniqueId)  → 送礼人数
// - likes:  TỔNG lượt tim tích luỹ từ lúc bắt đầu           → 点赞数量
// - points: TỔNG kim cương user tặng (diamond × repeat)     → điểm
// Hai overlay TÁCH RỜI (Dọc / Ngang) chia sẻ CÙNG bộ đếm + KPI, nhưng LƯU thông số hình học
// RIÊNG theo từng bố cục để chỉnh cái này không đụng cái kia. Mặc định Dọc = ảnh 1, Ngang = ảnh 2.
const MISSION_TRIO_GEO_V = { boxWidth: 300, gap: 14, titleFontSize: 30, valueFontSize: 35, overlayScale: 200 };
const MISSION_TRIO_GEO_H = { boxWidth: 180, gap: 150, titleFontSize: 25, valueFontSize: 20, overlayScale: 200 };
class MissionTrioEngine {
  constructor({ onState }) {
    this.onState = onState;
    this.config = {
      barColor1: '#ff2f87',      // màu đậm (mép đang tiến) — dùng chung
      barColor2: '#ff8ed1',      // màu nhạt (đầu thanh) — dùng chung
      borderAlpha: 0.55,         // độ mờ viền trắng (0.1–1) — dùng chung
      order: ['donors', 'likes', 'points'],
      items: {
        donors: { enabled: true, label: 'Người tặng', target: 100 },
        likes: { enabled: true, label: 'Số tim', target: 50000 },
        points: { enabled: true, label: 'Số điểm', target: 100000 },
      },
      vertical: { ...MISSION_TRIO_GEO_V },   // thông số riêng cho overlay Dọc
      horizontal: { ...MISSION_TRIO_GEO_H }, // thông số riêng cho overlay Ngang
    };
    this.state = { running: false, donors: new Set(), likes: 0, points: 0 };
    this._comboRepeats = new Map(); // khoá combo theo người+quà (đếm delta, không mất quà khi gói chốt rớt)
  }
  setConfig(patch) {
    patch = patch || {};
    // Merge sâu items (giữ field cũ khi patch thiếu) + merge riêng từng bố cục.
    const items = { ...this.config.items };
    if (patch.items && typeof patch.items === 'object') {
      for (const k of Object.keys(patch.items)) items[k] = { ...items[k], ...patch.items[k] };
    }
    const vertical = { ...MISSION_TRIO_GEO_V, ...this.config.vertical, ...(patch.vertical || {}) };
    const horizontal = { ...MISSION_TRIO_GEO_H, ...this.config.horizontal, ...(patch.horizontal || {}) };
    const order = Array.isArray(patch.order) && patch.order.length
      ? patch.order.filter(k => items[k])
      : this.config.order;
    for (const k of Object.keys(items)) if (!order.includes(k)) order.push(k);
    this.config = {
      barColor1: patch.barColor1 || this.config.barColor1,
      barColor2: patch.barColor2 || this.config.barColor2,
      borderAlpha: Number.isFinite(+patch.borderAlpha) ? +patch.borderAlpha : this.config.borderAlpha,
      order, items, vertical, horizontal,
    };
    this._emit();
  }
  start() { this.state = { running: true, donors: new Set(), likes: 0, points: 0 }; this._comboRepeats.clear(); this._emit(); }
  reset() { this.state = { running: false, donors: new Set(), likes: 0, points: 0 }; this._comboRepeats.clear(); this._emit(); }
  stop() { this.state.running = false; this._comboRepeats.clear(); this._emit(); }
  routeGift(ev) {
    if (!this.state.running) return;
    // Người tặng: mỗi user tính ĐÚNG 1 lần dù tặng 1 coin hay 10.000 coin, dù nhiều quà (Set uniqueId).
    const uid = ev.uniqueId || ev.userId;
    if (uid) this.state.donors.add(String(uid));
    // Điểm: 1 KIM CƯƠNG = 1 ĐIỂM. Đếm theo delta để KHÔNG mất combo khi gói chốt repeatEnd rớt/muộn
    // (xem comboDelta). Cộng ĐÚNG tổng kim cương (diamond × số quà mới), quà 0 kim cương cộng 0.
    const repeat = comboDelta(this._comboRepeats, ev);
    if (repeat) this.state.points += Math.max(0, resolveDiamond(ev)) * repeat;
    this._emit();
  }
  routeLike(ev) {
    if (!this.state.running) return;
    this.state.likes += Math.max(1, Number(ev.likeCount) || 1);
    this._emit();
  }
  // TEST thủ công: cộng nhanh vào một KPI để canh giao diện.
  bump(kind, amount) {
    const n = Math.round(Number(amount) || 0);
    if (kind === 'donors') {
      for (let i = 0; i < Math.max(0, n); i++) this.state.donors.add(`test-${this.state.donors.size}-${i}`);
    } else if (kind === 'likes') {
      this.state.likes = Math.max(0, this.state.likes + n);
    } else if (kind === 'points') {
      this.state.points = Math.max(0, this.state.points + n);
    }
    this._emit();
  }
  getStateForOverlay() {
    return {
      ...this.config,
      running: this.state.running,
      values: { donors: this.state.donors.size, likes: this.state.likes, points: this.state.points },
    };
  }
  _emit() { try { this.onState(this.getStateForOverlay()); } catch {} }
}

// =================================================================
// THẺ BÀI — MC táp tim (KPI) để lật thẻ. Overlay tương tác được:
// bấm thẻ nào (OBS Interact / cửa sổ Review) là lật thẻ đó.
//  • Mặt úp (back.png)  = thẻ hp vàng/hồng (mặc định).
//  • Mặt mở (front.png) = thẻ trắng phát sáng, hiện NỘI DUNG.
//  • "Chọn thẻ" = thẻ rung để MC/người dùng xác nhận (vẫn úp).
//  • "Lật thẻ"  = quay 3D sang mặt mở kèm nội dung.
// Thanh "máu" đếm số TIM (like) tích luỹ so với mục tiêu.
// =================================================================
const CARD_FLIP_DEFAULT = {
  title: 'Thẻ bài',
  heartTarget: 1000,
  cardStyle: 'gold',        // 'gold' | 'pink'
  cardSize: 156,            // bề rộng thẻ (px) — cao tự tính theo tỉ lệ
  fontSize: 20,             // cỡ chữ THÔNG TIN (tiêu đề/trạng thái/số trong thanh)
  cardTextSize: 30,         // cỡ chữ NỘI DUNG TRONG THẺ (tách riêng khỏi thông tin)
  bgColor: '#000000',
  bgAlpha: 0.80,            // độ trong suốt nền (0–1)
  titleColor: '#ffd94a',
  barColor: '#ff2f87',      // màu thanh tiến trình (máu)
  barTextColor: '#ffffff',  // màu chữ số trong thanh máu
  runningColor: '#ff5a5a',  // màu chữ "ĐANG THỰC HIỆN"
  doneColor: '#38e08a',     // màu chữ "THÀNH CÔNG"
  edges: true,              // viền trên/dưới (mat tren/duoi)
  scale: 100,               // scale overlay OBS (%)
  fx: true,                 // bật overlay "lật 3D" giữa màn hình khi lật thẻ
  spinMs: 3000,             // thời lượng cuộn 3D trước khi lộ thẻ (ms) — thanh ngang lộ đồng thời
  fxStyle: 'random',        // kiểu lộ 3D: random (mặc định) | ring | fan | stack | fly | ...
  sound: true,              // âm thanh (whoosh cuộn + chuông lộ) — tổng hợp WebAudio
  soundVolume: 70,          // âm lượng 0–100
  particles: true,          // pháo hoa/lấp lánh khi lộ thẻ
};
const CARD_FX_STYLES = ['ring', 'fan', 'stack', 'fly', 'wave', 'tunnel', 'helix', 'spiral'];
class CardFlipEngine {
  constructor({ onState }) {
    this.onState = onState;
    this._seq = 0;
    this.config = {
      ...CARD_FLIP_DEFAULT,
      cards: [
        this._mkCard('A'), this._mkCard('B'), this._mkCard('C'),
        this._mkCard('Nội dung'), this._mkCard('Nội dung'),
      ],
    };
    this.state = { running: false, hearts: 0 };
  }
  _mkCard(text = '') { return { id: `c${++this._seq}`, text: String(text || ''), flipped: false, selected: false, flipAt: 0 }; }
  _clampInt(v, dv, min, max) { let n = Math.round(Number(v)); if (!Number.isFinite(n)) n = dv; return Math.max(min, Math.min(max, n)); }
  _color(v, dv) { return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : dv; }
  _normalizeCards(arr) {
    if (!Array.isArray(arr)) return this.config.cards;
    return arr.slice(0, 60).map((c) => ({
      id: c && c.id ? String(c.id) : `c${++this._seq}`,
      text: String((c && c.text) || ''),
      flipped: !!(c && c.flipped),
      selected: !!(c && c.selected),
      flipAt: Number(c && c.flipAt) || 0,
    }));
  }
  setConfig(patch) {
    patch = patch || {};
    const d = CARD_FLIP_DEFAULT;
    const c = this.config;
    this.config = {
      title: patch.title != null ? String(patch.title).slice(0, 80) : c.title,
      heartTarget: patch.heartTarget != null ? this._clampInt(patch.heartTarget, c.heartTarget, 0, 100000000) : c.heartTarget,
      cardStyle: patch.cardStyle === 'pink' ? 'pink' : (patch.cardStyle === 'gold' ? 'gold' : c.cardStyle),
      cardSize: patch.cardSize != null ? this._clampInt(patch.cardSize, c.cardSize, 60, 400) : c.cardSize,
      fontSize: patch.fontSize != null ? this._clampInt(patch.fontSize, c.fontSize, 8, 80) : c.fontSize,
      cardTextSize: patch.cardTextSize != null ? this._clampInt(patch.cardTextSize, c.cardTextSize, 8, 90) : c.cardTextSize,
      bgColor: this._color(patch.bgColor, c.bgColor),
      bgAlpha: patch.bgAlpha != null && Number.isFinite(+patch.bgAlpha) ? Math.max(0, Math.min(1, +patch.bgAlpha)) : c.bgAlpha,
      titleColor: this._color(patch.titleColor, c.titleColor),
      barColor: this._color(patch.barColor, c.barColor),
      barTextColor: this._color(patch.barTextColor, c.barTextColor),
      runningColor: this._color(patch.runningColor, c.runningColor),
      doneColor: this._color(patch.doneColor, c.doneColor),
      edges: patch.edges != null ? !!patch.edges : c.edges,
      scale: patch.scale != null ? this._clampInt(patch.scale, c.scale, 40, 300) : c.scale,
      fx: patch.fx != null ? !!patch.fx : c.fx,
      spinMs: patch.spinMs != null ? this._clampInt(patch.spinMs, c.spinMs, 800, 8000) : c.spinMs,
      fxStyle: (CARD_FX_STYLES.includes(patch.fxStyle) || patch.fxStyle === 'random') ? patch.fxStyle : c.fxStyle,
      sound: patch.sound != null ? !!patch.sound : c.sound,
      soundVolume: patch.soundVolume != null ? this._clampInt(patch.soundVolume, c.soundVolume, 0, 100) : c.soundVolume,
      particles: patch.particles != null ? !!patch.particles : c.particles,
      cards: patch.cards != null ? this._normalizeCards(patch.cards) : c.cards,
    };
    this._emit();
  }
  startHearts() { this.state.running = true; this.state.hearts = 0; this._emit(); }
  stopHearts() { this.state.running = false; this._emit(); }
  resetHearts() { this.state = { running: false, hearts: 0 }; this._emit(); }
  setHearts(n) { this.state.hearts = Math.max(0, Math.round(Number(n) || 0)); this._emit(); }
  routeLike(ev) {
    if (!this.state.running) return;
    this.state.hearts += Math.max(1, Number(ev.likeCount) || 1);
    this._emit();
  }
  _find(id) { return this.config.cards.find((c) => c.id === String(id)); }
  // value === undefined → đảo trạng thái (dùng cho click trên overlay).
  // Lật LÊN: đóng dấu flipAt (giờ server) → overlay lật 3D & thanh ngang dùng CHUNG mốc này để lộ ĐỒNG THỜI.
  flipCard(id, value) {
    const c = this._find(id); if (!c) return;
    const nv = value == null ? !c.flipped : !!value;
    c.flipped = nv;
    c.flipAt = nv ? Date.now() : 0;
    this._emit();
  }
  selectCard(id, value) { const c = this._find(id); if (!c) return; c.selected = value == null ? !c.selected : !!value; this._emit(); }
  // serverNow → client tự tính lệch đồng hồ, canh đúng mốc lộ thẻ (flipAt + spinMs) dù kết nối trễ.
  getStateForOverlay() { return { ...this.config, running: this.state.running, hearts: this.state.hearts, serverNow: Date.now() }; }
  _emit() { try { this.onState(this.getStateForOverlay()); } catch {} }
}

// =================================================================
// NHẠC DANCE · Video overlay — engine "relay": chỉ giữ lệnh phát cho overlay, không có điểm/số.
//  - main: clip quà đang phát theo 🎬 Hàng đợi (renderer điều khiển; overlay báo phát xong qua playId).
//  - bg:   danh sách clip "Chạy nền" (đè lên trên), overlay tự phát tuần tự nên không cần round-trip.
// =================================================================
// NHẠC DANCE có 3 overlay ĐỘC LẬP (mỗi cái 1 link OBS riêng, 1080×1920): WEBM 1 (video thường),
// WEBM 2 (chạy nền), WEBM 3 (Biến Hình). Mỗi kênh có lớp main + nền riêng, chạy SONG SONG.
const DANCE_CHANNELS = ['webm1', 'webm2', 'webm3'];
const DANCE_OVERLAYS_DEFAULT = [
  { id: 'webm1', name: 'WEBM 1' },
  { id: 'webm2', name: 'WEBM 2' },
  { id: 'webm3', name: 'WEBM 3' },
];
const DANCE_VIDEO_DEFAULT = { overlays: DANCE_OVERLAYS_DEFAULT.map(o => ({ ...o })), maxClipSec: 90 };
class DanceVideoEngine {
  constructor({ onState }) {
    this.onState = onState; // (channel, stateForOverlay)
    this.config = { overlays: DANCE_OVERLAYS_DEFAULT.map(o => ({ ...o })), maxClipSec: 90 };
    this._bgSeq = {};
    this.state = {};
    for (const ch of DANCE_CHANNELS) { this._bgSeq[ch] = 0; this.state[ch] = { main: null, bg: { seq: 0, clips: [] }, speed: 1, paused: false }; }
  }
  // Nhân tốc độ TẠM THỜI cho MỌI kênh (lớp main + nền) — dùng cho "Tốc độ theo quà". factor 0.25..3.
  setSpeedAll(factor) {
    let f = Number(factor); if (!Number.isFinite(f) || f <= 0) f = 1;
    f = Math.max(0.25, Math.min(3, f));
    for (const ch of DANCE_CHANNELS) this.state[ch].speed = f;
    this.emitAll();
  }
  _int(v, dv, min, max) { let n = Math.round(Number(v)); if (!Number.isFinite(n)) n = dv; return Math.max(min, Math.min(max, n)); }
  _ch(ch) { return DANCE_CHANNELS.includes(ch) ? ch : 'webm1'; }
  setConfig(patch) {
    patch = patch || {};
    const c = this.config;
    const src = Array.isArray(patch.overlays) ? patch.overlays : c.overlays;
    this.config = {
      // Cố định đúng 3 kênh webm1/2/3, chỉ cho đổi TÊN.
      overlays: DANCE_CHANNELS.map((id, i) => {
        const found = (src || []).find(o => o && o.id === id) || {};
        const name = String(found.name || `WEBM ${i + 1}`).slice(0, 40).trim() || `WEBM ${i + 1}`;
        return { id, name };
      }),
      maxClipSec: patch.maxClipSec != null ? this._int(patch.maxClipSec, c.maxClipSec, 5, 600) : c.maxClipSec,
    };
    this.emitAll();
  }
  // Mọi overlay đều 1080×1920 toàn màn hình → bỏ vị trí/kích thước; chỉ giữ âm lượng + tốc độ.
  _place(cmd) {
    const volume = cmd.volume == null ? 100 : this._int(cmd.volume, 100, 0, 100);
    let rate = Number(cmd.rate); if (!Number.isFinite(rate) || rate <= 0) rate = 1;
    rate = Math.max(0.25, Math.min(3, rate));
    return { pos: 'full', size: 100, fit: 'contain', volume, rate };
  }
  // Lớp MAIN của 1 kênh: đặt clip hiện tại (playId mới) cho overlay phát.
  playMain(ch, cmd) {
    ch = this._ch(ch); cmd = cmd || {};
    if (!cmd.src || !cmd.playId) return;
    const p = this._place(cmd);
    this.state[ch].main = { playId: String(cmd.playId), src: String(cmd.src), ...p };
    this.state[ch].paused = false; // clip mới luôn phát bình thường
    this._emit(ch);
  }
  // Overlay báo clip main phát xong/lỗi → xoá main (khớp playId) để heartbeat không phát lại.
  finishMain(ch, playId) {
    ch = this._ch(ch);
    if (this.state[ch].main && String(this.state[ch].main.playId) === String(playId)) { this.state[ch].main = null; this._emit(ch); return true; }
    return false;
  }
  stopMain(ch) { ch = this._ch(ch); if (this.state[ch].main) { this.state[ch].main = null; this.state[ch].paused = false; this._emit(ch); } }
  // ⏸ Tạm dừng / tiếp tục lớp MAIN của 1 kênh (overlay tự pause/play <video>). Chỉ đổi khi khác trạng thái.
  setPaused(ch, on) { ch = this._ch(ch); const v = !!on; if (this.state[ch].paused !== v) { this.state[ch].paused = v; this._emit(ch); } }
  // Lớp NỀN của 1 kênh: danh sách clip phát tuần tự, đè lên trên. seq tăng = lượt nền mới.
  playBackground(ch, cmd) {
    ch = this._ch(ch); cmd = cmd || {};
    const clips = Array.isArray(cmd.clips) ? cmd.clips.map(x => String(x || '')).filter(Boolean) : [];
    if (!clips.length) return;
    const p = this._place(cmd);
    const loop = !!cmd.loop;
    this.state[ch].bg = { seq: ++this._bgSeq[ch], clips, loop, ...p };
    this._emit(ch);
  }
  stopBackground(ch) { ch = this._ch(ch); this.state[ch].bg = { seq: 0, clips: [] }; this._emit(ch); }
  stopAll() { for (const ch of DANCE_CHANNELS) { this.state[ch] = { main: null, bg: { seq: 0, clips: [] }, speed: this.state[ch].speed || 1, paused: false }; } this.emitAll(); }
  getStateForOverlay(ch) { ch = this._ch(ch); return { channel: ch, main: this.state[ch].main, bg: this.state[ch].bg, speed: this.state[ch].speed || 1, paused: !!this.state[ch].paused, serverNow: Date.now() }; }
  _emit(ch) { try { this.onState(this._ch(ch), this.getStateForOverlay(ch)); } catch {} }
  emitAll() { for (const ch of DANCE_CHANNELS) this._emit(ch); }
}

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
    title: 'HP GROUP LIVE',
    backgroundColor: '#1a1330', // khớp nền màn hình tải (boot splash tối) → không chớp sáng lúc mở app
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
  // Hỏi xác nhận trước khi thoát: đóng cửa sổ chính sẽ TẮT overlay OBS + popup Review, nên chặn
  // đóng nhầm. Bỏ qua khi app đang thoát theo chương trình (hpkey thu hồi, before-quit…).
  win.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    // Ưu tiên popup đẹp trong renderer (đồng bộ giao diện app); nếu renderer treo/đang tải → dialog gốc.
    const wc = win?.webContents;
    const canAsk = win && !win.isDestroyed() && wc && !wc.isCrashed() && !wc.isLoading();
    if (!canAsk) return nativeQuitConfirm();
    quitPromptOpen = true;
    wc.send('app:confirmQuit');
  });

  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

function broadcast(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// broadcast CÓ GOM NHỊP cho các kênh state tần suất cao (đếm TIM/like). Mission Trio & Card Flip
// gọi onState mỗi lần có 1 like → nếu bắn IPC thẳng sang renderer mỗi like (hàng trăm/giây) thì
// cửa sổ chính bị nghẽn, gõ liệu/đổi số bị đơ. Ở đây chỉ giữ TRẠNG THÁI MỚI NHẤT rồi gửi tối đa
// ~8 lần/giây (đủ mượt cho preview), luôn flush lần cuối để số cuối cùng không bị bỏ sót.
const _throttleState = new Map(); // channel -> { last, timer, pending }
function throttledBroadcast(channel, data, ms = 120) {
  const rec = _throttleState.get(channel) || { last: 0, timer: null, pending: null };
  const now = Date.now();
  const send = () => {
    rec.last = Date.now();
    rec.pending = null;
    broadcast(channel, rec.latest);
  };
  rec.latest = data;
  if (now - rec.last >= ms) {
    if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
    send();
  } else if (!rec.timer) {
    rec.timer = setTimeout(() => { rec.timer = null; send(); }, ms - (now - rec.last));
  }
  _throttleState.set(channel, rec);
}

// ===== Liên kết trò chơi → THI ĐẤU NHÓM (realtime) =====
// Callback duy nhất các engine trò chơi gọi khi 1 quà quy về Creator có gắn (khi Liên kết BẬT).
// CHỐNG CỘNG ĐÔI: nhiều nguồn Liên kết (PK Đôi + Đập Trứng…) có thể cùng khớp MỘT sự kiện quà →
// mỗi món quà chỉ được cộng vào BXH đúng MỘT lần (engine đầu tiên khớp trong nhịp dispatch).
// Sự kiện quà được gắn ev.__rankToken (duy nhất/nhịp) ở luồng nhận quà; điểm THỦ CÔNG/TEST không có
// token → luôn cộng bình thường.
let _lastRankToken = null;
let _rankGiftSeq = 0; // bộ đếm token sự kiện quà (gắn ev.__rankToken ở luồng nhận quà)
function rankingLivePoints(creatorId, points, ev) {
  if (ev && ev.__rankToken != null) {
    if (ev.__rankToken === _lastRankToken) return; // đã có engine khác cộng cho quà này
    _lastRankToken = ev.__rankToken;
  }
  rankingEngine?.addLivePoints(creatorId, points, ev);
}
// Nguồn chuẩn của trạng thái Liên kết: settings.rankingLinks { pkduo, pkgroup, sticker }.
function getRankingLinks() {
  const l = (settings.rankingLinks && typeof settings.rankingLinks === 'object') ? settings.rankingLinks : {};
  return { pkduo: !!l.pkduo, pkgroup: !!l.pkgroup, sticker: !!l.sticker, kcduo: !!l.kcduo };
}
// Đẩy cờ linkRanking xuống từng engine để routeGift biết có cộng realtime hay không.
function applyRankingLinksToEngines() {
  const l = getRankingLinks();
  if (pkDuoEngine) pkDuoEngine.config.linkRanking = l.pkduo;
  if (pkGroupEngine) pkGroupEngine.config.linkRanking = l.pkgroup;
  if (stickerEngine) stickerEngine.config.linkRanking = l.sticker;
  if (kcDuoEngine) kcDuoEngine.config.linkRanking = l.kcduo;
}
// Có nguồn Liên kết nào đang "sống" không → BXH ngưng tự cộng quà mặc định (tránh cộng trùng).
// PK Đôi/Nhóm chỉ tính khi trận đang chạy; Đập Trứng/Dance tính bất cứ khi nào bật (bảng luôn nhận quà).
function anyLinkedGiftSourceActive() {
  const l = getRankingLinks();
  const pkDuoRun = l.pkduo && ['prestart', 'running', 'grace'].includes(pkDuoEngine?.state?.status);
  const pkGroupRun = l.pkgroup && ['prestart', 'running', 'grace'].includes(pkGroupEngine?.state?.status);
  const kcDuoRun = l.kcduo && ['prestart', 'running', 'grace'].includes(kcDuoEngine?.state?.status);
  return !!(pkDuoRun || pkGroupRun || kcDuoRun || l.sticker);
}
// Đã có "hiệu lệnh BẮT ĐẦU" cho VOTE ở THI ĐẤU NHÓM chưa? = phiên 🎯 Tính điểm đang chạy
// (đã bấm BẮT ĐẦU) HOẶC có trận Liên kết (PK Đôi/Nhóm) đang chạy. Chưa bắt đầu → VOTE không nhận điểm.
function rankVoteStarted() {
  const scoreRun = ['running', 'grace'].includes(scoreEngine?.state?.status);
  return !!(scoreRun || anyLinkedGiftSourceActive());
}
// Ai đang thi đấu PK (Đôi/Nhóm) ĐÃ LIÊN KẾT + trận đang chạy → BXH THI ĐẤU NHÓM đánh dấu đúng
// hàng Creator đó bằng FX chọn nhân vật. Trả { ids:Set<creatorId>, fx } hoặc null.
// PK Đôi: luôn đánh dấu 2 phe. PK Nhóm: chỉ khi chọn subset (ít hơn full nhóm) — đủ full thì thôi.
function activePkFighters() {
  const l = getRankingLinks();
  const live = s => ['prestart', 'running', 'grace'].includes(s);
  const ids = new Set();
  // PK Đôi có 2 phe cố định: teamA (trái) / teamB (phải) → tô marker theo màu TikTok (A đỏ-hồng, B xanh).
  // PK Nhóm không có trái/phải → không gán phe (marker giữ màu mặc định).
  const teamOf = new Map();
  let fx = '';
  if (l.pkduo && pkDuoEngine && live(pkDuoEngine.state.status)) {
    const f = pkDuoEngine._resolveSelectFx();
    if (f !== 'off') {
      const a = pkDuoEngine.config.teamA, b = pkDuoEngine.config.teamB;
      if (a && a.creatorId) { ids.add(String(a.creatorId)); teamOf.set(String(a.creatorId), 'A'); }
      if (b && b.creatorId) { ids.add(String(b.creatorId)); teamOf.set(String(b.creatorId), 'B'); }
      if (ids.size && !fx) fx = f;
    }
  }
  if (l.pkgroup && pkGroupEngine && live(pkGroupEngine.state.status)) {
    const cfg = pkGroupEngine.config;
    const parts = Array.isArray(cfg.participants) ? cfg.participants : [];
    const gid = String(cfg.groupId || '');
    const roster = gid ? (loadCreators() || []).filter(c => String(c.groupId || '') === gid).length : 0;
    const subset = parts.length >= 2 && (!roster || parts.length < roster);
    const f = pkGroupEngine._resolveSelectFx();
    if (subset && f !== 'off') {
      for (const p of parts) { const id = p.creatorId || p.id; if (id) ids.add(String(id)); }
      if (!fx) fx = f;
    }
  }
  return ids.size ? { ids, teamOf, fx: fx || 'arrow' } : null;
}

function bootstrapEngines() {
  pkDuoEngine = new PkDuoEngine({
    onState: (st) => {
      overlayServer?.sendPkDuo(st);
      broadcast('pkduo:state', st);
      // Liên kết → BXH THI ĐẤU NHÓM vẽ lại để đánh dấu/bỏ đánh dấu người đang thi đấu theo trận.
      if (getRankingLinks().pkduo) rankingEngine?._emit();
      scheduleLiveRuntimeSave(); // chống mất điểm khi văng
    },
    onResult: appendMatchHistory,
    // Engine tự cập nhật chuỗi WIN sau trận → lưu file + báo renderer để ô "Chuỗi WIN" đồng bộ.
    onConfigChange: () => {
      savePkDuoConfig(pkDuoEngine.config);
      broadcast('pkduo:config', { teamA: pkDuoEngine.config.teamA, teamB: pkDuoEngine.config.teamB });
    },
    getCreators: loadCreators,
    onRankingPoints: rankingLivePoints,
  });
  const savedPk = loadPkDuoConfig();
  if (savedPk) pkDuoEngine.setConfig(savedPk);
  kcDuoEngine = new KcDuoEngine({
    onState: (st) => {
      overlayServer?.sendKcDuo(st);
      broadcast('kcduo:state', st);
      if (getRankingLinks().kcduo) rankingEngine?._emit();
      scheduleLiveRuntimeSave(); // chống mất điểm khi văng
    },
    // Engine tự cập nhật chuỗi trụ vững / tổng vòng / người kế sau trận → lưu file + báo renderer.
    onConfigChange: () => {
      saveKcDuoConfig(kcDuoEngine.config);
      broadcast('kcduo:config', {
        teamA: kcDuoEngine.config.teamA, teamB: kcDuoEngine.config.teamB,
        defendStreak: kcDuoEngine.config.defendStreak, totalRounds: kcDuoEngine.config.totalRounds,
        performerName: kcDuoEngine.config.performerName, nextName: kcDuoEngine.config.nextName,
      });
    },
    getCreators: loadCreators,
    onRankingPoints: rankingLivePoints,
  });
  const savedKc = loadKcDuoConfig();
  if (savedKc) {
    kcDuoEngine.setConfig(savedKc);
    if (savedKc.teamA?.name !== 'KEEP/GIỮ' || savedKc.teamA?.nameOverride !== true || savedKc.teamB?.name !== 'CHANGE/ĐỔI' || savedKc.teamB?.nameOverride !== true) saveKcDuoConfig(kcDuoEngine.config);
  }
  pkGroupEngine = new PkGroupEngine({
    onState: (st) => {
      overlayServer?.sendPkGroup(st);
      broadcast('pkgroup:state', st);
      // Liên kết → BXH THI ĐẤU NHÓM vẽ lại để đánh dấu/bỏ đánh dấu người đang thi đấu theo trận.
      if (getRankingLinks().pkgroup) rankingEngine?._emit();
      scheduleLiveRuntimeSave(); // chống mất điểm khi văng
    },
    onResult: appendMatchHistory,
    getCreators: loadCreators,
    onRankingPoints: rankingLivePoints,
    // Chốt vòng phải lưu ngay chuỗi mới; tổng MVP được ghi độc lập vào hồ sơ Creator.
    onConfigChange: () => savePkGroupConfig(pkGroupEngine.config),
    onMvpAward: ({ creatorId, groupId }) => addPkGroupMvpTotal(creatorId, groupId, 1),
  });
  const savedPkGroup = loadPkGroupConfig();
  if (savedPkGroup) pkGroupEngine.setConfig(savedPkGroup);
  rankingEngine = new RankingEngine({
    onState: (st) => {
      overlayServer?.sendRanking(st);
      broadcast('ranking:state', st);
      scheduleLiveRuntimeSave(); // chống mất điểm khi văng
    },
    getCreators: loadCreators,
    getGroups: loadGroups,
    getActiveFighters: activePkFighters,
    getCreatorById,
  });
  if (settings.ranking) rankingEngine.setConfig(settings.ranking);
  rankingEngine.config.activeGroupId = ''; // Luôn khởi động ở chế độ TALENT SHOW (mở tất cả)
  scoreEngine = new ScoreEngine({
    onState: (st) => {
      overlayServer?.sendScore(st);
      broadcast('score:state', st);
      scheduleLiveRuntimeSave(); // chống mất điểm khi văng
    },
  });
  if (settings.score) scoreEngine.setConfig(settings.score);
  stickerEngine = new StickerEngine({
    onState: (st) => {
      overlayServer?.sendSticker(st);
      broadcast('stickerdance:state', st);
    },
    onRankingPoints: rankingLivePoints,
    getCreators: loadCreators,
  });
  const savedSticker = loadStickerConfig();
  if (savedSticker) stickerEngine.setConfig(savedSticker);
  // Áp trạng thái Liên kết THI ĐẤU NHÓM đã lưu vào các engine (nguồn chuẩn = settings.rankingLinks).
  applyRankingLinksToEngines();
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
  missionTrioEngine = new MissionTrioEngine({
    onState: (st) => {
      overlayServer?.sendMissionTrio(st);
      throttledBroadcast('missiontrio:state', st);
    },
  });
  if (settings.missionTrio) missionTrioEngine.setConfig(settings.missionTrio);
  cardFlipEngine = new CardFlipEngine({
    onState: (st) => {
      overlayServer?.sendCardFlip(st);
      throttledBroadcast('cardflip:state', st);
    },
  });
  if (settings.cardFlip) cardFlipEngine.setConfig(settings.cardFlip);
  danceVideoEngine = new DanceVideoEngine({
    onState: (ch, st) => { overlayServer?.sendDanceVideo(ch, st); },
  });
  const savedDanceVideo = loadDanceVideoConfig();
  if (savedDanceVideo) danceVideoEngine.setConfig(savedDanceVideo);
  const savedGiftMenu = loadGiftMenuConfig();
  if (savedGiftMenu && typeof savedGiftMenu === 'object') giftMenuConfig = savedGiftMenu;
  interactConfig = normalizeInteractConfig(loadInteractConfig());

  // KHÔI PHỤC điểm số đang chạy của phiên trước (chống mất khi văng/mất điện).
  // Nạp SAU khi đã áp config (setConfig) để state runtime (điểm/chuỗi/đồng hồ) đè lên
  // giá trị khởi tạo; nếu phiên trước đang giữa vòng thì đồng hồ tự chạy tiếp tới khi chốt.
  // Muốn bắt đầu MỚI sạch: bấm Reset (Reset ghi state 0 xuống file → mở lại là 0).
  try {
    const rt = loadJson(LIVE_RUNTIME_PATH, null);
    if (rt && typeof rt === 'object') {
      // "fresh" = phiên trước vừa lưu (≤3 phút) → coi như crash-relaunch nhanh, cho chạy tiếp đồng hồ trận.
      // Mở lại muộn hơn → chỉ khôi phục ĐIỂM (đóng băng đồng hồ), tránh trận cũ tự chốt vòng âm thầm
      // (ghi lịch sử/chuỗi WIN/MVP ngoài ý muốn ngay khi mở app).
      const opt = { resume: Number.isFinite(Number(rt.savedAt)) && (Date.now() - Number(rt.savedAt)) < 180000 };
      try { rankingEngine.restoreRuntime(rt.ranking); } catch {}
      try { scoreEngine.restoreRuntime(rt.score, opt); } catch {}
      try { pkDuoEngine.restoreRuntime(rt.pkduo, opt); } catch {}
      try { kcDuoEngine.restoreRuntime(rt.kcduo, opt); } catch {}
      try { pkGroupEngine.restoreRuntime(rt.pkgroup, opt); } catch {}
    }
  } catch {}

  // Phát state khởi tạo cho overlay khi mới connect
  pkDuoEngine._emit();
  kcDuoEngine._emit();
  pkGroupEngine._emit();
  rankingEngine._emit();
  scoreEngine._emit();
  stickerEngine._emit();
  mvpHonorEngine._emit();
  luckyWheelEngine._emit();
  missionTrioEngine._emit();
  cardFlipEngine._emit();
  danceVideoEngine.emitAll();
  overlayServer?.sendGiftMenu(giftMenuConfig);
  overlayServer?.sendInteract(interactConfig);
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
  ttClient.on('chat', (d) => {
    _cacheAvatar(d);
    broadcast('tt:chat', d);
    // Overlay TƯƠNG TÁC + QUÀ (cột bình luận dưới) — chỉ đẩy khi thực sự có nội dung bình luận.
    if (d && (d.comment || '').trim()) {
      overlayServer?.pushInteractChat({
        avatar: d.avatar || '', nickname: d.nickname || '', uniqueId: d.uniqueId || '',
        level: d.level || '', comment: d.comment || '',
      });
    }
  });
  ttClient.on('gift', (d) => {
    _cacheAvatar(d);   // gift có avatar thì lưu lại
    _fillAvatar(d);    // gift thiếu avatar thì bù từ cache
    if (d.avatar) overlayServer?.primeAvatar(d.avatar); // lưu đĩa avatar người tặng (champion PK) ngay
    // "Học ID": nếu đang bắt ID người nhận cho 1 Creator → chộp recipientMemberId của quà kế tiếp.
    if (_learnRecipientArmed && d.recipientMemberId) {
      broadcast('tt:recipientLearned', { userId: d.recipientMemberId, name: d.recipientMemberName || '', giftName: d.giftName || '', from: d.nickname || d.uniqueId || '' });
      _learnRecipientArmed = false;
    }
    // Nhận diện Creator NHẬN quà (LIVE nhóm) → gắn recipientCreatorId. Luôn resolve (rẻ, có cache);
    // chỉ engine ở mode 🔴 Creator LIVE mới DÙNG tới. Trống = quà chung/không khớp.
    d.recipientCreatorId = resolveRecipientCreatorId(d);
    broadcast('tt:gift', d);
    // Overlay TƯƠNG TÁC + QUÀ (cột quà trên) — mirror renderer: chỉ hiện khi shouldProcess (né spam combo).
    if (d.shouldProcess) {
      const repeat = Math.max(1, Number(d.repeatCount) || 1);
      const coinEach = resolveDiamond(d);
      overlayServer?.pushInteractGift({
        avatar: d.avatar || '', nickname: d.nickname || '', uniqueId: d.uniqueId || '',
        level: d.level || '', giftId: d.giftId || '', giftName: d.giftName || '',
        giftIcon: d.giftIcon || '', repeat, totalCoin: coinEach * repeat,
      });
    }
    // TẤT CẢ engine cộng điểm quà đều đếm theo DELTA từng nhịp combo (xem comboDelta) → gọi trên MỌI
    // nhịp, KHÔNG gate theo shouldProcess. Nhờ vậy điểm lên ngay và KHÔNG mất combo x10/x1000 khi TikTok
    // gửi gói chốt repeatEnd muộn/rớt mạng (lỗi "tặng 2 quà chỉ nhận 1" ở CHỌN PHE PK Đôi/Nhóm).
    // Token duy nhất/nhịp → rankingLivePoints chỉ cho MỘT nguồn Liên kết cộng vào BXH (chống trùng).
    d.__rankToken = ++_rankGiftSeq;
    scoreEngine?.routeGift(d);
    kcDuoEngine?.routeGift(d);
    pkDuoEngine?.routeGift(d);
    pkGroupEngine?.routeGift(d);
    // Khi có trò chơi đang Liên kết → BXH ngưng tự cộng quà mặc định (điểm đến từ trò chơi).
    rankingEngine?.routeGift(d, anyLinkedGiftSourceActive(), rankVoteStarted());
    stickerEngine?.routeGift(d);
    missionTrioEngine?.routeGift(d);
  });
  // QUAN TRỌNG (fix treo/đơ giao diện khi LIVE): like/member/follow/share là các
  // sự kiện TẦN SUẤT RẤT CAO (like có thể hàng trăm/giây, member = mỗi lượt vào phòng).
  // Renderer KHÔNG có listener nào cho tt:like/tt:member/tt:follow/tt:share — nhưng trước
  // đây vẫn broadcast tất cả sang cửa sổ chính. Mỗi broadcast là một IPC phải serialize +
  // dispatch ở renderer → làm nghẽn main-thread của renderer → gõ ID/đổi số/thời gian bị đơ,
  // "phải chờ 1 lúc mới nhập được rồi lại đơ". Vì vậy CHỈ route vào engine + cache avatar ở
  // main, KHÔNG gửi sang renderer nữa (overlay lấy dữ liệu qua SSE riêng, không ảnh hưởng).
  ttClient.on('like', (d) => { _cacheAvatar(d); missionTrioEngine?.routeLike(d); cardFlipEngine?.routeLike(d); });
  ttClient.on('member', (d) => { _cacheAvatar(d); });
  ttClient.on('follow', (d) => { _cacheAvatar(d); });
  ttClient.on('share', (d) => { _cacheAvatar(d); });
  ttClient.on('roomUser', (d) => broadcast('tt:roomUser', d));
}

// Danh sách khoá ẩn/hiện overlay — MỖI nguồn OBS một khoá riêng để Hiện/Ẩn/Ghim độc lập.
// Nhóm có nhiều overlay: PK Đôi (pkduo + pkduofx), Thi đấu (ranking dọc + rankinggrid ngang),
// Tính điểm (score/scorebar/scorecard/scoretimer), Thẻ bài (cardflip + cardflipfx), Nhạc Dance (3 kênh).
const OVERLAY_SCENE_KEYS = [
  'pkduo', 'pkduofx', 'kcduo', 'pkgroup', 'ranking', 'rankinggrid',
  'score', 'scorebar', 'scorecard', 'scoretimer', 'sticker', 'giftmenu',
  'mvphonor', 'luckywheel', 'missiontrio', 'cardflip', 'cardflipfx',
  'dancevideo', 'dancevideo2', 'dancevideo3', 'interact',
];
// Đọc cấu hình ẩn/hiện overlay (chuẩn hoá + mặc định): hiện hết, tự-theo-menu BẬT, ghim sẵn TƯƠNG TÁC + Menu Quà.
// visModel = phiên bản mô hình lưu. Bản CŨ (<2) từng ghi auto-ẩn theo menu ĐÈ vào 'vis' (lựa chọn tay),
// để lại các 'false' rác khiến overlay bị "ẩn dính". Nâng cấp lên model 2: XÓA hết false rác về mặc định HIỆN,
// vì từ nay 'vis' chỉ chứa lựa chọn TAY (auto-ẩn tính riêng, không lưu). Giữ nguyên autoScene + pinned.
function getOverlayVis() {
  const raw = settings.overlayVisibility || {};
  const vis = {}, pinned = {};
  const migrateVis = (raw.visModel || 0) >= 2; // đủ mới ⇒ tôn trọng false đã lưu (là lựa chọn tay thật)
  const rawVis = migrateVis ? (raw.vis || {}) : {}; // model cũ: bỏ qua vis rác → về mặc định HIỆN
  const rawPin = raw.pinned || {};
  const firstRun = !raw.pinned; // chưa từng lưu ⇒ dùng ghim mặc định
  for (const k of OVERLAY_SCENE_KEYS) {
    vis[k] = rawVis[k] !== false;                       // mặc định hiện
    pinned[k] = firstRun ? (k === 'interact' || k === 'giftmenu') : !!rawPin[k];
  }
  return { autoScene: raw.autoScene !== false, pinned, vis, visModel: 2 };
}

async function bootstrapOverlay() {
  overlayServer = new ObsOverlayServer({
    root: ROOT,
    port: settings.overlayPort,
    token: settings.overlayToken,
    // Phiên bản app phát qua SSE → overlay tự location.reload() KHI phiên bản ĐỔI (sau khi cập nhật),
    // để OBS lấy CSS/JS mới mà KHÔNG cần bấm "Refresh/Reset" thủ công. Không reload khi chỉ reconnect.
    assetVersion: app.getVersion(),
    cacheDir: path.join(CONFIG_DIR, 'avatar-cache'),
    normalizeAvatar: (buf) => {
      const image = nativeImage.createFromBuffer(buf);
      return image.isEmpty() ? buf : image.toPNG();
    },
    onLuckyWheelSpin: () => {
      const result = luckyWheelEngine?.doSpin();
      if (result) saveLuckyWheelConfig(luckyWheelEngine.config);
      return result;
    },
    // Overlay tương tác: bấm thẻ → đảo mặt úp/mở của đúng thẻ đó, rồi lưu lại.
    onCardFlip: (id) => {
      if (!cardFlipEngine) return null;
      cardFlipEngine.flipCard(id);
      settings.cardFlip = cardFlipEngine.config; saveSettings();
      return cardFlipEngine.getStateForOverlay();
    },
    // Overlay TƯƠNG TÁC + QUÀ: kéo vạch chia (Quà/Bình luận) trên overlay/Review → lưu tỉ lệ + đồng bộ UI.
    onInteractSplit: (ratio) => {
      interactConfig = normalizeInteractConfig({ ...interactConfig, splitRatio: ratio });
      saveInteractConfig(interactConfig);
      overlayServer?.sendInteract(interactConfig);
      broadcast('interact:state', interactConfig);
      return interactConfig;
    },
    // Video NHẠC DANCE phát xong/lỗi trên overlay → xoá main + báo renderer để 🎬 Hàng đợi bước tiếp.
    onDanceVideoEnded: (ch, playId, layer) => {
      if (layer === 'main') danceVideoEngine?.finishMain(ch, playId);
      broadcast('dancevideo:ended', { channel: ch, playId, layer });
    },
    onLog: (m) => broadcast('log', { source: 'overlay', message: m }),
  });
  await overlayServer.start();
  // Khôi phục chế độ link copy. MẶC ĐỊNH BẬT TikTok Studio (hostname hpstudio.obs) khi chưa từng set;
  // chỉ TẮT (về 127.0.0.1) nếu người dùng đã chủ động tắt (lưu false). (Cần hosts "127.0.0.1 hpstudio.obs".)
  overlayServer.setLinkMode(settings.overlayTikTokLinks !== false);
  // Khôi phục trạng thái ẩn/hiện overlay đã lưu (đẩy sau khi server chạy — mẫu re-emit như config khác).
  overlayServer.setVisibility(getOverlayVis().vis);
  // Đang bật chế độ TikTok mà máy chưa có dòng hosts → tự cài (UAC 1 lần). Chạy nền, không chặn khởi động.
  if (overlayServer.isTikTokLinkMode() && !hostsSetup.hasOverlayHostEntry()) ensureOverlayHostsAndNotify(true);
  // Lưu sẵn avatar các creator/nhóm ra đĩa (không chặn khởi động).
  setTimeout(() => primeStoredAvatars().catch(() => {}), 1500);
}

// Kiểm tra (và tùy chọn tự cài) dòng hosts cho hostname overlay, rồi báo trạng thái cho renderer.
// autoFix=true: thử nâng quyền ghi ngay (dùng lúc khởi động). autoFix=false: chỉ kiểm tra (dùng cho IPC status).
let _hostsFixInFlight = false;
async function ensureOverlayHostsAndNotify(autoFix) {
  let present = hostsSetup.hasOverlayHostEntry();
  if (!present && autoFix && !_hostsFixInFlight) {
    _hostsFixInFlight = true;
    try { present = await hostsSetup.ensureOverlayHostEntry(); } catch { present = hostsSetup.hasOverlayHostEntry(); }
    _hostsFixInFlight = false;
  }
  const tiktok = !!overlayServer?.isTikTokLinkMode();
  // "needed" = đang dùng chế độ TikTok mà lại thiếu dòng hosts → overlay sẽ trắng, cần cảnh báo.
  broadcast('hosts:status', { present, needed: tiktok && !present, hostname: hostsSetup.OVERLAY_HOSTNAME });
  return present;
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
  // Lấy avatar theo ID TikTok rồi TẢI VỀ 1 LẦN dưới dạng dataURL (lưu thẳng vào config, không phải fetch lại từ TikTok).
  ipcMain.handle('tt:fetchAvatarData', async (_e, { username }) => {
    const p = await ttClient.fetchProfile(username);
    let dataUrl = '';
    if (p?.avatar) {
      try {
        const res = await fetch(p.avatar, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (res.ok) {
          const ct = res.headers.get('content-type') || 'image/jpeg';
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length && buf.length <= 4 * 1024 * 1024) dataUrl = `data:${ct};base64,${buf.toString('base64')}`;
        }
      } catch {}
    }
    return { uniqueId: p?.uniqueId || '', nickname: p?.nickname || '', found: !!p?.found, dataUrl };
  });

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
  // "Học ID": bật/tắt chế độ chộp ID người nhận từ quà kế tiếp (tự nhận diện Creator).
  ipcMain.handle('creators:armLearnRecipient', (_e, on) => {
    _learnRecipientArmed = !!on;
    return _learnRecipientArmed;
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
  // File cấu hình CHUNG bỏ qua khi xuất/nhập: đã có ở cấp cao (creators/groups/group-profiles),
  // và settings.json (chứa token OBS / khoá bản quyền — máy-riêng, không nên chép sang máy khác).
  const CONFIG_EXPORT_SKIP = new Set(['creators.json', 'groups.json', 'group-profiles.json', 'settings.json', 'live-runtime.json']);
  // Đọc mọi *.json trong CONFIG_DIR (trừ bản .bak và danh sách bỏ qua) → gói cấu hình CHUNG.
  const collectSharedConfigs = () => {
    const out = {};
    try {
      for (const f of fs.readdirSync(CONFIG_DIR)) {
        if (!f.endsWith('.json') || f.endsWith('.bak') || CONFIG_EXPORT_SKIP.has(f)) continue;
        try { out[f] = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, f), 'utf8')); } catch {}
      }
    } catch {}
    return out;
  };
  ipcMain.handle('data:export', async () => {
    const payload = {
      app: 'HP GROUP LIVE',
      version: app.getVersion(),
      exportedAt: Date.now(),
      creators: loadCreators(),
      groups: loadGroups(),
      groupProfiles: loadGroupProfiles(),
      configs: collectSharedConfigs(), // cấu hình chung: sticker-dance, nhạc, menu quà, PK, vòng quay, MVP, KC...
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
    // Khôi phục cấu hình CHUNG (GHI ĐÈ file cùng tên trên máy đích) — để các chỉ số overlay sang máy khác
    // vẫn đúng. Chặn path traversal: chỉ nhận tên file .json thuần, nằm đúng trong CONFIG_DIR.
    let cfgWritten = 0;
    if (data.configs && typeof data.configs === 'object' && !Array.isArray(data.configs)) {
      for (const [fname, content] of Object.entries(data.configs)) {
        if (!/^[a-z0-9._-]+\.json$/i.test(fname) || fname.endsWith('.bak') || CONFIG_EXPORT_SKIP.has(fname)) continue;
        const dest = path.join(CONFIG_DIR, fname);
        if (path.dirname(dest) !== CONFIG_DIR) continue;
        try { fs.writeFileSync(dest, JSON.stringify(content, null, 2), 'utf8'); cfgWritten++; } catch {}
      }
    }
    // Nạp lại cấu hình vừa ghi vào các engine đang chạy (khỏi phải khởi động lại để overlay đổi ngay).
    if (cfgWritten) {
      try { stickerEngine.setConfig(loadStickerConfig() || {}); } catch {}
      try { pkDuoEngine.setConfig(loadPkDuoConfig() || {}); } catch {}
      try { kcDuoEngine.setConfig(loadKcDuoConfig() || {}); } catch {}
      try { pkGroupEngine.setConfig(loadPkGroupConfig() || {}); } catch {}
    }
    rankingEngine?._emit();
    return { ok: true, creatorsAdded: cAdd, creatorsUpdated: cUpd, groupsAdded: gAdd, groupsUpdated: gUpd, configsRestored: cfgWritten };
  });

  // PK Duo
  ipcMain.handle('pkduo:getState', () => pkDuoEngine.getStateForOverlay());
  ipcMain.handle('pkduo:setConfig', (_e, cfg) => { pkDuoEngine.setConfig(cfg); savePkDuoConfig(pkDuoEngine.config); return pkDuoEngine.config; });
  ipcMain.handle('pkduo:start', () => { pkDuoEngine.start(); return true; });
  ipcMain.handle('pkduo:stop', () => { pkDuoEngine.stop(); return true; });
  ipcMain.handle('pkduo:reset', () => { pkDuoEngine.reset(); return true; });
  ipcMain.handle('pkduo:resetAll', () => { pkDuoEngine.resetAll(); return true; });
  ipcMain.handle('pkduo:addPoints', (_e, { side, points }) => { pkDuoEngine.addPoints(side, points); return true; });
  ipcMain.handle('pkduo:testGift', (_e, { side, qty, sign } = {}) => pkDuoEngine.testGift(side, qty, sign));
  ipcMain.handle('pkduo:getUrl', () => overlayServer.getPkDuoUrl());
  ipcMain.handle('pkduo:getFxUrl', () => overlayServer.getPkDuoFxUrl());

  // Chế độ link overlay dùng chung cho MỌI nút copy: false = OBS (127.0.0.1), true = TikTok Studio (hostname).
  ipcMain.handle('overlay:getLinkMode', () => overlayServer?.isTikTokLinkMode() || false);
  ipcMain.handle('overlay:setLinkMode', (_e, on) => {
    settings.overlayTikTokLinks = !!on;
    saveSettings();
    overlayServer?.setLinkMode(!!on);
    // Vừa bật TikTok mà thiếu hosts → tự cài (UAC). Vừa tắt → chỉ cập nhật lại trạng thái banner.
    if (on) ensureOverlayHostsAndNotify(true); else ensureOverlayHostsAndNotify(false);
    return !!on;
  });
  // Ẩn/hiện overlay theo cảnh: renderer đọc trạng thái để dựng bảng điều khiển + nút nổi.
  ipcMain.handle('overlay:getVisibility', () => getOverlayVis());
  // Ghi patch {autoScene?, pinned?, vis?} → CHỈ lưu LỰA CHỌN TAY (mặc định HIỆN), KHÔNG tự phát.
  // Việc phát ra OBS là bản đồ HIỆU LỰC (tay + cảnh đang mở + ghim) do renderer tính rồi gọi
  // overlay:applyVisibility. Tách vậy để auto-ẩn theo menu KHÔNG ghi đè lựa chọn tay (tránh "ẩn dính").
  ipcMain.handle('overlay:setVisibility', (_e, patch) => {
    const cur = getOverlayVis();
    const next = {
      visModel: 2, // đã ở mô hình mới (vis = chỉ lựa chọn tay) — khỏi bị migrate reset lần sau
      autoScene: patch && 'autoScene' in patch ? !!patch.autoScene : cur.autoScene,
      pinned: patch && patch.pinned ? { ...cur.pinned, ...patch.pinned } : cur.pinned,
      vis: patch && patch.vis ? { ...cur.vis, ...patch.vis } : cur.vis,
    };
    settings.overlayVisibility = next;
    saveSettings();
    return next;
  });
  // Phát bản đồ HIỆU LỰC (những gì THỰC SỰ hiện trên OBS/TikTok) — chỉ broadcast, KHÔNG lưu.
  ipcMain.handle('overlay:applyVisibility', (_e, vis) => {
    overlayServer?.setVisibility(vis && typeof vis === 'object' ? vis : {});
  });
  // Trạng thái dòng hosts cho hostname overlay (renderer hiện/ẩn banner cảnh báo).
  ipcMain.handle('hosts:status', () => ({
    present: hostsSetup.hasOverlayHostEntry(),
    needed: !!overlayServer?.isTikTokLinkMode() && !hostsSetup.hasOverlayHostEntry(),
    hostname: hostsSetup.OVERLAY_HOSTNAME,
  }));
  // Nút "Sửa nhanh": tự nâng quyền ghi dòng hosts (UAC). Trả về trạng thái sau khi ghi.
  ipcMain.handle('hosts:fix', async () => {
    const present = await ensureOverlayHostsAndNotify(true);
    return { present, hostname: hostsSetup.OVERLAY_HOSTNAME };
  });

  // GIỮ / ĐỔI (Keep/Change)
  ipcMain.handle('kcduo:getState', () => kcDuoEngine.getStateForOverlay());
  ipcMain.handle('kcduo:setConfig', (_e, cfg) => { kcDuoEngine.setConfig(cfg); saveKcDuoConfig(kcDuoEngine.config); return kcDuoEngine.config; });
  ipcMain.handle('kcduo:start', () => { kcDuoEngine.start(); return true; });
  ipcMain.handle('kcduo:stop', () => { kcDuoEngine.stop(); return true; });
  ipcMain.handle('kcduo:reset', () => { kcDuoEngine.reset(); return true; });
  ipcMain.handle('kcduo:resetAll', () => { kcDuoEngine.resetAll(); return true; });
  ipcMain.handle('kcduo:addPoints', (_e, { side, points }) => { kcDuoEngine.addPoints(side, points); return true; });
  ipcMain.handle('kcduo:testGift', (_e, { side, qty, sign } = {}) => kcDuoEngine.testGift(side, qty, sign));
  ipcMain.handle('kcduo:getUrl', () => overlayServer.getKcDuoUrl());

  // PK Group
  ipcMain.handle('pkgroup:getState', () => pkGroupEngine.getStateForOverlay());
  ipcMain.handle('pkgroup:setConfig', (_e, cfg) => { pkGroupEngine.setConfig(cfg); savePkGroupConfig(pkGroupEngine.config); return pkGroupEngine.config; });
  ipcMain.handle('pkgroup:start', () => { pkGroupEngine.start(); return true; });
  ipcMain.handle('pkgroup:stop', () => { pkGroupEngine.stop(); return true; });
  ipcMain.handle('pkgroup:reset', () => { pkGroupEngine.reset(); return true; });
  ipcMain.handle('pkgroup:resetAll', () => { pkGroupEngine.resetAll(); savePkGroupConfig(pkGroupEngine.config); return true; });
  ipcMain.handle('pkgroup:addPoints', (_e, { id, points }) => { pkGroupEngine.addPoints(id, points); return true; });
  ipcMain.handle('pkgroup:testGift', (_e, { id, qty, sign } = {}) => pkGroupEngine.testGift(id, qty, sign));
  ipcMain.handle('pkgroup:setMvpTotal', (_e, { creatorId, groupId, total } = {}) => {
    const result = setPkGroupMvpTotal(creatorId, groupId || pkGroupEngine?.config?.groupId || '', total);
    if (result) pkGroupEngine?._emit();
    return result;
  });
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
  ipcMain.handle('luckywheel:setCount', (_e, n) => { luckyWheelEngine?.setCount(n); saveLuckyWheelConfig(luckyWheelEngine?.config); return luckyWheelEngine?.config?.spinCount; });
  ipcMain.handle('luckywheel:removeHistory', (_e, id) => { luckyWheelEngine?.removeHistory(id); saveLuckyWheelConfig(luckyWheelEngine?.config); return luckyWheelEngine?.config?.spinCount; });
  ipcMain.handle('luckywheel:export', async () => {
    const list = luckyWheelEngine?.config?.history || [];
    if (!list.length) return { ok: false, reason: 'empty' };
    const esc = v => '"' + String(v || '').replace(/"/g, '""') + '"';
    const csv = ['Thời gian,Người quay,Kết quả,Ghi chú,Loại'].concat(
      list.map(x => [x.time || '', x.member || '', x.text || '', x.note || '', x.type || 'info'].map(esc).join(','))
    ).join('\r\n');
    const stamp = new Date().toISOString().slice(0, 10);
    const res = await dialog.showSaveDialog(win, {
      title: 'Tải lịch sử vòng quay',
      defaultPath: `Lich-su-Vong-quay-${stamp}.csv`,
      filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, reason: 'canceled' };
    try {
      // BOM giúp Excel trên Windows đọc đúng tiếng Việt ngay khi mở file.
      fs.writeFileSync(res.filePath, '\ufeff' + csv, 'utf8');
      return { ok: true, filePath: res.filePath, count: list.length };
    } catch (err) {
      return { ok: false, reason: String(err && err.message || err) };
    }
  });
  ipcMain.handle('luckywheel:reset', () => { luckyWheelEngine?.reset(); return true; });
  ipcMain.handle('luckywheel:getUrl', () => overlayServer?.getLuckyWheelUrl());

  // ===== MENU QUÀ (thông tin quà) — config-only overlay, không có engine =====
  ipcMain.handle('giftmenu:getConfig', () => loadGiftMenuConfig() || giftMenuConfig);
  ipcMain.handle('giftmenu:setConfig', (_e, cfg) => {
    giftMenuConfig = (cfg && typeof cfg === 'object') ? cfg : { items: [] };
    saveGiftMenuConfig(giftMenuConfig);
    overlayServer?.sendGiftMenu(giftMenuConfig);
    broadcast('giftmenu:state', giftMenuConfig);
    return giftMenuConfig;
  });
  // apply: đẩy cấu hình NHÓM ra overlay ngay (KHÔNG ghi file gốc — hồ sơ nhóm tự lưu ở group-profiles).
  ipcMain.handle('giftmenu:apply', (_e, cfg) => {
    const live = (cfg && typeof cfg === 'object') ? cfg : { items: [] };
    overlayServer?.sendGiftMenu(live);
    broadcast('giftmenu:state', live);
    return live;
  });
  ipcMain.handle('giftmenu:getUrl', () => overlayServer?.getGiftMenuUrl());

  // ===== TƯƠNG TÁC + QUÀ (overlay gộp chat + quà) — config-only, không có engine =====
  ipcMain.handle('interact:getConfig', () => interactConfig);
  ipcMain.handle('interact:setConfig', (_e, cfg) => {
    interactConfig = normalizeInteractConfig(cfg);
    saveInteractConfig(interactConfig);
    overlayServer?.sendInteract(interactConfig);
    return interactConfig;
  });
  ipcMain.handle('interact:getUrl', () => overlayServer?.getInteractUrl());

  // Match history (LỊCH SỬ trận đấu)
  ipcMain.handle('history:list', (_e, filter) => {
    let list = loadMatchHistory();
    if (filter && filter.type) list = list.filter(m => m.type === filter.type);
    return list.slice().sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  });
  ipcMain.handle('history:clear', (_e, filter) => {
    // Trả điểm về trước khi xoá, tránh mồ côi điểm đã cộng vào BXH.
    const doomed = loadMatchHistory().filter(m => !filter || !filter.type || m.type === filter.type);
    for (const m of doomed) { if (m.applied) { try { unapplyMatchPointsFromRanking(m.id); } catch {} } }
    if (filter && filter.type) saveMatchHistory(loadMatchHistory().filter(m => m.type !== filter.type));
    else saveMatchHistory([]);
    return true;
  });
  ipcMain.handle('history:remove', (_e, id) => {
    // Nếu trận đã áp điểm vào BXH → hoàn tác điểm trước rồi mới xoá.
    const m = loadMatchHistory().find(x => x.id === id);
    if (m && m.applied) { try { unapplyMatchPointsFromRanking(id); } catch {} }
    saveMatchHistory(loadMatchHistory().filter(x => x.id !== id));
    return true;
  });
  // Cộng điểm 1 trận PK vào THI ĐẤU NHÓM (contestPoints Creator). Idempotent + hoàn tác được.
  ipcMain.handle('history:apply', (_e, { id, mapping } = {}) => applyMatchPointsToRanking(id, mapping || {}));
  ipcMain.handle('history:unapply', (_e, id) => unapplyMatchPointsFromRanking(id));
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

  // ===== Lịch sử 🎯 Tính điểm =====
  ipcMain.handle('scoreHistory:list', () => loadScoreHistory().slice().reverse());
  ipcMain.handle('scoreHistory:add', (_e, rec = {}) => {
    const list = loadScoreHistory();
    const entry = { id: uid('sh_'), at: Date.now(), ...rec };
    list.push(entry);
    saveScoreHistory(list);
    broadcast('scoreHistory:changed', entry);
    return entry;
  });
  ipcMain.handle('scoreHistory:remove', (_e, id) => { saveScoreHistory(loadScoreHistory().filter(x => x.id !== id)); return true; });
  ipcMain.handle('scoreHistory:clear', () => { saveScoreHistory([]); return true; });
  ipcMain.handle('scoreHistory:export', async () => {
    const list = loadScoreHistory();
    if (!list.length) return { ok: false, reason: 'empty' };
    const stamp = fmtDate(Date.now()).replace(/\//g, '-');
    const res = await dialog.showSaveDialog(win, {
      title: 'Xuất lịch sử Tính điểm',
      defaultPath: `Lich-su-Tinh-diem-${stamp}.csv`,
      filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, reason: 'canceled' };
    try { fs.writeFileSync(res.filePath, buildScoreHistoryCsv(list), 'utf8'); return { ok: true, filePath: res.filePath, count: list.length }; }
    catch (err) { return { ok: false, reason: String(err && err.message || err) }; }
  });

  // ===== Lịch sử 🏆 THI ĐẤU NHÓM =====
  ipcMain.handle('rankingHistory:list', () => loadRankingHistory().slice().reverse());
  ipcMain.handle('rankingHistory:add', (_e, rec = {}) => {
    const rows = Array.isArray(rec.rows) ? rec.rows : [];
    if (!rows.length) return { ok: false, reason: 'empty' };
    const list = loadRankingHistory();
    const entry = { id: uid('rh_'), at: Date.now(), label: rec.label || 'Chụp bảng', floor: Number(rec.floor) || 0, mode: rec.mode || 'creator', rows };
    list.push(entry);
    saveRankingHistory(list);
    broadcast('rankingHistory:changed', entry);
    return { ok: true, entry };
  });
  ipcMain.handle('rankingHistory:remove', (_e, id) => { saveRankingHistory(loadRankingHistory().filter(x => x.id !== id)); return true; });
  ipcMain.handle('rankingHistory:clear', () => { saveRankingHistory([]); return true; });
  ipcMain.handle('rankingHistory:export', async (_e, heSo) => {
    const list = loadRankingHistory();
    if (!list.length) return { ok: false, reason: 'empty' };
    const stamp = fmtDate(Date.now()).replace(/\//g, '-');
    const res = await dialog.showSaveDialog(win, {
      title: 'Xuất lịch sử THI ĐẤU NHÓM',
      defaultPath: `Lich-su-Thi-dau-nhom-${stamp}.csv`,
      filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, reason: 'canceled' };
    try { fs.writeFileSync(res.filePath, buildRankingHistoryCsv(list, heSo), 'utf8'); return { ok: true, filePath: res.filePath, count: list.length }; }
    catch (err) { return { ok: false, reason: String(err && err.message || err) }; }
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

  // ===== SỐ THỨ TỰ THI ĐẤU (STT) — gán từ 🎡 VÒNG QUAY, hiện trên overlay THI ĐẤU DỌC/NGANG =====
  ipcMain.handle('ranking:setPerfOrder', (_e, { creatorId, order } = {}) => {
    const id = String(creatorId || '');
    if (!id) return { ok: false, reason: 'no-creator' };
    const list = loadCreators();
    const idx = list.findIndex(c => c.id === id);
    if (idx < 0) return { ok: false, reason: 'not-found' };
    const n = Math.max(0, Math.round(Number(order) || 0));
    list[idx] = { ...list[idx], perfOrder: n };
    saveCreators(list);
    rankingEngine._emit();
    return { ok: true, perfOrder: n };
  });
  ipcMain.handle('ranking:clearPerfOrder', () => {
    const list = loadCreators().map(c => (Number(c.perfOrder) ? { ...c, perfOrder: 0 } : c));
    saveCreators(list);
    rankingEngine._emit();
    return { ok: true };
  });
  // Áp snapshot STT từ các ô quay còn hiệu lực trong một lần ghi: khi đổi Creator/khôi phục,
  // không thể còn badge cũ trên một trong hai overlay DỌC/NGANG.
  ipcMain.handle('ranking:syncPerfOrders', (_e, rawAssignments = []) => {
    const creators = loadCreators();
    const creatorIds = new Set(creators.map(c => String(c.id)));
    const orders = new Map();
    for (const assignment of (Array.isArray(rawAssignments) ? rawAssignments : [])) {
      const creatorId = String(assignment?.creatorId || '');
      const order = Math.max(0, Math.round(Number(assignment?.order) || 0));
      if (creatorId && order && creatorIds.has(creatorId)) orders.set(creatorId, order);
    }
    let changed = false;
    const list = creators.map(c => {
      const perfOrder = orders.get(String(c.id)) || 0;
      if ((Number(c.perfOrder) || 0) === perfOrder) return c;
      changed = true;
      return { ...c, perfOrder };
    });
    if (changed) saveCreators(list);
    rankingEngine._emit();
    return { ok: true, count: orders.size };
  });

  // ===== Liên kết điểm mini-game → THI ĐẤU NHÓM (contestPoints), idempotent + hoàn tác =====
  // 🎯 Tính điểm: cộng số điểm đạt được vào 1 Creator (thường là Creator đang VOTE).
  ipcMain.handle('ranking:applyScore', (_e, { creatorId, points, label } = {}) => {
    const pts = Number(points) || 0;
    if (!creatorId || !pts) return { ok: false, reason: 'invalid' };
    const res = applyDeltaBatchToCreators([{ creatorId, delta: pts }], { label: label || '🎯 Tính điểm', source: 'score' });
    // CHỐNG CỘNG ĐÔI ("nhân 2 điểm"): trong phiên 🎯 Tính điểm có VOTE, BXH ĐÃ tự cộng LIVE từng món quà
    // vào rankingEngine.scores[creatorId] (thanh leo realtime). Điểm chính thức (st.score) vừa được cộng
    // vào contestPoints ở trên → phải DỌN điểm LIVE của Creator này về 0, nếu không overlay hiển thị
    // contestPoints + điểm live ≈ GẤP ĐÔI (giống 🔒 Chốt vòng dọn scores sau khi gộp).
    if (res.ok && rankingEngine && rankingEngine.scores && rankingEngine.scores[creatorId]) {
      delete rankingEngine.scores[creatorId];
      rankingEngine._emit();
    }
    return res;
  });
  // 🥚 Đập Trứng / 🎵 NHẠC DANCE: map mỗi ô quà → Creator có defaultGiftId trùng, cộng điểm (kim cương) ô đó.
  ipcMain.handle('ranking:applySticker', () => {
    const st = stickerEngine?.getStateForOverlay();
    const cells = (st?.cells || []).filter(c => (Number(c.points) || 0) > 0);
    if (!cells.length) return { ok: false, reason: 'empty' };
    const creators = loadCreators();
    const raw = [];
    const unmatched = [];
    for (const c of cells) {
      const cr = creators.find(x =>
        (x.defaultGiftId && String(x.defaultGiftId) === String(c.giftId || '')) ||
        (x.defaultGiftName && _normName(x.defaultGiftName) === _normName(c.giftName)));
      if (!cr) { unmatched.push({ giftName: c.giftName || c.giftId, points: Number(c.points) || 0 }); continue; }
      raw.push({ creatorId: cr.id, delta: Number(c.points) || 0 });
    }
    if (!raw.length) return { ok: false, reason: 'no-match', unmatched };
    const res = applyDeltaBatchToCreators(raw, { label: st.content || '🥚 Đập Trứng/Dance', source: 'sticker' });
    return { ...res, unmatched };
  });
  // 🔒 Chốt vòng: gộp điểm LIVE của vòng (theo quà) vào contestPoints rồi dọn về 0 (chống hiển thị trùng).
  ipcMain.handle('ranking:commitRound', () => {
    if (rankingEngine.config.mode !== 'creator') return { ok: false, reason: 'not-creator-mode' };
    const scores = rankingEngine.scores || {};
    const raw = Object.keys(scores)
      .map(cid => ({ creatorId: cid, delta: Number(scores[cid] && scores[cid].points) || 0 }))
      .filter(e => e.delta > 0);
    if (!raw.length) return { ok: false, reason: 'empty' };
    const res = applyDeltaBatchToCreators(raw, { label: '🔒 Chốt vòng (điểm live)', source: 'round' });
    if (res.ok) { rankingEngine.scores = {}; rankingEngine._emit(); }
    return res;
  });
  ipcMain.handle('ranking:undoApply', (_e, applyId) => undoApplyBatch(applyId));
  ipcMain.handle('ranking:applyLog', () => loadApplyLog().slice().reverse());
  // ☑️ Liên kết trò chơi (PK Đôi/PK Nhóm/Đập Trứng·Dance) → THI ĐẤU NHÓM realtime.
  ipcMain.handle('ranking:getLinks', () => getRankingLinks());
  ipcMain.handle('ranking:setLinks', (_e, patch = {}) => {
    const next = getRankingLinks();
    if (typeof patch.pkduo === 'boolean') next.pkduo = patch.pkduo;
    if (typeof patch.pkgroup === 'boolean') next.pkgroup = patch.pkgroup;
    if (typeof patch.sticker === 'boolean') next.sticker = patch.sticker;
    if (typeof patch.kcduo === 'boolean') next.kcduo = patch.kcduo;
    settings.rankingLinks = next;
    saveSettings();
    applyRankingLinksToEngines();
    broadcast('ranking:links', next); // đồng bộ ô tích ở mọi tab + bảng tổng
    return next;
  });
  // 🔍 Kiểm tra liên kết trước LIVE: soi từng nguồn ĐANG BẬT xem creatorId đã gắn có hợp lệ không
  // (thiếu / trỏ Creator đã xoá) → chặn "lúc nhận lúc không / nhận sai" khi nhiều nhóm. Chỉ đọc, không sửa.
  ipcMain.handle('ranking:validateLinks', () => {
    const links = getRankingLinks();
    const scoreOn = !!settings.scoreLinkRanking;
    const problems = [];
    const badId = (cid) => !cid || !getCreatorById(cid); // thiếu id HOẶC id không còn Creator
    // PK Đôi / Giữ-Đổi: 2 phe cố định, mỗi phe 1 creatorId.
    for (const [on, eng, tag] of [[links.pkduo, pkDuoEngine, '⚔️ PK Đôi'], [links.kcduo, kcDuoEngine, '🔁 Giữ/Đổi']]) {
      if (!on || !eng) continue;
      for (const [side, team] of [['A', eng.config.teamA], ['B', eng.config.teamB]]) {
        const cid = team && team.creatorId;
        if (!cid) problems.push({ game: tag, who: `Phe ${side}`, issue: 'chưa gắn Creator → quà phe này KHÔNG cộng vào BXH' });
        else if (!getCreatorById(cid)) problems.push({ game: tag, who: `Phe ${side}`, issue: `Creator đã gắn không còn tồn tại (id ${cid})` });
      }
    }
    // PK Nhóm: mỗi participant là 1 Creator (creatorId hoặc id).
    if (links.pkgroup && pkGroupEngine) {
      const parts = pkGroupEngine.config.participants || [];
      if (!parts.length) problems.push({ game: '🧩 PK Nhóm', who: '—', issue: 'chưa có người tham gia' });
      parts.forEach((p, i) => {
        const cid = p.creatorId || p.id;
        const label = p.name || p.tiktokId || `#${i + 1}`;
        if (badId(cid)) problems.push({ game: '🧩 PK Nhóm', who: label, issue: cid ? `Creator không tồn tại (id ${cid})` : 'chưa gắn Creator' });
      });
    }
    // Đập Trứng/Dance: mỗi ô suy Creator theo c.creatorId, không có thì khớp Quà mặc định (giống engine).
    if (links.sticker && stickerEngine) {
      const cells = stickerEngine.config.cells || [];
      const creators = loadCreators() || [];
      cells.forEach((c, i) => {
        let cid = c.creatorId;
        if (!cid) {
          const cr = creators.find(x =>
            (x.defaultGiftId && String(x.defaultGiftId) === String(c.giftId || '')) ||
            (x.defaultGiftName && _normName(x.defaultGiftName) === _normName(c.giftName)));
          cid = cr && cr.id;
        }
        const label = c.giftName || `Ô #${i + 1}`;
        if (!cid) problems.push({ game: '🥚 Đập Trứng', who: label, issue: 'không suy ra được Creator (chưa gắn 👤 Creator, không khớp Quà mặc định)' });
        else if (!getCreatorById(cid)) problems.push({ game: '🥚 Đập Trứng', who: label, issue: `Creator không tồn tại (id ${cid})` });
      });
    }
    const anyOn = links.pkduo || links.kcduo || links.pkgroup || links.sticker || scoreOn;
    return { anyOn, links: { ...links, score: scoreOn }, problems };
  });

  // Score
  ipcMain.handle('score:getState', () => scoreEngine.getStateForOverlay());
  ipcMain.handle('score:setConfig', (_e, cfg) => { scoreEngine.setConfig(cfg); settings.score = scoreEngine.config; saveSettings(); return scoreEngine.config; });
  ipcMain.handle('score:start', () => { scoreEngine.start(); return true; });
  ipcMain.handle('score:stop', () => { scoreEngine.stop(); return true; });
  ipcMain.handle('score:reset', () => { scoreEngine.reset(); return true; });
  ipcMain.handle('score:addPoints', (_e, { points, user } = {}) => { scoreEngine.addPoints(points, user); return true; });
  ipcMain.handle('score:getUrl', () => overlayServer.getScoreUrl());
  ipcMain.handle('score:getBarUrl', () => overlayServer.getScoreBarUrl());
  ipcMain.handle('score:getCardUrl', () => overlayServer.getScoreCardUrl());
  ipcMain.handle('score:getTimerUrl', () => overlayServer.getScoreTimerUrl());

  // NHIỆM VỤ · BỘ BA
  ipcMain.handle('missiontrio:getState', () => missionTrioEngine.getStateForOverlay());
  ipcMain.handle('missiontrio:setConfig', (_e, cfg) => { missionTrioEngine.setConfig(cfg); settings.missionTrio = missionTrioEngine.config; saveSettings(); return missionTrioEngine.config; });
  ipcMain.handle('missiontrio:start', () => { missionTrioEngine.start(); return true; });
  ipcMain.handle('missiontrio:stop', () => { missionTrioEngine.stop(); return true; });
  ipcMain.handle('missiontrio:reset', () => { missionTrioEngine.reset(); return true; });
  ipcMain.handle('missiontrio:bump', (_e, { kind, amount } = {}) => { missionTrioEngine.bump(kind, amount); return true; });
  ipcMain.handle('missiontrio:getUrl', (_e, mode) => overlayServer.getMissionTrioUrl(mode));

  // ===== THẺ BÀI =====
  ipcMain.handle('cardflip:getState', () => cardFlipEngine.getStateForOverlay());
  ipcMain.handle('cardflip:setConfig', (_e, cfg) => { cardFlipEngine.setConfig(cfg); settings.cardFlip = cardFlipEngine.config; saveSettings(); return cardFlipEngine.config; });
  ipcMain.handle('cardflip:startHearts', () => { cardFlipEngine.startHearts(); return true; });
  ipcMain.handle('cardflip:stopHearts', () => { cardFlipEngine.stopHearts(); return true; });
  ipcMain.handle('cardflip:resetHearts', () => { cardFlipEngine.resetHearts(); return true; });
  ipcMain.handle('cardflip:setHearts', (_e, n) => { cardFlipEngine.setHearts(n); return true; });
  ipcMain.handle('cardflip:flip', (_e, { id, value } = {}) => { cardFlipEngine.flipCard(id, value); settings.cardFlip = cardFlipEngine.config; saveSettings(); return true; });
  ipcMain.handle('cardflip:select', (_e, { id, value } = {}) => { cardFlipEngine.selectCard(id, value); settings.cardFlip = cardFlipEngine.config; saveSettings(); return true; });
  ipcMain.handle('cardflip:getUrl', () => overlayServer.getCardFlipUrl());
  ipcMain.handle('cardflip:getFxUrl', () => overlayServer.getCardFlipFxUrl());

  // ===== NHẠC DANCE · Video overlay (3 kênh độc lập webm1/2/3) =====
  ipcMain.handle('dancevideo:getState', (_e, ch) => danceVideoEngine.getStateForOverlay(ch));
  ipcMain.handle('dancevideo:getConfig', () => danceVideoEngine.config);
  ipcMain.handle('dancevideo:setConfig', (_e, cfg) => { danceVideoEngine.setConfig(cfg); saveDanceVideoConfig(danceVideoEngine.config); return danceVideoEngine.config; });
  // Trả về số overlay đang kết nối của ĐÚNG kênh để renderer biết: có overlay → chờ overlay báo
  // "phát xong"; KHÔNG có overlay (OBS chưa mở) → bỏ qua nhanh, tránh kẹt hàng đợi cả phút.
  ipcMain.handle('dancevideo:play', (_e, cmd) => { danceVideoEngine.playMain(cmd?.channel, cmd); return { clients: overlayServer?.danceVideoClientCount(cmd?.channel) || 0 }; });
  ipcMain.handle('dancevideo:stopMain', (_e, ch) => { danceVideoEngine.stopMain(ch); return true; });
  ipcMain.handle('dancevideo:setSpeed', (_e, cmd) => { danceVideoEngine.setSpeedAll(Number(cmd && cmd.factor) || 1); return true; });
  ipcMain.handle('dancevideo:setPaused', (_e, cmd) => { danceVideoEngine.setPaused(cmd && cmd.channel, !!(cmd && cmd.paused)); return true; });
  ipcMain.handle('dancevideo:playBackground', (_e, cmd) => { danceVideoEngine.playBackground(cmd?.channel, cmd); return true; });
  ipcMain.handle('dancevideo:stopBackground', (_e, ch) => { danceVideoEngine.stopBackground(ch); return true; });
  ipcMain.handle('dancevideo:stopAll', () => { danceVideoEngine.stopAll(); return true; });
  ipcMain.handle('dancevideo:getUrl', (_e, ch) => overlayServer.getDanceVideoUrl(ch));

  // Overlay Review windows
  ipcMain.handle('review:open', (_e, type) => openReviewWindow(type));
  // Cửa sổ DANH SÁCH PHÁT tách rời (chỉ xem).
  ipcMain.handle('playlist:open', () => openPlaylistWindow());
  ipcMain.handle('playlist:isOpen', () => !!(playlistWindow && !playlistWindow.isDestroyed()));
  ipcMain.on('playlist:push', (_e, data) => {
    if (playlistWindow && !playlistWindow.isDestroyed()) { try { playlistWindow.webContents.send('playlist:update', data); } catch {} }
  });
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
    lastActiveGroupId: typeof settings.lastActiveGroupId === 'string' ? settings.lastActiveGroupId : null,
    talentShowUsername: settings.talentShowUsername || '',
    signApiKey: settings.signApiKey ? '•••' : '',
    sessionId: settings.sessionId ? '•••' : '',
    ttTargetIdc: settings.ttTargetIdc,
    overlayPort: settings.overlayPort,
    overlay: { ...(settings.overlay || {}) },
    audio: { ...(settings.audio || {}) },
    scoreLinkRanking: !!settings.scoreLinkRanking,
    scoreLinkVoteLock: !!settings.scoreLinkVoteLock,
    autoRecognizeRecipient: settings.autoRecognizeRecipient !== false,
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
      if (typeof patch.lastActiveGroupId === 'string' || patch.lastActiveGroupId === null) settings.lastActiveGroupId = patch.lastActiveGroupId;
      if (typeof patch.talentShowUsername === 'string') settings.talentShowUsername = patch.talentShowUsername.trim().replace(/^@/, '');
      if (typeof patch.scoreLinkRanking === 'boolean') settings.scoreLinkRanking = patch.scoreLinkRanking;
      if (typeof patch.scoreLinkVoteLock === 'boolean') settings.scoreLinkVoteLock = patch.scoreLinkVoteLock;
      if (typeof patch.autoRecognizeRecipient === 'boolean') settings.autoRecognizeRecipient = patch.autoRecognizeRecipient;
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
  // Bản DEV (chạy nguồn, chưa đóng gói) = true → mở khoá mọi tính năng để test.
  // Bản CÀI chính thức (app.isPackaged) = false → yêu cầu kết nối LIVE mới cho chạy.
  ipcMain.handle('app:isDev', () => !app.isPackaged);
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

  // KIM CƯƠNG TỔNG theo nhóm (sheet DAILY DATA). Lỗi mạng → trả cache đã lưu.
  ipcMain.handle('kc:getGroups', async () => {
    try {
      const data = await fetchGroupDiamonds();
      return { ok: true, ...data };
    } catch (e) {
      const cached = loadKcData();
      return { ok: false, error: e.message || String(e), byGroup: {}, total: 0, period: '', fetchedAt: 0, ...(cached || {}) };
    }
  });

  // Chuỗi Kim cương 12 tháng (chart Hồ Sơ Nhóm). Cache 3 giờ vì số tháng đổi chậm.
  ipcMain.handle('kc:getMonths', async () => {
    const cached = loadKcMonths();
    if (cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < 3 * 3600 * 1000) return { ok: true, ...cached };
    try {
      const data = await fetchGroupMonthly();
      return { ok: true, ...data };
    } catch (e) {
      return { ok: false, error: e.message || String(e), byGroup: {}, fetchedAt: 0, ...(cached || {}) };
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
      // defaultYes: Enter tự chọn "Có" (dùng cho thao tác lặp lại nhiều như xóa quà); mặc định Enter = "Không" cho an toàn.
      defaultId: opts.defaultYes ? 0 : 1,
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
  ipcMain.handle('shell:pickVideos', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Chọn một hoặc nhiều file video',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv'] }],
    });
    if (r.canceled || !Array.isArray(r.filePaths)) return [];
    return r.filePaths;
  });
  // Chọn cả THƯ MỤC → nạp mọi file nhạc + video bên trong (sắp theo tên). Dùng cho NHẠC DANCE.
  ipcMain.handle('shell:pickMediaFolder', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Chọn thư mục chứa nhạc/video',
      properties: ['openDirectory'],
    });
    if (r.canceled || !r.filePaths?.[0]) return [];
    const dir = r.filePaths[0];
    const RE = /\.(mp3|wav|ogg|m4a|aac|flac|mp4|webm|mov|m4v|ogv|mkv)$/i;
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    return names.filter(n => RE.test(n)).sort((a, b) => a.localeCompare(b, 'vi'))
      .map(n => path.join(dir, n));
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
  pkDuoEngine?._emit(); kcDuoEngine?._emit(); pkGroupEngine?._emit(); rankingEngine?._emit(); scoreEngine?._emit(); stickerEngine?._emit(); mvpHonorEngine?._emit(); luckyWheelEngine?._emit(); missionTrioEngine?._emit(); cardFlipEngine?._emit(); danceVideoEngine?.emitAll();
  overlayServer?.sendGiftMenu(giftMenuConfig);
  overlayServer?.sendInteract(interactConfig);
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

// Thoát theo chương trình (app.quit ở bất kỳ đâu) → đánh dấu để cửa sổ chính không hỏi lại.
app.on('before-quit', () => { isQuitting = true; try { flushLiveRuntime(); } catch {} });

app.on('window-all-closed', () => {
  try { flushLiveRuntime(); } catch {}
  try { ttClient?.disconnect(); } catch {}
  try { overlayServer?.stop(); } catch {}
  if (process.platform !== 'darwin') app.quit();
});

// Lưới an toàn cuối cùng: bất kỳ đường thoát nào của tiến trình chính (kể cả app.exit) đều ghi nốt
// điểm số đang chờ. saveJson là đồng bộ nên chạy được ở 'exit'. Crash cứng/mất điện thì đã có bản ghi
// gần nhất (≤0.6s) từ scheduleLiveRuntimeSave — vẫn đúng thời điểm sự cố.
process.on('exit', () => { try { flushLiveRuntime(); } catch {} });
