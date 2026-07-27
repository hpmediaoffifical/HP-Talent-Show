// Ranking overlay — port từ BIGO, hỗ trợ vertical + grid (?grid=1)
const token = new URLSearchParams(location.search).get('token') || '';
const layoutGrid = new URLSearchParams(location.search).get('grid') === '1';
if (new URLSearchParams(location.search).get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = new URLSearchParams(location.search).get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}
const root = document.getElementById('rankingRoot');

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
  const longClass = text.length > 12 ? ' long' : '';
  const safe = esc(text);
  return `<div class="${className}${longClass}" title="${safe}"><span>${safe}${longClass ? ` <b>${safe}</b>` : ''}</span></div>`;
}

// Marker "đang thi đấu" (kiểu chọn nhân vật game) — 4 kiểu FX trong 1 phần tử; CSS chỉ hiện đúng
// kiểu theo class .sel-<style> trên .ranking-board. Đặt trong .ranking-avatar để ôm/chỉ vào avatar.
function selectMarkHtml() {
  return `<span class="ranking-select-mark" aria-hidden="true"><span class="sm-arrow"></span><span class="sm-lock"><i></i><i></i><i></i><i></i></span><span class="sm-spot"></span><span class="sm-vs"><b>ĐẤU</b></span></span>`;
}

function rowHtml(row, state, selFxOn) {
  const rankEmoji = row.rank === 1 ? '🥇' : (row.rank === 2 ? '🥈' : (row.rank === 3 ? '🥉' : (row.rank < 10 ? '0' + row.rank : String(row.rank))));
  const loser = !!row.lost;
  const gift = row.giftIcon ? `<img src="${esc(row.giftIcon)}" />` : (row.giftName ? '🎁' : '');
  const groupColor = row.groupColor || 'transparent';
  // Đánh dấu hàng của người đang thi đấu PK đã Liên kết (chỉ khi có kiểu FX bật + hàng inMatch).
  const selMark = (selFxOn && row.inMatch) ? selectMarkHtml() : '';
  return `<div class="ranking-row top-${row.rank <= 3 ? row.rank : 0} ${row.active ? 'active' : ''} ${loser ? 'loser' : ''}${row.inMatch ? ' in-match' : ''}" style="--row-group-color:${esc(groupColor)}">
    ${state.showRank === false ? '' : `<div class="ranking-rank">${rankEmoji}</div>`}
    ${state.showAvatar === false ? '' : `<div class="ranking-avatar">${selMark}${avatarHtml(row.avatar, row.initials, row.avatarVersion, row.avatarKey)}</div>`}
    <div class="ranking-main">
      ${nameHtml(row.name || 'Idol', 'ranking-name')}
      ${row.groupName ? `<div class="ranking-group">${esc(row.groupName)}</div>` : ''}
      ${row.hideScore || state.hideAllScores ? '<div class="ranking-points hidden-score" aria-label="Ẩn điểm" title="Ẩn điểm">•••</div>' : `<div class="ranking-points">${fmt(row.points)}</div>`}
    </div>
    ${state.showGift === false || !gift ? '' : `<div class="ranking-gift">${gift}</div>`}
    ${state.showRound === false ? '' : `<div class="ranking-round">R${fmt(row.round)}</div>`}
  </div>`;
}

function render(state = {}) {
  const gridRows = Math.max(1, Number(state.gridRows) || 3);
  const gridCols = Math.max(1, Number(state.gridCols) || 3);
  const gridFlow = state.gridFlow === 'column' ? 'column' : 'row';
  const rows = Array.isArray(state.rows) ? state.rows : [];
  const visibleRows = layoutGrid ? rows.slice(0, gridRows * gridCols) : rows;
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
  const giftScale = Math.max(.8, Math.min(1.8, (Number(state.giftScale) || 145) / 100));
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

  root.innerHTML = `<div class="ranking-board${compactClass}${layoutClass} name-${state.nameMode === 'marquee' ? 'marquee' : 'two-line'}${showSelect ? ` sel-on sel-${selFx}` : ''}" style="
    --ranking-card-bg-rgb:${hexToRgb(state.overlayBgColor || '#2a2d37')};
    --ranking-card-bg-opacity:${((Number(state.overlayBgOpacity ?? 74)) / 100).toFixed(2)};
    --ranking-board-bg-rgb:${hexToRgb(state.overlayBoardColor || '#232633')};
    --ranking-streak-color:${esc(state.streakColor || '#67e8f9')};
    --ranking-streak-rgb:${hexToRgb(state.streakColor || '#67e8f9')};
    --rk-rows:${effRows};
    --rk-cols:${effCols};
    --rk-flow:${gridFlow};
    --rk-avatar-visual-scale:${avatarScale};
    --rk-gift-visual-scale:${giftScale};
    --rk-scale:${overlayScale}
  ">
    <div class="ranking-title">${esc(state.title || 'TOP IDOL')}</div>
    <div class="ranking-list">${visibleRows.length === 0 ? '<div class="ranking-empty">Chưa có dữ liệu thi đấu nhóm</div>' : visibleRows.map(r => rowHtml(r, state, selFxOn)).join('')}</div>
    ${state.active ? `<div class="ranking-active-name ${activeLong ? 'long' : ''}">
      <div class="ranking-active-avatar">${avatarHtml(state.active.avatar, state.active.initials, state.active.avatarVersion, state.active.avatarKey)}</div>
      <div class="ranking-active-main"><div>${activeName}</div><b>${activePoints}</b></div>
    </div>` : ''}
  </div>`;
}

render({});
// SSE tự hồi phục (overlay-sse.js) → overlay tự lên lại khi stream rớt/kẹt, không cần Ctrl+R.
connectSSE(`/ranking-events?token=${encodeURIComponent(token)}`, 'ranking', render);
