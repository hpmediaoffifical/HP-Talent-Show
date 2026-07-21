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

const FX_STYLES = ['freeze', 'fire', 'water', 'dim', 'electric', 'poison', 'shadow', 'shatter'];

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('en-US'); }
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
      <i class="ice-slab"></i>
      <i class="frost-sheet"></i>
      <i class="frost-edge top"></i><i class="frost-edge bottom"></i><i class="frost-edge in"></i><i class="frost-edge out"></i>
      <i class="ice-crack"></i><i class="ice-shine"></i>
      ${particles('crystals', 8, (i) => `<i class="crystal" style="--x:${(i * 11 + 6) % 100}%;--y:${(i * 23 + 8) % 100}%;--s:${0.6 + (i % 4) * 0.4};--d:${(i % 5) * 0.6}s"></i>`)}
      ${particles('snow', 16, (i) => `<i class="flake" style="--x:${(i * 6 + 3) % 100}%;--d:${(i % 7) * 0.8}s;--dur:${6 + (i % 5)}s;--s:${0.5 + (i % 3) * 0.5};--sway:${(i % 2 ? 1 : -1) * (10 + i % 12)}px"></i>`)}
    </span>`;
  const fire = `<span class="fx fx-fire">
      <i class="fire-glow"></i>
      <span class="flames back">${particles('', 5, (i) => `<i class="flame" style="--x:${12 + i * 19}%;--d:${(i % 4) * 0.2}s;--h:${0.7 + (i % 3) * 0.2};--w:${1 + (i % 2) * 0.4}"></i>`)}</span>
      <span class="flames front">${particles('', 7, (i) => `<i class="flame" style="--x:${8 + i * 13}%;--d:${(i % 5) * 0.15}s;--h:${0.85 + (i % 3) * 0.25};--w:${0.8 + (i % 2) * 0.3}"></i>`)}</span>
      <span class="smoke">${particles('', 4, (i) => `<i class="puff" style="--x:${18 + i * 22}%;--d:${i * 0.9}s;--dur:${4 + i}s"></i>`)}</span>
      ${particles('embers', 18, (i) => `<i class="ember" style="--x:${(i * 6 + 4) % 100}%;--d:${(i % 8) * 0.35}s;--dur:${2.2 + (i % 5) * 0.5}s;--s:${0.5 + (i % 4) * 0.4};--drift:${(i % 2 ? 1 : -1) * (20 + i % 30)}px"></i>`)}
      <i class="heat"></i>
    </span>`;
  const water = `<span class="fx fx-water">
      <i class="water-body">
        <i class="caustics"></i><i class="wave wave2"></i><i class="wave wave1"></i>
      </i>
      <i class="water-glass"></i>
      ${particles('bubbles', 14, (i) => `<i class="bubble" style="--x:${(i * 7 + 5) % 100}%;--d:${(i % 6) * 0.5}s;--dur:${3 + (i % 5) * 0.6}s;--s:${0.4 + (i % 4) * 0.5};--drift:${(i % 2 ? 1 : -1) * (14 + i % 16)}px"></i>`)}
    </span>`;
  const dim = `<span class="fx fx-dim">
      <i class="dim-scrim"></i><i class="dim-blocks"></i><i class="dim-scan"></i><i class="dim-rgb"></i><i class="dim-vignette"></i>
    </span>`;
  const electric = `<span class="fx fx-electric">
      <i class="volt-flash"></i>
      <span class="bolts">${particles('', 5, (i) => `<i class="bolt" style="--x:${12 + i * 18}%;--d:${(i % 5) * 0.5}s;--dur:${1.6 + (i % 3) * 0.5}s;--s:${0.8 + (i % 3) * 0.3}"></i>`)}</span>
      ${particles('sparks', 16, (i) => `<i class="spark" style="--x:${(i * 7 + 5) % 100}%;--y:${(i * 17 + 10) % 100}%;--d:${(i % 8) * 0.25}s;--dur:${1.2 + (i % 4) * 0.4}s"></i>`)}
      <i class="volt-vignette"></i>
    </span>`;
  const poison = `<span class="fx fx-poison">
      <i class="tox-fog"></i>
      ${particles('toxb', 14, (i) => `<i class="toxbubble" style="--x:${(i * 7 + 4) % 100}%;--d:${(i % 6) * 0.5}s;--dur:${3 + (i % 5) * 0.7}s;--s:${0.5 + (i % 4) * 0.5};--drift:${(i % 2 ? 1 : -1) * (16 + i % 20)}px"></i>`)}
      <i class="tox-vignette"></i>
    </span>`;
  const shadow = `<span class="fx fx-shadow">
      <i class="shadow-core"></i>
      <i class="tendril top"></i><i class="tendril bottom"></i><i class="tendril in"></i><i class="tendril out"></i>
      ${particles('wisps', 10, (i) => `<i class="wisp" style="--x:${(i * 11 + 5) % 100}%;--y:${(i * 19 + 10) % 100}%;--d:${(i % 6) * 0.6}s;--dur:${4 + (i % 4)}s;--s:${0.6 + (i % 3) * 0.5}"></i>`)}
      <i class="shadow-vignette"></i>
    </span>`;
  const shatter = `<span class="fx fx-shatter">
      <i class="crack-glass"></i>
      <i class="shatter-flash"></i>
      ${particles('shards', 10, (i) => `<i class="shard" style="--x:${(i * 11 + 6) % 100}%;--y:${(i * 13 + 8) % 100}%;--r:${(i * 37) % 360}deg;--d:${(i % 6) * 0.2}s;--s:${0.6 + (i % 4) * 0.5}"></i>`)}
    </span>`;
  return `<div class="pkfx-half ${side}">
    ${freeze}${fire}${water}${dim}${electric}${poison}${shadow}${shatter}
    <span class="pkfx-badge"><b class="pkfx-result"></b></span>
  </div>`;
}

function buildScaffold() {
  root.innerHTML = `<div class="pkfx-stage">
    ${halfHtml('left')}
    ${halfHtml('right')}
    <div class="pkfx-seam"><i class="seam-core"></i><i class="seam-chevrons"></i><i class="seam-shock"></i></div>
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

  const runKey = String(state.startedAt || 'idle');
  if (runKey !== lastRunKey) { lastRunKey = runKey; playedStart = false; playedResult = false; }

  // Vạch giữa: đẩy về phía bên thua theo push (đã clamp ±42 ở engine).
  const fxMode = String(state.fxMode || 'both');
  const pushSeam = fxMode !== 'affliction';
  // Đẩy vạch vừa phải (hệ số .7) để bar không dán sát mép, vẫn gần ranh giới nửa thua.
  const seam = pushSeam ? clamp(50 + Number(state.push || 0) * 0.7, 20, 80) : 50;

  // Cường độ hiệu ứng theo % chênh điểm.
  const gapPct = (sA + sB) > 0 ? Math.abs(sA - sB) / (sA + sB) * 100 : 0;
  const thr = clamp(Number(state.fxThreshold ?? 8), 0, 95);
  // maxGap thấp hơn → hiệu ứng đạt đậm nhanh hơn (không cần chênh quá lớn mới thấy rõ).
  const maxGap = Math.max(thr + 1, Number(state.fxMaxGap ?? 30));
  const cap = clamp(Number(state.fxIntensityCap ?? 100), 0, 100) / 100;
  const doAffliction = state.fxEnabled !== false && fxMode !== 'push';
  let intensity = 0;
  if (doAffliction && !neutral && (live || finished)) {
    const t = clamp((gapPct - thr) / (maxGap - thr), 0, 1);
    // Sàn 0.5: khi đã vượt ngưỡng, hiệu ứng luôn hiện rõ (tránh mờ nhạt gần như vô hình).
    intensity = (0.5 + 0.5 * t) * cap;
    if (finished) intensity = Math.max(intensity, 0.75 * cap); // chốt trận: bên thua "gục" rõ
  }
  const loserSide = neutral ? '' : (aLead ? 'B' : 'A');
  const style = resolveStyle(state);

  // ---- Cập nhật CSS var + class (KHÔNG dựng lại DOM) ----
  const stg = el.stage.style;
  stg.setProperty('--pk-a', a.color || '#FE2C55');
  stg.setProperty('--pk-b', b.color || '#25F4EE');
  stg.setProperty('--seam', seam + '%');

  const applyHalf = (half, side, isLoser, isWinner) => {
    half.className = 'pkfx-half ' + (side === 'A' ? 'left' : 'right')
      + (isLoser && intensity > 0.001 ? ' afflicted fx-' + style : '')
      + (isWinner && !neutral ? ' winner' : '')
      + (finished ? ' finished' : '');
    half.style.setProperty('--fx-i', (isLoser ? intensity : 0).toFixed(3));
  };
  applyHalf(el.halfL, 'A', loserSide === 'A', leadSide === 'A');
  applyHalf(el.halfR, 'B', loserSide === 'B', leadSide === 'B');

  el.stage.classList.toggle('is-neutral', neutral);
  el.stage.classList.toggle('is-live', live);
  el.stage.classList.toggle('is-finished', finished);
  el.stage.classList.toggle('is-idle', status === 'idle' || status === 'prestart');
  el.seam.className = 'pkfx-seam' + (neutral ? ' neutral' : (aLead ? ' lead-a' : ' lead-b'));

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
connectSSE(`/pk-duo-events?token=${encodeURIComponent(token)}`, 'pkduo', render);
