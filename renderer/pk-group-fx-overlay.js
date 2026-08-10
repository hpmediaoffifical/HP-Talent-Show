// PK Nhóm FX — overlay toàn màn hình phủ lên lưới video PK Nhóm (nhiều Creator).
// CHỈ áp dụng kiểu "Rời nhau theo TOP 1" (layoutMode='separated'): chia màn hình ĐỀU theo SỐ
// Thành viên; vẽ N-1 GẠCH ranh giới (đen + quầng màu theo fx) ở KHE giữa; phủ hiệu ứng băng/lửa…
// lên người KÉM TOP 1 (đậm dần theo khoảng cách điểm với TOP 1). Bộ hiệu ứng lấy y hệt PK Đôi FX.
// Dùng CHUNG stream /pk-group-events (0 engine mới). Nguyên tắc: chỉ DỰNG LẠI DOM khi SỐ cột đổi,
// mỗi emit chỉ đổi CSS var + class → animation chạy liên tục, không giật mỗi 250ms (mượt trên OBS).

const token = new URLSearchParams(location.search).get('token') || '';
if (new URLSearchParams(location.search).get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = new URLSearchParams(location.search).get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}

const root = document.getElementById('pkgfxRoot');
const FX_STYLES = ['freeze', 'fire', 'water', 'dim', 'electric', 'poison', 'shadow', 'shatter'];
// Màu đặc trưng mỗi kiểu FX (triplet r,g,b) → quầng sáng "màu theo fx" cho gạch ranh giới.
const FX_ACCENT = {
  freeze: '126,200,255', fire: '255,122,24', water: '56,176,242', dim: '150,157,173',
  electric: '125,208,255', poison: '123,255,123', shadow: '154,92,255', shatter: '255,90,82',
};
// Màu "mặt nước" (ngọn 3D) mỗi kiểu FX — sáng hơn thân để bắt sáng rõ.
const FX_CREST = {
  freeze: '200,235,255', fire: '255,168,66', water: '120,205,255', dim: '150,160,182',
  electric: '150,215,255', poison: '150,255,150', shadow: '176,124,240', shatter: '255,150,138',
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ---- Particle scaffolds (dựng 1 lần / cột) --------------------------------
function particles(cls, count, mk) {
  let html = '';
  for (let i = 0; i < count; i++) html += mk(i, count);
  return `<span class="${cls}">${html}</span>`;
}

// Bộ 8 hiệu ứng cho MỖI cột — copy nguyên từ PK Đôi FX (kèm lớp fx-cast màu ĐẶC để đọc rõ trên OBS
// [[obs-fx-cast-layer]]) để nhìn y hệt. CSS chỉ hiện bộ đang bật.
function fxLayersHtml() {
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
  const dim = `<span class="fx fx-dim">
      <i class="fx-cast"></i>
      <i class="dim-scrim"></i><i class="dim-blocks"></i><i class="dim-scan"></i><i class="dim-rgb"></i><i class="dim-vignette"></i>
    </span>`;
  const electric = `<span class="fx fx-electric">
      <i class="fx-cast"></i>
      <i class="volt-flash"></i>
      <span class="bolts">${particles('', 6, (i) => `<i class="bolt" style="--x:${10 + i * 15}%;--d:${(i % 5) * 0.5}s;--dur:${1.6 + (i % 3) * 0.5}s;--s:${0.8 + (i % 3) * 0.3}"></i>`)}</span>
      ${particles('sparks', 24, (i) => `<i class="spark" style="--x:${(i * 7 + 5) % 100}%;--y:${(i * 17 + 10) % 100}%;--d:${(i % 8) * 0.25}s;--dur:${1.2 + (i % 4) * 0.4}s"></i>`)}
      <i class="volt-vignette"></i>
    </span>`;
  const poison = `<span class="fx fx-poison">
      <i class="fx-cast"></i>
      <i class="tox-fog"></i>
      ${particles('toxb', 20, (i) => `<i class="toxbubble" style="--x:${(i * 7 + 4) % 100}%;--d:${(i % 6) * 0.5}s;--dur:${3 + (i % 5) * 0.7}s;--s:${0.5 + (i % 4) * 0.5};--drift:${(i % 2 ? 1 : -1) * (16 + i % 20)}px"></i>`)}
      <i class="tox-vignette"></i>
    </span>`;
  const shadow = `<span class="fx fx-shadow">
      <i class="fx-cast"></i>
      <i class="shadow-core"></i>
      <i class="tendril top"></i><i class="tendril bottom"></i><i class="tendril in"></i><i class="tendril out"></i>
      ${particles('wisps', 14, (i) => `<i class="wisp" style="--x:${(i * 11 + 5) % 100}%;--y:${(i * 19 + 10) % 100}%;--d:${(i % 6) * 0.6}s;--dur:${4 + (i % 4)}s;--s:${0.6 + (i % 3) * 0.5}"></i>`)}
      <i class="shadow-vignette"></i>
    </span>`;
  const shatter = `<span class="fx fx-shatter">
      <i class="fx-cast"></i>
      <i class="crack-glass"></i>
      <i class="shatter-flash"></i>
      ${particles('shards', 16, (i) => `<i class="shard" style="--x:${(i * 11 + 6) % 100}%;--y:${(i * 13 + 8) % 100}%;--r:${(i * 37) % 360}deg;--d:${(i % 6) * 0.2}s;--s:${0.6 + (i % 4) * 0.5}"></i>`)}
    </span>`;
  const crest = `<span class="fx-crest"><i class="crest-glow"></i><i class="crest-fill"></i><i class="crest-foam"></i><i class="crest-rim"></i><i class="crest-splash"></i></span>`;
  return `${freeze}${fire}${water}${dim}${electric}${poison}${shadow}${shatter}${crest}`;
}

let structKey = '';
let stage = null;
let cols = [];
let seams = [];
let lastScores = {}; // id -> điểm lần trước, để "nhá sóng" khi có quà (kể cả lúc delay/ngập kịch trần)

function buildScaffold(n) {
  let colsHtml = '';
  for (let i = 0; i < n; i++) colsHtml += `<div class="pkgfx-col">${fxLayersHtml()}</div>`;
  let seamsHtml = '';
  for (let i = 1; i < n; i++) seamsHtml += `<div class="pkgfx-seam"><i class="seam-core"></i></div>`;
  root.innerHTML = `<div class="pkgfx-stage">${colsHtml}${seamsHtml}</div>`;
  stage = root.querySelector('.pkgfx-stage');
  cols = Array.from(root.querySelectorAll('.pkgfx-col'));
  seams = Array.from(root.querySelectorAll('.pkgfx-seam'));
}

// CHIA ĐỀU khung theo SỐ Creator (bản gốc, chắc chắn): mỗi Thành viên = 1/N bề rộng, gạch ở đúng
// KHE giữa 2 phần (N-1 gạch tại 100/N·k %). Dùng % → độc lập bề rộng/scale của nguồn OBS, luôn hiện
// đủ gạch, không bao giờ vọt ra ngoài. Đây là kiểu "chia khung theo số Thành viên" user yêu cầu.
function positionColumns(n) {
  const w = 100 / n;
  cols.forEach((col, k) => {
    col.style.left = (k * w).toFixed(4) + '%';
    col.style.right = ((n - 1 - k) * w).toFixed(4) + '%';
  });
  seams.forEach((seam, k) => {
    seam.style.left = ((k + 1) * w).toFixed(4) + '%';
    seam.style.display = '';
  });
}

function resolveStyle(state) {
  const s = String(state.fxStyle || 'auto');
  if (FX_STYLES.includes(s)) return s;
  const r = Number(state.roundNo || 0);
  return FX_STYLES[((r % FX_STYLES.length) + FX_STYLES.length) % FX_STYLES.length];
}

function render(state = {}) {
  const participants = Array.isArray(state.participants) ? state.participants : [];
  const layout = state.layoutMode === 'separated' ? 'separated' : 'joined';
  const enabled = state.fxEnabled !== false;
  const n = participants.length;
  // FX chỉ áp dụng kiểu thanh máu "Rời nhau theo TOP 1" và cần ≥2 Thành viên để có ranh giới.
  const active = enabled && layout === 'separated' && n >= 2;
  document.body.classList.toggle('fx-off', !active);
  if (!active) return;

  const key = layout + ':' + n;
  if (key !== structKey) { structKey = key; buildScaffold(n); lastScores = {}; }

  // Chia đều khung theo SỐ Thành viên (bản gốc). scale chỉ dùng cho ĐỘ DÀY gạch (thẩm mỹ).
  const scale = Math.max(0.8, Math.min(3, (Number(state.overlayScale) || 200) / 100));
  positionColumns(n);

  const style = resolveStyle(state);
  const showSeam = state.fxSeam !== false;
  const status = state.status || 'idle';
  const live = status === 'running' || status === 'grace';
  const finished = status === 'finished';
  // 🌫️ SƯƠNG MÙ 10s cuối: bật fogHide & đang chạy & còn ≤10s → GIẤU luôn FX để không lộ ai kém TOP 1.
  const secLeft = Math.max(0, Math.ceil((state.remainingMs || 0) / 1000));
  const fog = state.fogHide !== false && status === 'running' && secLeft <= 10 && secLeft > 0;

  // TOP 1 = điểm cao nhất (giữ Thành viên ĐẦU khi hoà) → người còn lại "kém TOP 1" bị phủ hiệu ứng.
  const max = Math.max(1, ...participants.map(p => Number(p.score) || 0));
  let leaderIdx = 0, best = -1;
  participants.forEach((p, i) => { const s = Number(p.score) || 0; if (s > best) { best = s; leaderIdx = i; } });

  // Chọn SỐ người bị hiệu ứng = K người điểm THẤP NHẤT (bottom-K). 0 = tất cả trừ TOP 1.
  // Kẹp về [1, N-1] → 5 người: tối đa 4, tối thiểu 1 (TOP 1 luôn sạch vì K ≤ N-1).
  const rawK = Number(state.fxLoserCount) || 0;
  const afflictCount = rawK <= 0 ? (n - 1) : clamp(Math.round(rawK), 1, n - 1);
  const ascending = participants
    .map((p, i) => ({ i, s: Number(p.score) || 0 }))
    .sort((a, b) => a.s - b.s || b.i - a.i); // điểm tăng dần; hoà thì người đứng SAU bị trước (TOP 1 luôn cuối)
  const loserSet = new Set(ascending.slice(0, afflictCount).map(o => o.i));

  stage.style.setProperty('--pkgfx-accent', FX_ACCENT[style] || '255,255,255');
  stage.style.setProperty('--crest-rgb', FX_CREST[style] || '190,225,255'); // màu ngọn "mặt nước" theo kiểu FX
  stage.style.setProperty('--pkgfx-sw', (4 * scale).toFixed(1) + 'px'); // gạch MẢNH theo scale (mép feather → mỏng mịn)
  stage.classList.toggle('no-seam', !showSeam);
  stage.classList.toggle('is-finished', finished);

  const thr = clamp(Number(state.fxThreshold ?? 8), 0, 95);
  const cap = clamp(Number(state.fxIntensityCap ?? 100), 0, 100) / 100;
  // ⛴️ ĐIỂM TRẦN TUYỆT ĐỐI: kém TOP 1 ≥ fxFullPoints → ngập FULL; dưới thì dâng dần (đuổi kịp thì rút).
  const fullPts = Math.max(1, Number(state.fxFullPoints ?? 100));
  const topSafe = clamp(Number(state.fxTopSafe ?? 14), 0, 40) / 100; // chừa mép trên (TikTok che) → sóng luôn thấy
  const fillMax = 1 - topSafe;

  participants.forEach((p, i) => {
    const col = cols[i];
    if (!col) return;
    const score = Number(p.score) || 0;
    const isLeader = i === leaderIdx && best > 0;
    // % kém TOP 1 (chỉ để BẬT ngưỡng) + điểm kém TUYỆT ĐỐI (để tính độ ngập theo điểm trần).
    const gapPct = max > 0 ? (max - score) / max * 100 : 0;
    const gapAbs = Math.max(0, max - score);
    let intensity = 0, fill = 0;
    // Chỉ K người điểm thấp nhất (loserSet) bị hiệu ứng; bật khi qua ngưỡng % hoặc đã kết thúc.
    // Sương mù 10s cuối → KHÔNG ngập (fog) để giấu ai kém TOP 1.
    if (loserSet.has(i) && !isLeader && !fog && (finished || (live && gapPct > thr))) {
      const t = clamp(gapAbs / fullPts, 0, 1); // 0 (bằng TOP 1) → 1 (kém ≥ điểm trần = ngập FULL)
      intensity = (0.62 + 0.38 * t) * cap; // sàn 0.62: vùng đã ngập MÀU luôn ĐẬM, đọc rõ trên OBS [[obs-fx-cast-layer]]
      // Ngập từ ĐÁY lên: thấp (18%) → dâng NHANH (sqrt) rồi mượt tới đỉnh fillMax → cảm giác nước dâng thật.
      fill = 0.18 + (fillMax - 0.18) * Math.sqrt(t);
      if (finished) { intensity = Math.max(intensity, 0.9 * cap); fill = Math.max(fill, fillMax); } // chốt trận: người kém "gục" ngập kịch mép an toàn
    }
    // className reset KHÔNG đụng style inline (left/width) → cột giữ nguyên vị trí.
    col.className = 'pkgfx-col'
      + (intensity > 0.001 ? ' afflicted fx-' + style : '')
      + (isLeader ? ' winner' : '')
      + (finished ? ' finished' : '');
    col.style.setProperty('--fx-i', intensity.toFixed(3));
    col.style.setProperty('--fx-fill', fill.toFixed(3));
    col.style.setProperty('--fx-crest', intensity.toFixed(3)); // ngọn mặt nước hiện khi bị hiệu ứng
    // Quà mới (điểm tăng) trong lúc còn tính (running không sương mù / delay 'grace') & đang bị ngập
    // → nhá đợt sóng ở NGỌN (kể cả khi ngập kịch trần) để late-gift luôn thấy FX phản hồi.
    const prev = lastScores[p.id];
    if (live && !fog && intensity > 0.001 && prev != null && score > prev) {
      const crest = col.querySelector('.fx-crest');
      if (crest) { crest.classList.remove('splash'); void crest.offsetWidth; crest.classList.add('splash'); }
    }
    lastScores[p.id] = score;
  });
}

render({});
// SSE tự hồi phục (connectSSE ở overlay-sse.js) → overlay tự lên lại khi stream rớt/kẹt.
// visKey 'pkgroupfx' → công tắc Hiện/Ẩn overlay riêng (không đụng bản banner PK Nhóm).
connectSSE(`/pk-group-events?token=${encodeURIComponent(token)}`, 'pkgroup', render, { visKey: 'pkgroupfx' });
