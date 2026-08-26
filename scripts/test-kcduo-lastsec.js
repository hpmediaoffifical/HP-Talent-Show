'use strict';
// Replay chuỗi gói tin quà vào ĐÚNG class KcDuoEngine (bóc thẳng từ src/main.js, không cần Electron)
// để kiểm chứng lỗi: "Giữ/Đổi — lên combo GIÂY CUỐI là thanh tự động ×2 điểm".
//
// Chạy: node scripts/test-kcduo-lastsec.js
//
// Vì sao cần harness riêng (ngoài scripts/test-gift-combo.js): lỗi này KHÔNG nằm trong comboDelta mà
// nằm ở TƯƠNG TÁC giữa vòng đời trận (prestart/running/grace/finished) với bộ nhớ combo của engine:
//   • routeGift chặn ở đầu khi status không phải running/grace → comboDelta KHÔNG được gọi (bộ nhớ
//     combo đứng yên trong lúc prestart/finished).
//   • start() gọi this._comboRepeats.clear() → XOÁ SẠCH bộ nhớ combo đang dở.
// Combo lên ở giây cuối luôn còn nhịp/gói chốt bay tới SAU khi trận đã chốt (TikTok/connector trễ tới
// vài giây — xem memory gift-latency-not-app). Nếu MC bấm BẮT ĐẦU vòng mới lúc đó, bộ nhớ vừa bị xoá
// nên nhịp còn lại của CHÍNH lượt combo cũ bị coi là "lượt tặng mới" và cộng ĐỦ lần thứ hai.
//
// Đồng hồ + setInterval đều được GIẢ LẬP nên test chạy tức thì và tất định.

const fs = require('fs');
const path = require('path');
const { comboDelta } = require('../src/gift-combo');

// ---------- Bóc class KcDuoEngine khỏi main.js ----------
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const from = MAIN.indexOf('class KcDuoEngine {');
const to = MAIN.indexOf('class PkGroupEngine {');
if (from < 0 || to < 0 || to <= from) { console.error('Không tìm thấy class KcDuoEngine trong src/main.js'); process.exit(2); }
const CLASS_SRC = MAIN.slice(from, to);

// Các helper mà class dùng tới — bản thật (chép nguyên văn hành vi) hoặc stub vô hại.
function normRecipientName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '');
}
function orderNamesByRotation(names, order) {
  const set = new Set(names), seen = new Set(), out = [];
  for (const n of (Array.isArray(order) ? order : [])) {
    const s = String(n || '').trim();
    if (s && set.has(s) && !seen.has(s)) { out.push(s); seen.add(s); }
  }
  for (const n of names) if (!seen.has(n)) { out.push(n); seen.add(n); }
  return out;
}
function migrateTiktokMode(cfg) { if (cfg && cfg.creatorLive) { cfg.tiktokCombine = true; cfg.creatorLive = false; } return cfg; }
function giftMatches(rule, ev) {
  if (!rule) return false;
  if (rule.giftId && String(rule.giftId) === String(ev.giftId)) return true;
  if (rule.giftName && rule.giftName.toLowerCase() === String(ev.giftName || '').toLowerCase()) return true;
  return false;
}
function resolveDiamond(ev) { return Number(ev.diamondCount) > 0 ? Number(ev.diamondCount) : 0; }

// ---------- Đồng hồ + hẹn giờ giả ----------
let clock = 1700000000000;
let timers = [];
const fakeSetInterval = (fn, ms) => { const t = { fn, ms, next: clock + ms, dead: false }; timers.push(t); return t; };
const fakeClearInterval = (t) => { if (t) t.dead = true; timers = timers.filter(x => x !== t); };
function advance(ms) {
  const target = clock + ms;
  for (;;) {
    const due = timers.filter(t => !t.dead && t.next <= target).sort((a, b) => a.next - b.next)[0];
    if (!due) break;
    clock = due.next;
    due.next += due.ms;
    due.fn();
  }
  clock = target;
}
const realNow = Date.now;
Date.now = () => clock; // comboDelta (module khác) cũng phải nhìn cùng đồng hồ

