// HP Talent Show — Electron main process.
// - TikTok LIVE bridge (qua TikTokClient)
// - OBS overlay server (localhost SSE)
// - Persistent store: creators, groups, settings, pkDuo cfg, ranking cfg, score cfg
// - Engines: PkDuoEngine, RankingEngine, ScoreEngine (đều ăn gift events từ TikTok)

const { app, BrowserWindow, ipcMain, shell, clipboard, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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
const GIFT_MASTER_PATH = path.join(CONFIG_DIR, 'gift-master.json');
const SHIPPED_GIFT_MASTER_PATH = path.join(SHIPPED_CONFIG_DIR, 'gift-master.json');
const GIFT_MASTER_SHEET = 'https://docs.google.com/spreadsheets/d/1Fv9Jdno_pPMTx_-tnwSfRObm1r1wKds_gaMBnfCDm4M/gviz/tq?tqx=out:csv&sheet=DANH%20SACH%20QUA';

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
let rankingEngine = null;
let scoreEngine = null;
let settings = loadSettings();

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
  };
  const raw = loadJson(SETTINGS_PATH, null);
  if (!raw) { saveJson(SETTINGS_PATH, def); return def; }
  return { ...def, ...raw };
}
function saveSettings() { saveJson(SETTINGS_PATH, settings); }

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
      scoreA: this.state.scoreA,
      scoreB: this.state.scoreB,
      teamA: this.config.teamA,
      teamB: this.config.teamB,
      bgColor: this.config.bgColor,
      bgOpacity: this.config.bgOpacity,
      giftSize: this.config.giftSize,
      textSize: this.config.textSize,
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
            this.state.graceElapsedMs = 0;
            this.state.remainingMs = 0;
          } else {
            this.state.status = 'finished';
            this._clearTicker();
          }
        } else if (this.state.status === 'grace' && Math.abs(this.state.remainingMs) >= (this.config.delaySec || 0) * 1000) {
          this.state.status = 'finished';
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
      target: 30000,
      durationMs: 180000, // 3 phút mặc định
      prepSec: 3,
      delayMs: 5000,
      creatorName: '',
      creatorAvatar: '',
      content: 'Kêu gọi điểm',
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
      showSpeed: true,
      hideAvatar: false,
      hideCreator: false,
      customMilestoneValues: [10000, 20000, 30000, 40000, 50000],
      startSound: '',
      warningSound: '',
      goalSound: '',
      successSound: '',
      failSound: '',
      pointsBy: 'diamond',
    };
    this.state = {
      score: 0,
      status: 'idle', // idle | prestart | running | grace | success | failed
      endAt: 0,
      runStartedAt: 0,
      lastAdd: 0,
      lastAddUser: '',
      topUsers: [], // [{ user, points }]
      resultAt: 0,
    };
    this._tick = null;
  }
  setConfig(patch) {
    if (patch.themePreset && patch.themePreset !== 'custom') {
      const T = SCORE_THEMES[patch.themePreset];
      if (T) {
        patch = {
          ...patch,
          barColor1: T[0], barColor2: T[1], waveColor: T[2], overColor: T[3],
        };
      }
    }
    this.config = { ...this.config, ...patch };
    this._emit();
  }
  reset() {
    this._clearTicker();
    this.state = { score: 0, status: 'idle', endAt: 0, runStartedAt: 0, lastAdd: 0, lastAddUser: '', topUsers: [], resultAt: 0 };
    this._emit();
  }
  start() {
    if (this.state.status === 'running' || this.state.status === 'prestart') return;
    this.state.status = 'prestart';
    this.state.score = 0;
    this.state.lastAdd = 0;
    this.state.lastAddUser = '';
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
  routeGift(ev) {
    if (this.state.status !== 'running' && this.state.status !== 'grace') return;
    const pts = this.config.pointsBy === 'diamond'
      ? Math.max(1, resolveDiamond(ev)) * Math.max(1, Number(ev.repeatCount) || 1)
      : Math.max(1, Number(ev.repeatCount) || 1);
    this.state.score += pts;
    this.state.lastAdd = pts;
    this.state.lastAddUser = ev.nickname || ev.uniqueId || '';
    // Top users
    const userKey = ev.uniqueId || ev.nickname;
    if (userKey) {
      let top = this.state.topUsers.find(t => t.user === userKey);
      if (!top) { top = { user: userKey, points: 0 }; this.state.topUsers.push(top); }
      top.points += pts;
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
  const bounds = settings.windowBounds || {};
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

  win.on('close', () => {
    try {
      const b = win.getBounds();
      settings.windowBounds = b;
      saveSettings();
    } catch {}
  });

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
  rankingEngine = new RankingEngine({
    onState: (st) => {
      overlayServer?.sendRanking(st);
      broadcast('ranking:state', st);
    },
    getCreators: loadCreators,
    getGroups: loadGroups,
  });
  if (settings.ranking) rankingEngine.setConfig(settings.ranking);
  scoreEngine = new ScoreEngine({
    onState: (st) => {
      overlayServer?.sendScore(st);
      broadcast('score:state', st);
    },
  });

  // Phát state khởi tạo cho overlay khi mới connect
  pkDuoEngine._emit();
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
  ipcMain.handle('creators:list', () => loadCreators());
  ipcMain.handle('creators:upsert', (_e, creator) => {
    const list = loadCreators();
    const cid = creator.id;
    const idx = cid ? list.findIndex(c => c.id === cid) : -1;
    const now = Date.now();
    if (idx >= 0) list[idx] = { ...list[idx], ...creator, id: cid };
    else list.push({ createdAt: now, ...creator, id: uid('c_') });
    saveCreators(list);
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

  // Ranking
  ipcMain.handle('ranking:getState', () => rankingEngine.getStateForOverlay());
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
  ipcMain.handle('score:setConfig', (_e, cfg) => { scoreEngine.setConfig(cfg); return scoreEngine.config; });
  ipcMain.handle('score:start', () => { scoreEngine.start(); return true; });
  ipcMain.handle('score:stop', () => { scoreEngine.stop(); return true; });
  ipcMain.handle('score:reset', () => { scoreEngine.reset(); return true; });
  ipcMain.handle('score:getUrl', () => overlayServer.getScoreUrl());

  // Settings
  ipcMain.handle('settings:get', () => ({
    lastUsername: settings.lastUsername,
    signApiKey: settings.signApiKey ? '•••' : '',
    sessionId: settings.sessionId ? '•••' : '',
    ttTargetIdc: settings.ttTargetIdc,
    overlayPort: settings.overlayPort,
    overlay: { ...(settings.overlay || {}) },
  }));
  ipcMain.handle('settings:set', (_e, patch) => {
    if (patch && typeof patch === 'object') {
      for (const k of ['signApiKey', 'sessionId', 'ttTargetIdc']) {
        if (typeof patch[k] === 'string') settings[k] = patch[k];
      }
      if (patch.overlay && typeof patch.overlay === 'object') {
        settings.overlay = { ...(settings.overlay || {}), ...patch.overlay };
      }
      saveSettings();
    }
    return true;
  });

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
});

app.on('window-all-closed', () => {
  try { ttClient?.disconnect(); } catch {}
  try { overlayServer?.stop(); } catch {}
  if (process.platform !== 'darwin') app.quit();
});
