// NHIỆM VỤ · VOTE BÌNH LUẬN — bảng bình chọn cho OBS (port từ 🗳 Vote Bình Luận của HP NPC LIVE).
// Khán giả gõ TỪ KHOÁ trong bình luận (hoặc tặng quà đã gán) → dòng tương ứng lên điểm.
// Điểm/đồng hồ do ENGINE quyết (nhịp 250ms), overlay chỉ VẼ. Cập nhật TẠI CHỖ theo structKey
// (chỉ dựng lại DOM khi cấu trúc đổi) để thanh máu/vệt sáng không bị restart animation mỗi nhịp SSE.
const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
if (params.get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = params.get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}
const root = document.getElementById('vcRoot');
const card = document.getElementById('vcCard');
const below = document.getElementById('vcBelow');

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('vi-VN'); }
function num(v, dv) { return Number.isFinite(+v) ? +v : dv; }
// OBS CEF cũ không có color-mix() → tự trộn hex + alpha ra rgba.
function rgba(hex, a) {
  const m = String(hex || '').match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex || 'transparent';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function clock(ms) {
  const s = Math.max(0, Math.ceil(Number(ms) || 0) / 1000);
  const mm = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
// Icon quà đi qua proxy /avatar (URL TikTok hết hạn / bị chặn fetch trực tiếp trên OBS).
function mediaUrl(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return `/avatar?url=${encodeURIComponent(s)}`;
  return s;
}
window.avRetry = function (img) {
  const n = +(img.dataset.avTry || 0);
  if (n >= 3 || !/\/avatar\?/.test(img.src)) { img.onerror = null; img.style.display = 'none'; return; }
  img.dataset.avTry = n + 1;
  const clean = img.src.replace(/[?&]_r=\d+/, '');
  setTimeout(() => { img.src = clean + (clean.includes('?') ? '&' : '?') + '_r=' + (n + 1); }, 500 + n * 800);
};

function rowHtml(row, showBar, showGift, showPct) {
  // Chấm điểm CHỈ bằng bình luận ⇒ quà không tính điểm ⇒ giấu luôn icon quà cho gọn dòng.
  const icon = (showGift && row.giftImage)
    ? `<img class="vc-gift" src="${esc(mediaUrl(row.giftImage))}" alt="" onerror="avRetry(this)" />`
    : '';
  return `<div class="vc-row" data-id="${esc(row.id)}">
    <div class="vc-key">${esc(row.keyword)}</div>
    <div class="vc-main">
      <div class="vc-bar${showBar ? '' : ' vc-hidden'}"><i style="width:${row.pct}%;background:${esc(row.color)}"></i></div>
      <div class="vc-content">${icon}<div class="vc-label">${esc(row.label)}</div></div>
    </div>
    <div class="vc-score">${showPct ? `<span class="vc-pct">(${row.pct}%)</span>` : ''}<span class="vc-pts">${fmt(row.points)}</span><small>${esc(row.pointsLabel)}</small></div>
  </div>`;
}

let _structKey = '';
let _belowKey = '';

function render(state = {}) {
  const rows = Array.isArray(state.rows) ? state.rows : [];
  const d = state.display || {};
  const pointsLabel = state.pointsLabel || 'ĐIỂM';
  const showBar = d.showBar !== false;
  const showGift = state.countingMode !== 'comments';
  const showPct = d.showPercent !== false;

  // ---- Biến CSS (không phụ thuộc cấu trúc DOM → gán mỗi nhịp, rẻ) ----
  const boardFactor = Math.max(.6, Math.min(2.4, num(d.boardWidth, 100) / 100));
  const alpha = Math.max(0, Math.min(100, num(d.overlayAlpha, 94))) / 100;
  root.style.setProperty('--vc-scale', Math.max(.4, Math.min(3, num(d.scale, 100) / 100)));
  root.style.setProperty('--vc-title-size', `${num(d.titleSize, 60)}px`);
  root.style.setProperty('--vc-time-size', `${num(d.timeSize, 52)}px`);
  root.style.setProperty('--vc-item-size', `${num(d.itemSize, 48)}px`);
  root.style.setProperty('--vc-icon-size', `${num(d.iconSize, 60)}px`);
  root.style.setProperty('--vc-item-height', `${num(d.itemHeight, 82)}px`);
  root.style.setProperty('--vc-board-px', `${Math.round(760 * boardFactor)}px`);
  root.style.setProperty('--vc-content-fr', `${Math.max(.7, Math.min(2.2, num(d.contentWidth, 100) / 100))}fr`);
  root.style.setProperty('--vc-content-padding', `${num(d.contentPadding, 12)}px`);
  root.style.setProperty('--vc-card-padding', `${num(d.cardPadding, 28)}px`);
  root.style.setProperty('--vc-row-padding', `${num(d.rowPadding, 14)}px`);
  root.style.setProperty('--vc-bar-color', d.barColor || '#4f83ff');
  root.style.setProperty('--vc-text-color', d.textColor || '#ffffff');
  root.style.setProperty('--vc-panel-bg', rgba(d.overlayBg || '#3a3d46', alpha.toFixed(2)));
  root.style.setProperty('--vc-row-bg', rgba(d.itemBg || '#8f2230', num(d.itemBgOpacity, .88).toFixed(2)));
  // Khoảng hở mép trên đặt trên <html> (px THẬT) để không bị nhân theo zoom của bảng.
  document.documentElement.style.setProperty('--vc-top-gap', `${num(d.topGap, 40)}px`);
  card.classList.toggle('vc-flat', alpha <= 0);
  card.classList.toggle('vc-nokey', d.showKeyword === false);

  // ---- Dựng lại DOM CHỈ khi cấu trúc đổi (số dòng / tên / icon / bật-tắt thanh) ----
  const holdMs = Math.max(0, num(state.holdMs, 0));
  const structKey = JSON.stringify([
    state.title, pointsLabel, showBar, showGift, showPct,
    rows.map(r => [r.id, r.keyword, r.label, r.color, r.giftImage]),
  ]);
  if (structKey !== _structKey) {
    _structKey = structKey;
    card.innerHTML = `
      <div class="vc-top">
        <h1 class="vc-title">${esc(state.title || 'BÌNH CHỌN')}</h1>
        <div class="vc-clock">${clock(state.remainingMs)}</div>
      </div>
      <div class="vc-list">${rows.map(r => rowHtml({ ...r, pointsLabel }, showBar, showGift, showPct)).join('')}</div>`;
  }

  // ---- Lớp NGOÀI thẻ (không ảnh hưởng chiều cao thẻ) ----
  const winnerNames = (state.ended && (state.winners || []).length) ? state.winners.join(' / ') : '';
  const belowKey = JSON.stringify([winnerNames, holdMs > 0, pointsLabel]);
  if (belowKey !== _belowKey) {
    _belowKey = belowKey;
    below.innerHTML =
      (winnerNames ? `<div class="vc-winner"><span>🏆 Dẫn đầu</span><b>${esc(winnerNames)}</b><em class="vc-winpts">${fmt(state.winnerPoints)} ${esc(pointsLabel)}</em></div>` : '')
      + (holdMs > 0 ? `<div class="vc-next"><span>Vòng mới sau</span><b class="vc-hold">${clock(holdMs)}</b></div>` : '');
    root.classList.toggle('has-below', !!below.firstChild);
  }

  // ---- Cập nhật TẠI CHỖ: đồng hồ + điểm + thanh máu + dòng dẫn đầu ----
  const clockEl = card.querySelector('.vc-clock');
  if (clockEl) {
    const text = clock(state.remainingMs);
    if (clockEl.textContent !== text) clockEl.textContent = text;
    clockEl.classList.toggle('vc-urgent', !!state.active && num(state.remainingMs, 0) <= 10000);
  }
  const holdEl = below.querySelector('.vc-hold');
  if (holdEl) { const t = clock(holdMs); if (holdEl.textContent !== t) holdEl.textContent = t; }

  const list = card.querySelector('.vc-list');
  if (list) {
    rows.forEach((r, i) => {
      const el = list.children[i];
      if (!el) return;
      const fill = el.querySelector('.vc-bar > i');
      if (fill && fill.style.width !== `${r.pct}%`) fill.style.width = `${r.pct}%`;
      const pct = el.querySelector('.vc-pct');
      if (pct && pct.textContent !== `(${r.pct}%)`) pct.textContent = `(${r.pct}%)`;
      const pts = el.querySelector('.vc-pts');
      if (pts && pts.textContent !== fmt(r.points)) pts.textContent = fmt(r.points);
      el.classList.toggle('vc-leader', !!r.leader);
    });
  }
  const winPts = below.querySelector('.vc-winpts');
  if (winPts) { const t = `${fmt(state.winnerPoints)} ${pointsLabel}`; if (winPts.textContent !== t) winPts.textContent = t; }
}

connectSSE(`/vote-comment-events?token=${encodeURIComponent(token)}`, 'votecmt', render);
fetch(`/vote-comment-state?token=${encodeURIComponent(token)}`).then(r => r.json()).then(render).catch(() => {});
