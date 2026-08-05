// Ranking overlay — port từ BIGO, hỗ trợ vertical + grid (?grid=1)
const token = new URLSearchParams(location.search).get('token') || '';
const layoutGrid = new URLSearchParams(location.search).get('grid') === '1';
if (new URLSearchParams(location.search).get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = new URLSearchParams(location.search).get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}
const root = document.getElementById('rankingRoot');
root.classList.toggle('ranking-grid', layoutGrid);
root.classList.toggle('ranking-vertical', !layoutGrid);
const textMeasureContext = document.createElement('canvas').getContext('2d');

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('vi-VN'); }
function hexToRgb(hex, fb = '42,45,55') {
  const m = String(hex || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return fb;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
function mediaUrl(value, version = '', key = '') {
  const s = String(value || '').trim();
  if (!s || s === '../logo/hp-logo.png' || /logo[\\/]hp-logo\.(png|ico)$/i.test(s)) return '/logo.png';
  if (/^[a-f0-9]{40}$/i.test(key)) return `/avatar?key=${encodeURIComponent(key)}${version ? `&v=${encodeURIComponent(version)}` : ''}`;
  if (/^https?:\/\//i.test(s)) return `/avatar?url=${encodeURIComponent(s)}${version ? `&v=${encodeURIComponent(version)}` : ''}`;
  if (/^file:\/\//i.test(s)) return s;
  return s;
}
// Ảnh avatar lỗi (proxy cold-miss/timeout tức thời trên OBS) → THỬ LẠI vài lần rồi mới rơi về logo,
// thay vì kẹt logo vĩnh viễn. Bust cache trình duyệt bằng &_r; proxy cache theo URL gốc nên lần
// thử sau phục vụ ngay từ cache ấm.
window.avRetry = function (img) {
  const n = +(img.dataset.avTry || 0);
  if (n >= 3 || !/\/avatar\?/.test(img.src)) { img.onerror = null; img.src = '/logo.png'; return; }
  img.dataset.avTry = n + 1;
  const clean = img.src.replace(/[?&]_r=\d+/, '');
  setTimeout(() => { img.src = clean + (clean.includes('?') ? '&' : '?') + '_r=' + (n + 1); }, 500 + n * 800);
};
function avatarHtml(url, initials = '?', version = '', key = '') {
  const src = mediaUrl(url, version, key);
  return `<img src="${esc(src)}" alt="${esc(initials || '')}" onerror="avRetry(this)" />`;
}
function nameHtml(name, className) {
  const text = String(name || 'Idol');
  // Đếm theo CODE-POINT (emoji 🔥 / • / dấu cách đều = 1) đúng chuẩn "8 ký tự". [...text] tách theo code-point,
  // khác text.length (đơn vị UTF-16: 🔥 = 2) nên "NPC•YAN 🔥" = 9 → chạy chữ (trước kia .length=10 ≤ 12 nên tràn).
  const long = [...text].length > 8;
  const safe = esc(text);
  if (!long) return `<div class="${className}" title="${safe}"><span>${safe}</span></div>`;
  // Chạy chữ LIỀN MẠCH (phải→trái, lặp vô hạn): 2 đoạn GIỐNG HỆT, mỗi đoạn kèm khoảng đệm phải → span dịch
  // translateX(-50%) đúng bằng 1 đoạn → đoạn 2 rơi vào đúng vị trí đoạn 1 = không có mối nối/giật.
  const seg = `<i>${safe}</i>`;
  return `<div class="${className} long" title="${safe}"><span>${seg}${seg}</span></div>`;
}

// Marker "đang thi đấu" (kiểu chọn nhân vật game) — 4 kiểu FX trong 1 phần tử; CSS chỉ hiện đúng
// kiểu theo class .sel-<style> trên .ranking-board. Đặt trong .ranking-avatar để ôm/chỉ vào avatar.
function selectMarkHtml() {
  return `<span class="ranking-select-mark" aria-hidden="true"><span class="sm-arrow"></span><span class="sm-lock"><i></i><i></i><i></i><i></i></span><span class="sm-spot"></span><span class="sm-vs"><b>ĐẤU</b></span></span>`;
}

// Vương miện TOP 1/2/3 — SVG tô màu theo hạng (--crown-c ở CSS), luôn hiện dù bật/tắt "màu TOP 123".
// Dùng cho cả overlay DỌC và NGANG (cùng rowHtml) nên đồng bộ tuyệt đối.
function crownSvg(rank) {
  return `<svg class="rk-crown crown-${rank}" viewBox="0 0 24 20" aria-hidden="true">`
    + `<path class="rk-crown-body" d="M2.6 7.2l3.6 3.8L12 3.3l5.8 7.7 3.6-3.8-1.5 9.7H4.1L2.6 7.2z"/>`
    + `<circle class="rk-crown-gem" cx="12" cy="3.3" r="1.6"/>`
    + `<circle class="rk-crown-gem" cx="2.6" cy="7.2" r="1.3"/>`
    + `<circle class="rk-crown-gem" cx="21.4" cy="7.2" r="1.3"/></svg>`;
}

function rowHtml(row, state, selFxOn) {
  const rankEmoji = row.rank <= 3
    ? crownSvg(row.rank) + `<span class="rk-crown-num">${row.rank}</span>`
    : (row.rank < 10 ? '0' + row.rank : String(row.rank));
  const loser = !!row.lost;
  const gift = row.giftIcon ? `<img src="${esc(row.giftIcon)}" />` : (row.giftName ? '🎁' : '');
  const groupColor = row.groupColor || 'transparent';
  // Đánh dấu hàng của người đang thi đấu PK đã Liên kết (chỉ khi có kiểu FX bật + hàng inMatch).
  const selMark = (selFxOn && row.inMatch) ? selectMarkHtml() : '';
  // Số thứ tự thi đấu (STT) — chip góc trên-PHẢI (chỗ R#, thường tắt khi thi đấu), dạng "#10".
  const hasPerf = state.showPerfOrder !== false && Number(row.perfOrder) > 0;
  const perf = hasPerf ? `<div class="ranking-perf" title="Số thứ tự thi đấu">#${Math.round(row.perfOrder)}</div>` : '';
  // Phe PK Đôi (trái A / phải B) → class tô marker + viền theo màu TikTok. PK Nhóm không có phe → rỗng.
  const teamCls = row.matchTeam === 'A' ? ' match-a' : (row.matchTeam === 'B' ? ' match-b' : '');
  return `<div class="ranking-row top-${row.rank <= 3 ? row.rank : 0} ${row.active ? 'active' : ''} ${loser ? 'loser' : ''}${row.inMatch ? ' in-match' : ''}${teamCls}${hasPerf ? ' has-perf' : ''}" style="--row-group-color:${esc(groupColor)}">
    ${perf}
    ${state.showRank === false ? '' : `<div class="ranking-rank">${rankEmoji}</div>`}
    ${state.showAvatar === false ? '' : `<div class="ranking-avatar">${selMark}${avatarHtml(row.avatar, row.initials, row.avatarVersion, row.avatarKey)}</div>`}
    <div class="ranking-main">
      ${nameHtml(row.name || 'Idol', 'ranking-name')}
      ${state.showGroupName !== false && row.groupName ? `<div class="ranking-group">${esc(row.groupName)}</div>` : ''}
      ${row.hideScore || state.hideAllScores ? '<div class="ranking-points hidden-score" aria-label="Ẩn điểm" title="Ẩn điểm">•••</div>' : `<div class="ranking-points">${fmt(row.points)}</div>`}
    </div>
    ${state.showGift === false || !gift ? '' : `<div class="ranking-gift">${gift}</div>`}
    ${state.showRound === false ? '' : `<div class="ranking-round">R${fmt(row.round)}</div>`}
  </div>`;
}

// DỌC giữ "|" thành hai dòng; NGANG luôn là một dòng. Cả hai tự thu chữ để
// giữ lề hai bên của nền tiêu đề, thay vì làm nền tiêu đề nới rộng ra.
// Cache theo (chữ|bề rộng) để không tính lại mỗi render (render dựng lại innerHTML liên tục theo SSE).
let _titleFit = { key: '', size: 15, wrap: false };
function fitTitle() {
  const el = root.querySelector('.ranking-title');
  if (!el || !el.clientWidth) return;
  const key = `${el.textContent || ''}|${el.clientWidth}`;
  if (key === _titleFit.key) {
    el.style.setProperty('--rk-title-size', `${_titleFit.size}px`);
    el.classList.toggle('wrap', _titleFit.wrap);
    return;
  }
  el.classList.remove('wrap');
  // BỀ RỘNG CONTENT-BOX = clientWidth trừ lề trong 2 bên (padding). PHẢI so cỡ chữ với mốc này,
  // KHÔNG dùng scrollWidth>clientWidth (cả hai đều tính CẢ padding) → khi chữ tràn content-box mà vẫn
  // nằm trong padding thì không bị phát hiện, chữ dồn lệch trái (do width:0) chừa trống bên phải.
  const cs = getComputedStyle(el);
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const avail = el.clientWidth - padX; // content-box (px layout, độc lập zoom — cùng đơn vị offsetWidth)
  // #rankingRoot dùng zoom nên Range.getBoundingClientRect trả px ĐÃ ZOOM; quy về px layout bằng tỉ lệ
  // rect/offsetWidth của chính title để so CÙNG ĐƠN VỊ với avail (zoom-safe, khỏi lệch như scrollWidth cũ).
  const zk = el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1;
  const rng = document.createRange();
  const lineW = () => {
    let w = 0;
    el.childNodes.forEach(n => { if (n.nodeType === 3 && n.textContent.trim()) { rng.selectNode(n); w = Math.max(w, rng.getBoundingClientRect().width); } });
    return w ? w / zk : (el.scrollWidth - padX);
  };
  const minSize = layoutGrid ? 5 : 8;
  let size = 15;
  el.style.setProperty('--rk-title-size', `${size}px`);
  let guard = 0;
  while (guard++ < 40 && size > minSize && lineW() > avail + 0.5) {
    size -= 0.5;
    el.style.setProperty('--rk-title-size', `${size}px`);
  }
  if (layoutGrid && lineW() > avail + 0.5) {
    size = Math.max(minSize, size * avail / lineW());
    el.style.setProperty('--rk-title-size', `${size}px`);
  }
  const wrap = !layoutGrid && lineW() > avail + 0.5;
  el.classList.toggle('wrap', wrap);
  _titleFit = { key, size, wrap };
}

// Thu nhỏ chữ số đến mức vẫn đọc được trước khi CSS phải cắt phần vượt khung.
// Cả DỌC và NGANG dùng cùng state, nên phải cùng ưu tiên hiện đủ điểm.
function fitScores() {
  root.querySelectorAll('.ranking-points:not(.hidden-score), .ranking-active-main b').forEach(el => {
    if (el.clientWidth <= 0) return;
    let size = parseFloat(getComputedStyle(el).fontSize);
    if (!Number.isFinite(size)) return;
    let guard = 0;
    while (el.scrollWidth > el.clientWidth + 1 && size > 8 && guard++ < 16) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
  });
}

function labelWidth(el, text) {
  const value = String(text || '');
  if (!value) return 0;
  const ctx = textMeasureContext;
  if (!ctx) return el.scrollWidth || 0;
  const style = getComputedStyle(el);
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const spacing = parseFloat(style.letterSpacing);
  return ctx.measureText(value).width + (Number.isFinite(spacing) ? spacing * Math.max(0, value.length - 1) : 0);
}

// DỌC và từng card NGANG cùng lấy bề rộng từ tên/điểm dài nhất. Badge vẫn có
// khoảng thở nhưng không để lại mảng nền phải quá rộng ở các hàng ngắn.
function fitLayoutWidth() {
  const board = root.querySelector('.ranking-board');
  const rows = board?.querySelectorAll('.ranking-row');
  if (!board || !rows?.length) return;
  let needed = 0;
  rows.forEach(row => {
    const main = row.querySelector('.ranking-main');
    if (!main || !main.clientWidth) return;
    const name = main.querySelector('.ranking-name');
    const points = main.querySelector('.ranking-points');
    const text = Math.max(
      name ? labelWidth(name, name.title || name.textContent) : 0,
      points ? labelWidth(points, points.textContent) : 0,
    );
    needed = Math.max(needed, row.offsetWidth - main.clientWidth + text + 2);
  });
  const active = board.querySelector('.ranking-active-name');
  const activeMain = active?.querySelector('.ranking-active-main');
  if (active && activeMain?.clientWidth) {
    const name = activeMain.querySelector('div');
    const points = activeMain.querySelector('b');
    const text = Math.max(
      name ? labelWidth(name, name.textContent) : 0,
      points ? labelWidth(points, points.textContent) : 0,
    );
    needed = Math.max(needed, active.offsetWidth - activeMain.clientWidth + text + 2);
  }
  if (!needed) return;
  const style = getComputedStyle(board);
  const min = parseFloat(style.getPropertyValue(layoutGrid ? '--rk-grid-min-width' : '--rk-min-width')) || (layoutGrid ? 86 : 100);
  const max = parseFloat(style.getPropertyValue(layoutGrid ? '--rk-grid-max-width' : '--rk-max-width')) || 180;
  board.style.setProperty(layoutGrid ? '--rk-grid-card-width' : '--rk-width', `${Math.max(min, Math.min(max, Math.ceil(needed)))}px`);
}

// Chữ chạy (tên > 8 ký tự): overlay dựng lại innerHTML mỗi nhịp state (khi LIVE, ~250ms) → mọi CSS animation
// bị RESTART từ đầu → chữ đứng yên/giật. Đồng bộ PHA theo đồng hồ chung: đặt animation-delay ÂM = vị trí hiện
// tại trong chu kỳ (khớp duration 7s ở CSS) để phần tử vừa dựng lại chạy TIẾP đúng chỗ → liền mạch, mượt.
const NAME_MARQUEE_DUR_MS = 7000;
function syncNameMarquee() {
  const delay = '-' + ((Date.now() % NAME_MARQUEE_DUR_MS) / 1000).toFixed(2) + 's';
  root.querySelectorAll('.ranking-name.long span').forEach(el => { el.style.animationDelay = delay; });
}

function render(state = {}) {
  // 🎨 Skin mùa lễ (dùng chung) — trang trí ở <body>, độc lập với việc dựng lại root mỗi render.
  if (window.OverlaySkin) OverlaySkin.applySkin(state.skin);
  const gridRows = Math.max(1, Number(state.gridRows) || 3);
  const gridCols = Math.max(1, Number(state.gridCols) || 3);
  const gridFlow = state.gridFlow === 'column' ? 'column' : 'row';
  const rows = Array.isArray(state.rows) ? state.rows : [];
  // rows đã được RankingEngine lọc theo Khoảng hạng/Tối đa. Grid chỉ quyết định
  // cách xếp, không được tự cắt thêm dữ liệu khiến OBS ngang khác OBS dọc.
  const visibleRows = rows;
  const hasGiftBadge = state.showGift !== false && visibleRows.some(r => r.giftIcon || r.giftName);
  const hasRoundBadge = state.showRound !== false && visibleRows.length > 0;
  const hasPerfBadge = state.showPerfOrder !== false && visibleRows.some(r => Number(r.perfOrder) > 0);
  const badgeClass = hasGiftBadge || hasRoundBadge || hasPerfBadge ? ' has-badge' : ' no-badge';
  // Grid tự canh theo số thành viên thực tế: bỏ hàng/cột trống để board khít
  // với thanh vote bên dưới (không chừa chỗ cho ô rỗng đã cấu hình).
  let effRows = gridRows, effCols = gridCols;
  if (layoutGrid && visibleRows.length > 0) {
    const n = visibleRows.length;
    if (gridFlow === 'column') {
      effRows = Math.min(gridRows, n);
      effCols = Math.ceil(n / effRows);
    } else {
      effCols = Math.min(gridCols, n);
      effRows = Math.ceil(n / effCols);
    }
  }
  const compactClass =
    (state.showRank === false ? ' hide-rank' : '') +
    (state.showAvatar === false ? ' hide-avatar' : '') +
    (state.showGift === false ? ' hide-gift' : '') +
    (state.showRound === false ? ' hide-round' : '') +
    (state.showGroupName === false ? ' hide-groupname' : '') +
    (state.showTopColors === false ? ' hide-top-colors' : '') +
    ` cols-${[state.showRank !== false, state.showAvatar !== false, state.showGift !== false, state.showRound !== false].filter(Boolean).length}`;
  const layoutClass = layoutGrid ? ` layout-grid flow-${gridFlow}` : '';
  const activeName = state.active ? esc(state.active.name || 'Idol') : '';
  const activePoints = state.active ? fmt(state.active.points) : '';
  const activeLong = state.active && `${state.active.name || 'Idol'} ${activePoints}`.length > 18;
  const rawScale = parseInt(state.overlayScale, 10);
  if (Number.isFinite(rawScale)) { try { localStorage.setItem('rankingScale', rawScale); } catch {} }
  const useScale = Number.isFinite(rawScale) ? rawScale : (parseInt(localStorage.getItem('rankingScale'), 10) || 200);
  const overlayScale = Math.max(.8, Math.min(3, useScale / 100));
  const avatarScale = Math.max(.8, Math.min(1.7, (Number(state.avatarScale) || 130) / 100));
  const avatarSlot = (25 * avatarScale).toFixed(2);
  const giftScale = Math.max(.8, Math.min(1.8, (Number(state.giftScale) || 145) / 100));
  const badgeSpace = Math.max(
    5,
    hasGiftBadge ? 15 * giftScale + 6 : 0,
    hasRoundBadge || hasPerfBadge ? 30 : 0,
  );
  root.style.setProperty('--rk-scale', overlayScale);

  // --- FX đánh dấu người đang thi đấu PK (đã Liên kết THI ĐẤU NHÓM) ---
  const selFx = ['arrow', 'lock', 'spotlight', 'versus'].includes(state.selectFx) ? state.selectFx : 'off';
  const anyInMatch = visibleRows.some(r => r.inMatch);
  const showSelect = selFx !== 'off' && anyInMatch;
  const selFxOn = showSelect ? selFx : '';
  if (showSelect) {
    const now = Date.now();
    root.style.setProperty('--rk-sel-a', `${-((now % 720) / 1000).toFixed(3)}s`);
    root.style.setProperty('--rk-sel-l', `${-((now % 1100) / 1000).toFixed(3)}s`);
    root.style.setProperty('--rk-sel-r', `${-((now % 1700) / 1000).toFixed(3)}s`);
    root.style.setProperty('--rk-sel-s', `${-((now % 2600) / 1000).toFixed(3)}s`);
    root.style.setProperty('--rk-sel-v', `${-((now % 900) / 1000).toFixed(3)}s`);
    root.style.setProperty('--rk-sel-ring', `${-((now % 3000) / 1000).toFixed(3)}s`);
  }

  // Cấu hình cũ có spotlight/sparkle/pulse/off. Ánh xạ rõ ràng để cập nhật không
  // tự đổi FX người dùng đã chọn sang vàng.
  const legacyActiveFx = { spotlight: 'shine', sparkle: 'royal', pulse: 'neon' };
  const requestedActiveFx = legacyActiveFx[state.activeBgFx] || state.activeBgFx;
  const activeFx = ['off', 'shine', 'neon', 'gold', 'rainbow', 'royal', 'plasma', 'flash', 'live'].includes(requestedActiveFx) ? requestedActiveFx : 'off';
  const activeBgOp = Math.max(0, Math.min(1, (Number(state.activeBgOpacity ?? 55)) / 100));
  const title = String(state.title || 'TOP IDOL').trim();
  const titleHtml = layoutGrid
    ? esc(title.replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' '))
    : esc(title).replace(/\s*\|\s*/g, '<br>');
  root.innerHTML = `<div class="ranking-board${compactClass}${layoutClass}${badgeClass} name-${state.nameMode === 'marquee' ? 'marquee' : 'two-line'}${showSelect ? ` sel-on sel-${selFx}` : ''} af-${activeFx}${state.activeBarSync ? ' bar-sync' : ''}" style="
    --ranking-card-bg-rgb:${hexToRgb(state.overlayBgColor || '#2a2d37')};
    --ranking-card-bg-opacity:${((Number(state.overlayBgOpacity ?? 74)) / 100).toFixed(2)};
    --ranking-board-bg-rgb:${hexToRgb(state.overlayBoardColor || '#000000')};
    --ranking-board-bg-opacity:${((Number(state.overlayBoardOpacity ?? 75)) / 100).toFixed(2)};
    --ranking-title-color:${esc(state.overlayTitleColor || '#ffffff')};
    --ranking-streak-color:${esc(state.streakColor || '#67e8f9')};
    --ranking-streak-rgb:${hexToRgb(state.streakColor || '#67e8f9')};
    --ranking-active-bg-color:${esc(state.activeBgColor || '#ffca3a')};
    --ranking-active-bg-rgb:${hexToRgb(state.activeBgColor || '#ffca3a', '255,202,58')};
    --ranking-active-bg-opacity:${activeBgOp.toFixed(2)};
    --ranking-active-bg-opacity2:${(activeBgOp * 0.5).toFixed(2)};
    --rk-rows:${effRows};
    --rk-cols:${effCols};
    --rk-flow:${gridFlow};
    --rk-avatar-visual-scale:${avatarScale};
    --rk-avatar-slot:${avatarSlot}px;
    --rk-gift-visual-scale:${giftScale};
    --rk-badge-space:${badgeSpace.toFixed(2)}px;
    --rk-scale:${overlayScale}
  ">
    <div class="ranking-title">${titleHtml}</div>
    <div class="ranking-list">${visibleRows.length === 0 ? '<div class="ranking-empty">Chưa có dữ liệu thi đấu nhóm</div>' : visibleRows.map(r => rowHtml(r, state, selFxOn)).join('')}</div>
    ${state.active && state.showActive !== false ? `<div class="ranking-active-name ${activeLong ? 'long' : ''}">
      <div class="ranking-active-avatar">${avatarHtml(state.active.avatar, state.active.initials, state.active.avatarVersion, state.active.avatarKey)}</div>
      <div class="ranking-active-main"><div>${activeName}</div><b>${activePoints}</b></div>
    </div>` : ''}
  </div>`;
  fitLayoutWidth();
  fitTitle(); // sau khi dựng xong: thu nhỏ cỡ chữ tiêu đề cho vừa, không cắt ký tự
  fitScores();
  syncNameMarquee(); // chữ chạy tên dài chạy tiếp đúng pha, không giật khi dựng lại DOM
}

render({});
// SSE tự hồi phục (overlay-sse.js) → overlay tự lên lại khi stream rớt/kẹt, không cần Ctrl+R.
// Ẩn/hiện riêng: bản NGANG (?grid=1) khoá 'rankinggrid', bản DỌC khoá 'ranking'.
connectSSE(`/ranking-events?token=${encodeURIComponent(token)}`, 'ranking', render, { visKey: layoutGrid ? 'rankinggrid' : 'ranking' });
