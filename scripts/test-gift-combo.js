// Replay các CHUỖI GÓI TIN quà TikTok để kiểm chứng bộ đếm combo — chạy: node scripts/test-gift-combo.js
//
// Vì sao có file này: lỗi "1 quà thành 2" đã tái đi tái lại 3 lần (v0.1.87, v0.1.95, v0.1.96) vì mỗi
// lần chỉ vá ở NƠI HIỂN THỊ mà không có cách nào tái hiện chuỗi gói tin. Harness này replay thẳng vào
// comboDelta nên tái hiện được trong mili giây, không cần Electron/LIVE.
//
// Chạy đối chứng cả HAI bản: LEGACY (bản trước 0.1.97, xoá state ngay khi thấy gói chốt) và CURRENT
// (src/gift-combo.js). Kịch bản nào LEGACY sai mà CURRENT đúng chính là lỗi đã vá.

const { comboDelta: current } = require('../src/gift-combo');

// --- Bản CŨ, chép nguyên văn từ main.js trước bản vá (dùng làm đối chứng) ---
const LEGACY_TTL = 60000;
function legacy(map, ev, now = Date.now()) {
  const repeat = Math.max(1, Number(ev.repeatCount) || 1);
  const key = `${ev.uniqueId || ev.nickname || ev.avatar || 'anonymous'}:${ev.giftId || ev.giftName || 'gift'}`;
  const prev = map.get(key);
  const fresh = !prev || (now - prev.at) > LEGACY_TTL || repeat < prev.last;
  let delta, counted;
  if (fresh) { delta = repeat; counted = repeat; }
  else if (repeat > prev.counted) { delta = repeat - prev.counted; counted = repeat; }
  else if (ev.repeatEnd) { delta = 0; counted = prev.counted; }
  else { delta = repeat; counted = prev.counted + repeat; }
  if (ev.repeatEnd) map.delete(key);
  else map.set(key, { last: repeat, counted, at: now });
  return delta;
}

// --- Bộ dựng gói tin ---
// p(repeatCount, repeatEnd, {gap: ms trước gói này, user, gift})
const p = (repeatCount, repeatEnd = false, o = {}) => ({ repeatCount, repeatEnd, ...o });
const accumulate = (n) => { const out = []; for (let i = 1; i <= n; i++) out.push(p(i)); out.push(p(n, true)); return out; };
const eachBeat = (n) => { const out = []; for (let i = 0; i < n; i++) out.push(p(1)); out.push(p(n, true)); return out; };
const batched = (each, times) => { const out = []; for (let i = 0; i < times; i++) out.push(p(each)); out.push(p(each * times, true)); return out; };

