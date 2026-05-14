// Ranking overlay — port từ BIGO, hỗ trợ vertical + grid (?grid=1)
const token = new URLSearchParams(location.search).get('token') || '';
const layoutGrid = new URLSearchParams(location.search).get('grid') === '1';
const root = document.getElementById('rankingRoot');

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('vi-VN'); }
function hexToRgb(hex, fb = '42,45,55') {
  const m = String(hex || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return fb;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
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
    ${state.showAvatar === false ? '' : `<div class="ranking-avatar">${row.avatar ? `<img src="${esc(row.avatar)}" />` : esc(row.initials || '?')}</div>`}
    <div class="ranking-main">
      ${nameHtml(row.name || 'Idol', 'ranking-name')}
      ${row.groupName ? `<div class="ranking-group">${esc(row.groupName)}</div>` : ''}
      ${row.hideScore || state.hideAllScores ? '<div class="ranking-points hidden-score">Ẩn điểm</div>' : `<div class="ranking-points">${fmt(row.points)}</div>`}
    </div>
    ${state.showGift === false || !gift ? '' : `<div class="ranking-gift">${gift}</div>`}
    ${state.showRound === false ? '' : `<div class="ranking-round">R${fmt(row.round)}</div>`}
  </div>`;
}

function render(state = {}) {
  const rows = Array.isArray(state.rows) ? state.rows : [];
  const compactClass =
    (state.showRank === false ? ' hide-rank' : '') +
    (state.showAvatar === false ? ' hide-avatar' : '') +
    (state.showGift === false ? ' hide-gift' : '') +
    (state.showRound === false ? ' hide-round' : '') +
    ` cols-${[state.showRank !== false, state.showAvatar !== false, state.showGift !== false, state.showRound !== false].filter(Boolean).length}`;
  const layoutClass = layoutGrid ? ' layout-grid' : '';
  const activeName = state.active ? esc(state.active.name || 'Idol') : '';
  const activePoints = state.active ? fmt(state.active.points) : '';
  const activeLong = state.active && `${state.active.name || 'Idol'} ${activePoints}`.length > 18;

  root.innerHTML = `<div class="ranking-board${compactClass}${layoutClass} name-${state.nameMode === 'marquee' ? 'marquee' : 'two-line'}" style="
    --ranking-card-bg-rgb:${hexToRgb(state.overlayBgColor || '#2a2d37')};
    --ranking-card-bg-opacity:${((Number(state.overlayBgOpacity ?? 74)) / 100).toFixed(2)};
    --ranking-streak-color:${esc(state.streakColor || '#67e8f9')};
    --rk-rows:${Number(state.gridRows) || 3};
    --rk-cols:${Number(state.gridCols) || 3};
    --rk-flow:${esc(state.gridFlow || 'row')}
  ">
    <div class="ranking-title">${esc(state.title || 'TOP IDOL')}</div>
    <div class="ranking-list">${rows.length === 0 ? '<div class="ranking-empty">Chưa có dữ liệu BXH</div>' : rows.map(r => rowHtml(r, state)).join('')}</div>
    ${state.active && !layoutGrid ? `<div class="ranking-active-name ${activeLong ? 'long' : ''}">
      <div class="ranking-active-avatar">${state.active.avatar ? `<img src="${esc(state.active.avatar)}" />` : esc(state.active.initials || '?')}</div>
      <div class="ranking-active-main"><div>${activeName}</div><b>${activePoints}</b></div>
    </div>` : ''}
  </div>`;
}

render({});
const es = new EventSource(`/ranking-events?token=${encodeURIComponent(token)}`);
es.addEventListener('ranking', e => { try { render(JSON.parse(e.data || '{}')); } catch {} });
