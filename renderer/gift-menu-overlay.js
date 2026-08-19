// Menu Quà overlay — bảng "ICON QUÀ | Nội dung" cho OBS.
// CHỈ hiển thị thông tin quà (không số lượng, không nhịp nhảy, không đếm). Nhận config qua
// SSE /gift-menu-events và dựng lại danh sách. Icon quà qua proxy /avatar (OBS chặn CDN TikTok).
// OBS sắc nét: root dùng CSS zoom (không transform:scale). Anim bằng transform ở lớp wrapper;
// filter drop-shadow đặt ở <img> tĩnh (né lỗi OBS tô đen phần vừa animate vừa có filter).

const token = new URLSearchParams(location.search).get('token') || '';
if (new URLSearchParams(location.search).get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = new URLSearchParams(location.search).get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}
const root = document.getElementById('gmRoot');

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hexToRgb(hex, fb = '0,0,0') {
  const m = String(hex || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return fb;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
function validColor(v, fb) { return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : fb; }
// Icon quà TikTok CDN bị chặn trực tiếp trong OBS Browser Source → qua proxy /avatar.
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

const ICON_FX = ['none', 'bubble', 'ring', 'glow', 'orbit', 'ripple', 'sparkle', 'neon', 'rays'];
const ICON_ANIM = ['none', 'float', 'shake', 'flip', 'swing', 'bounce', 'wobble', 'spin', 'pulse', 'tada', 'heartbeat', 'jelly'];
const TEXT_FX = ['none', 'glow', 'shine', 'rainbow', 'neon', 'fire', 'pulse', 'wave', 'shadow3d', 'glitch'];

// Lớp hiệu ứng bọc icon. Vẽ 1 lần theo kiểu đã chọn (đặt cạnh icon trong .gm-iconbox).
function fxMarkup(kind) {
  switch (kind) {
    case 'bubble': return '<span class="gm-fx bubble"><i class="gm-hi"></i><i class="gm-hi2"></i></span>';
    case 'ring': return '<span class="gm-fx ring"></span>';
    case 'glow': return '<span class="gm-fx glow"></span>';
    case 'orbit': return '<span class="gm-fx orbit"><i></i><i></i><i></i></span>';
    case 'ripple': return '<span class="gm-fx ripple"><i></i><i></i><i></i></span>';
    case 'sparkle': return '<span class="gm-fx sparkle"><i></i><i></i><i></i><i></i><i></i><i></i></span>';
    case 'neon': return '<span class="gm-fx neon"></span>';
    case 'rays': return '<span class="gm-fx rays"></span>';
    default: return '';
  }
}

// Nội dung chữ: bọc trong track (để marquee), span mang data-text (glitch), tách chữ khi 'wave'.
// Xuống dòng thủ công (gõ Enter ở ô nội dung) → <br> để hiển thị nhiều hàng.
function textInner(text, textFx) {
  const s = String(text || '');
  if (textFx === 'wave') {
    return [...s].map((ch, i) => {
      if (ch === '\n') return '<br>';
      if (ch === ' ') return '<i class="gm-sp">&nbsp;</i>';
      return `<i style="animation-delay:${(i * 0.06).toFixed(2)}s">${esc(ch)}</i>`;
    }).join('');
  }
  return esc(s).replace(/\n/g, '<br>');
}

function render(cfg) {
  cfg = cfg || {};
  const items = Array.isArray(cfg.items) ? cfg.items : [];

  root.style.setProperty('--scale', (Number(cfg.overlayScale) || 100) / 100);
  root.style.setProperty('--icon', (Number(cfg.iconSize) || 84) + 'px');
  root.style.setProperty('--text', (Number(cfg.textSize) || 34) + 'px');
  root.style.setProperty('--row-gap', (Number.isFinite(Number(cfg.rowGap)) ? Number(cfg.rowGap) : 16) + 'px');
  root.style.setProperty('--gap', (Number.isFinite(Number(cfg.gap)) ? Number(cfg.gap) : 18) + 'px');
  root.style.setProperty('--tcolor', validColor(cfg.textColor, '#ffe14d'));
  root.style.setProperty('--mq-width', (Number(cfg.marqueeWidth) || 360) + 'px');
  const op = Number.isFinite(Number(cfg.bgOpacity)) ? Number(cfg.bgOpacity) : 0;
  root.style.setProperty('--gm-bg', `rgba(${hexToRgb(cfg.bg || '#000000')}, ${Math.max(0, Math.min(100, op)) / 100})`);

  root.dataset.align = cfg.align === 'center' ? 'center' : 'left';
  root.dataset.panel = ['none', 'rows', 'full'].includes(cfg.panel) ? cfg.panel : 'none';
  const iconFx = ICON_FX.includes(cfg.iconFx) ? cfg.iconFx : 'bubble';
  root.dataset.iconFx = iconFx;
  root.dataset.iconAnim = ICON_ANIM.includes(cfg.iconAnim) ? cfg.iconAnim : 'float';
  root.dataset.textFx = TEXT_FX.includes(cfg.textFx) ? cfg.textFx : 'none';
  root.dataset.stroke = cfg.textStroke === false ? '0' : '1';
  root.dataset.bold = cfg.bold === false ? '0' : '1';
  // Chữ dài: BẬT 'scroll' = chạy ngang (marquee) trong khung; TẮT = hiển thị đúng nội dung đã nhập
  // (gõ Enter xuống dòng bao nhiêu hàng ra bấy nhiêu). Tương thích ngược cấu hình cũ (cờ marquee / 'wrap').
  const scroll = cfg.longText === 'scroll' || (cfg.longText == null && cfg.marquee !== false);
  const speed = Math.max(1, Math.min(10, Math.round(Number(cfg.speed) || 5)));
  // "Khung chữ theo số ký tự" (chỉ khi CHẠY): >0 → mọi dòng cùng cỡ khung rộng chừng đó ký tự; chữ
  // dài chạy TRONG khung. =0 → dùng bề rộng pixel.
  const maxChars = Math.max(0, Math.round(Number(cfg.maxChars) || 0));
  const fixed = scroll && maxChars > 0;
  root.dataset.frame = scroll ? '1' : '0';
  root.dataset.fixed = fixed ? '1' : '0';
  root.style.setProperty('--mq-chars', maxChars || 10);
  const textFx = root.dataset.textFx;

  const fx = fxMarkup(iconFx);
  const title = (cfg.showTitle && cfg.title) ? `<div class="gm-title">${esc(cfg.title)}</div>` : '';

  let html = title + '<div class="gm-list">';
  for (const it of items) {
    if (!it) continue;
    const icon = it.icon
      ? `<img class="gm-icon" src="${esc(mediaUrl(it.icon))}" onerror="avRetry(this)" />`
      : '<div class="gm-icon ph">🎁</div>';
    const col = validColor(it.color, '');
    const tStyle = col ? ` style="color:${col}"` : '';
    const rowBg = validColor(it.bg, '');
    const rowCls = rowBg ? ' has-bg' : '';
    const rowStyle = rowBg ? ` style="--gm-row-bg:${rowBg}"` : '';
    html += `<div class="gm-row${rowCls}"${rowStyle}>`
      + `<div class="gm-iconbox"><div class="gm-iconwrap">${icon}</div>${fx}</div>`
      + `<div class="gm-textbox"><div class="gm-text"${tStyle}><div class="gm-track">`
      + `<span class="gm-txt" data-text="${esc(it.text || '')}">${textInner(it.text, textFx)}</span>`
      + `</div></div></div>`
      + `</div>`;
  }
  html += '</div>';
  if (!items.length && document.body.classList.contains('overlay-review')) {
    html = title + '<div class="gm-empty">Chưa có mục nào — thêm quà ở tab 🥚 Đập Trứng ▸ Menu Quà</div>';
  }
  root.innerHTML = html;

  // Marquee (chỉ khi chọn "Chạy ngang"): CHỈ khi chữ RỘNG HƠN khung mới chạy (nhân đôi nội dung →
  // lặp liền mạch, vô hạn). Tốc độ = px/giây theo thanh "Tốc độ chạy" (1..10 → 18..180 px/s).
  if (scroll) {
    const pxPerSec = speed * 18;
    root.querySelectorAll('.gm-textbox').forEach(box => {
      const track = box.querySelector('.gm-track');
      const span = track && track.firstElementChild;
      if (!span) return;
      const overflow = span.scrollWidth > box.clientWidth + 2;
      if (!overflow) return;
      box.classList.add('scroll');
      const gap = Math.round((Number(cfg.iconSize) || 84) * 0.7);
      const clone = span.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
      const dist = span.scrollWidth + gap;
      track.style.setProperty('--mq-gap', gap + 'px');
      track.style.setProperty('--mq-dist', dist + 'px');
      track.style.setProperty('--mq-dur', Math.max(2, dist / pxPerSec).toFixed(1) + 's');
    });
  }
}

// Chỉ vẽ lại khi DỮ LIỆU thật sự đổi: render() dựng lại innerHTML nên mỗi lần gọi là restart hết
// animation icon/marquee. Poll + SSE cùng bắn state giống nhau → phải chặn ở đây kẻo giật liên tục.
let lastPayload = '';
function applyState(state) {
  const s = JSON.stringify(state || {});
  if (s === lastPayload) return;
  lastPayload = s;
  render(state);
}

render({});
// Lấy state ngay bằng HTTP + poll nhẹ (giống Vòng quay / Vinh danh): một số bản OBS CEF mở trang
// nhưng EventSource nằm im không đẩy event vào JS → nếu chỉ dựa vào SSE thì overlay trống trơn cho
// tới khi người dùng chỉnh sửa cấu hình. Poll bảo đảm LUÔN nhận và bám realtime.
function pullState() {
  fetch(`/gift-menu-state?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
    .then(res => (res.ok ? res.json() : null))
    .then(state => { if (state) applyState(state); })
    .catch(() => {});
}
pullState();
setInterval(pullState, 2500);
connectSSE(`/gift-menu-events?token=${encodeURIComponent(token)}`, 'giftmenu', applyState);
