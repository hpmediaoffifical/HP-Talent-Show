// NHIỆM VỤ · BỘ BA — overlay 3 thanh KPI (người tặng / tim / điểm).
// HAI overlay TÁCH RỜI dùng chung file này, phân biệt bằng ?mode=vertical|horizontal:
//   - Dọc: xếp chồng, số căn TRÁI trong thanh (như ảnh 1).
//   - Ngang: 3 ô tách rời, số căn GIỮA thanh cho cân đối (như ảnh 2).
// Thông số hình học (bề rộng ô, khoảng cách, cỡ chữ, scale) LƯU RIÊNG theo từng bố cục.
// Mỗi thanh: viền trắng, ruột trong suốt, fill hồng "vệt sao băng" (đầu mờ → mép tiến đậm).
const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
const MODE = params.get('mode') === 'horizontal' ? 'horizontal' : 'vertical';
if (params.get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = params.get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}
const root = document.getElementById('mtRoot');

const KPI_ORDER = ['donors', 'likes', 'points'];
const KPI_DEFAULT_LABEL = { donors: 'Người tặng', likes: 'Số tim', points: 'Số điểm' };

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('vi-VN'); }
function num(v, dv) { return Number.isFinite(+v) ? +v : dv; }

// OBS-safe: CEF cũ trong OBS KHÔNG hỗ trợ color-mix() → thanh fill (chứa var()) sẽ mất nền (trong suốt).
// Tự trộn màu bằng JS ra rgba() để chạy mọi phiên bản CEF của OBS.
function _hx(h) { h = String(h || '').trim(); const m3 = h.match(/^#([0-9a-f]{3})$/i); if (m3) h = '#' + m3[1].split('').map(c => c + c).join(''); const m = h.match(/^#([0-9a-f]{6})$/i); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function alphaHex(hex, a) { const c = _hx(hex); return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : hex; }
// Fill gradient: đuôi (điểm gốc bên trái) mờ trong suốt → đầu (mép đang tiến) đậm nhất.
function fillGradient(c1, c2) {
  return `linear-gradient(90deg,`
    + ` ${alphaHex(c2, .16)} 0%,`
    + ` ${alphaHex(c2, .58)} 26%,`
    + ` ${c2} 56%,`
    + ` ${c1} 100%)`;
}

function render(state = {}) {
  const items = state.items || {};
  const values = state.values || {};
  const order = (Array.isArray(state.order) && state.order.length ? state.order : KPI_ORDER).filter(k => items[k]);
  const geo = (MODE === 'horizontal' ? state.horizontal : state.vertical) || {};
  const c1 = state.barColor1 || '#ff2f87';
  const c2 = state.barColor2 || '#ff8ed1';

  const shown = order.filter(k => items[k] && items[k].enabled !== false);
  const doneCount = shown.filter(k => (Number(values[k]) || 0) >= Math.max(1, Number(items[k].target) || 1)).length;
  const allDone = shown.length > 0 && doneCount === shown.length;

  root.className = `mt-wrap mt-${MODE}${allDone ? ' mt-all-done' : ''}`;
  root.style.setProperty('--mt-scale', Math.max(0.5, Math.min(3, num(geo.overlayScale, 200) / 100)));
  root.style.setProperty('--mt-gap', `${Math.max(0, num(geo.gap, MODE === 'horizontal' ? 150 : 14))}px`);
  root.style.setProperty('--mt-box-w', `${Math.max(120, num(geo.boxWidth, MODE === 'horizontal' ? 180 : 300))}px`);
  root.style.setProperty('--mt-title-size', `${Math.max(10, num(geo.titleFontSize, MODE === 'horizontal' ? 25 : 30))}px`);
  root.style.setProperty('--mt-value-size', `${Math.max(10, num(geo.valueFontSize, MODE === 'horizontal' ? 20 : 35))}px`);
  root.style.setProperty('--mt-fill', fillGradient(c1, c2));
  root.style.setProperty('--mt-run', c1);
  root.style.setProperty('--mt-border-alpha', String(Math.max(0.05, Math.min(1, num(state.borderAlpha, 0.55)))));
  // Đồng hồ chung (âm) neo mọi animation theo giờ tuyệt đối → render dựng lại innerHTML KHÔNG làm
  // viền chạy / sheen / nhấp nháy bị nhảy về đầu (không giật khi số KPI tăng). Mỗi chu kỳ 1 đồng hồ riêng.
  const clock = (period) => `${(-(Date.now() % period) / 1000).toFixed(3)}s`;
  root.style.setProperty('--mt-clock', clock(900));       // nhấp nháy đồng bộ (0.9s)
  root.style.setProperty('--mt-run-clock', clock(1400));  // viền chạy quanh (1.4s)
  root.style.setProperty('--mt-flow-clock', clock(1000)); // gợn sáng chảy (1s)

  root.innerHTML = shown.map(k => {
    const it = items[k] || {};
    const label = it.label || KPI_DEFAULT_LABEL[k] || k;
    const target = Math.max(1, Number(it.target) || 1);
    const val = Math.max(0, Number(values[k]) || 0);
    const pct = Math.max(0, Math.min(100, (val / target) * 100));
    const done = val >= target;
    return `<div class="mt-item${done ? ' mt-done' : ''}">
      <div class="mt-title">${esc(label)}</div>
      <div class="mt-bar" style="--mt-pct:${pct}%">
        <div class="mt-fill" style="width:${pct}%"></div>
        <div class="mt-val"><b>${fmt(val)}</b><span>/${fmt(target)}</span></div>
      </div>
    </div>`;
  }).join('') || '<div class="mt-empty"></div>';
}

render({});
// SSE tự hồi phục (overlay-sse.js) → overlay tự lên lại khi stream rớt/kẹt, không cần Ctrl+R.
connectSSE(`/mission-trio-events?token=${encodeURIComponent(token)}`, 'missiontrio', render);
