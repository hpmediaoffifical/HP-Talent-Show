// PK Đôi FX — overlay toàn màn hình 1080x1920 phủ lên cặp video PK.
// Dùng CHUNG stream điểm /pk-duo-events với overlay banner (0 engine mới).
// Nguyên tắc: dựng DOM MỘT LẦN, mỗi lần có state chỉ đổi CSS var + class
// → animation hiệu ứng chạy liên tục, không restart mỗi 250ms (mượt trên OBS).

const token = new URLSearchParams(location.search).get('token') || '';
if (new URLSearchParams(location.search).get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = new URLSearchParams(location.search).get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}

const root = document.getElementById('pkfxRoot');
const audio = document.getElementById('pkfxSound');

// 3 kiểu đầu dựng bằng CSS; 7 kiểu sau vẽ bằng ẢNH (webp động trong /fx-assets) — thứ CSS thuần
// không dựng nổi. 'frost' đặc biệt: 3 lớp ảnh nhẹ/vừa/nặng, JS chọn cấp theo chênh điểm (frostTier).
const FX_STYLES = ['freeze', 'fire', 'water',
  'prison', 'smoke', 'ice1', 'ice2', 'ice3', 'frost', 'chain'];
// Màu "mặt nước" (ngọn 3D) mỗi kiểu FX — sáng hơn thân để bắt sáng rõ.
const FX_CREST = {
  freeze: '200,235,255', fire: '255,168,66', water: '120,205,255',
  prison: '196,204,214', smoke: '150,150,156',
  ice1: '198,236,255', ice2: '176,220,250', ice3: '206,240,255', frost: '190,230,255', chain: '198,200,206',
};
// Băng phủ dày dần theo mức bị dẫn: t1 (mỏng) → t2 → t3 (kín). intensity đã gồm sàn 0.62 nên
// mốc chia lấy trong khoảng 0.62..1 cho trải đều 3 cấp.
function frostTier(intensity) { return intensity >= 0.90 ? 3 : intensity >= 0.76 ? 2 : 1; }

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('vi-VN'); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function mmss(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function shortName(v) { const s = String(v || '').trim(); return s.length > 16 ? s.slice(0, 16) + '…' : s; }

// ---- Particle scaffolds (dựng 1 lần) --------------------------------------
function particles(cls, count, mk) {
  let html = '';
  for (let i = 0; i < count; i++) html += mk(i, count);
  return `<span class="${cls}">${html}</span>`;
}

// Một nửa màn hình (trái/phải) — chứa sẵn tất cả bộ hiệu ứng, CSS chỉ hiện bộ đang bật.
// Nhiều lớp chiều sâu (back/front/parallax) → cảm giác 3D, sinh động.
function halfHtml(side) {
  const freeze = `<span class="fx fx-freeze">
      <i class="fx-cast"></i>
      <i class="ice-slab"></i>
      <i class="frost-sheet"></i>
      <i class="frost-edge top"></i><i class="frost-edge bottom"></i><i class="frost-edge in"></i><i class="frost-edge out"></i>
      <i class="ice-crack"></i><i class="ice-shine"></i>
      ${particles('crystals', 11, (i) => `<i class="crystal" style="--x:${(i * 11 + 6) % 100}%;--y:${(i * 23 + 8) % 100}%;--s:${0.6 + (i % 4) * 0.4};--d:${(i % 5) * 0.6}s"></i>`)}
      ${particles('snow', 24, (i) => `<i class="flake" style="--x:${(i * 6 + 3) % 100}%;--d:${(i % 7) * 0.8}s;--dur:${6 + (i % 5)}s;--s:${0.5 + (i % 3) * 0.5};--sway:${(i % 2 ? 1 : -1) * (10 + i % 12)}px"></i>`)}
    </span>`;
  const fire = `<span class="fx fx-fire">
      <i class="fx-cast"></i>
      <i class="fire-glow"></i>
      <span class="flames back">${particles('', 6, (i) => `<i class="flame" style="--x:${10 + i * 16}%;--d:${(i % 4) * 0.2}s;--h:${0.75 + (i % 3) * 0.2};--w:${1 + (i % 2) * 0.4}"></i>`)}</span>
      <span class="flames front">${particles('', 9, (i) => `<i class="flame" style="--x:${6 + i * 10.5}%;--d:${(i % 5) * 0.15}s;--h:${0.9 + (i % 3) * 0.25};--w:${0.8 + (i % 2) * 0.3}"></i>`)}</span>
      <span class="smoke">${particles('', 5, (i) => `<i class="puff" style="--x:${14 + i * 18}%;--d:${i * 0.8}s;--dur:${4 + i}s"></i>`)}</span>
      ${particles('embers', 28, (i) => `<i class="ember" style="--x:${(i * 6 + 4) % 100}%;--d:${(i % 8) * 0.35}s;--dur:${2.2 + (i % 5) * 0.5}s;--s:${0.5 + (i % 4) * 0.4};--drift:${(i % 2 ? 1 : -1) * (20 + i % 30)}px"></i>`)}
      <i class="heat"></i>
    </span>`;
  const water = `<span class="fx fx-water">
      <i class="fx-cast"></i>
      <i class="water-body">
        <i class="caustics"></i><i class="wave wave2"></i><i class="wave wave1"></i>
      </i>
      <i class="water-glass"></i>
      ${particles('bubbles', 20, (i) => `<i class="bubble" style="--x:${(i * 7 + 5) % 100}%;--d:${(i % 6) * 0.5}s;--dur:${3 + (i % 5) * 0.6}s;--s:${0.4 + (i % 4) * 0.5};--drift:${(i % 2 ? 1 : -1) * (14 + i % 16)}px"></i>`)}
    </span>`;
  // Nhóm hiệu ứng dựng bằng ẢNH: ảnh webp tự chạy animation trong file → không tốn animation CSS.
  // fx-cast/affl-shade là nền màu ĐẶC để đọc rõ trên video OBS [[obs-fx-cast-layer]].
  const img = (id) => `<span class="fx fx-${id}"><i class="fx-cast"></i><i class="affl-img"></i><i class="affl-shade"></i></span>`;
  const prison = img('prison'), smoke = img('smoke');
  const ice = img('ice1') + img('ice2') + img('ice3') + img('chain');
  // Băng phủ: 3 lớp cùng nằm sẵn, CSS chỉ hiện lớp khớp cấp (frost-t1/t2/t3 đặt trên nửa màn hình).
  const frost = `<span class="fx fx-frost"><i class="fx-cast"></i>
      <i class="affl-img t1"></i><i class="affl-img t2"></i><i class="affl-img t3"></i>
      <i class="affl-shade"></i></span>`;
  const crest = `<span class="fx-crest"><i class="crest-glow"></i><i class="crest-fill"></i><i class="crest-foam"></i><i class="crest-rim"></i><i class="crest-splash"></i></span>`;
  return `<div class="pkfx-half ${side}">
    ${freeze}${fire}${water}${prison}${smoke}${ice}${frost}
    ${crest}
    <span class="pkfx-badge"><b class="pkfx-result"></b></span>
  </div>`;
}

function buildScaffold() {
  root.innerHTML = `<div class="pkfx-stage">
    ${halfHtml('left')}
    ${halfHtml('right')}
    <div class="pkfx-seam"><i class="seam-core"></i><i class="seam-img"></i><i class="seam-chevrons"></i><i class="seam-shock"></i></div>
    <div class="pkfx-hud">
      <div class="pkfx-team a"><span class="pkfx-name na"></span><span class="pkfx-score sa">0</span></div>
      <div class="pkfx-center"><span class="pkfx-vs">VS</span><span class="pkfx-timer"></span></div>
      <div class="pkfx-team b"><span class="pkfx-score sb">0</span><span class="pkfx-name nb"></span></div>
    </div>
  </div>`;
  return {
    stage: root.querySelector('.pkfx-stage'),
    halfL: root.querySelector('.pkfx-half.left'),
    halfR: root.querySelector('.pkfx-half.right'),
    seam: root.querySelector('.pkfx-seam'),
    resL: root.querySelector('.pkfx-half.left .pkfx-result'),
    resR: root.querySelector('.pkfx-half.right .pkfx-result'),
    na: root.querySelector('.pkfx-name.na'),
    nb: root.querySelector('.pkfx-name.nb'),
    sa: root.querySelector('.pkfx-score.sa'),
    sb: root.querySelector('.pkfx-score.sb'),
    vs: root.querySelector('.pkfx-vs'),
    timer: root.querySelector('.pkfx-timer'),
  };
}

const el = buildScaffold();

// Fit-scale 1080x1920 vào khung (OBS 1:1, hoặc cửa sổ review nhỏ) bằng zoom (nét).
function fitStage() {
  const z = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
  el.stage.style.zoom = z > 0 ? z : 1;
}
window.addEventListener('resize', fitStage);
fitStage();

// ---- Sound (tái dùng field âm thanh của PK Đôi) ---------------------------
let lastRunKey = '', lastStatus = '', lastLead = '';
let playedStart = false, playedResult = false;
let lastGainA = 0, lastGainB = 0; // theo dõi điểm để "nhá sóng" mỗi khi có quà (kể cả lúc delay/ngập kịch trần)
function playSound(url) { if (!url) return; try { audio.src = url; audio.currentTime = 0; audio.play().catch(() => {}); } catch {} }

function resolveStyle(state) {
  const s = String(state.fxStyle || 'auto');
  if (FX_STYLES.includes(s)) return s;
  const r = Number(state.roundNo || 0);
  return FX_STYLES[((r % FX_STYLES.length) + FX_STYLES.length) % FX_STYLES.length];
}

function render(state = {}) {
  const a = state.teamA || { name: 'ĐỘI A', color: '#FE2C55' };
  const b = state.teamB || { name: 'ĐỘI B', color: '#25F4EE' };
  const sA = Number(state.scoreA || 0), sB = Number(state.scoreB || 0);
  const status = state.status || 'idle';
  const live = status === 'running' || status === 'grace';
  const finished = status === 'finished';
  const neutral = sA === sB;
  const aLead = sA > sB;
  const leadSide = neutral ? '' : (aLead ? 'A' : 'B');

  // 🌫️ SƯƠNG MÙ 10s cuối: khi bật fogHide & đang chạy & còn ≤10s → GIẤU luôn FX (nước/hiệu ứng),
  // vạch & điểm HUD để KHÔNG lộ ai đang thua (giống banner che thanh máu). Hết giờ (finished) mới lộ.
  const secLeft = Math.max(0, Math.ceil((state.remainingMs || 0) / 1000));
  const fog = state.fogHide !== false && status === 'running' && secLeft <= 10 && secLeft > 0;

  const runKey = String(state.startedAt || 'idle');
  if (runKey !== lastRunKey) { lastRunKey = runKey; playedStart = false; playedResult = false; lastGainA = sA; lastGainB = sB; }
  // Có quà mới (điểm tăng) trong lúc CÒN TÍNH (running không sương mù, hoặc delay 'grace') → nhá 1 đợt sóng.
  const canSurge = (live && !fog);
  const gained = canSurge && (sA > lastGainA || sB > lastGainB);
  lastGainA = sA; lastGainB = sB;

  // Vạch giữa: đẩy về phía bên thua theo push (đã clamp ±42 ở engine). Sương mù → về giữa (không lộ kèo).
  const fxMode = String(state.fxMode || 'both');
  const pushSeam = fxMode !== 'affliction';
  // Đẩy vạch vừa phải (hệ số .7) để bar không dán sát mép, vẫn gần ranh giới nửa thua.
  const seam = fog ? 50 : (pushSeam ? clamp(50 + Number(state.push || 0) * 0.7, 20, 80) : 50);

  // ⛴️ ĐỘ NGẬP theo ĐIỂM TRẦN TUYỆT ĐỐI: chênh điểm ≥ fxFullPoints → ngập FULL; dưới thì dâng dần.
  // Dùng chênh điểm THẬT (không phải %) để "cân đối" — bên kém đuổi kịp thì nước tự rút xuống mượt.
  const gapPct = (sA + sB) > 0 ? Math.abs(sA - sB) / (sA + sB) * 100 : 0; // chỉ dùng cho NGƯỠNG bật (chống nhiễu khi sát nút)
  const gapAbs = Math.abs(sA - sB);
  const thr = clamp(Number(state.fxThreshold ?? 8), 0, 95);
  const cap = clamp(Number(state.fxIntensityCap ?? 100), 0, 100) / 100;
  const fullPts = Math.max(1, Number(state.fxFullPoints ?? 100)); // điểm trần
  const topSafe = clamp(Number(state.fxTopSafe ?? 14), 0, 40) / 100; // chừa mép trên (TikTok che) → sóng luôn thấy
  const fillMax = 1 - topSafe; // đỉnh ngập tối đa (đường sóng dừng dưới mép trên)
  const doAffliction = state.fxEnabled !== false && fxMode !== 'push';
  let intensity = 0, fill = 0;
  // Bật khi có chênh (không hoà) & qua ngưỡng % (lúc đang chạy) HOẶC đã kết thúc có kèo thắng.
  // Sương mù 10s cuối → KHÔNG ngập (fog) để giấu kèo.
  if (doAffliction && !neutral && !fog && (finished || (live && gapPct > thr))) {
    const t = clamp(gapAbs / fullPts, 0, 1); // 0 (sát điểm) → 1 (≥ điểm trần = ngập FULL)
    // Sàn 0.62: vùng đã ngập MÀU luôn ĐẬM, đọc rõ trên OBS (không mờ nhạt gần vô hình).
    intensity = (0.62 + 0.38 * t) * cap;
    // Ngập từ ĐÁY lên: thấp (18%) → dâng NHANH (sqrt) rồi mượt tới đỉnh fillMax → cảm giác nước dâng thật.
    fill = 0.18 + (fillMax - 0.18) * Math.sqrt(t);
    if (finished) { intensity = Math.max(intensity, 0.9 * cap); fill = Math.max(fill, fillMax); } // chốt trận: bên thua "gục" ngập kịch mép an toàn
  }
  const loserSide = neutral ? '' : (aLead ? 'B' : 'A');
  const style = resolveStyle(state);

  // ---- Cập nhật CSS var + class (KHÔNG dựng lại DOM) ----
  const stg = el.stage.style;
  // Triplet "r,g,b" cho rgba(var(--pk-*-rgb), a) thay color-mix() (CEF cũ của OBS không hiểu → glow rớt).
  const _trip = (h, fb) => { const m = /^#([0-9a-f]{6})$/i.exec(String(h || '')); if (!m) return fb; const n = parseInt(m[1], 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; };
  stg.setProperty('--pk-a', a.color || '#FE2C55');
  stg.setProperty('--pk-a-rgb', _trip(a.color, '254,44,85'));
  stg.setProperty('--pk-b', b.color || '#25F4EE');
  stg.setProperty('--pk-b-rgb', _trip(b.color, '37,244,238'));
  stg.setProperty('--seam', seam + '%');
  stg.setProperty('--crest-rgb', FX_CREST[style] || '190,225,255'); // màu ngọn "mặt nước" theo kiểu FX

  const applyHalf = (half, side, isLoser, isWinner) => {
    half.className = 'pkfx-half ' + (side === 'A' ? 'left' : 'right')
      + (isLoser && intensity > 0.001 ? ' afflicted fx-' + style : '')
      + (isLoser && style === 'frost' ? ' frost-t' + frostTier(intensity) : '')
      + (isWinner && !neutral ? ' winner' : '')
      + (finished ? ' finished' : '');
    half.style.setProperty('--fx-i', (isLoser ? intensity : 0).toFixed(3));
    half.style.setProperty('--fx-fill', (isLoser ? fill : 0).toFixed(3));
    half.style.setProperty('--fx-crest', (isLoser ? intensity : 0).toFixed(3)); // ngọn mặt nước hiện khi bị hiệu ứng
  };
  applyHalf(el.halfL, 'A', loserSide === 'A', leadSide === 'A');
  applyHalf(el.halfR, 'B', loserSide === 'B', leadSide === 'B');

  // Quà mới trong lúc còn tính → nhá đợt sóng ở NGỌN bên đang bị ngập (kể cả khi đã ngập kịch trần,
  // để late-gift lúc delay vẫn thấy FX phản hồi). restart animation bằng remove+reflow+add.
  if (gained) {
    const lh = loserSide === 'A' ? el.halfL : (loserSide === 'B' ? el.halfR : null);
    const crest = lh && lh.querySelector('.fx-crest');
    if (crest) { crest.classList.remove('splash'); void crest.offsetWidth; crest.classList.add('splash'); }
  }

  el.stage.classList.toggle('is-neutral', neutral);
  el.stage.classList.toggle('is-live', live);
  el.stage.classList.toggle('is-finished', finished);
  el.stage.classList.toggle('is-idle', status === 'idle' || status === 'prestart');
  el.stage.classList.toggle('is-fog', fog); // 🌫️ ẩn điểm HUD 10s cuối (CSS)
  el.seam.className = 'pkfx-seam' + (fog || neutral ? ' neutral' : (aLead ? ' lead-a' : ' lead-b'));
  // Vạch chia bằng ẢNH (sét/dung nham/thuỷ mặc…) đè lên vạch CSS. 'auto' đổi theo trận (roundNo).
  // className vừa gán ở trên đã xoá has-seam-img → phải apply LẠI sau đó, đúng thứ tự này.
  OverlayDivider.apply(el.seam, OverlayDivider.resolve(state.fxSeamSkin, state.roundNo), 1);

  // Shockwave 1 nhịp khi đổi bên dẫn
  if (leadSide && leadSide !== lastLead && lastLead !== '') {
    el.seam.classList.remove('shock'); void el.seam.offsetWidth; el.seam.classList.add('shock');
  }
  lastLead = leadSide;

  // HUD
  el.na.textContent = shortName(a.name || 'ĐỘI A');
  el.nb.textContent = shortName(b.name || 'ĐỘI B');
  el.sa.textContent = fmt(sA);
  el.sb.textContent = fmt(sB);
  const sec = Math.max(0, Math.ceil((state.remainingMs || 0) / 1000));
  el.timer.textContent = status === 'prestart' ? `Bắt đầu sau ${sec}s`
    : status === 'running' ? mmss(sec)
    : status === 'grace' ? 'ĐANG TÍNH ĐIỂM'
    : finished ? '🏁 KẾT THÚC' : '';
  el.vs.style.display = (status === 'running' || status === 'prestart') ? 'none' : '';

  // Kết quả WIN/LOSE/DRAW
  const setRes = (node, txt) => { node.textContent = txt; node.className = 'pkfx-result' + (txt ? ' ' + txt.toLowerCase() : ''); };
  if (finished) {
    setRes(el.resL, neutral ? 'DRAW' : (aLead ? 'WIN' : 'LOSE'));
    setRes(el.resR, neutral ? 'DRAW' : (aLead ? 'LOSE' : 'WIN'));
  } else { setRes(el.resL, ''); setRes(el.resR, ''); }

  // Sound
  if (!playedStart && (status === 'prestart' || status === 'running')) { playedStart = true; playSound(state.startSound); }
  if (finished && lastStatus !== 'finished' && !playedResult) {
    playedResult = true;
    if (sA > sB) playSound(state.teamASound);
    else if (sB > sA) playSound(state.teamBSound);
    else playSound(state.drawSound);
  }
  lastStatus = status;
}

render({});
// SSE tự hồi phục (connectSSE ở overlay-sse.js) → overlay tự lên lại khi stream rớt/kẹt,
// không cần Ctrl+R hay tác động OBS lúc kết nối LIVE.
connectSSE(`/pk-duo-events?token=${encodeURIComponent(token)}`, 'pkduo', render, { visKey: 'pkduofx' });
