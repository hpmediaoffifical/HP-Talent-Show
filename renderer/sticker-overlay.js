// Sticker Dance overlay — nhận state qua SSE (/sticker-events) và vẽ bảng lưới quà.
// Số đếm chạy MƯỢT bằng nội suy trên rAF (render dựng lại innerHTML nên CSS transition chết);
// icon quà load qua proxy /avatar để không bị OBS chặn CDN TikTok.

const token = new URLSearchParams(location.search).get('token') || '';
if (new URLSearchParams(location.search).get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = new URLSearchParams(location.search).get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}
const root = document.getElementById('stickerRoot');

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('vi-VN'); }
function hexToRgb(hex, fb = '43,47,58') {
  const m = String(hex || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return fb;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
// Icon quà TikTok CDN bị chặn trực tiếp trong OBS Browser Source → qua proxy /avatar.
function mediaUrl(value) {
  const s = String(value || '').trim();
  if (!s) return '/logo.png';
  if (/^https?:\/\//i.test(s)) return `/avatar?url=${encodeURIComponent(s)}`;
  return s;
}
window.avRetry = function (img) {
  const n = +(img.dataset.avTry || 0);
  if (n >= 3 || !/\/avatar\?/.test(img.src)) { img.onerror = null; img.src = '/logo.png'; return; }
  img.dataset.avTry = n + 1;
  const clean = img.src.replace(/[?&]_r=\d+/, '');
  setTimeout(() => { img.src = clean + (clean.includes('?') ? '&' : '?') + '_r=' + (n + 1); }, 500 + n * 800);
};

// ---- "ĐẬP TRỨNG": count=0 → hiện quả trứng thay số; có quà → trứng NỞ (vỡ vỏ + hiện số). ----
// render() dựng lại innerHTML mỗi state nên ta nhớ trạng thái ô để bắt đúng khoảnh khắc 0→>0.
const HATCH_MS = 850;
const eggState = new Map(); // key -> { giftId, wasEgg }  ô này lần trước có đang là trứng?
const hatchAt = new Map();  // key -> mốc (ms) nở, giữ lớp vỏ vỡ qua vài lần re-render trong lúc dồn quà
let hatchCleanup = 0;       // timer vẽ lại để dọn lớp vỏ vỡ nếu không có state mới
let lastState = null;

// "Skin ngẫu nhiên": mỗi ô giữ 1 skin ổn định khi đang là trứng; nở rồi quay lại trứng thì bốc
// skin MỚI khác skin lần trước (không lặp liền kề). Skin được giữ suốt lúc nở để vỏ vỡ cùng màu.
const EGG_SKINS = ['ivory', 'gold', 'pink', 'blue', 'dino'];
const eggSkinByKey = new Map(); // key -> skin hiện tại (chế độ ngẫu nhiên)
function pickEggSkin(prev) {
  const pool = EGG_SKINS.filter(s => s !== prev); // loại skin trước → không trùng liền kề
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---- Kiểu NHÃN TÊN người ĐANG DIỄN (pill/metal/rainbow/eq/lights). Chế độ 'random' bốc 1 kiểu
// khi ô VỪA vào diễn rồi GIỮ suốt lượt (không nhấp nháy mỗi frame vì render dựng lại innerHTML). ----
const PERF_NAME_STYLES = ['pill', 'metal', 'rainbow', 'eq', 'lights'];
const perfNameByKey = new Map(); // key ô -> kiểu đang áp (chỉ giữ khi đang diễn)
function pickPerfName() { return PERF_NAME_STYLES[Math.floor(Math.random() * PERF_NAME_STYLES.length)]; }

// ---- Nội suy số đếm (mượt) — key theo vị trí ô; đổi quà ở ô đó thì snap ngay. ----
const disp = new Map(); // key "r-c" -> { cur, giftId }
let raf = 0;
function tweenLoop() {
  raf = 0;
  let active = false;
  root.querySelectorAll('.sd-count').forEach(el => {
    const key = el.dataset.k;
    const target = Number(el.dataset.target) || 0;
    const st = disp.get(key) || { cur: target, giftId: el.dataset.gift };
    let cur = st.cur;
    if (Math.abs(cur - target) > 0.5) { cur += (target - cur) * 0.28; active = true; }
    else cur = target;
    st.cur = cur;
    disp.set(key, st);
    el.textContent = fmt(cur);
  });
  if (active) raf = requestAnimationFrame(tweenLoop);
}

// ---- GIỮ CHUỖI: thanh máu cạn dần theo thời gian (nội suy trên rAF cho mượt giữa 2 lần state). ----
let streakDur = 10000, streakRaf = 0, streakBarColor = 'tiktok';
function streakColor(p) {
  p = Math.max(0, Math.min(1, p));
  let r, g;
  if (p > 0.5) { const t = (p - 0.5) * 2; r = Math.round(255 - t * 192); g = Math.round(210 + t * 14); } // vàng → xanh
  else { const t = p * 2; r = 255; g = Math.round(75 + t * 135); }                                       // đỏ → vàng
  return `rgb(${r}, ${g}, 74)`;
}
function streakLoop() {
  streakRaf = 0;
  const now = Date.now();
  let active = false;
  root.querySelectorAll('.sd-streak').forEach(bar => {
    const until = Number(bar.dataset.until) || 0;
    let p = streakDur > 0 ? (until - now) / streakDur : 0;
    p = Math.max(0, Math.min(1, p));
    const fill = bar.firstElementChild;
    if (fill) {
      fill.style.width = (p * 100).toFixed(1) + '%';
      // 'health' → màu đổi theo mức (JS); 'tiktok'/'blue' → màu cố định theo CSS theme (xoá inline).
      fill.style.background = streakBarColor === 'health' ? streakColor(p) : '';
    }
    bar.classList.toggle('dead', p <= 0);
    if (p > 0) active = true;
  });
  if (active) streakRaf = requestAnimationFrame(streakLoop);
}

// Hiệu ứng LEVEL UP: khi ô vừa đạt mục tiêu → loé chữ "LEVEL UP!" + tia sáng, chạy 1 lần.
function fireLevelUp(countEl) {
  const sticker = countEl.closest('.sd-sticker');
  if (!sticker || sticker.querySelector('.sd-levelup')) return;
  const b = document.createElement('div');
  b.className = 'sd-levelup';
  b.textContent = 'LEVEL UP!';
  b.addEventListener('animationend', () => { b.remove(); sticker.classList.remove('leveling'); });
  sticker.classList.add('leveling');
  sticker.appendChild(b);
}

// Marquee nhãn (chỉ khi chọn "Chạy ngang"): CHỈ chạy khi chữ RỘNG HƠN khung. Nhân đôi
// nội dung để lặp liền mạch vô hạn; tốc độ = px/giây theo "Tốc độ chạy" (1..10 → 12..120 px/s).
function setupLabelMarquee(st) {
  const pxPerSec = Math.max(1, Math.min(10, Number(st.labelScrollSpeed) || 4)) * 12;
  // Đo TỪNG hàng (.sd-lrow) độc lập → hàng nào rộng hơn khung thì hàng đó chạy, kể cả khi có 2 hàng.
  root.querySelectorAll('.sd-lrow').forEach(row => {
    const txt = row.querySelector('.sd-ltxt');
    if (!txt) return;
    if (txt.scrollWidth <= row.clientWidth + 2) return; // vừa khung → đứng yên, căn giữa
    const gap = Math.round((Number(st.iconSize) || 66) * 0.6);
    const track = document.createElement('span');
    track.className = 'sd-ltrack';
    const clone = txt.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    row.appendChild(track);
    track.appendChild(txt);
    track.appendChild(clone);
    const dist = txt.scrollWidth + gap;
    track.style.setProperty('--mq-gap', gap + 'px');
    track.style.setProperty('--mq-dist', dist + 'px');
    track.style.setProperty('--mq-dur', Math.max(3, dist / pxPerSec).toFixed(1) + 's');
    row.classList.add('scroll');
  });
}

function render(st) {
  st = st || {};
  lastState = st;
  if (hatchCleanup) { clearTimeout(hatchCleanup); hatchCleanup = 0; }
  const now = Date.now();
  const newlyHatched = new Set(); // ô vừa nở ngay lần vẽ này (để đếm số bắt đầu từ 0)
  const rows = Math.max(1, Math.min(20, Number(st.rows) || 3));
  const cols = Math.max(1, Math.min(20, Number(st.cols) || 6));
  root.style.setProperty('--cols', cols);
  const gap0 = (Number.isFinite(Number(st.gap)) ? Number(st.gap) : 10);
  root.style.setProperty('--gap', gap0 + 'px');
  // Khoảng cách NGANG (giữa cột) & DỌC (giữa hàng) chỉnh riêng; thiếu thì dùng gap chung.
  root.style.setProperty('--col-gap', (Number.isFinite(Number(st.colGap)) ? Number(st.colGap) : gap0) + 'px');
  // Khoảng cách DỌC áp bằng margin-top (không dùng grid row-gap) để CHO PHÉP giá trị ÂM → hàng dưới
  // kéo sát/đè lên hàng trên. row-gap của grid không nhận số âm nên phải làm cách này.
  const rowGapPx = Number.isFinite(Number(st.rowGap)) ? Number(st.rowGap) : gap0;
  root.style.setProperty('--row-gap', rowGapPx + 'px');
  root.style.setProperty('--icon', (Number(st.iconSize) || 66) + 'px');
  root.style.setProperty('--text', (Number(st.textSize) || 14) + 'px');
  root.style.setProperty('--egg-scale', Math.max(40, Math.min(140, Number(st.eggSize) || 85)) / 100);
  const eggRandom = !!st.eggSkinRandom;
  // Ngẫu nhiên → skin đặt theo TỪNG ô (.sd-sticker), root để 'ivory' cho khỏi đè lên skin ô.
  root.dataset.eggSkin = eggRandom ? 'ivory' : (EGG_SKINS.includes(st.eggSkin) ? st.eggSkin : 'ivory');
  root.style.setProperty('--scale', (Number(st.overlayScale) || 100) / 100);
  root.style.setProperty('--sd-bg', `rgba(${hexToRgb(st.bg || '#2b2f3a')}, ${(Number.isFinite(Number(st.bgOpacity)) ? Number(st.bgOpacity) : 55) / 100})`);
  root.dataset.perfBg = ['none', 'gold', 'pink', 'blue', 'dark'].includes(st.perfBg) ? st.perfBg : 'gold';
  root.dataset.perfBorder = ['none', 'glow', 'neon', 'rainbow', 'ring'].includes(st.perfBorder) ? st.perfBorder : 'glow';
  // Kiểu nhãn tên đang diễn: 'random' (mặc định) bốc ngẫu nhiên mỗi lượt; còn lại là kiểu cố định.
  const perfNameCfg = (st.perfName === 'random' || PERF_NAME_STYLES.includes(st.perfName)) ? st.perfName : 'random';

  const byPos = new Map();
  for (const c of (st.cells || [])) if (c && c.giftId) byPos.set(`${Number(c.row) || 0}-${Number(c.col) || 0}`, c);
  const labelTop = st.labelPos === 'top';
  // Nhãn ở TRÊN → đảo ngược bố cục theo chiều dọc (tên · nền xám+số · icon thò xuống)
  // để các ô cân đối dù icon quà to/nhỏ khác nhau (xem CSS [data-label-pos="top"]).
  root.dataset.labelPos = labelTop ? 'top' : 'bottom';
  // Enter = xuống dòng (luôn tôn trọng). Hàng DÀI hơn khung xử lý theo: scroll (chạy ngang,
  // mặc định) | clip (cắt …). Cấu hình cũ 'wrap' → coi như 'scroll'.
  const labelLong = st.labelLong === 'clip' ? 'clip' : 'scroll';
  root.dataset.labelLong = labelLong;
  const anim = st.animIcon !== false;
  const sparkOn = !!st.perfSparkle;
  const rippleOn = !!st.perfRipple;
  const shineOn = !!st.perfShine;
  const notesOn = !!st.perfNotes;
  const showMedals = st.showMedals !== false;
  const showLevelUp = st.showLevelUp !== false;
  const streakOn = !!st.streakOn;
  streakDur = Math.max(1000, Number(st.streakDur) || 10000);
  streakBarColor = ['tiktok', 'blue', 'health'].includes(st.streakBarColor) ? st.streakBarColor : 'tiktok';
  root.dataset.streakColor = streakBarColor;
  const eggOn = st.eggWhenZero !== false;
  const topGift = String(st.topGiftId || '');
  const crownGift = String(st.crownGiftId || '');
  const MEDALS = ['🥇', '🥈', '🥉'];

  let html = '<div class="sd-grid">';
  for (let r = 0; r < rows; r++) {
    // Hàng đầu không có margin; các hàng sau lùi lên/xuống theo Cách hàng (âm = đè sát).
    const rowMt = r > 0 ? ` style="margin-top:${rowGapPx}px"` : '';
    for (let cc = 0; cc < cols; cc++) {
      const c = byPos.get(`${r}-${cc}`);
      if (!c) { html += `<div class="sd-cell empty"${rowMt}></div>`; continue; }
      const key = `${r}-${cc}`;
      const perf = !!c.performing;
      const special = !!c.special;
      const crowned = !!(crownGift && String(c.giftId) === crownGift);
      const big = perf || (topGift && String(c.giftId) === topGift);
      const iconInner = c.icon
        ? `<img class="sd-icon" src="${esc(mediaUrl(c.icon))}" onerror="avRetry(this)" />`
        : '<div class="sd-icon ph">🎁</div>';
      // Ô quà đặc biệt: bọc icon trong quả bong bóng nước (glass sphere) — 2 vệt sáng specular.
      const waterball = special
        ? '<span class="sd-waterball"><i class="sd-wb-hi"></i><i class="sd-wb-hi2"></i></span>'
        : '';
      const iconHtml = `<div class="sd-iconwrap${anim ? ' anim' : ''}">${iconInner}${waterball}</div>`;
      const ripple = (perf && rippleOn) ? '<span class="sd-ripple"></span><span class="sd-ripple r2"></span>' : '';
      const shine = (perf && shineOn) ? '<span class="sd-shine"><span class="sd-shine-bar"></span></span>' : '';
      // "Đập trứng": count=0 → hiện trứng thay số. Bắt khoảnh khắc 0→>0 của CÙNG quà ở ô → nở.
      // Ô "Quà đặc biệt" (special): BỎ số liệu + trứng cho gọn, chỉ còn icon tụt xuống (xem CSS).
      const cnt = Number(c.count) || 0;
      const isEgg = eggOn && cnt <= 0 && !special;
      const ePrev = eggState.get(key);
      if (ePrev && ePrev.giftId === String(c.giftId) && ePrev.wasEgg && !isEgg) { hatchAt.set(key, now); newlyHatched.add(key); }
      // Skin ngẫu nhiên theo ô: bốc skin mới khi ô VỪA thành trứng (lần đầu / hết beat quay lại / đổi quà);
      // giữ nguyên nếu vẫn đang là trứng để không nhấp nháy. ePrev là trạng thái LẦN TRƯỚC (trước khi ghi đè).
      if (eggRandom) {
        const stayedEgg = !!(ePrev && ePrev.wasEgg && ePrev.giftId === String(c.giftId));
        if (isEgg && !stayedEgg) eggSkinByKey.set(key, pickEggSkin(eggSkinByKey.get(key)));
      }
      const cellSkin = eggRandom ? (eggSkinByKey.get(key) || 'ivory') : '';
      eggState.set(key, { giftId: String(c.giftId), wasEgg: isEgg });
      const hatching = !isEgg && !special && (hatchAt.get(key) || 0) > now - HATCH_MS;
      // Thanh tiến trình tới mục tiêu (chỉ khi ô có target > 0, KHÔNG phải trứng, KHÔNG phải đặc biệt).
      const target = Math.max(0, Number(c.target) || 0);
      const pct = target > 0 ? Math.min(100, (cnt / target) * 100) : 0;
      const prog = (!isEgg && !special && target > 0) ? `<div class="sd-prog${pct >= 100 ? ' done' : ''}" title="${fmt(c.count)}/${fmt(target)}"><i style="width:${pct}%"></i></div>` : '';
      const done = target > 0 && cnt >= target;
      // GIỮ CHUỖI: thanh máu chuỗi (cạn dần). Khi bật, thanh này thay cho thanh tiến trình mục tiêu.
      const streakUntil = Number(c.streakUntil) || 0;
      const streakBar = (streakOn && !isEgg && !special && streakUntil > 0)
        ? `<div class="sd-streak" data-until="${streakUntil}"><i></i></div>` : '';
      const barSlot = streakOn ? streakBar : prog;
      // Lớp vỏ vỡ chỉ chèn trong cửa sổ HATCH_MS; class sd-hatch (số bung ra) chỉ ở nhịp nở đầu.
      const crack = hatching
        ? '<span class="sd-crack"><i class="sd-shell"></i><i class="sd-flash"></i>'
          + [0, 1, 2, 3, 4, 5].map(k => `<i class="sd-bit b${k}"></i>`).join('')
          + '<b class="sd-egg-note">🎵</b></span>'
        : '';
      const inner = special
        ? '' // ô đặc biệt: panel trống, chỉ làm badge phát sáng sau icon
        : isEgg
          ? '<span class="sd-egg" aria-hidden="true"><span class="sd-egg-body"></span></span>'
          : `<span class="sd-count${newlyHatched.has(key) ? ' sd-hatch' : ''}" data-k="${key}" data-gift="${esc(c.giftId)}" data-target="${cnt}" data-lv="${done ? 1 : 0}">${fmt(c.count)}</span>${barSlot}${crack}`;
      // Ô quà đặc biệt: BỎ hẳn panel nền xám — chỉ còn bong bóng nước ôm icon + tên.
      const panel = special ? '' : `<div class="sd-panel">${ripple}${shine}${inner}</div>`;
      // Mỗi lần gõ Enter = 1 HÀNG (.sd-lrow) — luôn giữ nguyên. Hàng nào dài hơn khung sẽ tự
      // CHẠY ngang hoặc cắt "…" tuỳ chế độ; áp cho cả trường hợp nhiều hàng.
      // Kiểu nhãn tên cho ô đang diễn: random giữ ổn định theo key suốt lượt; hết diễn thì bỏ để
      // lượt sau bốc kiểu mới. Kiểu cố định dùng thẳng giá trị cấu hình.
      let perfNameStyle = '';
      if (perf) {
        if (perfNameCfg === 'random') { perfNameStyle = perfNameByKey.get(key) || pickPerfName(); perfNameByKey.set(key, perfNameStyle); }
        else { perfNameStyle = perfNameCfg; perfNameByKey.delete(key); }
      } else { perfNameByKey.delete(key); }
      const tRaw = String(c.text || '');
      const rowsHtml = tRaw.split('\n')
        .map(line => `<div class="sd-lrow"><span class="sd-ltxt">${esc(line)}</span></div>`)
        .join('');
      // Kiểu 'eq': chèn mấy thanh equalizer nhún nhảy trước tên (dấu hiệu "đang phát nhạc").
      const eqMarkup = perfNameStyle === 'eq' ? '<span class="sd-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : '';
      const labelInner = c.text ? `<div class="sd-label" title="${esc(tRaw)}">${eqMarkup}${rowsHtml}</div>` : '';
      // Cách C: bọc nhãn trong DẢI cao cố định (.sd-labelband) để icon các ô luôn thẳng hàng —
      // nhãn 1 dòng / 2 dòng không làm xê dịch icon. Giữ cả dải rỗng khi ô không có tên.
      // Ô "quà đặc biệt" (special) để nhãn nổi tự do (không dải) để không phá bố cục bong bóng nước.
      const label = special ? labelInner : `<div class="sd-labelband">${labelInner}</div>`;
      // Huy chương top 3 theo điểm — badge góc. Ẩn huy chương #1 khi ô đã đội vương miện (tránh trùng).
      const medal = (showMedals && c.rank >= 1 && c.rank <= 3 && !(crowned && c.rank === 1)) ? `<div class="sd-medal m${c.rank}">${MEDALS[c.rank - 1]}</div>` : '';
      // Vương miện trên ô nhiều điểm nhất.
      const crown = crowned ? '<div class="sd-crown">👑</div>' : '';
      // Hạt lấp lánh: chỉ khi ĐANG BIỂU DIỄN + bật (ô quà đặc biệt không còn sparkle cho gọn).
      const sparks = (perf && sparkOn)
        ? '<div class="sd-sparks">' + [0, 1, 2, 3, 4, 5].map(k => `<i class="sd-spark s${k}"></i>`).join('') + '</div>'
        : '';
      // Ô quà đặc biệt: bỏ bong bóng bay lên — chỉ giữ quả bong bóng nước ôm icon (.sd-waterball).
      const bubbles = '';
      const notes = (perf && notesOn)
        ? '<div class="sd-notes">' + ['🎵', '🎶', '🎵'].map((n, k) => `<i class="sd-note n${k}">${n}</i>`).join('') + '</div>'
        : '';
      // Nhãn-ở-dưới (mặc định): icon (trên) · nền xám+số · nhãn (dưới).
      // Nhãn-ở-trên: ĐẢO NGƯỢC — nhãn (trên) · nền xám+số · icon THÒ XUỐNG (dưới), cân đối.
      const stack = labelTop ? (label + panel + iconHtml) : (iconHtml + panel + label);
      html += `<div class="sd-cell"${rowMt}><div class="sd-sticker${big ? ' big' : ''}${perf ? ' performing' : ''}${special ? ' special' : ''}${crowned ? ' crowned' : ''}"${cellSkin ? ` data-egg-skin="${cellSkin}"` : ''}${perfNameStyle ? ` data-perfname="${perfNameStyle}"` : ''}>`
        + medal + crown
        + stack
        + bubbles + sparks + notes
        + '</div></div>';
    }
  }
  html += '</div>';
  root.innerHTML = html;

  // Tên dài + chọn "Chạy ngang": bật marquee cho các nhãn rộng hơn khung.
  if (labelLong === 'scroll') setupLabelMarquee(st);

  // Đồng bộ tween: quà ở ô đổi → snap về target, giữ nguyên nếu cùng quà.
  root.querySelectorAll('.sd-count').forEach(el => {
    const key = el.dataset.k, gift = el.dataset.gift, target = Number(el.dataset.target) || 0;
    const nowDone = el.dataset.lv === '1';
    const prev = disp.get(key);
    if (newlyHatched.has(key)) { disp.set(key, { cur: 0, giftId: gift, done: nowDone }); el.textContent = fmt(0); } // trứng vừa nở → đếm lên từ 0
    else if (!prev || prev.giftId !== gift) { disp.set(key, { cur: target, giftId: gift, done: nowDone }); el.textContent = fmt(target); }
    else {
      if (Math.round(prev.cur) !== target) el.classList.add('sd-pop'); // số đổi → phóng to giật 1 nhịp
      if (showLevelUp && nowDone && !prev.done) fireLevelUp(el); // vừa đạt mục tiêu → LEVEL UP
      disp.set(key, { cur: prev.cur, giftId: gift, done: nowDone });
    }
  });
  // Nếu có ô vừa nở, hẹn vẽ lại sau cửa sổ để gỡ lớp vỏ vỡ (khi không có state mới đến).
  if (newlyHatched.size) hatchCleanup = setTimeout(() => render(lastState), HATCH_MS + 80);
  if (!raf) raf = requestAnimationFrame(tweenLoop);
  if (streakOn && !streakRaf) streakRaf = requestAnimationFrame(streakLoop);
}

render({});
connectSSE(`/sticker-events?token=${encodeURIComponent(token)}`, 'sticker', render);
