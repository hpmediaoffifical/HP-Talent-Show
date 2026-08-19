'use strict';
/**
 * HP KEY - Kho luu KEY + HWID BEN VUNG (zero-dependency).
 *
 * VAN DE: KEY chi nam trong config/settings.json cua app. Go cai / doi thu muc
 * userData / file settings.json hong => mat KEY, user phai xin lai. HWID cung
 * vay: tinh lai moi lan chay nen cam VPN/USB wifi/dock la doi van tay may.
 *
 * CACH LAM: ghi ra NHIEU noi doc lap voi thu muc app, doc thi lay ban MOI NHAT
 * (savedAt lon nhat) con key. Ghi/doc deu best-effort, khong bao gio nem loi.
 *   1) <userData>/config/license.json   - do main.js gan qua setExtraDir()
 *   2) %ProgramData%\HP Media\<product>\license.json
 *   3) %AppData%\HP Media\<product>\license.json   (song qua go cai app)
 *   4) Registry HKCU\Software\HP Media\<product>   (song qua xoa sach o dia)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PRODUCT = require('./config').PRODUCT;
const REG_KEY = 'HKCU\\Software\\HP Media\\' + PRODUCT;
const FILE_NAME = 'license.json';

let extraDir = ''; // thu muc phu (userData) - main.js gan luc khoi dong

function setExtraDir(dir) { extraDir = String(dir || ''); }

function baseDirs() {
  const dirs = [];
  if (extraDir) dirs.push(extraDir);
  const pd = process.env.ProgramData || process.env.PROGRAMDATA || '';
  if (pd) dirs.push(path.join(pd, 'HP Media', PRODUCT));
  const ad = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (ad) dirs.push(path.join(ad, 'HP Media', PRODUCT));
  return dirs;
}

function readFileRec(file) {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch (_) { return null; }
}

function writeFileRec(file, rec) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
    fs.renameSync(tmp, file);            // thay the nguyen tu -> khong hong file cu
    return true;
  } catch (_) {
    try { fs.writeFileSync(file, JSON.stringify(rec, null, 2), 'utf8'); return true; }
    catch (_e) { return false; }
  }
}

// --- Registry (chi Windows). Dung execFileSync => KHONG qua shell => khoi lo escape.
function regRead() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg', ['query', REG_KEY, '/v', 'data'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString();
    const m = out.match(/\bdata\s+REG_SZ\s+(\S+)/i);
    if (!m) return null;
    const json = Buffer.from(m[1], 'base64').toString('utf8');
    const o = JSON.parse(json);
    return o && typeof o === 'object' ? o : null;
  } catch (_) { return null; }
}

function regWrite(rec) {
  if (process.platform !== 'win32') return false;
  try {
    const b64 = Buffer.from(JSON.stringify(rec), 'utf8').toString('base64');
    execFileSync('reg', ['add', REG_KEY, '/v', 'data', '/t', 'REG_SZ', '/d', b64, '/f'],
      { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (_) { return false; }
}

function regClear() {
  if (process.platform !== 'win32') return;
  try { execFileSync('reg', ['delete', REG_KEY, '/f'], { stdio: 'ignore', timeout: 5000 }); } catch (_) {}
}

/** Doc tat ca noi luu, tra ban ghi MOI NHAT (uu tien ban co key). */
function readRecord() {
  const recs = [];
  for (const d of baseDirs()) {
    const r = readFileRec(path.join(d, FILE_NAME));
    if (r) recs.push(r);
  }
  const r = regRead();
  if (r) recs.push(r);
  if (!recs.length) return null;
  const withKey = recs.filter((x) => x && x.key);
  const pool = withKey.length ? withKey : recs;
  pool.sort((a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0));
  return pool[0];
}

/**
 * Ghi ban ghi ra MOI noi. Gop voi ban cu de khong lam mat truong da co
 * (vd chi cap nhat hwid thi van giu nguyen key).
 */
function writeRecord(patch) {
  const cur = readRecord() || {};
  const rec = Object.assign({}, cur, patch || {}, { savedAt: Date.now(), product: PRODUCT });
  let n = 0;
  for (const d of baseDirs()) { if (writeFileRec(path.join(d, FILE_NAME), rec)) n++; }
  if (regWrite(rec)) n++;
  return n;
}

function clearRecord() {
  for (const d of baseDirs()) { try { fs.unlinkSync(path.join(d, FILE_NAME)); } catch (_) {} }
  regClear();
}

function readKey() { const r = readRecord(); return (r && r.key) || ''; }
function readHwid() { const r = readRecord(); return (r && r.hwid) || ''; }
function writeHwid(hwid) { return writeRecord({ hwid: String(hwid || '') }); }

/** Luu thong tin bane quyen sau khi kich hoat/xac thuc thanh cong. */
function saveLicense(license) {
  const l = license || {};
  if (!l.key) return 0;
  return writeRecord({
    key: l.key,
    vip: l.vip || '',
    expiresAt: l.expiresAt || '',
    allowedIds: Array.isArray(l.allowedIds) ? l.allowedIds : [],
    activatedAt: l.activatedAt || Date.now(),
    checkedAt: Date.now(),
  });
}

module.exports = {
  setExtraDir, readRecord, writeRecord, clearRecord,
  readKey, readHwid, writeHwid, saveLicense,
};
