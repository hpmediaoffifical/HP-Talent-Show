// NHIỆM VỤ · TÁP TIM — bức tường thả tim (点赞墙 Douyin).
// BXH người xem táp tim nhiều nhất: topN ô, mỗi ô avatar + tên (chạy chữ) + thanh máu (top = 100%).
// Thanh máu TỔNG = tổng tim cả phòng / mục tiêu. Ticker = người vừa táp + combo.
// Popup DANH HIỆU (点赞萌新) bung 2-3s khi 1 người vượt mốc tim tích luỹ — quản lý TÁCH khỏi render
// (không bị SSE dựng lại DOM làm mất). OBS-safe: gradient trộn sẵn ra rgba (CEF cũ không có color-mix).
const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
if (params.get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = params.get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}
const stage = document.getElementById('lwStage');
const card = document.getElementById('lwCard');
const toastLayer = document.getElementById('lwToast');
let _toastLayoutKey = '';
let _toastPositionQueued = false;

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('vi-VN'); }
function num(v, dv) { return Number.isFinite(+v) ? +v : dv; }

// ---- Màu (OBS CEF cũ không hỗ trợ color-mix → tự trộn ra rgba) ----
function _hx(h) { h = String(h || '').trim(); const m3 = h.match(/^#([0-9a-f]{3})$/i); if (m3) h = '#' + m3[1].split('').map(c => c + c).join(''); const m = h.match(/^#([0-9a-f]{6})$/i); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgba(hex, a) { const c = _hx(hex); return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : hex; }
// Thanh máu "vệt sao băng": đuôi mờ (trái) → mép tiến đậm nhất (phải).
function fillGradient(c1, c2) {
  return `linear-gradient(90deg, ${rgba(c2, .28)} 0%, ${rgba(c2, .7)} 34%, ${c2} 62%, ${c1} 100%)`;
}

// ---- Avatar qua proxy (giống ranking): thử lại vài lần trước khi rơi về logo ----
function mediaUrl(value, key = '') {
  const s = String(value || '').trim();
  if (!s || /logo[\\/]hp-logo\.(png|ico)$/i.test(s)) return '/logo.png';
  if (/^[a-f0-9]{40}$/i.test(key)) return `/avatar?key=${encodeURIComponent(key)}`;
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
function avatarImg(url, key) {
  return `<img src="${esc(mediaUrl(url, key))}" alt="" onerror="avRetry(this)" />`;
}

// ---- Tên/tiêu đề chạy chữ theo SỐ KÝ TỰ (tất định, không đo px — OBS trả scrollWidth chập chờn) ----
function marqueeHtml(text, cls, maxChars) {
  const t = String(text || '');
  const safe = esc(t);
  if ([...t].length <= maxChars) return `<div class="${cls}" title="${safe}"><span>${safe}</span></div>`;
  const seg = `<i>${safe}</i>`;
  return `<div class="${cls} long" title="${safe}"><span>${seg}${seg}</span></div>`;
}
const MARQUEE_DUR_MS = 7000;
function syncMarquee() {
  const delay = '-' + ((Date.now() % MARQUEE_DUR_MS) / 1000).toFixed(2) + 's';
  stage.querySelectorAll('.lw-name.long span, .lw-title.long span').forEach(el => { el.style.animationDelay = delay; });
}

// Vương miện TOP 1/2/3 (SVG, màu theo hạng qua --crown-c ở CSS).
function crownSvg() {
  return `<svg class="lw-crown" viewBox="0 0 24 20" aria-hidden="true">`
    + `<path class="lw-crown-body" d="M2.6 7.2l3.6 3.8L12 3.3l5.8 7.7 3.6-3.8-1.5 9.7H4.1L2.6 7.2z"/>`
    + `<circle class="lw-crown-gem" cx="12" cy="3.3" r="1.6"/>`
    + `<circle class="lw-crown-gem" cx="2.6" cy="7.2" r="1.3"/>`
    + `<circle class="lw-crown-gem" cx="21.4" cy="7.2" r="1.3"/></svg>`;
}

// Một ô người xem (hoặc ô trống nếu chưa đủ người). frameFile != '' → lồng khung VIP (thay deco CSS).
function cellHtml(row, rank, nameMax, frameFile) {
  const filled = !!row;
  const avInner = filled ? avatarImg(row.avatar, row.avatarKey) : '<span class="lw-avatar-ph"></span>';
  let avatarWrap;
  if (frameFile) {
    // Khung VIP: khung đè (z-trên, tâm trong suốt), avatar tròn căn giữa (z-dưới) — như MVP Honor.
    avatarWrap = `<div class="lw-avatar-wrap has-frame"><div class="lw-avatar">${avInner}</div><img class="lw-frame" src="/mvp-frames/${esc(frameFile)}" alt="" onerror="this.style.display='none'" /></div>`;
  } else {
    const deco = rank <= 3 ? crownSvg() + `<span class="lw-rank-no">${rank}</span>` : (rank <= 5 ? '<span class="lw-ring-badge"></span>' : (rank === 6 ? '<span class="lw-red-dot"></span>' : ''));
    avatarWrap = `<div class="lw-avatar-wrap">${deco}<div class="lw-avatar">${avInner}</div></div>`;
  }
  const name = filled ? marqueeHtml(row.name || 'Người xem', 'lw-name', nameMax) : '<div class="lw-name lw-name-empty"><span>Chờ tim…</span></div>';
  const pct = filled ? Math.max(0, Math.min(100, Number(row.pct) || 0)) : 0;
  const count = filled ? fmt(row.count) : '0';
  const identity = JSON.stringify([filled, row && row.name, row && row.avatar, row && row.avatarKey, nameMax, frameFile]);
  return `<div class="lw-cell lw-r${rank} ${filled ? '' : 'lw-empty'}${(rank <= 3 || frameFile) ? ' lw-podium' : ''}${frameFile ? ' lw-framed' : ''}" data-lw-identity="${esc(identity)}">
    ${avatarWrap}
    ${name}
    <div class="lw-bar">
      <div class="lw-fill" style="width:${pct}%"><span class="lw-stripes"></span></div>
      <div class="lw-bar-val">${count}</div>
    </div>
  </div>`;
}

function setWidth(el, pct) {
  const width = `${pct}%`;
  if (el && el.style.width !== width) el.style.width = width;
}

// Popup bám vào tâm thực tế của lưới: đổi 9 ô sang 6 ô vẫn nằm giữa danh sách,
// thay vì giữ một vị trí cố định rồi đè lệch sang thanh KPI.
function syncToastPosition() {
  if (_toastPositionQueued) return;
  _toastPositionQueued = true;
  requestAnimationFrame(() => {
    _toastPositionQueued = false;
    const grid = card.querySelector('.lw-grid');
    if (!grid) return;
    toastLayer.style.top = `${grid.offsetTop + grid.offsetHeight / 2}px`;
    toastLayer.style.setProperty('--lw-toast-max-height', `${Math.max(78, grid.offsetHeight - 14)}px`);
  });
}

// Khung avatar có thể tải trễ một nhịp; căn lại sau khi kích thước khung đã ổn định.
stage.addEventListener('load', (event) => {
  if (event.target.classList && event.target.classList.contains('lw-frame')) syncToastPosition();
}, true);

function updateTicker(ticker) {
  const host = card.querySelector('.lw-ticker-host');
  if (!host) return;
  if (!ticker) { host.textContent = ''; return; }

  let el = host.firstElementChild;
  if (!el) {
    host.innerHTML = `<div class="lw-ticker">
      <div class="lw-ticker-av">${avatarImg(ticker.avatar, ticker.avatarKey)}</div>
      <div class="lw-ticker-name"></div>
      <div class="lw-ticker-combo"><svg viewBox="0 0 24 24" class="lw-thumb" aria-hidden="true"><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3zm3 0 4-7a2 2 0 0 1 2 2v4h4a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 20.7 21H10z"/></svg><b></b></div>
    </div>`;
    el = host.firstElementChild;
  }
  const img = el.querySelector('.lw-ticker-av img');
  const avatar = mediaUrl(ticker.avatar, ticker.avatarKey);
  if (img && img.getAttribute('src') !== avatar) img.src = avatar;
  el.querySelector('.lw-ticker-name').textContent = ticker.nickname || 'Người xem';
  el.querySelector('.lw-ticker-combo b').textContent = `+${fmt(ticker.combo || 1)}`;
}

function render(state = {}) {
  const rows = Array.isArray(state.rows) ? state.rows : [];
  const topN = Math.max(1, Math.min(12, Number(state.topN) || 9));
  const nameMax = Math.max(3, Math.min(40, Number(state.nameMaxChars) || 6));
  const c1 = state.barColor1 || '#ff2e4d';
  const c2 = state.barColor2 || '#ff8a9a';
  const target = Math.max(1, Number(state.target) || 1);
  const total = Math.max(0, Number(state.total) || 0);
  const totalPct = Math.max(0, Math.min(100, (total / target) * 100));
  // Khung VIP TOP 1-5 (từ /mvp-frames). Chỉ nhận tên file an toàn.
  const framesEnabled = state.framesEnabled !== false;
  const framesMap = (state.frames && typeof state.frames === 'object') ? state.frames : {};
  const frameOf = (rank) => {
    if (!framesEnabled) return '';
    const f = String(framesMap[rank] || '').trim();
    return /^[\w.-]+\.(png|apng)$/i.test(f) ? f : '';
  };

  // Scale NHỚ qua localStorage: OBS mở/reload/khi app vừa lên (state đầu có thể chưa tới) vẫn TO ngay
  // theo lần chỉnh gần nhất, không bị nhỏ lại rồi mới to khi bấm Bắt đầu (giống ranking-overlay).
  const rawScale = parseInt(state.overlayScale, 10);
  if (Number.isFinite(rawScale)) { try { localStorage.setItem('lwallScale', rawScale); } catch {} }
  const useScale = Number.isFinite(rawScale) ? rawScale : (parseInt(localStorage.getItem('lwallScale'), 10) || 200);
  stage.style.setProperty('--lw-scale', Math.max(0.5, Math.min(3, useScale / 100)));
  card.style.setProperty('--lw-fs', Math.max(1.2, Math.min(2.4, num(state.frameScale, 172) / 100)));
  card.style.setProperty('--lw-fill', fillGradient(c1, c2));
  card.style.setProperty('--lw-run', c1);
  card.style.setProperty('--lw-card-bg', rgba(state.cardBgColor || '#3a3d46', num(state.cardBgOpacity, .62)));
  card.style.setProperty('--lw-cell-bg', rgba(state.cellBgColor || '#000000', num(state.cellBgOpacity, .30)));
  card.style.setProperty('--lw-title-color', state.titleColor || '#ffffff');

  const title = state.title || 'BỨC TƯỜNG THẢ TIM';
  const isNewLayout = card.dataset.lwTopN !== String(topN);
  if (isNewLayout) {
    const cells = [];
    for (let r = 1; r <= topN; r++) cells.push(cellHtml(rows[r - 1] || null, r, nameMax, frameOf(r)));
    card.dataset.lwTopN = String(topN);
    card.dataset.lwTitle = title;
    card.innerHTML = `
      ${marqueeHtml(title, 'lw-title', 18)}
      <div class="lw-grid">${cells.join('')}</div>
      <div class="lw-total">
        <div class="lw-total-bar">
          <div class="lw-total-fill" style="width:${totalPct}%"><span class="lw-stripes"></span></div>
          <div class="lw-total-val"><b>${fmt(total)}</b><span>/${fmt(target)}</span></div>
        </div>
      </div>
      <div class="lw-ticker-host"></div>`;
    syncMarquee();
  } else {
    if (card.dataset.lwTitle !== title) {
      card.dataset.lwTitle = title;
      card.querySelector('.lw-title').outerHTML = marqueeHtml(title, 'lw-title', 18);
      syncMarquee();
    }
    const grid = card.querySelector('.lw-grid');
    for (let r = 1; r <= topN; r++) {
      const row = rows[r - 1] || null;
      const frameFile = frameOf(r);
      const identity = JSON.stringify([!!row, row && row.name, row && row.avatar, row && row.avatarKey, nameMax, frameFile]);
      let cell = grid.children[r - 1];
      if (cell.dataset.lwIdentity !== identity) {
        cell.outerHTML = cellHtml(row, r, nameMax, frameFile);
        cell = grid.children[r - 1];
      }
      const pct = row ? Math.max(0, Math.min(100, Number(row.pct) || 0)) : 0;
      setWidth(cell.querySelector('.lw-fill'), pct);
      cell.querySelector('.lw-bar-val').textContent = row ? fmt(row.count) : '0';
    }
    setWidth(card.querySelector('.lw-total-fill'), totalPct);
    const totalValue = card.querySelector('.lw-total-val');
    totalValue.querySelector('b').textContent = fmt(total);
    totalValue.querySelector('span').textContent = `/${fmt(target)}`;
  }
  const toastLayoutKey = [topN, num(state.frameScale, 172), framesEnabled, ...Array.from({ length: topN }, (_v, i) => frameOf(i + 1))].join('|');
  if (_toastLayoutKey !== toastLayoutKey) {
    _toastLayoutKey = toastLayoutKey;
    syncToastPosition();
  }
  updateTicker(state.ticker);
  updateToast(state);
}

// ---- Popup DANH HIỆU (点赞萌新) — hiện popupMs rồi tắt, không phụ thuộc render() ----
let _lastToastSeq = null;
let _toastTimer = null;
function updateToast(state) {
  const seq = Number(state.toastSeq) || 0;
  // Lần state ĐẦU (mở/reload OBS): chỉ ghi mốc, KHÔNG bung lại toast cũ.
  if (_lastToastSeq === null) { _lastToastSeq = seq; return; }
  const t = state.toast;
  if (!t || !state.popupEnabled || (Number(t.seq) || 0) <= _lastToastSeq) return;
  _lastToastSeq = Number(t.seq) || 0;
  const ms = Math.max(1200, Math.min(8000, Number(state.popupMs) || 2600));
  toastLayer.innerHTML = `<div class="lw-toast">
    <div class="lw-toast-emblem"><svg viewBox="0 0 24 24" class="lw-thumb" aria-hidden="true"><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3zm3 0 4-7a2 2 0 0 1 2 2v4h4a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 20.7 21H10z"/></svg></div>
    <div class="lw-toast-body">
      <div class="lw-toast-badge"><span class="lw-toast-title">${esc(t.name || 'Tân binh')}</span><span class="lw-toast-x">X${Math.max(1, Number(t.tierNo) || 1)}</span></div>
      <div class="lw-toast-user"><span class="lw-toast-av">${avatarImg(t.avatar, t.avatarKey)}</span><span class="lw-toast-nick">${esc(t.nickname || 'Người xem')}</span></div>
      <div class="lw-toast-desc">Đã thả tích luỹ ${fmt(t.count || t.at || 0)} tim</div>
    </div>
  </div>`;
  const el = toastLayer.firstElementChild;
  requestAnimationFrame(() => el && el.classList.add('show'));
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    if (el) { el.classList.remove('show'); el.classList.add('hide'); }
    setTimeout(() => { toastLayer.innerHTML = ''; }, 420);
  }, ms);
}

render({});
// SSE tự hồi phục (overlay-sse.js) → overlay tự lên lại khi stream rớt/kẹt, không cần Ctrl+R.
connectSSE(`/like-wall-events?token=${encodeURIComponent(token)}`, 'likewall', render, { visKey: 'likewall' });
