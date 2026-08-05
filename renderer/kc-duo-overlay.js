// GIỮ / ĐỔI (Keep/Change) overlay — thanh máu 2 màu giữ/đổi người đang diễn.
// Layout: tên đội TRÊN thanh máu, icon quà 2 BÊN, đồng hồ Ở GIỮA (vị trí đổi được),
// người đang diễn (ghế nóng) nổi bật, WIN/LOSE khi kết thúc, chuỗi "trụ vững ghế" + số vòng.
const token = new URLSearchParams(location.search).get('token') || '';
if (new URLSearchParams(location.search).get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = new URLSearchParams(location.search).get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}
const root = document.getElementById('kcRoot');
const audio = document.getElementById('kcSound');

let lastStatus = '';
let lastRunKey = '';
let playedStart = false, playedWarning = false, playedResult = false;
let lastScoreA = 0, lastScoreB = 0, hasPrevScore = false;

// --- FX thanh máu: mọi trạng thái sống trong BIẾN CSS trên root (sống sót qua rebuild innerHTML,
// không nháy, không dùng filter → OBS-safe), điều khiển bởi MỘT vòng rAF. ---
//   --kc-a-width : vị trí ranh giới (nội suy đẩy máu mượt, giống PK Đôi)
//   --kc-move    : 0..1 độ sáng vạch chia khi máu đang di chuyển
//   --kc-surge   : 0..1 cường độ "va chạm" ở ranh giới (phân rã nhanh)
//   --kc-wave    : 0..1 tiến trình sóng xung kích lan ra; --kc-wave-op độ mờ; --kc-surge-dir hướng
//   --kc-pop-a/b : 0..1 số điểm bên vừa cộng nảy lên
const PUSH_MS = 520, SURGE_TAU = 230, WAVE_MS = 560, POP_MS = 430, KICK_TAU = 130;
const easeOutBack = t => { const c = 1.5; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
let widthCur = 50, widthFrom = 50, widthTarget = 50, widthT0 = 0, widthActive = false;
let surgeT0 = 0, surgeActive = false, waveT0 = 0, waveActive = false;
let popAT0 = 0, popAActive = false, popBT0 = 0, popBActive = false;
let kickT0 = 0, kickActive = false;
let fxRaf = 0;
function applyWidth(v) { root.style.setProperty('--kc-a-width', v.toFixed(3) + '%'); }
function ensureRaf() { if (!fxRaf) fxRaf = requestAnimationFrame(tick); }
function tick(now) {
  let alive = false;
  if (widthActive) {
    const t = Math.min(1, (now - widthT0) / PUSH_MS);
    widthCur = widthFrom + (widthTarget - widthFrom) * easeOutBack(t);
    if (t >= 1) { widthCur = widthTarget; widthActive = false; } else alive = true;
  }
  applyWidth(widthCur);
  root.style.setProperty('--kc-move', (widthActive ? Math.min(1, Math.abs(widthTarget - widthCur) / 6) : 0).toFixed(3));
  if (surgeActive) {
    const v = Math.exp(-(now - surgeT0) / SURGE_TAU);
    if (v < 0.02) { surgeActive = false; root.style.setProperty('--kc-surge', '0'); }
    else { root.style.setProperty('--kc-surge', v.toFixed(3)); alive = true; }
  }
  if (waveActive) {
    const p = (now - waveT0) / WAVE_MS;
    if (p >= 1) { waveActive = false; root.style.setProperty('--kc-wave', '0'); root.style.setProperty('--kc-wave-op', '0'); }
    else { root.style.setProperty('--kc-wave', p.toFixed(3)); root.style.setProperty('--kc-wave-op', Math.sin(Math.PI * p).toFixed(3)); alive = true; }
  }
  if (popAActive) { const p = (now - popAT0) / POP_MS; if (p >= 1) { popAActive = false; root.style.setProperty('--kc-pop-a', '0'); } else { root.style.setProperty('--kc-pop-a', Math.sin(Math.PI * p).toFixed(3)); alive = true; } }
  if (popBActive) { const p = (now - popBT0) / POP_MS; if (p >= 1) { popBActive = false; root.style.setProperty('--kc-pop-b', '0'); } else { root.style.setProperty('--kc-pop-b', Math.sin(Math.PI * p).toFixed(3)); alive = true; } }
  // Cú "thump" đập vào thanh máu (phân rã nhanh) → cả bar nảy nhẹ khi có bên ghi điểm.
  if (kickActive) {
    const v = Math.exp(-(now - kickT0) / KICK_TAU);
    if (v < 0.02) { kickActive = false; root.style.setProperty('--kc-kick', '0'); }
    else { root.style.setProperty('--kc-kick', v.toFixed(3)); alive = true; }
  }
  fxRaf = alive ? requestAnimationFrame(tick) : 0;
}
function pushWidth(target, snap) {
  widthTarget = target;
  if (snap) {
    widthActive = false; widthCur = widthFrom = target; applyWidth(target);
    root.style.setProperty('--kc-move', '0');
    return;
  }
  if (Math.abs(target - widthCur) < 0.01) return;
  widthFrom = widthCur; widthT0 = performance.now(); widthActive = true; ensureRaf();
}
// Bên vừa ghi điểm → bùng flare + phóng sóng xung kích đúng hướng + số nảy.
function triggerGain(side, colHex) {
  const now = performance.now();
  root.style.setProperty('--kc-surge-dir', side === 'A' ? '1' : '-1'); // A đẩy sang phải, B sang trái
  if (colHex) { root.style.setProperty('--kc-surge-col', colHex); root.style.setProperty('--kc-surge-rgb', hexToRgb(colHex, '255,255,255')); }
  surgeT0 = now; surgeActive = true;
  waveT0 = now; waveActive = true;
  kickT0 = now; kickActive = true;
  if (side === 'A') { popAT0 = now; popAActive = true; } else { popBT0 = now; popBActive = true; }
  ensureRaf();
}
function resetFx() {
  surgeActive = waveActive = popAActive = popBActive = kickActive = false;
  ['--kc-surge', '--kc-wave', '--kc-wave-op', '--kc-pop-a', '--kc-pop-b', '--kc-move', '--kc-kick'].forEach(k => root.style.setProperty(k, '0'));
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('vi-VN'); }
function mmss(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function hexToRgb(hex, fb = '0,0,0') {
  const m = String(hex || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return fb;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
function shortName(value, max = 18) {
  const s = String(value || '').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}
function giftHtml(gift) {
  return `<span class="kc-gift-icon" title="${esc(gift.giftName || gift.name || '')}">${gift.icon ? `<img src="${esc(gift.icon)}" />` : '🎁'}</span>`;
}
function giftLane(gifts, mode) {
  const list = (gifts || []).filter(Boolean);
  if (!list.length) return '';
  // ≤1 quà hoặc chế độ 2 hàng → tĩnh; nhiều quà + cuộn → marquee (nhân 3 bản để chạy vô hạn).
  if (list.length <= 1 || mode !== 'scroll') return list.map(giftHtml).join('');
  const html = list.map(giftHtml).join('');
  return `<span class="kc-gift-track"><span class="kc-gift-seq">${html}</span><span class="kc-gift-seq" aria-hidden="true">${html}</span><span class="kc-gift-seq" aria-hidden="true">${html}</span></span>`;
}

function playSound(url) {
  if (!url) return;
  audio.src = url; audio.currentTime = 0;
  audio.play().catch(() => {});
}

function render(state = {}) {
  if (window.OverlaySkin) OverlaySkin.applySkin(state.skin);
  const a = state.teamA || { name: 'KEEP/GIỮ', color: '#FE2C55', gifts: [] };
  const b = state.teamB || { name: 'CHANGE/ĐỔI', color: '#00D5FF', gifts: [] };
  const sec = Math.ceil((state.remainingMs || 0) / 1000);
  const status = state.status || 'idle';
  const runKey = String(state.startedAt || 'idle');
  const isNewRun = runKey !== lastRunKey;
  if (isNewRun) { lastRunKey = runKey; playedStart = false; playedWarning = false; playedResult = false; hasPrevScore = false; resetFx(); }

  // Đếm lùi khẩn cấp (giống PK Đôi): 10s lắc, ≤9s hiện SỐ to.
  const tick10 = status === 'running' && sec === 10;
  const finalCount = status === 'running' && sec <= 9 && sec > 0;
  const urgent = status === 'running' && sec <= 10 && sec > 0;
  const statusText =
    status === 'prestart' ? `${sec}` :
    status === 'running' ? (finalCount ? String(sec) : mmss(sec)) :
    status === 'grace' ? 'TÍNH ĐIỂM' :
    status === 'finished' ? 'KẾT THÚC' : 'SẴN SÀNG';
  const showClock = !(status === 'finished' || finalCount || status === 'prestart');

  const aWidth = Math.max(8, Math.min(92, 50 + Number(state.push || 0)));

  // Kết quả: ưu tiên winnerSide từ engine (đã áp ngưỡng lật kèo); fallback so điểm đơn giản.
  const showResult = status === 'finished';
  let winner = state.winnerSide === 'A' || state.winnerSide === 'B' ? state.winnerSide : '';
  if (showResult && !winner) winner = (Number(state.scoreB || 0) - Number(state.scoreA || 0)) > 0 ? 'B' : 'A';
  // Không hiển thị badge WIN/LOSE nữa (chỉ giữ winnerSide cho âm thanh kết quả).
  const resultA = '';
  const resultB = '';

  const neutral = Number(state.scoreA || 0) === Number(state.scoreB || 0);
  const aLead = Number(state.scoreA || 0) > Number(state.scoreB || 0);
  const barClass = neutral ? 'neutral' : (aLead ? 'lead-a' : 'lead-b');

  // Ngưỡng "lật kèo": vạch mốc ĐỔI phải vượt qua (lợi thế người đương nhiệm). Tính theo điểm hiện tại.
  const flipMargin = Math.max(0, Number(state.flipMargin) || 0);
  const flipMode = state.flipMarginMode === 'point' ? 'point' : 'percent';
  let holdMark = '';
  if (flipMargin > 0) {
    const tot = Number(state.scoreA || 0) + Number(state.scoreB || 0);
    const req = flipMode === 'point' ? flipMargin : tot * flipMargin / 100;
    let markPos = null;
    if (tot > 0) markPos = 50 - (req / tot) * 42;
    else if (flipMode === 'percent') markPos = 50 - flipMargin / 100 * 42;
    if (markPos != null) {
      markPos = Math.max(6, Math.min(50, markPos));
      holdMark = `<span class="kc-hold" style="left:${markPos.toFixed(2)}%" title="🛡️ Mốc lật ghế"><i>🛡️</i></span>`;
    }
  }

  const giftMode = state.giftDisplayMode === 'wrap' ? 'wrap' : 'scroll';
  const timerPos = ['left', 'right', 'center'].includes(state.timerPos) ? state.timerPos : 'center';

  // Người đang diễn (ghế nóng) + người kế tiếp.
  const performer = String(state.performerName || '').trim();
  const nextName = String(state.nextName || '').trim();
  const defend = Math.max(0, Number(state.defendStreak) || 0);
  const rounds = Math.max(0, Number(state.totalRounds) || 0);

  const rawScale = parseInt(state.overlayScale, 10);
  if (Number.isFinite(rawScale)) { try { localStorage.setItem('kcDuoScale', rawScale); } catch {} }
  const useScale = Number.isFinite(rawScale) ? rawScale : (parseInt(localStorage.getItem('kcDuoScale'), 10) || 200);
  const overlayScale = Math.max(.8, Math.min(3, useScale / 100));

  const giftDelay = -((Date.now() % 9000) / 1000).toFixed(3);
  // Vệt sáng ƯU THẾ lặp 3.6s (khớp @keyframes kcBeamRun): delay ÂM neo theo đồng hồ tường
  // → sau mỗi lần render dựng lại innerHTML, animation vẫn tiếp tục đúng pha (không giật/nhảy).
  const beamDelay = -((Date.now() % 3600) / 1000).toFixed(3);
  const content = String(state.content || '').trim();

  const boardStyle = `
    --kc-a:${esc(a.color || '#FE2C55')};
    --kc-a-rgb:${hexToRgb(a.color || '#FE2C55', '254,44,85')};
    --kc-b:${esc(b.color || '#00D5FF')};
    --kc-b-rgb:${hexToRgb(b.color || '#00D5FF', '0,213,255')};
    --kc-gift:${Math.max(28, Math.min(90, parseInt(state.giftSize, 10) || 46))}px;
    --kc-text:${Math.max(14, Math.min(42, parseInt(state.textSize, 10) || 21))}px;
    --kc-scale:${overlayScale};
    --kc-gift-delay:${giftDelay}s;
    --kc-beam-delay:${beamDelay}s`;
  const boardClass = `kc-board status-${esc(status)} ${barClass} tpos-${timerPos}${urgent ? ' urgent' : ''}${tick10 ? ' tick10' : ''}${finalCount ? ' final-count' : ''}`;

  const roundChip = `<span class="kc-chip kc-round" title="Số vòng đã chạy">Vòng:<b>${rounds}</b></span>`;
  const defendChip = defend > 0 ? `<span class="kc-chip kc-defend" title="Số vòng người đang diễn giữ được ghế">CHUỖI:<b>${defend}</b></span>` : '';
  const timerHtml = `<div class="kc-timer status-${esc(status)}">${showClock ? '<i class="kc-clock" aria-hidden="true"></i>' : ''}<b>${esc(statusText)}</b></div>`;
  // Tiêu đề: KHÔNG nhập nội dung → tự ẩn (không chiếm chỗ). Có nhập → hiện, căn giữa trên cùng.
  const titleHtml = content ? `<div class="kc-head"><span class="kc-title">${esc(content)}</span></div>` : '';
  // Ghế nóng / người kế — hàng CHÂN (dưới thanh máu).
  const seatLine = performer
    ? `<span class="kc-seat"><span class="kc-seat-mic">🎤</span><b class="kc-seat-name">${esc(shortName(performer, 22))}</b>${nextName ? `<span class="kc-seat-next">→ kế: <b>${esc(shortName(nextName, 16))}</b></span>` : ''}</span>`
    : (nextName ? `<span class="kc-seat"><span class="kc-seat-next">Người kế: <b>${esc(shortName(nextName, 16))}</b></span></span>` : '');
  // Hàng chân giữ CHIỀU CAO cố định → thanh máu đứng yên. Trụ 🔥 sát MÉP TRÁI, Vòng 🔁 sát MÉP PHẢI
  // (canh theo 2 đầu thanh máu), ghế nóng ở giữa.
  const footHtml = `<span class="kc-foot-slot left">${defendChip}</span><span class="kc-foot-mid">${seatLine}</span><span class="kc-foot-slot right">${roundChip}</span>`;

  root.innerHTML = `<div class="${boardClass}" style="${boardStyle}">
    ${titleHtml}
    <div class="kc-topline">
      <span class="kc-team-label a"><b class="kc-name a">${esc(shortName(a.name || 'KEEP/GIỮ'))}</b>${resultA}</span>
      ${timerHtml}
      <span class="kc-team-label b">${resultB}<b class="kc-name b">${esc(shortName(b.name || 'CHANGE/ĐỔI'))}</b></span>
    </div>
    <div class="kc-barrow">
      <span class="kc-gift left">${giftLane(a.gifts, giftMode)}</span>
      <div class="kc-bar">
        <span class="kc-fill" aria-hidden="true"></span>
        <span class="kc-beam" aria-hidden="true"><span class="kc-beam-band"></span></span>
        <span class="kc-wave" aria-hidden="true"></span>
        <span class="kc-streak" aria-hidden="true"></span>
        ${holdMark}
        <span class="kc-seam" aria-hidden="true"></span>
        <span class="kc-flare" aria-hidden="true"></span>
        <strong class="kc-score a">${fmt(state.scoreA)}</strong>
        <strong class="kc-score b">${fmt(state.scoreB)}</strong>
      </div>
      <span class="kc-gift right">${giftLane(b.gifts, giftMode)}</span>
    </div>
    <div class="kc-foot">${footHtml}</div>
  </div>`;
  root.style.setProperty('--kc-scale', overlayScale);

  pushWidth(aWidth, isNewRun);

  // Bên vừa ghi điểm (so với lần render trước) → FX va chạm/sóng/số nảy. Chỉ khi đang chạy.
  const sA = Number(state.scoreA || 0), sB = Number(state.scoreB || 0);
  if (hasPrevScore && (status === 'running' || status === 'grace')) {
    const dA = sA - lastScoreA, dB = sB - lastScoreB;
    let gainSide = '';
    if (dA > 0 && dB > 0) gainSide = dA >= dB ? 'A' : 'B';
    else if (dA > 0) gainSide = 'A';
    else if (dB > 0) gainSide = 'B';
    if (gainSide) triggerGain(gainSide, gainSide === 'A' ? (a.color || '#FE2C55') : (b.color || '#00D5FF'));
  }
  lastScoreA = sA; lastScoreB = sB; hasPrevScore = true;

  // Âm thanh
  if (!playedStart && (status === 'prestart' || status === 'running')) { playedStart = true; playSound(state.startSound); }
  if (!playedWarning && urgent) { playedWarning = true; playSound(state.warningSound); }
  if (status === 'finished' && lastStatus !== 'finished' && !playedResult) {
    playedResult = true;
    if (winner === 'A') playSound(state.keepSound);
    else if (winner === 'B') playSound(state.changeSound);
    else playSound(state.drawSound);
  }
  lastStatus = status;
}

render({});
connectSSE(`/kc-duo-events?token=${encodeURIComponent(token)}`, 'kcduo', render);