const KcDuoEngine = new Function(
  'comboDelta', 'resolveDiamond', 'giftMatches', 'migrateTiktokMode', 'normRecipientName',
  'orderNamesByRotation', 'setInterval', 'clearInterval',
  CLASS_SRC + '\nreturn KcDuoEngine;'
)(comboDelta, resolveDiamond, giftMatches, migrateTiktokMode, normRecipientName,
  orderNamesByRotation, fakeSetInterval, fakeClearInterval);

// ---------- Dựng engine theo CẤU HÌNH THẬT của user (config/kc-duo.json) ----------
const KC_REAL = path.join(process.env.APPDATA || '', 'HP Talent Show', 'config', 'kc-duo.json');
let realCfg = null;
try { realCfg = JSON.parse(fs.readFileSync(KC_REAL, 'utf8')); } catch {}

function newEngine(patch = {}) {
  const rankLog = [];
  const eng = new KcDuoEngine({
    onState: () => {},
    getCreators: () => [],
    onConfigChange: () => {},
    onRankingPoints: (cid, pts) => rankLog.push({ cid, pts }),
  });
  const base = realCfg ? { ...realCfg } : {};
  eng.setConfig({
    ...base,
    // GIỮ = Hoa hồng 1 kim cương (đúng cấu hình thật), ĐỔI để trống.
    teamA: { name: 'GIỮ', gifts: [{ giftName: 'Rose', giftId: '5655', diamond: 1 }] },
    teamB: { name: 'ĐỔI', gifts: [] },
    tiktokCombine: false,     // bỏ định tuyến theo người nhận cho gọn: quà Hoa hồng → phe GIỮ
    joinMode: false,
    pointsBy: 'diamond',
    linkRanking: false,
    prepSec: 0,
    durationSec: 60,
    delaySec: 5,
    ...patch,
  });
  eng._rankLog = rankLog;
  return eng;
}

// Gói tin Hoa hồng của MỘT người xem. rc = repeatCount, end = repeatEnd.
const rose = (rc, end = false, grp = '') => ({
  uniqueId: 'khan_gia', nickname: 'Khán giả', giftId: '5655', giftName: 'Rose',
  diamondCount: 1, repeatCount: rc, repeatEnd: end, comboGroupId: grp,
});

// ---------- Bộ kịch bản ----------
// Mỗi kịch bản trả về { got, want, note } — got = tổng điểm GIỮ cộng dồn qua CÁC VÒNG.
const CASES = [];

CASES.push({
  name: 'combo x10 GỌN trong trận (đối chứng)',
  want: 10,
  run() {
    const e = newEngine();
    e.start(); advance(250);
    for (let i = 1; i <= 10; i++) { e.routeGift(rose(i, false, 'g1')); advance(300); }
    e.routeGift(rose(10, true, 'g1'));
    advance(60000 + 6000);
    return e.state.scoreA;
  },
});

CASES.push({
  name: 'combo x10 lên GIÂY CUỐI, đuôi rơi vào Delay (grace) — cùng vòng',
  want: 10,
  run() {
    const e = newEngine();
    e.start(); advance(250);
    advance(58500);                      // chạy tới sát giây cuối
    for (let i = 1; i <= 10; i++) { e.routeGift(rose(i, false, 'g1')); advance(300); }
    e.routeGift(rose(10, true, 'g1'));   // gói chốt rơi trong grace
    advance(10000);
    return e.state.scoreA;
  },
});

CASES.push({
  name: '★ combo x10 GIÂY CUỐI + MC bấm BẮT ĐẦU vòng mới, đuôi combo bay tới sau',
  want: 10,
  note: 'điểm của vòng 1 + vòng 2 cộng lại phải vẫn là 10 quà',
  run() {
    const e = newEngine();
    e.start(); advance(250);
    advance(58500);
    for (let i = 1; i <= 8; i++) { e.routeGift(rose(i, false, 'g1')); advance(300); } // 8 nhịp lọt vòng 1
    const r1 = e.state.scoreA;
    advance(6000);            // hết giờ + hết Delay → finished
    e.start(); advance(250);  // MC mở vòng mới NGAY (start() xoá sạch bộ nhớ combo)
    e.routeGift(rose(9, false, 'g1'));   // hai nhịp cuối của CHÍNH lượt combo cũ mới bay tới
    advance(300);
    e.routeGift(rose(10, true, 'g1'));
    advance(2000);
    return r1 + e.state.scoreA;
  },
});

