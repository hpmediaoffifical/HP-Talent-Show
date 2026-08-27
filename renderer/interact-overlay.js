// Overlay TƯƠNG TÁC + QUÀ — 1 cột dọc: 🎁 QUÀ (trên) + 💬 TƯƠNG TÁC (dưới).
// Nhận config (state) + luồng sự kiện bình luận/quà qua SSE /interact-events. Mỗi sự kiện có __seq
// tăng dần → chống trùng khi server phát lại lịch sử lúc client mới/mở lại. Avatar & icon quà qua
// proxy /avatar (OBS chặn CDN TikTok). Vạch chia kéo lên/xuống → POST /interact-split để lưu tỉ lệ.

const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
const REVIEW = params.get('review') === '1';
if (REVIEW) {
  document.body.classList.add('overlay-review');
  const bg = params.get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}

const root = document.getElementById('feedRoot');
const secGift = document.getElementById('feedGift');
const secChat = document.getElementById('feedChat');
const giftList = document.getElementById('giftList');
const chatList = document.getElementById('chatList');
const splitEl = document.getElementById('feedSplit');

const MAX_ITEMS = 30;
let lastSeq = 0;          // __seq lớn nhất đã xử lý (chống phát lại trùng)
let dragging = false;     // đang kéo vạch chia → tạm bỏ qua splitRatio từ config
let ratioPending = false; // vừa thả vạch, đang chờ server xác nhận tỉ lệ mới (né heartbeat kéo ngược)
let curRatio = 0.5;
let newestBottom = false; // vị trí item mới: false = trên cùng, true = dưới cùng

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hexToRgb(hex, fb = '0,0,0') {
  const m = String(hex || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return fb;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
function compact(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(n % 1e9 ? 1 : 0) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n % 1e3 ? 1 : 0) + 'K';
  return String(n);
}
// Avatar/icon TikTok CDN bị chặn trực tiếp trong OBS → qua proxy /avatar.
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

function lvBadge(level) { return level ? `<span class="feed-lv">Lv ${esc(level)}</span>` : ''; }
function avatarImg(url) {
  return `<img class="avatar" src="${esc(mediaUrl(url))}" onerror="avRetry(this)" alt="" />`;
}

// Thêm 1 item vào danh sách theo vị trí "mới nhất" (trên cùng / dưới cùng), giới hạn số dòng.
function place(list, el) {
  if (newestBottom) { list.appendChild(el); while (list.childElementCount > MAX_ITEMS) list.removeChild(list.firstChild); }
  else { list.insertBefore(el, list.firstChild); while (list.childElementCount > MAX_ITEMS) list.removeChild(list.lastChild); }
}

function addChat(d) {
  const el = document.createElement('div');
  el.className = 'feed-item';
  el.innerHTML = avatarImg(d.avatar)
    + `<div class="feed-body"><div class="feed-who">${lvBadge(d.level)}${esc(d.nickname || d.uniqueId || '')}</div>`
    + `<div class="feed-comment">${esc(d.comment || '')}</div></div>`;
  place(chatList, el);
}

// Dòng quà GỌN: [icon] [tên quà] · [x số lần] · [💎 KC] — bật/tắt từng phần qua data-attr trên root
// (ẩn/hiện tức thì bằng CSS, không cần dựng lại item cũ).
function addGift(d) {
  const el = document.createElement('div');
  el.className = 'feed-item';
  const icon = d.giftIcon
    ? `<img class="gift-icon" src="${esc(mediaUrl(d.giftIcon))}" onerror="avRetry(this)" alt="" />`
    : '<span class="gift-icon ph">🎁</span>';
  el.innerHTML = avatarImg(d.avatar)
    + `<div class="feed-body"><div class="feed-who">${lvBadge(d.level)}${esc(d.nickname || d.uniqueId || '')}</div>`
    + `<div class="feed-gift-line">${icon}`
    + `<span class="feed-gift-name">${esc(d.giftName || '')}</span>`
    + `<span class="g-chip g-rep">x${compact(d.repeat)}</span>`
    + `<span class="g-chip g-coin">💎 ${compact(d.totalCoin)}</span>`
    + `</div></div>`;
  place(giftList, el);
}

// Áp config vào giao diện (nền, cỡ chữ/avatar, tỉ lệ chia, bật/tắt cột).
function applyConfig(cfg) {
  cfg = cfg || {};
  const op = Math.max(0, Math.min(100, Number(cfg.bgOpacity ?? 55))) / 100;
  root.style.setProperty('--feed-bg', `rgba(${hexToRgb(cfg.bgColor || '#000000')}, ${op})`);
  // Kéo độ trong suốt về 0 = TRONG SUỐT HOÀN TOÀN: bỏ luôn nền/bóng của từng dòng
  // (không chỉ nền khung) để chỉ còn chữ + avatar + icon nổi trên video.
  root.dataset.transparent = op <= 0 ? '1' : '0';
  root.style.setProperty('--avatar', (Number(cfg.avatarSize) || 56) + 'px');
  root.style.setProperty('--name', (Number(cfg.nameSize) || 30) + 'px');
  root.style.setProperty('--comment', (Number(cfg.commentSize) || 34) + 'px');
  root.style.setProperty('--gift', (Number(cfg.giftSize) || 32) + 'px');

  // Bật/tắt hiển thị từng phần (ẩn/hiện tức thì bằng CSS trên item ĐÃ có, khỏi dựng lại).
  root.dataset.avatar = cfg.showAvatar === false ? '0' : '1';
  root.dataset.giftname = cfg.showGiftName === false ? '0' : '1';
  root.dataset.repeat = cfg.showRepeat === false ? '0' : '1';
  root.dataset.coin = cfg.showCoin === false ? '0' : '1';
  newestBottom = cfg.newest === 'bottom';
  root.dataset.newest = newestBottom ? 'bottom' : 'top';

  const showGift = cfg.showGift !== false;
  const showChat = cfg.showChat !== false || !showGift; // không cho tắt cả 2
  secGift.style.display = showGift ? '' : 'none';
  secChat.style.display = showChat ? '' : 'none';
  if (showGift && showChat) root.removeAttribute('data-only');
  else root.setAttribute('data-only', showGift ? 'gift' : 'chat');

  if (showGift && showChat) {
    const incoming = Math.max(0.1, Math.min(0.9, Number(cfg.splitRatio) || 0.5));
    if (ratioPending) {
      // Đang chờ server xác nhận: chỉ nhả cờ khi config đã khớp tỉ lệ vừa kéo (tránh heartbeat cũ kéo ngược).
      if (Math.abs(incoming - curRatio) < 0.005) ratioPending = false;
    } else if (!dragging) {
      curRatio = incoming;
      applyRatio(curRatio);
    }
  }
}

function applyRatio(r) {
  secGift.style.flex = r.toFixed(4) + ' 1 0';
  secChat.style.flex = (1 - r).toFixed(4) + ' 1 0';
}

// ---- Kéo vạch chia (chạy trong Review / OBS Interact). Thả ra → lưu tỉ lệ về app. ----
let saveTimer = 0;
function postRatio(r) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch(`/interact-split?token=${encodeURIComponent(token)}&ratio=${r.toFixed(4)}`, { method: 'POST' }).catch(() => {});
  }, 120);
}
splitEl.addEventListener('pointerdown', (e) => {
  if (root.hasAttribute('data-only')) return;
  e.preventDefault(); e.stopPropagation();
  dragging = true;
  splitEl.classList.add('dragging');
  try { splitEl.setPointerCapture(e.pointerId); } catch {}
});
splitEl.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const rect = root.getBoundingClientRect();
  if (rect.height <= 0) return;
  const r = Math.max(0.1, Math.min(0.9, (e.clientY - rect.top) / rect.height));
  curRatio = r;
  applyRatio(r);
});
function endDrag(e) {
  if (!dragging) return;
  dragging = false;
  ratioPending = true;
  splitEl.classList.remove('dragging');
  try { splitEl.releasePointerCapture(e.pointerId); } catch {}
  postRatio(curRatio);
}
splitEl.addEventListener('pointerup', endDrag);
splitEl.addEventListener('pointercancel', endDrag);

