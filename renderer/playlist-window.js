// Cửa sổ DANH SÁCH PHÁT tách rời (chỉ xem). Nhận dữ liệu realtime từ renderer chính qua
// 'playlist:update' (main chuyển tiếp từ renderer chính). Không tương tác — chỉ hiển thị.
const bodyEl = document.getElementById('body');
const countEl = document.getElementById('count');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function itemHtml(it, live, pos) {
  if (!it) return '';
  const num = live ? '<span class="num">▶</span>' : `<span class="num">${pos}</span>`;
  const img = `<img src="${esc(it.icon || '../logo/hp-logo.png')}" onerror="this.style.visibility='hidden'" />`;
  const file = it.file ? `<span class="file" title="${esc(it.file)}">${it.isVid ? '🎬' : '🎵'} ${esc(it.file)}</span>` : '';
  const tail = live
    ? '<em class="live-tag">Đang phát</em>'
    : (it.isVid ? `<span class="ov">${esc(it.overlayName || '')}</span>` : '');
  return `<div class="item ${live ? 'live' : 'wait'}">
    ${num}${img}
    <span class="mid"><span class="name">${esc(it.label)}</span>${file}</span>
    ${tail}
  </div>`;
}

function render(data) {
  data = data || {};
  document.body.classList.toggle('paused', !!data.paused);
  countEl.textContent = `Đang chờ: ${Number(data.total) || 0}`;
  const parts = [];
  parts.push('<p class="now-label">Đang phát</p>');
  parts.push(data.current ? itemHtml(data.current, true) : '<div class="idle">Chưa có mục nào đang phát.</div>');
  const waiting = Array.isArray(data.waiting) ? data.waiting : [];
  if (waiting.length) {
    parts.push('<p class="queue-label">Hàng chờ</p>');
    parts.push(waiting.map((it, i) => itemHtml(it, false, i + 1)).join(''));
    if (Number(data.extra) > 0) parts.push(`<div class="more">+${data.extra} mục nữa đang chờ…</div>`);
  }
  bodyEl.innerHTML = parts.join('');
}

window.api.on('playlist:update', render);