CASES.push({
  name: '★ combo x50 GIÂY CUỐI, chỉ GÓI CHỐT tới muộn sau khi MC mở vòng mới',
  want: 50,
  note: 'gói chốt lặp lại tổng 50 — không được cộng thêm 50 vào vòng mới',
  run() {
    const e = newEngine();
    e.start(); advance(250);
    advance(58000);
    for (let i = 1; i <= 50; i++) { e.routeGift(rose(i, false, 'g7')); advance(40); }
    const r1 = e.state.scoreA;
    advance(6000);
    e.start(); advance(250);
    e.routeGift(rose(50, true, 'g7')); // gói chốt trễ (TikTok/connector trễ vài giây)
    advance(2000);
    return r1 + e.state.scoreA;
  },
});

CASES.push({
  name: '★ MC bấm BẮT ĐẦU vòng mới NGAY trong Delay, combo vẫn đang chạy',
  want: 10,
  run() {
    const e = newEngine();
    e.start(); advance(250);
    advance(59500);
    for (let i = 1; i <= 5; i++) { e.routeGift(rose(i, false, 'g2')); advance(200); }
    const r1 = e.state.scoreA;
    advance(1000);            // đang trong grace (Delay 5s)
    e.start(); advance(250);  // MC mở vòng mới giữa Delay
    for (let i = 6; i <= 10; i++) { e.routeGift(rose(i, false, 'g2')); advance(200); }
    e.routeGift(rose(10, true, 'g2'));
    advance(2000);
    return r1 + e.state.scoreA;
  },
});

CASES.push({
  name: 'combo x10 rơi trọn vào lúc trận ĐÃ CHỐT rồi mở vòng mới (lượt mới thật)',
  want: 10,
  note: 'đây là lượt tặng MỚI hoàn toàn — phải cộng đủ 10, không được nuốt',
  run() {
    const e = newEngine();
    e.start(); advance(250);
    advance(70000);           // hết trận (60s) + hết Delay
    e.start(); advance(250);  // vòng mới
    for (let i = 1; i <= 10; i++) { e.routeGift(rose(i, false, 'g3')); advance(300); }
    e.routeGift(rose(10, true, 'g3'));
    advance(2000);
    return e.state.scoreA;
  },
});

CASES.push({
  name: 'quà lẻ liên tiếp qua ranh giới vòng (2 lượt khác nhau) → phải là 2',
  want: 2,
  run() {
    const e = newEngine();
    e.start(); advance(250);
    advance(59000);
    e.routeGift(rose(1, true, 'gA'));
    const r1 = e.state.scoreA;
    advance(6000);
    e.start(); advance(250);
    e.routeGift(rose(1, true, 'gB'));
    advance(1000);
    return r1 + e.state.scoreA;
  },
});

// ---------- Chạy ----------
console.log('\n  GIỮ/ĐỔI — combo lên GIÂY CUỐI (engine thật, bóc từ src/main.js)\n');
let failed = 0;
for (const c of CASES) {
  clock = 1700000000000; timers = [];
  let got;
  try { got = c.run(); } catch (err) { got = `LỖI: ${err.message}`; }
  const ok = got === c.want;
  if (!ok) failed++;
  console.log(`  ${ok ? 'ĐẠT ' : 'HỎNG'}  ${c.name}`);
  console.log(`         mong đợi ${c.want} điểm GIỮ | thực tế ${got}${ok ? '' : `  ← LỆCH ${typeof got === 'number' ? got - c.want : '?'}`}`);
  if (c.note) console.log(`         (${c.note})`);
}
console.log(`\n  ${CASES.length - failed}/${CASES.length} kịch bản đạt\n`);
Date.now = realNow;
process.exit(failed ? 1 : 0);