// ---- SSE đa sự kiện: config + bình luận + quà, kèm watchdog tự hồi phục + reload khi đổi version ----
function connect() {
  const STALE = 12000;
  let es = null, lastAt = Date.now(), closed = false, reconnecting = false, loadedVer = null;
  const bump = () => { lastAt = Date.now(); };

  function handleEvent(d, kind) {
    const seq = Number(d && d.__seq) || 0;
    if (seq && seq <= lastSeq) return; // đã xử lý (phát lại lúc reconnect) → bỏ qua
    if (seq) lastSeq = seq;
    if (kind === 'chat') addChat(d); else addGift(d);
  }

  function open() {
    reconnecting = false;
    try { es && es.close(); } catch {}
    try { es = new EventSource(`/interact-events?token=${encodeURIComponent(token)}`); }
    catch { return schedule(1500); }
    es.addEventListener('open', bump);
    es.addEventListener('__ver', (e) => {
      bump();
      const v = String(e.data || '');
      if (!v) return;
      if (loadedVer === null) { loadedVer = v; return; }
      if (v !== loadedVer) { loadedVer = v; try { location.reload(); } catch {} }
    });
    es.addEventListener('__vis', (e) => { bump(); try { window.applyOverlayVisibility && window.applyOverlayVisibility('interact', e.data); } catch {} });
    es.addEventListener('__white', (e) => { bump(); try { document.documentElement.classList.toggle('white-text', String(e.data).trim() === '1'); } catch {} });
    es.addEventListener('interact', (e) => { bump(); try { applyConfig(JSON.parse(e.data || '{}')); } catch {} });
    es.addEventListener('ichat', (e) => { bump(); try { handleEvent(JSON.parse(e.data || '{}'), 'chat'); } catch {} });
    es.addEventListener('igift', (e) => { bump(); try { handleEvent(JSON.parse(e.data || '{}'), 'gift'); } catch {} });
    es.onerror = () => { if (es && es.readyState === 2) reconnect(800); };
  }
  function reconnect(wait) {
    if (closed || reconnecting) return;
    reconnecting = true;
    try { es && es.close(); } catch {}
    es = null;
    schedule(wait || 500);
  }
  function schedule(wait) { setTimeout(() => { if (!closed) { bump(); open(); } }, wait); }

  setInterval(() => { if (!closed && Date.now() - lastAt > STALE) reconnect(200); }, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastAt > STALE) reconnect(200); });
  window.addEventListener('online', () => reconnect(200));
  open();
}

applyConfig({});
applyRatio(0.5);
connect();
