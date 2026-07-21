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
function mediaUrl(value) {
  const s = String(value || '').trim();
  if (!s || s === '../logo/hp-logo.png' || /logo[\\/]hp-logo\.(png|ico)$/i.test(s)) return '/logo.png';
  if (/^https?:\/\//i.test(s)) return `/avatar?url=${encodeURIComponent(s)}`;
  if (/^file:\/\//i.test(s)) return s;
  return s;
}
function avatarHtml(url, initials = '?') {
  const src = mediaUrl(url);
  return `<img src="${esc(src)}" alt="${esc(initials || '')}" onerror="this.onerror=null;this.src='/logo.png'" />`;
}
function nameHtml(name, className) {
  const text = String(name || 'Idol');
  const longClass = text.length > 12 ? ' long' : '';
  const safe = esc(text);
  return `<div class="${className}${longClass}" title="${safe}"><span>${safe}${longClass ? ` <b>${safe}</b>` : ''}</span></div>`;
}

function rowHtml(row, state) {
  const rankEmoji = row.rank === 1 ? '🥇' : (row.rank === 2 ? '🥈' : (row.rank === 3 ? '🥉' : (row.rank < 10 ? '0' + row.rank : String(row.rank))));
  const loser = !!row.lost;
  const gift = row.giftIcon ? `<img src="${esc(row.giftIcon)}" />` : (row.giftName ? '🎁' : '');
  const groupColor = row.groupColor || 'transparent';
  return `<div class="ranking-row top-${row.rank <= 3 ? row.rank : 0} ${row.active ? 'active' : ''} ${loser ? 'loser' : ''}" style="--row-group-color:${esc(groupColor)}">
    ${state.showRank === false ? '' : `<div class="ranking-rank">${rankEmoji}</div>`}
    ${state.showAvatar === false ? '' : `<div class="ranking-avatar">${avatarHtml(row.avatar, row.initials)}</div>`}
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
  const useScale = Number.isFinite(rawScale) ? rawScale : (parseInt(localStorage.getItem('rankingScale'), 10) || 100);
  const overlayScale = Math.max(.8, Math.min(3, useScale / 100));
  root.style.setProperty('--rk-scale', overlayScale);

  root.innerHTML = `<div class="ranking-board${compactClass}${layoutClass} name-${state.nameMode === 'marquee' ? 'marquee' : 'two-line'}" style="
    --ranking-card-bg-rgb:${hexToRgb(state.overlayBgColor || '#2a2d37')};
    --ranking-card-bg-opacity:${((Number(state.overlayBgOpacity ?? 74)) / 100).toFixed(2)};
    --ranking-streak-color:${esc(state.streakColor || '#67e8f9')};
    --rk-rows:${effRows};
    --rk-cols:${effCols};
    --rk-flow:${gridFlow};
    --rk-scale:${overlayScale}
  ">
    <div class="ranking-title">${esc(state.title || 'TOP IDOL')}</div>
    <div class="ranking-list">${visibleRows.length === 0 ? '<div class="ranking-empty">Chưa có dữ liệu thi đấu nhóm</div>' : visibleRows.map(r => rowHtml(r, state)).join('')}</div>
    ${state.active ? `<div class="ranking-active-name ${activeLong ? 'long' : ''}">
      <div class="ranking-active-avatar">${avatarHtml(state.active.avatar, state.active.initials)}</div>
      <div class="ranking-active-main"><div>${activeName}</div><b>${activePoints}</b></div>
    </div>` : ''}
  </div>`;
}

render({});
// SSE tự hồi phục (overlay-sse.js) → overlay tự lên lại khi stream rớt/kẹt, không cần Ctrl+R.
connectSSE(`/ranking-events?token=${encodeURIComponent(token)}`, 'ranking', render);