// Mỗi kịch bản: { name, packets, expect, per? } — per = tổng riêng theo khoá (nhiều người/nhiều quà)
const CASES = [
  { name: '1 quà thường (không combo)', packets: [p(1, true)], expect: 1 },
  { name: 'combo x5 tích luỹ 1..5 + chốt', packets: accumulate(5), expect: 5 },
  { name: 'combo x500 tích luỹ + chốt', packets: accumulate(500), expect: 500 },
  { name: 'combo x200 từng nhịp (repeat luôn 1) + chốt', packets: eachBeat(200), expect: 200 },
  { name: 'combo theo lô 10x20 + chốt 200', packets: batched(10, 20), expect: 200 },
  { name: 'one-shot 200 (1 gói duy nhất, repeatEnd)', packets: [p(200, true)], expect: 200 },

  // ↓↓↓ Ba kịch bản gây lỗi "200 hoa hồng thành 400" ↓↓↓
  {
    name: '★ one-shot 200 + PHÁT LẠI gói chốt (msgId khác)',
    packets: [p(200, true), p(200, true, { gap: 300 })], expect: 200,
  },
  {
    name: '★ tích luỹ 200 + gói chốt đến HAI LẦN',
    packets: [...accumulate(200), p(200, true, { gap: 250 })], expect: 200,
  },
  // ↓↓↓ Hồi quy: KHÔNG được mất quà (quan trọng ngang việc không nhân đôi) ↓↓↓
  {
    name: 'combo CHỐT XONG rồi combo MỚI ngay sau (1.5s) → phải cộng đủ cả hai',
    packets: [...accumulate(5), p(1, false, { gap: 1500 }), p(2), p(3), p(3, true)], expect: 8,
  },
  {
    name: 'hai lượt tặng LẺ cùng quà cách nhau 2s → phải là 2',
    packets: [p(1, true), p(1, true, { gap: 2000 })], expect: 2,
  },
  {
    name: 'quà KHÔNG combo tặng liên tiếp 3 lần → phải là 3',
    packets: [p(1), p(1, false, { gap: 900 }), p(1, false, { gap: 900 })], expect: 3,
  },
  {
    name: 'rớt gói chốt rồi tặng tiếp lượt mới (bắt đầu lại từ 1)',
    packets: [p(1), p(2), p(3), p(1, false, { gap: 1500 }), p(2), p(2, true)], expect: 5,
  },
  {
    name: 'chuỗi chốt xong, tặng lượt MỚI sau cửa sổ hấp thụ (6s)',
    packets: [p(5, true), p(5, true, { gap: 6000 })], expect: 10,
  },
  {
    name: 'chuỗi vẫn chạy tiếp SAU gói chốt (tổng tăng) → chỉ cộng phần chênh',
    packets: [p(10, true), p(15, false, { gap: 200 }), p(15, true, { gap: 100 })], expect: 15,
  },
  {
    name: 'quá TTL 60s → lượt tặng mới, cộng đủ',
    packets: [p(3, true), p(3, true, { gap: 61000 })], expect: 6,
  },

  // ↓↓↓ Không được lẫn giữa người / giữa quà ↓↓↓
  {
    name: 'hai người combo cùng lúc, xen kẽ',
    packets: [
      p(1, false, { user: 'a' }), p(1, false, { user: 'b' }),
      p(2, false, { user: 'a' }), p(2, false, { user: 'b' }),
      p(2, true, { user: 'a' }), p(2, true, { user: 'b' }),
    ],
    per: { 'a:g': 2, 'b:g': 2 },
  },
  {
    name: 'một người, hai quà khác nhau, xen kẽ',
    packets: [
      p(1, false, { gift: 'rose' }), p(1, false, { gift: 'cake' }),
      p(3, false, { gift: 'rose' }), p(3, true, { gift: 'rose' }),
      p(2, true, { gift: 'cake' }),
    ],
    per: { 'u:rose': 3, 'u:cake': 2 },
  },
];

function run(fn, c) {
  const map = new Map();
  const totals = {};
  let now = 1_000_000;
  for (const pk of c.packets) {
    now += pk.gap != null ? pk.gap : 40; // nhịp combo cách nhau ~40ms
    const ev = { uniqueId: pk.user || 'u', giftId: pk.gift || 'g', repeatCount: pk.repeatCount, repeatEnd: pk.repeatEnd };
    const k = `${ev.uniqueId}:${ev.giftId}`;
    totals[k] = (totals[k] || 0) + fn(map, ev, now);
  }
  return totals;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let failed = 0;
const rows = [];
for (const c of CASES) {
  const want = c.per || { 'u:g': c.expect };
  const got = run(current, c);
  const old = run(legacy, c);
  const ok = same(got, want);
  const oldOk = same(old, want);
  if (!ok) failed++;
  rows.push({ name: c.name, want, got, old, ok, oldOk });
}

const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' ');
console.log('\n  BẢN CŨ = trước bản vá (xoá state khi thấy gói chốt) · BẢN MỚI = src/gift-combo.js\n');
for (const r of rows) {
  console.log(`  ${r.ok ? 'ĐẠT ' : 'HỎNG'}  ${r.name}`);
  console.log(`         mong đợi ${fmt(r.want)} | mới ${fmt(r.got)} | cũ ${fmt(r.old)}${r.oldOk ? '' : '  ← bản cũ SAI'}`);
}
const fixed = rows.filter(r => r.ok && !r.oldOk).length;
console.log(`\n  ${rows.length - failed}/${rows.length} kịch bản đạt · bản mới vá được ${fixed} kịch bản bản cũ làm sai\n`);

