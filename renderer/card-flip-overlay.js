// THẺ BÀI — overlay tương tác. Bấm 1 thẻ (OBS Interact / cửa sổ Review) → POST /card-flip-toggle
// để server đảo mặt úp/mở của đúng thẻ đó rồi phát lại cho MỌI overlay + app.
// Giữ transition lật MƯỢT: chỉ dựng lại DOM khi DANH SÁCH/nội dung thẻ đổi; đổi lật/chọn chỉ bật/tắt class.
const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
if (params.get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = params.get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}

const root = document.getElementById('cfRoot');
const elTitle = document.getElementById('cfTitle');
const elFill = document.getElementById('cfFill');
const elNum = document.getElementById('cfNum');
const elStatus = document.getElementById('cfStatus');
const elDeck = document.getElementById('cfDeck');
const elEdgeTop = document.querySelector('.cf-edge-top');
const elEdgeBottom = document.querySelector('.cf-edge-bottom');

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('vi-VN'); }
function num(v, dv) { return Number.isFinite(+v) ? +v : dv; }
function rgba(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return `rgba(11,11,15,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
// Triplet "r,g,b" cho CSS dùng rgba(var(--x-rgb), a) — thay color-mix() mà CEF cũ của OBS không hiểu.
function trip(hex, fb = '255,255,255') {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return fb;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

let lastSig = null;
let skew = 0;           // Date.now() - serverNow → canh mốc lộ thẻ chung với overlay Lật 3D
let pendingTimer = 0;   // hẹn vẽ lại đúng lúc thẻ "đến giờ" lộ (SSE không tự bắn vào thời điểm đó)
let lastState = {};

function render(state = {}) {
  if (state && Object.keys(state).length) lastState = state; else state = lastState;
  // KHÔNG tính skew ở đây: hàm này còn được gọi lại bằng setTimeout với state CŨ (serverNow cũ),
  // nếu tính lại sẽ đội skew lên đúng bằng thời gian đã trôi → dueAt lùi mãi, thanh ngang KHÔNG bao giờ lật.
  // skew chỉ cập nhật khi có gói SSE MỚI (onCardflip).
  const cards = Array.isArray(state.cards) ? state.cards : [];
  const style = state.cardStyle === 'pink' ? 'pink' : 'gold';
  const target = Math.max(0, Number(state.heartTarget) || 0);
  const hearts = Math.max(0, Number(state.hearts) || 0);
  const done = hearts >= target; // 0/0 cũng coi là THÀNH CÔNG (như thiết kế)
  const pct = target > 0 ? Math.max(0, Math.min(100, (hearts / target) * 100)) : (done ? 100 : 0);

  // Biến giao diện (đổi tức thì, KHÔNG dựng lại DOM thẻ).
  root.style.setProperty('--cf-bg', rgba(state.bgColor, num(state.bgAlpha, 0.85)));
  root.style.setProperty('--cf-title', state.titleColor || '#ffd94a');
  root.style.setProperty('--cf-title-rgb', trip(state.titleColor, '255,217,74'));
  root.style.setProperty('--cf-bar', state.barColor || '#ff2f87');
  root.style.setProperty('--cf-bar-rgb', trip(state.barColor, '255,47,135'));
  root.style.setProperty('--cf-bartext', state.barTextColor || '#ffffff');
  root.style.setProperty('--cf-running', state.runningColor || '#ff5a5a');
  root.style.setProperty('--cf-done', state.doneColor || '#38e08a');
  root.style.setProperty('--cf-done-rgb', trip(state.doneColor, '56,224,138'));
  root.style.setProperty('--cf-card-w', `${Math.max(60, num(state.cardSize, 128))}px`);
  root.style.setProperty('--cf-font', `${Math.max(8, num(state.fontSize, 16))}px`);
  root.style.setProperty('--cf-content-size', `${Math.max(8, num(state.cardTextSize, 18))}px`);
  root.style.setProperty('--cf-scale', String(Math.max(0.4, Math.min(3, num(state.scale, 100) / 100))));
  root.style.setProperty('--cf-back', `url("/card-assets/${style}/back.png")`);
  root.style.setProperty('--cf-front', `url("/card-assets/${style}/front.png")`);
  root.classList.toggle('cf-has-edges', state.edges !== false);
  root.classList.toggle('cf-done', done);

  elEdgeTop.src = `/card-assets/${style}/edge-top.png`;
  elEdgeBottom.src = `/card-assets/${style}/edge-bottom.png`;

  // Thông tin
  elTitle.textContent = state.title || 'Thẻ bài';
  elFill.style.width = `${pct}%`;
  elNum.textContent = `${fmt(hearts)} / ${fmt(target)}`;
  elStatus.textContent = done ? 'THÀNH CÔNG' : 'ĐANG THỰC HIỆN';

  // Bộ thẻ: dựng lại CHỈ khi danh sách/nội dung đổi (giữ transition lật).
  const sig = cards.map(c => `${c.id}${c.text || ''}`).join('');
  if (sig !== lastSig) {
    lastSig = sig;
    elDeck.innerHTML = cards.map(c => `
      <div class="cf-card" data-id="${esc(c.id)}">
        <div class="cf-card-inner">
          <div class="cf-face cf-back" style="background-image:var(--cf-back)"></div>
          <div class="cf-face cf-front" style="background-image:var(--cf-front)"><div class="cf-content">${esc(c.text)}</div></div>
        </div>
      </div>`).join('');
  }
  // Trạng thái lật/chọn: chỉ bật/tắt class → mượt.
  // ĐỒNG BỘ với overlay Lật 3D: khi bật hiệu ứng, thẻ chỉ LỘ (lật) đúng lúc flipAt+spinMs
  // (lúc lá 3D bay ra giữa) — không lộ sớm khi cuộn còn đang quay.
  const fxOn = state.fx !== false;
  const spinMs = Math.max(0, Math.min(8000, Math.round(+state.spinMs || 3000)));
  const now = Date.now();
  let nextDue = Infinity;
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = 0; }
  const nodes = elDeck.querySelectorAll('.cf-card');
  cards.forEach((c, i) => {
    const el = nodes[i]; if (!el) return;
    let showFlipped = !!c.flipped;
    if (showFlipped && fxOn && (c.flipAt || 0) > 0) {
      const dueAt = (c.flipAt || 0) + skew + spinMs;
      if (now < dueAt) { showFlipped = false; nextDue = Math.min(nextDue, dueAt); }
    }
    el.classList.toggle('cf-flipped', showFlipped);
    el.classList.toggle('cf-selected', !!c.selected);
  });
  if (nextDue !== Infinity) pendingTimer = setTimeout(() => render(lastState), Math.max(30, nextDue - Date.now()));
}

// Bấm thẻ → yêu cầu server lật (đảo). Server phát lại state → mọi overlay + app đồng bộ.
let pending = false;
elDeck.addEventListener('click', (e) => {
  const card = e.target.closest('.cf-card');
  if (!card || pending) return;
  const id = card.dataset.id;
  if (!id) return;
  pending = true;
  fetch(`/card-flip-toggle?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`, { method: 'POST' })
    .catch(() => {})
    .finally(() => { setTimeout(() => { pending = false; }, 120); });
});

// Cập nhật skew CHỈ khi có gói SSE mới (serverNow tươi) rồi mới vẽ; các lần vẽ lại do hẹn giờ dùng skew ổn định.
function onCardflip(st) {
  if (st && Number.isFinite(+st.serverNow)) skew = Date.now() - (+st.serverNow);
  render(st);
}
render({});
connectSSE(`/card-flip-events?token=${encodeURIComponent(token)}`, 'cardflip', onCardflip);
