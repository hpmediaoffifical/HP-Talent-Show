// Cửa sổ DANH SÁCH PHÁT tách rời. Nhận dữ liệu realtime từ renderer chính qua 'playlist:update'
// (main chuyển tiếp) và gửi LỆNH điều khiển ngược lại qua window.api.playlist.command → main → renderer chính.
const bodyEl = document.getElementById('body');
const totalEl = document.getElementById('tbTotal');
let lastState = { paused: false };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function send(action, extra) { try { window.api.playlist.command({ action, ...(extra || {}) }); } catch {} }

function itemHtml(it, live, pos) {
  if (!it) return '';
  const num = live ? '<span class="num">▶</span>' : `<span class="num">${pos}</span>`;
  const img = `<img src="${esc(it.icon || '../logo/hp-logo.png')}" onerror="this.style.visibility='hidden'" />`;
  const file = it.file ? `<span class="file" title="${esc(it.file)}">${it.isVid ? '🎬' : '🎵'} ${esc(it.file)}</span>` : '';
  // Mục đang phát: KHÔNG hiện chữ "Đang phát" nữa — chỉ cần viền đỏ (.item.live) là đủ.
  const tail = live ? '' : (it.isVid ? `<span class="ov">${esc(it.overlayName || '')}</span>` : '');
  // Nút xóa: mục đang phát → 'skipCurrent'; mục hàng chờ → 'removeUid' theo uid.
  const del = live
    ? '<button class="del" type="button" data-act="skipCurrent" title="Bỏ mục đang phát khỏi danh sách">✕</button>'
    : `<button class="del" type="button" data-act="removeUid" data-uid="${esc(it.uid || '')}" title="Xóa khỏi danh sách phát">✕</button>`;
  return `<div class="item ${live ? 'live' : 'wait'}">
    ${num}${img}
    <span class="mid"><span class="name">${esc(it.label)}</span>${file}</span>
    ${tail}${del}
  </div>`;
}

function render(data) {
  data = data || {};
  lastState = data;
  document.body.classList.toggle('paused', !!data.paused);
  // Tổng số beat = mục đang phát (nếu có) + toàn bộ hàng chờ.
  if (totalEl) totalEl.textContent = (Number(data.total) || 0) + (data.current ? 1 : 0);
  // Cập nhật nút Tạm dừng theo trạng thái + bật/tắt nút khi không có gì đang phát.
  const pauseBtn = document.getElementById('tbPause');
  const skipBtn = document.getElementById('tbSkip');
  if (pauseBtn) {
    pauseBtn.textContent = data.paused ? '▶' : '⏸';
    pauseBtn.title = data.paused ? 'Tiếp tục mục đang tạm dừng' : 'Tạm dừng mục đang phát';
    pauseBtn.classList.toggle('is-paused', !!data.paused);
    pauseBtn.disabled = !data.current;
  }
  if (skipBtn) skipBtn.disabled = !data.current;
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

// Nút xóa từng mục (uỷ quyền sự kiện — không cần gắn lại sau mỗi lần render).
bodyEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.del'); if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'removeUid') send('removeUid', { uid: btn.dataset.uid });
  else if (act === 'skipCurrent') send('skipCurrent');
});
// Thanh điều khiển
document.getElementById('tbPause')?.addEventListener('click', () => send('togglePause'));
document.getElementById('tbSkip')?.addEventListener('click', () => send('skipCurrent'));
document.getElementById('tbShuffle')?.addEventListener('click', () => send('shuffle'));
document.getElementById('tbClearAll')?.addEventListener('click', () => send('clearAll'));

window.api.on('playlist:update', render);