// ---------------------------------------------------------------------------
// Kiểm chứng ở tầng Ô ĐẬP TRỨNG: chép đúng vòng lặp của StickerEngine.routeGift
// (main.js) rồi chạy trên CẤU HÌNH THẬT của máy này. Bắt được cả lỗi combo lẫn
// lỗi "hai ô cùng giftId dồn vào một bucket" (rt khoá theo giftId).
const fs = require('fs');
const path = require('path');
const giftMatches = (rule, ev) => {
  if (!rule) return false;
  if (rule.giftId && String(rule.giftId) === String(ev.giftId)) return true;
  if (rule.giftName && rule.giftName.toLowerCase() === String(ev.giftName || '').toLowerCase()) return true;
  return false;
};
function stickerReplay(cells, packets, ev0) {
  const map = new Map(); const rt = {};
  let now = 1_000_000;
  for (const pk of packets) {
    now += pk.gap != null ? pk.gap : 40;
    const ev = { ...ev0, repeatCount: pk.repeatCount, repeatEnd: pk.repeatEnd };
    const rep = current(map, ev, now);
    if (!rep) continue;
    for (const c of cells) {
      if (!giftMatches(c, ev)) continue;
      const k = String(c.giftId || '');
      rt[k] = rt[k] || { received: 0, points: 0 };
      rt[k].received += rep;
      rt[k].points += 1 * rep; // Hoa hồng = 1 kim cương
    }
  }
  return rt;
}

const SCEN = [
  { name: 'one-shot 200 + phát lại gói chốt', packets: [p(200, true), p(200, true, { gap: 300 })] },
  { name: 'tích luỹ 200 + gói chốt hai lần', packets: [...accumulate(200), p(200, true, { gap: 250 })] },
];
const PROF = path.join(process.env.APPDATA || '', 'HP Talent Show', 'config', 'group-profiles.json');
let cells = null, src = '';
try {
  const profs = JSON.parse(fs.readFileSync(PROF, 'utf8'));
  const all = profs.groupProfiles || profs;
  for (const [gid, prof] of Object.entries(all)) {
    const cs = prof?.sticker?.cells || [];
    if (cs.some(c => String(c.giftId) === '5655')) { cells = cs; src = gid; break; }
  }
} catch {}
if (!cells) {
  console.log('  (bỏ qua phần Ô ĐẬP TRỨNG: không tìm thấy cấu hình có ô Hoa hồng 5655 trên máy này)\n');
} else {
  console.log(`  Ô ĐẬP TRỨNG — cấu hình THẬT của nhóm ${src} (${cells.length} ô, ô Hoa hồng giftId 5655)\n`);
  const ev0 = { uniqueId: 'khan_gia', giftId: '5655', giftName: 'Rose' };
  for (const s of SCEN) {
    const rt = stickerReplay(cells, s.packets, ev0);
    const got = rt['5655'] ? rt['5655'].received : 0;
    const pts = rt['5655'] ? rt['5655'].points : 0;
    const ok = got === 200 && pts === 200;
    if (!ok) failed++;
    console.log(`  ${ok ? 'ĐẠT ' : 'HỎNG'}  ${s.name} → ô hiện ${got} quà / ${pts} điểm (mong đợi 200 / 200)`);
    const others = Object.keys(rt).filter(k => k !== '5655');
    if (others.length) { failed++; console.log(`         ✗ ô khác cũng bị cộng: ${others.join(', ')}`); }
  }
  console.log('');
}
process.exit(failed ? 1 : 0);
