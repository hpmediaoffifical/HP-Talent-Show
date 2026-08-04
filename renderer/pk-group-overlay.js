const token = new URLSearchParams(location.search).get('token') || '';
if (new URLSearchParams(location.search).get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = new URLSearchParams(location.search).get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}
const root = document.getElementById('pkGroupRoot');
let noteEl = null;
let noteKey = '';
let mvpTitleKey = '';
let mvpTitleAlignRaf = 0;
let boardStyleKey = '';
let lastLeaderId = '';   // để phát hiện đổi ngôi Hạng 1
let lastIdsKey = '';     // để biết khi nào cấu trúc người chơi đổi → snap count-up
const prevRealScore = new Map(); // điểm THẬT lần trước theo id → phát hiện "vừa lên quà" để bắn gợn sóng

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('vi-VN'); }
function mmss(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
// Đo bề rộng chữ THẬT (canvas) — quyết định thanh máu có đủ chỗ chứa Hạng + Điểm + % không.
// Nhẹ & ổn định (font khớp CSS overlay: Inter/Segoe UI). Đo ở đơn vị pixel gốc (scale 1) → so với
// bề ngang segment gốc (BOARD_W) nên hệ số --pkg-scale tự triệt tiêu, giống donorFitPct.
const _measCtx = document.createElement('canvas').getContext('2d');
function textPx(text, fontPx, weight = 900) {
  _measCtx.font = `${weight} ${Math.max(1, fontPx)}px Inter, "Segoe UI", Arial, sans-serif`;
  return _measCtx.measureText(String(text)).width;
}
// Avatar TikTok CDN load trực tiếp bị chặn trong OBS Browser Source (403/CORS) → phải qua proxy /avatar.
// Đường dẫn logo mặc định của app (../logo/hp-logo.png) không tồn tại trên server overlay → map về /logo.png.
function mediaUrl(value, key = '') {
  const s = String(value || '').trim();
  if (!s || /logo[\\/]hp-logo\.(png|ico)$/i.test(s)) return '/logo.png';
  if (/^[a-f0-9]{40}$/i.test(key)) return `/avatar?key=${encodeURIComponent(key)}`;
  if (/^https?:\/\//i.test(s)) return `/avatar?url=${encodeURIComponent(s)}`;
  return s;
}
// Ảnh avatar lỗi (proxy cold-miss/timeout tức thời trên OBS) → THỬ LẠI vài lần rồi mới rơi về logo.
window.avRetry = function (img) {
  const n = +(img.dataset.avTry || 0);
  if (n >= 3 || !/\/avatar\?/.test(img.src)) { img.onerror = null; img.src = '/logo.png'; return; }
  img.dataset.avTry = n + 1;
  const clean = img.src.replace(/[?&]_r=\d+/, '');
  setTimeout(() => { img.src = clean + (clean.includes('?') ? '&' : '?') + '_r=' + (n + 1); }, 500 + n * 800);
};
function avatarImg(value, key = '') {
  return `<img src="${esc(mediaUrl(value, key))}" onerror="avRetry(this)" />`;
}
function alignMvpTitle() {
  const board = root.querySelector('.pkg-board');
  const row = board?.querySelector('.pkg-title-row');
  const firstCard = board?.querySelector('.pkg-separated-list .pkg-card');
  if (!board || !row || !board.classList.contains('mode-separated') || !firstCard) {
    board?.style.removeProperty('--pkg-mvp-left');
    return;
  }
  const left = Math.max(0, firstCard.getBoundingClientRect().left - row.getBoundingClientRect().left);
  board.style.setProperty('--pkg-mvp-left', `${left.toFixed(2)}px`);
}
function scheduleMvpTitleAlignment() {
  if (mvpTitleAlignRaf) cancelAnimationFrame(mvpTitleAlignRaf);
  mvpTitleAlignRaf = requestAnimationFrame(() => {
    mvpTitleAlignRaf = 0;
    alignMvpTitle();
  });
}
window.addEventListener('resize', scheduleMvpTitleAlignment);
function hexToRgb(hex, fb = '0,0,0') {
  let s = String(hex || '').trim();
  const m3 = s.match(/^#([0-9a-f]{3})$/i);
  if (m3) s = '#' + m3[1].split('').map(c => c + c).join(''); // #fff → #ffffff
  const m = s.match(/^#([0-9a-f]{6})$/i);
  if (!m) return fb;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
function giftHtml(gift) {
  return `<span class="pkg-gift" title="${esc(gift.giftName || gift.name || '')}">${gift.icon ? `<img src="${esc(gift.icon)}" />` : '🎁'}</span>`;
}
// TOP 3 người tặng quà nhiều nhất cho Creator: xếp avatar chồng NỬA lên nhau cho gọn, nằm BÊN PHẢI
// icon quà. Thứ tự DOM top1→top3: TOP1 là phần tử ĐẦU → nằm sát icon quà (bên trái cụm), luôn nổi
// lên trên (z-index cao nhất), đè nửa TOP2, TOP2 đè TOP3. Bo góc trực tiếp trên <img> (OBS-safe).
function donorsHtml(list) {
  const top = (Array.isArray(list) ? list : []).slice(0, 3);
  if (!top.length) return '';
  return `<span class="pkg-donors" aria-hidden="true">${top.map((g, i) =>
    `<span class="pkg-donor d${i + 1}" title="${esc(g.nickname || '')}${g.total ? ' • ' + fmt(g.total) : ''}"><span class="pkg-donor-ava"><img src="${esc(mediaUrl(g.avatar, g.avatarKey))}" onerror="avRetry(this)" /></span></span>`
  ).join('')}</span>`;
}
function shortName(value) {
  const s = String(value || '').trim();
  return s.length > 18 ? s.slice(0, 18) + '...' : s;
}

// Màu chữ LUÔN tương phản với màu nền của creator (nền sáng → chữ tối, nền tối → chữ trắng),
// không phụ thuộc toggle nữa để chữ điểm/tên luôn nổi bật.
function textColorFor(bg) {
  const m = String(bg || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#111827' : '#ffffff';
}

// Bóng chữ thích ứng theo màu chữ: chữ tối → quầng sáng kiểu emboss (nét, sang);
// chữ trắng → bóng tối tinh gọn. Tránh chữ đen đổ bóng đen bị nhòe bẩn.
function textShadowFor(tc) {
  return tc === '#111827'
    ? '0 1px 0 rgba(255,255,255,.85), 0 0 3px rgba(255,255,255,.9), 0 2px 3px rgba(0,0,0,.22)'
    : '0 1px 2px rgba(0,0,0,.55), 0 0 6px rgba(0,0,0,.5)';
}

function rankParticipants(participants) {
  return participants.slice().sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
}

// --- Nội suy "đẩy máu" mượt ---
// root.style sống sót qua mọi lần dựng lại bodyMount.innerHTML, nên ta nội suy các biến CSS
// trên root bằng rAF; grid/thanh kế thừa nên trôi mượt thay vì búng. Khi số người / thứ tự /
// layout đổi (thay đổi cấu trúc) thì snap ngay để tránh sai khớp cột.
const PUSH_MS = 520;
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

// (1) Thanh gộp: nội suy từng trọng số fr của --pkg-cols
let colsCur = [], colsFrom = [], colsTarget = [], colsKey = '', colsT0 = 0, colsRaf = 0;
function applyCols(arr) {
  root.style.setProperty('--pkg-cols', arr.map(w => `minmax(0,${w.toFixed(4)}fr)`).join(' ') || '1fr');
}
function stepCols(now) {
  const e = easeOutCubic(Math.min(1, (now - colsT0) / PUSH_MS));
  colsCur = colsTarget.map((v, i) => { const f = colsFrom[i] ?? v; return f + (v - f) * e; });
  applyCols(colsCur);
  colsRaf = (now - colsT0) < PUSH_MS ? requestAnimationFrame(stepCols) : 0;
}
function pushCols(target, key) {
  const snap = key !== colsKey || target.length !== colsCur.length;
  // Tick đồng hồ với cùng target: đang chạy dở thì để yên, khỏi reset easing.
  if (!snap && colsRaf && target.every((v, i) => Math.abs(v - colsTarget[i]) < 0.01)) return;
  colsKey = key;
  colsTarget = target.slice();
  if (snap) {
    if (colsRaf) { cancelAnimationFrame(colsRaf); colsRaf = 0; }
    colsCur = target.slice(); colsFrom = target.slice();
    applyCols(colsCur);
    return;
  }
  colsFrom = colsCur.slice();
  colsT0 = performance.now();
  if (!colsRaf) colsRaf = requestAnimationFrame(stepCols);
}

// (2) Thẻ tách rời: nội suy width từng người theo biến --cw-<id>
const cardCur = new Map(), cardTarget = new Map(), cardFrom = new Map();
let cardT0 = 0, cardRaf = 0;
function cardVar(id) { return '--cw-' + String(id).replace(/[^a-zA-Z0-9_-]/g, '_'); }
function applyCards() { for (const [id, v] of cardCur) root.style.setProperty(cardVar(id), v.toFixed(3) + '%'); }
function stepCards(now) {
  const e = easeOutCubic(Math.min(1, (now - cardT0) / PUSH_MS));
  for (const [id, tv] of cardTarget) { const f = cardFrom.has(id) ? cardFrom.get(id) : tv; cardCur.set(id, f + (tv - f) * e); }
  applyCards();
  cardRaf = (now - cardT0) < PUSH_MS ? requestAnimationFrame(stepCards) : 0;
}
function pushCards(targets) {
  // Tick đồng hồ với cùng bộ target: đang chạy dở thì để yên, khỏi reset easing.
  if (cardRaf && targets.length === cardTarget.size
      && targets.every(t => Math.abs((cardTarget.get(t.id) ?? -1) - t.width) < 0.01)) return;
  cardTarget.clear();
  for (const { id, width } of targets) { cardTarget.set(id, width); if (!cardCur.has(id)) cardCur.set(id, width); }
  for (const id of [...cardCur.keys()]) if (!cardTarget.has(id)) { cardCur.delete(id); root.style.removeProperty(cardVar(id)); }
  cardFrom.clear(); for (const [id, v] of cardCur) cardFrom.set(id, v);
  cardT0 = performance.now();
  applyCards();
  if (!cardRaf) cardRaf = requestAnimationFrame(stepCards);
}

// (3) Count-up điểm số — đồng bộ nhịp đẩy máu. Số nằm trong <span data-score-id> (có thể bị
// dựng lại mỗi render), nên mỗi frame ta quét lại các span đang có trong DOM và ghi giá trị nội suy.
const scoreCur = new Map(), scoreTarget = new Map(), scoreFrom = new Map();
let scoreT0 = 0, scoreRaf = 0;
function applyScores() {
  root.querySelectorAll('[data-score-id]').forEach(el => {
    const v = scoreCur.get(el.getAttribute('data-score-id'));
    if (v != null) el.textContent = fmt(v);
  });
}
function stepScores(now) {
  const e = easeOutCubic(Math.min(1, (now - scoreT0) / PUSH_MS));
  for (const [id, tv] of scoreTarget) { const f = scoreFrom.has(id) ? scoreFrom.get(id) : tv; scoreCur.set(id, f + (tv - f) * e); }
  applyScores();
  scoreRaf = (now - scoreT0) < PUSH_MS ? requestAnimationFrame(stepScores) : 0;
}
function pushScores(targets, structChanged) {
  // Snap khi: đổi cấu trúc / lần đầu / điểm GIẢM (reset trận hay chỉnh tay) — đếm ngược trông kỳ.
  let snap = structChanged || scoreCur.size === 0;
  if (!snap) for (const t of targets) if ((scoreCur.get(t.id) ?? 0) > t.score + 0.5) { snap = true; break; }
  // Tick đồng hồ cùng target đang chạy dở → để yên.
  if (!snap && scoreRaf && targets.length === scoreTarget.size
      && targets.every(t => (scoreTarget.get(t.id) ?? NaN) === t.score)) return;
  scoreTarget.clear();
  for (const { id, score } of targets) { scoreTarget.set(id, score); if (snap || !scoreCur.has(id)) scoreCur.set(id, score); }
  for (const id of [...scoreCur.keys()]) if (!scoreTarget.has(id)) scoreCur.delete(id);
  if (snap) {
    if (scoreRaf) { cancelAnimationFrame(scoreRaf); scoreRaf = 0; }
    applyScores();
    return;
  }
  scoreFrom.clear(); for (const [id, v] of scoreCur) scoreFrom.set(id, v);
  scoreT0 = performance.now();
  applyScores();
  if (!scoreRaf) scoreRaf = requestAnimationFrame(stepScores);
}

// ================== SKIN MÙA LỄ ==================
// Skin CHỈ là lớp trang trí (khung/hạt/màu/marker) phủ lên thanh máu — KHÔNG đụng chiều rộng máu,
// --pkg-cols, count-up hay bất kỳ logic tính điểm nào. 'auto' → tự chọn theo ngày.
// Lịch skin (auto theo tháng/sự kiện) dùng CHUNG ở overlay-skin.js (window.OverlaySkin) — 1 nguồn
// cho cả 4 overlay, tránh lệch. Fallback tối giản nếu module chưa nạp (overlay-skin.js nạp TRƯỚC file này).
function resolveSkin(skin) {
  if (window.OverlaySkin) return OverlaySkin.resolveSkin(skin);
  const s = String(skin || 'auto').toLowerCase();
  return (s !== 'auto' && ['noel', 'halloween', 'newyear', 'tet', 'valentine', 'trungthu', 'birthday'].includes(s)) ? s : 'none';
}
// Markup hạt/khung cho từng skin — vẽ MỘT LẦN vào .pkg-skin-fx (bền qua các render). Vị trí/độ trễ/
// tốc độ biến thiên bằng :nth-child trong CSS nên JS chỉ cần lặp phần tử. Chỉ tạo lại khi ĐỔI skin.
function skinFxHtml(skin) {
  const rep = (cls, n) => Array.from({ length: n }, () => `<span class="${cls}"></span>`).join('');
  const garland = '<span class="fx-garland">' + Array.from({ length: 12 }, () => '<i></i>').join('') + '</span>';
  switch (skin) {
    case 'tet':
      return '<span class="fx-lantern l1"></span><span class="fx-lantern l2"></span>' + rep('fx-petal', 14) + rep('fx-spark', 8);
    case 'noel':
      return '<span class="fx-tree"></span><span class="fx-santa"></span>' + garland + rep('fx-snow', 18);
    case 'halloween':
      return '<span class="fx-moon2"></span>' + rep('fx-bat', 6) + rep('fx-ghost', 4);
    case 'newyear':
      return rep('fx-firework', 5) + rep('fx-spark', 10) + rep('fx-confetti', 10);
    case 'valentine':
      return rep('fx-heart', 16);
    case 'trungthu':
      return '<span class="fx-moon"></span><span class="fx-lantern l1"></span><span class="fx-lantern l2"></span>' + rep('fx-firefly', 12);
    case 'birthday':
      return rep('fx-confetti', 16) + rep('fx-balloon', 6);
    default:
      return '';
  }
}
let lastSkin = '__init__';
function applySkin(state) {
  const skin = resolveSkin(state.skin);
  if (skin === lastSkin) return; // đổi skin mới tạo lại hạt → tránh restart animation mỗi emit
  lastSkin = skin;
  if (skin && skin !== 'none') root.dataset.skin = skin; else delete root.dataset.skin;
  const fx = root.querySelector('.pkg-skin-fx');
  if (fx) fx.innerHTML = skinFxHtml(skin);
}

function render(state = {}) {
  const participants = Array.isArray(state.participants) ? state.participants : [];
  const sec = Math.ceil((state.remainingMs || 0) / 1000);
  const status = state.status || 'idle';
  const urgent = status === 'running' && sec <= 10 && sec > 0;
  const statusText = status === 'prestart' ? `Chuẩn bị ${sec}s`
    : status === 'running' ? mmss(sec)
    : status === 'grace' ? 'ĐANG TÍNH ĐIỂM'
    : status === 'finished' ? 'KẾT THÚC'
    : '';
  const statusIcon = status === 'finished' ? 'off' : (statusText ? 'clock' : '');
  const layout = state.layoutMode === 'separated' ? 'separated' : 'joined';
  const showMvpTotals = !!state.showMvpTotals;
  const total = participants.reduce((sum, p) => sum + (Number(p.score) || 0), 0);
  const max = Math.max(1, ...participants.map(p => Number(p.score) || 0));
  const minWidth = 8;
  const ranked = rankParticipants(participants);
  const leaderId = ranked[0]?.id || '';
  const mvpParticipant = participants.find(p => (Number(p.streak) || 0) >= 1) || null;
  // Đổi ngôi: có leader mới khác leader trước, trong lúc trận đang diễn ra → lóe sáng 1 nhịp.
  const leaderChanged = lastLeaderId && leaderId && leaderId !== lastLeaderId && (status === 'running' || status === 'grace');
  // "Vừa lên quà": điểm thật của người đó tăng so với lần render trước → bắn 1 nhịp gợn sóng (port từ PK Đôi).
  const gained = new Set();
  if (status === 'running' || status === 'grace') {
    for (const p of participants) {
      const prev = prevRealScore.get(p.id);
      if (prev != null && (Number(p.score) || 0) > prev + 0.5) gained.add(p.id);
    }
  }
  const boostActive = state.boostId && Date.now() - (Number(state.boostAt) || 0) < 1300;
  const boostDir = state.boostDir === 'left' ? 'left' : 'right';
  const rankMap = new Map(ranked.map((p, i) => [p.id, i + 1]));
  const widthOf = (p) => layout === 'separated'
    ? Math.max(minWidth, (Number(p.score) || 0) / max * 100)
    : (total > 0 ? Math.max(minWidth, (Number(p.score) || 0) / total * 100) : 100 / Math.max(1, participants.length));
  const joinedDirOf = (p) => {
    let mid = 0;
    for (const item of participants) {
      const w = widthOf(item);
      if (item.id === p.id) return mid + w / 2 > 50 ? 'left' : 'right';
      mid += w;
    }
    return boostDir;
  };

  const NARROW_W = 12; // % — dưới ngưỡng này thì ẩn chữ tên / phần trăm để khỏi chèn chữ
  // 🎮 Chế độ TikTok (creatorLive): điểm cộng theo NGƯỜI NHẬN thật, không theo quà chỉ định →
  // icon quà vô nghĩa. Ẩn icon quà, CHỈ hiện avatar TOP người tặng cho gọn & đúng ý nghĩa.
  const tiktokMode = !!state.creatorLive;
  // (Ý 1) Cụm avatar TOP người tặng CHỈ hiện khi cột đủ RỘNG cho (icon quà nếu có) + avatar (+ đệm).
  // Cột thấp điểm → chỉ vừa icon → ẩn avatar; user phải đẩy máu thêm một đoạn (buffer) mới hiện lại.
  // Tính theo % bề ngang overlay (inner ≈ 1440 − padding·2 = 1424px; hệ số scale tự triệt tiêu).
  const BOARD_W = 1424;
  const pkgText = Math.max(14, Math.min(60, parseInt(state.textSize, 10) || 30)); // = --pkg-text (px, scale 1)
  const giftPx = Math.max(28, Math.min(120, parseInt(state.giftSize, 10) || 60));
  const donorFitPct = (list) => {
    const n = Math.min(3, (Array.isArray(list) ? list : []).length);
    if (!n) return 0; // không có donor → không cần xét (donorsHtml trả rỗng)
    const iconPx = tiktokMode ? 0 : giftPx * 1.1 + 8 + 4;    // icon quà + đệm trái + gap (ẩn ở TikTok mode)
    const donorPx = giftPx * 0.74;                            // 1 avatar
    const clusterPx = donorPx * 1.14 + donorPx * 0.5 * (n - 1); // d1 to hơn + mỗi cái sau chồng nửa
    const buffer = donorPx * 0.8;                             // đệm: phải đẩy thêm ~1 avatar mới hiện lại
    return (iconPx + 4 + clusterPx + buffer) / BOARD_W * 100;
  };
  // Cỡ chữ tên (đồng bộ board style) để ĐO bề rộng tên → nền pill dài ĐÚNG theo tên (fit-content thông
  // minh): cột đủ rộng thì tên hiện đầy đủ và nền chỉ dài thêm, cột hẹp thì nền kẹp 100% cột + tên cắt gọn.
  const nameScaleM = Math.max(.9, Math.min(3, ((parseInt(state.nameSize, 10) || 100) / 100) * 1.5));
  const mvpTotalText = (p) => fmt(p.mvpTotal);
  const mvpTotalBadgePx = (p) => showMvpTotals
    ? Math.max(pkgText * .92, textPx(mvpTotalText(p), pkgText * .58, 950) + pkgText * .28)
    : 0;
  const platePx = (p, dispName, isLeader) => {
    const nameFont = pkgText * (isLeader ? 0.72 : 0.58) * nameScaleM;
    const avaW = (isLeader ? 46 : 36) * nameScaleM;
    return Math.round(avaW + 6 * nameScaleM + textPx(dispName, nameFont, 950) + 16 + (showMvpTotals ? mvpTotalBadgePx(p) + 8 : 0)); // avatar + tên + huy hiệu tổng MVP
  };
  const totalMvpHtml = (p) => {
    if (!showMvpTotals) return '';
    const value = mvpTotalText(p);
    return `<span class="pkg-mvp-total${value.length > 2 ? ' is-wide' : ''}" title="Tổng MVP: ${value}">${value}</span>`;
  };
  const body = layout === 'joined'
    ? `<div class="pkg-joined-stage">
        <div class="pkg-joined-names">${participants.map(p => {
          const isLeader = p.id === leaderId;
          const narrow = widthOf(p) < NARROW_W;
          const tc = textColorFor(p.color);
          const dispName = shortName(p.name || p.tiktokId || 'Creator');
          return `<div class="pkg-name${isLeader ? ' leader' : ''}${narrow ? ' narrow' : ''}" data-rank="${rankMap.get(p.id) || ''}" style="--c:${esc(p.color || '#FE2C55')};--cr:${hexToRgb(p.color, '254,44,85')};--tc:${tc};--tsh:${textShadowFor(tc)};--pw:${platePx(p, dispName, isLeader)}px">${isLeader ? `<span class="pkg-crown${leaderChanged ? ' shake' : ''}" aria-hidden="true">👑</span>` : ''}${p.avatar ? avatarImg(p.avatar, p.avatarKey) : ''}<b>${esc(dispName)}</b>${totalMvpHtml(p)}</div>`;
        }).join('')}</div>
        <div class="pkg-joined-bar">${participants.map((p, i) => {
          const isLeader = p.id === leaderId;
          const narrow = widthOf(p) < NARROW_W;
          const score = Number(p.score) || 0;
          const tc = textColorFor(p.color);
          const edge = `${i === 0 ? ' is-first' : ''}${i === participants.length - 1 ? ' is-last' : ''}`;
          const num = `<span class="pkg-num" data-score-id="${esc(p.id)}">${fmt(score)}</span>`;
          const crowned = isLeader && leaderChanged;
          return `<div class="pkg-segment${isLeader ? ' leader' : ''}${narrow ? ' narrow' : ''}${crowned ? ' crowned' : ''}${edge}" style="--c:${esc(p.color || '#FE2C55')};--cr:${hexToRgb(p.color, '254,44,85')};--tc:${tc};--tsh:${textShadowFor(tc)}">${isLeader ? '<i class="pkg-flow" aria-hidden="true"></i>' : ''}<b><em>${isLeader ? `<i class="pkg-rank-tag">Hạng 1</i>${num}` : num}</em></b>${gained.has(p.id) ? '<span class="pkg-surge" aria-hidden="true"></span><span class="pkg-shock" aria-hidden="true"></span>' : ''}${crowned ? '<span class="pkg-crown-burst" aria-hidden="true"></span>' : ''}${boostActive && state.boostId === p.id ? `<span class="pkg-boost dir-${joinedDirOf(p)}" aria-hidden="true"><i></i></span>` : ''}</div>`;
        }).join('')}</div>
        <div class="pkg-joined-gifts">${participants.map(p => {
          const showDonors = widthOf(p) >= donorFitPct(p.topDonors);
          const giftsHtml = tiktokMode ? '' : (p.gifts || []).map(giftHtml).join('');
          // Icon quà bên TRÁI, cụm avatar TOP người tặng bên PHẢI icon (ẩn khi cột quá hẹp).
          return `<div class="${showDonors ? '' : 'donors-hidden'}${tiktokMode ? ' tiktok' : ''}" style="--c:${esc(p.color || '#FE2C55')}">${giftsHtml}${showDonors ? donorsHtml(p.topDonors) : ''}</div>`;
        }).join('')}</div>
      </div>`
    : `<div class="pkg-separated-list">${participants.map(p => {
        const score = Number(p.score) || 0;
        const width = widthOf(p);
        const isLeader = p.id === leaderId;
        const tc = textColorFor(p.color);
        return `<div class="pkg-card${isLeader ? ' leader' : ''}" data-rank="${rankMap.get(p.id) || ''}" style="--c:${esc(p.color || '#FE2C55')};--cr:${hexToRgb(p.color, '254,44,85')};--tc:${tc};--tsh:${textShadowFor(tc)}">
          <div class="pkg-card-person${showMvpTotals ? ' has-mvp-total' : ''}">${p.avatar ? avatarImg(p.avatar, p.avatarKey) : ''}<b>${esc(shortName(p.name || p.tiktokId || 'Creator'))}</b>${totalMvpHtml(p)}</div>
          <div class="pkg-card-head"><div class="pkg-card-bar${isLeader ? ' leader' : ''}${isLeader && leaderChanged ? ' crowned' : ''}"><i style="width:var(${cardVar(p.id)}, ${width}%)"></i><b>${isLeader ? `<i class="pkg-rank-tag">Hạng 1</i><span class="pkg-num" data-score-id="${esc(p.id)}">${fmt(score)}</span>` : `<span class="pkg-num" data-score-id="${esc(p.id)}">${fmt(score)}</span>`}</b>${gained.has(p.id) ? '<span class="pkg-surge" aria-hidden="true"></span><span class="pkg-shock" aria-hidden="true"></span>' : ''}${isLeader && leaderChanged ? '<span class="pkg-crown-burst" aria-hidden="true"></span>' : ''}${boostActive && state.boostId === p.id ? `<span class="pkg-boost dir-${boostDir}" style="--boost-left:${width}%" aria-hidden="true"><i></i></span>` : ''}</div></div>
          <div class="pkg-card-gifts${tiktokMode ? ' tiktok' : ''}">${tiktokMode ? '' : (p.gifts || []).map(giftHtml).join('')}${donorsHtml(p.topDonors)}</div>
        </div>`;
      }).join('')}</div>`;
  const noteText = String(state.noteText || '').trim();
  const noteLong = noteText.length > 42;
  const nextNoteKey = state.noteEnabled && noteText
    ? JSON.stringify([noteText, noteLong, state.noteEffect || 'soft', state.noteBgColor || '#1f2430', state.noteTextColor || '#fff', Math.max(6, Number(state.noteSpeedSec) || 16)])
    : '';
  const rawScale = parseInt(state.overlayScale, 10);
  if (Number.isFinite(rawScale)) { try { localStorage.setItem('pkGroupScale', rawScale); } catch {} }
  const useScale = Number.isFinite(rawScale) ? rawScale : (parseInt(localStorage.getItem('pkGroupScale'), 10) || 200);
  const overlayScale = Math.max(.8, Math.min(3, useScale / 100));
  const sparkDelay = -((Date.now() % 1800) / 1000).toFixed(3);
  const flowDelay = -((Date.now() % 1000) / 1000).toFixed(3);
  root.style.setProperty('--pkg-scale', overlayScale);

  if (!root.querySelector('.pkg-board')) {
    // .pkg-skin-fx: lớp trang trí skin BỀN — tạo 1 lần, KHÔNG bị dựng lại theo bodyMount nên
    // hạt rơi/đèn đưa võng chạy liên tục, không búng lại mỗi lần emit (giống bài học overlay-struct-key).
    root.innerHTML = '<div class="pkg-board"><div class="pkg-skin-fx" aria-hidden="true"></div><div id="pkgNoteMount"></div><div id="pkgBodyMount"></div><div class="pkg-title"><div class="pkg-title-row"><span id="pkgMvpTitle" class="pkg-mvp-title" hidden></span><b></b></div></div></div>';
  }
  applySkin(state);
  const board = root.querySelector('.pkg-board');
  board.className = `pkg-board mode-${layout} status-${esc(status)}${urgent ? ' urgent' : ''}`;
  // Baseline ×1.5: mức 100% trên giao diện = cỡ như 150% trước đây (avatar + tên to hơn mặc định).
  const nameScale = Math.max(.9, Math.min(3, ((parseInt(state.nameSize, 10) || 100) / 100) * 1.5));
  const nextBoardStyleKey = [state.textSize, state.giftSize, state.separatedGap, overlayScale, nameScale].join('|');
  if (boardStyleKey !== nextBoardStyleKey) {
    boardStyleKey = nextBoardStyleKey;
    board.style.cssText = `
    --pkg-text:${Math.max(14, Math.min(60, parseInt(state.textSize, 10) || 30))}px;
    --pkg-gift:${Math.max(28, Math.min(120, parseInt(state.giftSize, 10) || 60))}px;
    --pkg-separated-gap:${Math.max(0, Math.min(800, parseInt(state.separatedGap, 10) || 0))}px;
    --pkg-scale:${overlayScale};
    --pkg-name-scale:${nameScale};
  `;
  }
  board.style.setProperty('--pkg-spark-delay', `${sparkDelay}s`);
  board.style.setProperty('--pkg-flow-delay', `${flowDelay}s`);
  const bodyMount = document.getElementById('pkgBodyMount');
  if (bodyMount) bodyMount.innerHTML = body;
  // Đẩy máu mượt (gọi SAU khi mount để phần tử mới kế thừa giá trị biến đang chạy → liền mạch).
  // Key = layout + thứ tự id: đổi cấu trúc thì snap, chỉ đổi điểm thì nội suy.
  const idsKey = participants.map(p => p.id).join('|');
  const layoutKey = layout + '#' + idsKey;
  if (layout === 'joined') { pushCols(participants.map(widthOf), layoutKey); }
  else { colsKey = ''; pushCards(participants.map(p => ({ id: p.id, width: widthOf(p) }))); }
  // Count-up điểm: đổi cấu trúc người chơi thì snap, chỉ đổi điểm thì đếm dần.
  pushScores(participants.map(p => ({ id: p.id, score: Number(p.score) || 0 })), idsKey !== lastIdsKey);
  lastIdsKey = idsKey;
  lastLeaderId = leaderId;
  // Cập nhật điểm thật lần này để so ở lần sau (bắn gợn sóng khi tăng).
  prevRealScore.clear();
  for (const p of participants) prevRealScore.set(p.id, Number(p.score) || 0);
  const title = board.querySelector('.pkg-title b');
  if (title) title.innerHTML = statusText ? `<span class="pkg-time-icon ${statusIcon}" aria-hidden="true"></span><span>${esc(statusText)}</span>` : '';
  const mvpTitle = document.getElementById('pkgMvpTitle');
  const nextMvpTitleKey = mvpParticipant
    ? [mvpParticipant.id, mvpParticipant.avatar, mvpParticipant.avatarKey, mvpParticipant.color, mvpParticipant.name, mvpParticipant.tiktokId, mvpParticipant.streak].join('|')
    : '';
  if (mvpTitle && mvpTitleKey !== nextMvpTitleKey) {
    mvpTitleKey = nextMvpTitleKey;
    if (mvpParticipant) {
      const name = shortName(mvpParticipant.name || mvpParticipant.tiktokId || 'Creator');
      mvpTitle.hidden = false;
      const streak = Math.max(1, Number(mvpParticipant.streak) || 0);
      mvpTitle.title = `MVP: ${name} - Chuỗi ${fmt(streak)}`;
      mvpTitle.innerHTML = `<span class="pkg-mvp-avatar" style="--mvp-c:${esc(mvpParticipant.color || '#FE2C55')};--mvp-cr:${hexToRgb(mvpParticipant.color, '254,44,85')}">${mvpParticipant.avatar ? avatarImg(mvpParticipant.avatar, mvpParticipant.avatarKey) : ''}</span><strong>MVP</strong><span class="pkg-mvp-streak">${fmt(streak)}</span>`;
    } else {
      mvpTitle.hidden = true;
      mvpTitle.removeAttribute('title');
      mvpTitle.replaceChildren();
    }
  }
  scheduleMvpTitleAlignment();

  const noteMount = document.getElementById('pkgNoteMount');
  if (noteMount && nextNoteKey) {
    if (!noteEl || noteKey !== nextNoteKey) {
      noteMount.replaceChildren();
      const div = document.createElement('div');
      div.innerHTML = `<div class="pkg-note pkg-note-${esc(state.noteEffect || 'soft')}${noteLong ? ' is-long' : ''}" style="--note-bg:${esc(state.noteBgColor || '#1f2430')};--note-bg-rgb:${hexToRgb(state.noteBgColor, '31,36,48')};--note-color:${esc(state.noteTextColor || '#fff')};--note-color-rgb:${hexToRgb(state.noteTextColor, '255,255,255')};--note-speed:${Math.max(6, Number(state.noteSpeedSec) || 16)}s">${noteLong ? `<span><i>${esc(noteText)}</i><i aria-hidden="true">${esc(noteText)}</i></span>` : `<b>${esc(noteText)}</b>`}</div>`;
      noteEl = div.firstElementChild;
      noteKey = nextNoteKey;
    }
    if (noteEl.parentNode !== noteMount) noteMount.appendChild(noteEl);
  } else {
    noteMount?.replaceChildren();
    noteEl = null;
    noteKey = '';
  }
}

render({});
// SSE tự hồi phục (overlay-sse.js) → overlay tự lên lại khi stream rớt/kẹt, không cần Ctrl+R.
connectSSE(`/pk-group-events?token=${encodeURIComponent(token)}`, 'pkgroup', render);
