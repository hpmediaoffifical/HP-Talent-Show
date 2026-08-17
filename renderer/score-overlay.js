// Score overlay — port từ BIGO với state machine + theme presets + top users + runner
const token = new URLSearchParams(location.search).get('token') || '';
// Overlay TÁCH KIỂU: ?layout=bar|card ép cứng 1 phong cách (bỏ qua cardLayout của state) → cho phép
// dùng 2 nguồn OBS riêng (ĐƯỜNG ĐUA / KÊU GỌI), mỗi cái 1 con mắt bật/tắt + đặt vị trí độc lập,
// nên chuyển qua lại KHÔNG còn lệch chiều cao. Không có param = giữ hành vi cũ (theo dropdown).
const forcedLayout = (new URLSearchParams(location.search).get('layout') || '').toLowerCase();
if (new URLSearchParams(location.search).get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = new URLSearchParams(location.search).get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}
const root = document.getElementById('scoreRoot');
const audio = document.getElementById('scoreSound');

let lastStatus = '';
let lastRunKey = '';
let playedWarning = false;
let playedGoal = false;
let playedX2 = false;
const FAILED_STATUS_TEXTS = [
  { icon: '😵', text: 'KHÔNG HOÀN THÀNH' },
  { icon: '😜', text: 'ĐỒ CON GÀ' },
  { icon: '😅', text: 'IDOL CÙI BẮP' },
  { icon: '😝', text: 'BÁI BÁI NHÉ' },
  { icon: '😛', text: 'LÊU LÊU LÊU' },
  { icon: '😭', text: 'SUÝT NỮA RỒI' },
  { icon: '🥲', text: 'QUÀ ĐI LẠC RỒI' },
  { icon: '😏', text: 'HẸN KÈO SAU' },
  { icon: '😤', text: 'LẦN SAU PHỤC THÙ' },
];
let failedStatusText = FAILED_STATUS_TEXTS[0];

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('vi-VN'); }
// OBS-safe: CEF cũ trong OBS KHÔNG hỗ trợ color-mix() → thanh fill (chứa var()) sẽ mất nền (trong suốt).
// Tự trộn màu bằng JS ra rgba()/rgb() để chạy mọi phiên bản CEF của OBS.
function _hx(h) { h = String(h || '').trim(); const m3 = h.match(/^#([0-9a-f]{3})$/i); if (m3) h = '#' + m3[1].split('').map(c => c + c).join(''); const m = h.match(/^#([0-9a-f]{6})$/i); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function alphaHex(hex, a) { const c = _hx(hex); return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : hex; }
function mixHex(hex, other, pct) { const a = _hx(hex), b = _hx(other); if (!a || !b) return hex; const t = Math.max(0, Math.min(1, pct / 100)); const c = a.map((v, i) => Math.round(v + (b[i] - v) * t)); return `rgb(${c[0]},${c[1]},${c[2]})`; }
// Trộn màu RA rgba() (kèm alpha) — dùng cho "đường ray" bán trong suốt kiểu Douyin (thấy nền video qua phần chưa đầy).
function mixHexA(hex, other, pct, a) { const A = _hx(hex), B = _hx(other); if (!A || !B) return hex; const t = Math.max(0, Math.min(1, pct / 100)); const c = A.map((v, i) => Math.round(v + (B[i] - v) * t)); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
function shortText(s, max = 28) {
  const text = String(s || '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
function mediaUrl(url) {
  const s = String(url || '').trim();
  if (!s || s === '../logo/hp-logo.png' || /logo\/hp-logo\.(png|ico)$/i.test(s)) return '/logo.png';
  if (/^https?:\/\//i.test(s)) return `/avatar?url=${encodeURIComponent(s)}`;
  return s;
}

function scoreStatusText(status, timeText) {
  if (status === 'prestart') return timeText || 'CHUẨN BỊ';
  if (status === 'grace') return 'ĐANG TÍNH ĐIỂM';
  if (status === 'success') return 'THÀNH CÔNG';
  if (status === 'failed') return `${failedStatusText.icon} ${failedStatusText.text}`;
  return timeText || '03:00';
}

// THỜI GIAN (timer): nhãn giai đoạn ở GIỮA — dịch từ 冲刺中 (Douyin). Chữ ngắn để không lấn cột.
function timerPhaseText(status, urgent) {
  if (status === 'prestart') return 'CHUẨN BỊ';
  if (status === 'grace') return 'ĐỢI CHỐT ĐIỂM'; // delay chốt điểm: bỏ chip đồng hồ, báo chữ ở dưới
  if (status === 'success' || status === 'failed') return ''; // hết giờ: đã có card HẾT GIỜ + số điểm → khỏi lặp
  if (status === 'running') return urgent ? 'NƯỚC RÚT' : 'ĐANG NƯỚC RÚT';
  return 'CHỜ BẮT ĐẦU';
}
// THỜI GIAN: chip đồng hồ chỉ hiện MM:SS (ngắn), tránh chữ dài "THÀNH CÔNG/KHÔNG HOÀN THÀNH" tràn pill.
function timerClockText(status, timeText) {
  if (status === 'prestart') return 'SẴN SÀNG';
  if (status === 'success' || status === 'failed') return '00:00';
  return timeText || '00:00';
}

// Màu thanh biến đổi theo % tiến độ — hành trình sắc màu tím → lam → lục → vàng,
// không hiện số %, tạo cảm giác "ảo diệu" khi thanh đầy dần.
function progressFillGradient(pct) {
  const t = Math.max(0, Math.min(1, pct / 100));
  const hue = 280 - 250 * t;            // 0% tím → 100% vàng-cam
  const head = `hsl(${(hue - 14).toFixed(0)}, 92%, 55%)`;  // mép đang tiến: đậm nhất
  const mid  = `hsl(${hue.toFixed(0)}, 90%, 61%)`;
  const tailH = (hue + 16).toFixed(0);                     // đuôi: nhạt, hơi lệch tông (hsla trực tiếp, không color-mix)
  return `linear-gradient(90deg,`
    + ` hsla(${tailH}, 88%, 67%, .26) 0%,`
    + ` hsla(${tailH}, 88%, 67%, .70) 22%,`
    + ` ${mid} 52%,`
    + ` ${head} 100%)`;
}

function playSound(soundUrl) {
  if (!soundUrl) return;
  audio.src = soundUrl;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function runKey(state) {
  return String(state.runStartedAt || state.prestartUntil || 'idle');
}

// Cấu trúc DOM chỉ dựng lại khi "khung xương" đổi (trạng thái, có/không: quà chạy, +Over, nội dung…).
// Mỗi tick 250ms chỉ cập nhật CHỮ/CHIỀU RỘNG tại chỗ → animation không bị restart → hết nhấp nháy 1 chỗ.
let lastStructKey = '';
let lastClassName = '';
let lastAddSig = '';
let lastGoalMet = false;
let lastRenderedScore = 0;
let lastTop5Sig = '';
let lastTop1Id = '';        // THỜI GIAN #2: theo dõi TOP1 để phát hiện đổi ngôi
let lastResultKey = '';     // THỜI GIAN #5: chốt điểm hoành tráng chỉ bắn 1 lần/phiên
let lastTickSec = -1;       // THỜI GIAN #4: tiếng "tick" 10s cuối, mỗi giây 1 lần

// 🖼️ KHUNG avatar (KÊU GỌI) — dùng chung bộ khung của 🏅 Vinh danh (mvp-frames/1..41.png, cùng tỷ lệ 1.25).
// state.cardFrame:  '' = 🎲 NGẪU NHIÊN (bốc lại mỗi PHIÊN CHẠY MỚI theo runKey, giữ nguyên trong phiên để KHÔNG nháy
// khi dựng lại DOM) · 'none' = không khung · 'mvp-frames/N.png' = khung CỐ ĐỊNH do người dùng chọn trong Cài đặt.
const CARD_FRAME_COUNT = 41;
function pickCardFrame() { return `/mvp-frames/${1 + Math.floor(Math.random() * CARD_FRAME_COUNT)}.png`; }
let cardFrameSrc = pickCardFrame();
// Khung thực sự vẽ ra: ưu tiên lựa chọn cố định, rơi về khung ngẫu nhiên của phiên. '' = không vẽ khung.
function resolveCardFrame(state) {
  const want = String(state?.cardFrame || '').trim();
  if (want === 'none') return '';
  if (!want) return cardFrameSrc;
  return want.startsWith('/') ? want : `/${want}`;
}

// Tiếng "tick" 10s cuối bằng WebAudio (không cần file). secLeft ≤ 3 kêu gấp/cao hơn.
let _actx = null;
function playTick(urgentHigh) {
  try {
    _actx = _actx || new (window.AudioContext || window.webkitAudioContext)();
    if (_actx.state === 'suspended') _actx.resume();
    const t = _actx.currentTime;
    const o = _actx.createOscillator();
    const g = _actx.createGain();
    o.type = 'square';
    o.frequency.value = urgentHigh ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(urgentHigh ? 0.14 : 0.09, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g).connect(_actx.destination);
    o.start(t);
    o.stop(t + 0.12);
  } catch {}
}
let els = {};
// Số trên huy hiệu "đếm cuộn" (roll-up) khi có cú tặng mới — mượt như Douyin thay vì nhảy cóc.
let badgeRollRaf = 0;
let badgeShownVal = 0;

// Cuộn số huy hiệu từ giá trị đang hiện → target. prefix gồm cả nickname (nếu bật) + dấu (+/x).
function rollBadge(prefix, target) {
  const el = els.popText;
  if (!el) return;
  const to = Math.max(0, Number(target) || 0);
  const from = badgeShownVal;
  if (badgeRollRaf) { cancelAnimationFrame(badgeRollRaf); badgeRollRaf = 0; }
  if (from === to) { el.textContent = `${prefix}${fmt(to)}`; badgeShownVal = to; return; }
  const t0 = Date.now();
  const dur = 360;
  const step = () => {
    const p = Math.min(1, (Date.now() - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = `${prefix}${fmt(Math.round(from + (to - from) * e))}`;
    if (p < 1) { badgeRollRaf = requestAnimationFrame(step); }
    else { badgeRollRaf = 0; badgeShownVal = to; }
  };
  badgeRollRaf = requestAnimationFrame(step);
}

// Khởi động lại 1 animation "một lần" bằng cách gỡ→ép reflow→gắn lại class → chạy đúng 1 lượt mỗi lần gọi.
function fireOnce(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// FX "'+N' bay lên": tạo 1 chip điểm bay lên rồi tự gỡ. Giới hạn số node để combo lớn không dồn ứ.
function spawnFloatPoint(text, big) {
  const host = els.floats;
  if (!host) return;
  if (host.childElementCount > 10) host.removeChild(host.firstElementChild);
  const chip = document.createElement('span');
  chip.className = `sc-float${big ? ' big' : ''}`;
  // Lệch ngang ngẫu nhiên nhẹ để combo toả ra như "mưa điểm", không đè lên nhau
  chip.style.setProperty('--fx', `${(Math.random() * 44 - 22).toFixed(0)}px`);
  chip.textContent = `+${text}`;
  chip.addEventListener('animationend', () => chip.remove(), { once: true });
  host.appendChild(chip);
}

// Nội dung bên trong thanh máu (dùng chung cho cả 2 bố cục — dải ngang & thẻ HUD).
// LƯU Ý: người chạy (.score-pop) KHÔNG nằm trong này — nó được gắn NGOÀI thanh (thanh có overflow:hidden
// sẽ cắt mất vòng tròn + huy hiệu nhô lên trên) qua runnerHTML() ở lớp bọc .score-barwrap / .sc-cardbar-wrap.
function barInnerHTML(v, showOver = true) {
  return `
      <div class="score-fill"><i class="score-liquid"></i></div>
      <div class="score-sheen"></div>
      <div class="score-comet"></div>
      <div class="score-speedlines"></div>
      <div class="score-flash"></div>
      <div class="score-ripple"></div>
      <div class="score-wave"></div>
      ${showOver && v.over > 0 ? `<div class="score-over">+Over: <span class="score-over-val"></span></div>` : ''}
      <div class="score-burst"></div>`;
}

// Người chạy kiểu Douyin: vòng tròn hồng + hình người TRẮNG chạy, đuôi bụi trắng bắn ra sau (chờ tăng tốc),
// huy hiệu "+N" phía trên (nền mờ trong suốt + viền hồng TikTok), và avatar người tặng khi quà lớn (>1000đ).
function runnerHTML() {
  return `<div class="score-pop">
      <span class="score-pop-badge"><img class="score-pop-gift" onerror="this.onerror=null;this.style.display='none'" alt="" /><span class="score-pop-text"></span><img class="score-pop-avatar" onerror="this.onerror=null;this.style.display='none'" alt="" /></span>
      <span class="score-pop-runner">
        <span class="score-pop-dash" aria-hidden="true"></span>
        <span class="score-pop-dust"><i></i><i></i><i></i><i></i><i></i></span>
        <svg class="score-pop-figure" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7z"/></svg>
      </span>
    </div>`;
}

function buildStructure(state, v) {
  // 🌫️ Sương mù 10s cuối — che SỐ ĐIỂM (và thanh máu ở ĐƯỜNG ĐUA/KÊU GỌI). Kiểu THỜI GIAN chỉ che số,
  // GIỮ NGUYÊN thanh đồng hồ. Veil dựng cùng structure (structKey đã gồm fog) nên chỉ đổi khi bật/tắt.
  const fogVeil = v.fog && window.OverlayFog ? OverlayFog.veilHtml({ label: 'SƯƠNG MÙ' }) : '';
  const fogVeilPlain = v.fog && window.OverlayFog ? OverlayFog.veilHtml() : '';
  if (v.timerLayout) {
    // THỜI GIAN (Douyin): thanh THỜI GIAN đếm lùi + đồng hồ VÒNG xoay (1 vòng ≈ 1 giây) ở mút phải;
    // dưới thanh: avatar+tên idol (trái) · nhãn giai đoạn 冲刺中/ĐANG NƯỚC RÚT (giữa) · Điểm vòng (phải).
    root.innerHTML = `
    <div class="score-timer">
      <div class="st-barwrap">
        <div class="score-bar st-timebar">
          <div class="st-stripes" aria-hidden="true"></div>
          <div class="score-fill st-timefill"><i class="score-liquid"></i></div>
          <div class="score-flash"></div>
        </div>
        <div class="st-clock"><span class="st-clock-text"></span></div>
        <div class="st-dial" aria-hidden="true"><span class="st-dial-ticks"></span><span class="st-dial-hand"></span></div>
      </div>
      <div class="st-info">
        <div class="score-person">
          ${state.hideAvatar ? '' : `<div class="score-avatar"><img class="score-avatar-img" onerror="this.onerror=null;this.src='/logo.png'" /></div>`}
          ${state.hideCreator ? '' : `<div class="score-creator"></div>`}
        </div>
        <div class="st-phase"><span class="st-phase-text"></span></div>
        ${v.ended && v.showTop5
          ? '<div class="st-top5 st-top5-honor"></div>'
          : `<div class="st-points"><small class="st-points-label">ĐIỂM</small><b class="score-points-cur"></b><span class="st-momentum" aria-hidden="true"></span>${fogVeil}</div>`}
      </div>
      ${(!v.ended && v.showTop5) ? '<div class="st-top5"></div>' : ''}
      <div class="sc-fx-floats" aria-hidden="true"></div>
      <div class="st-result" aria-hidden="true"><div class="st-result-card"><span class="st-result-label"></span><b class="st-result-score"></b><span class="st-result-spark"></span></div></div>
    </div>
    `;
  } else if (v.cardLayout) {
    // Thẻ HUD góc GỌN: tab TÊN IDOL ở đỉnh · avatar TO giữa-trái · đồng hồ/trạng thái ở giữa · thanh máu ôm đáy
    root.innerHTML = `
    <div class="score-card">
      <div class="sc-fx-spotlight" aria-hidden="true"></div>
      <div class="sc-tab"><span class="sc-tab-text"></span></div>
      <div class="sc-card-mid">
        ${state.hideAvatar ? '' : `<div class="sc-fx-aura" aria-hidden="true"></div><div class="sc-card-avwrap"><div class="sc-card-avatar"><img class="score-avatar-img" onerror="this.onerror=null;this.src='/logo.png'" /></div>${v.frame ? `<img class="sc-card-frame" src="${v.frame}" alt="" aria-hidden="true" onerror="this.style.display='none'" />` : ''}</div>`}
        <div class="sc-card-clock"><span class="score-time-text sc-clock-text"></span></div>
        ${v.kpiX2 ? `<div class="sc-card-kpi2"><span class="score-points-x2"></span></div>` : ''}
      </div>
      <div class="sc-cardbar-wrap">
        <div class="score-bar sc-cardbar">${barInnerHTML(v, false)}</div>
        ${v.showRunner ? runnerHTML() : ''}
        <div class="sc-cardbar-labels${v.over > 0 ? ' has-over' : ''}">
          ${v.over > 0 ? `<span class="sc-card-over">+OVER <b class="score-over-val"></b></span>` : ''}
          <span class="sc-score-chip"><span class="sc-score-chip-val"></span></span>
          <span class="sc-target-label"><small>ĐIỂM</small><b class="sc-target-value"></b></span>
        </div>
        ${fogVeil}
      </div>
      <div class="sc-fx-floats" aria-hidden="true"></div>
    </div>
    ${v.showRemaining ? `<div class="score-remaining"><span class="score-remaining-text"></span></div>` : ''}
    `;
  } else {
    root.innerHTML = `
    <div class="score-barwrap"><div class="score-bar">${barInnerHTML(v)}${fogVeil}</div><div class="score-flag">⚑</div>${v.showRunner ? runnerHTML() : ''}</div>
    <div class="score-meta">
      <div class="score-person">
        ${state.hideAvatar ? '' : `<div class="score-avatar"><img class="score-avatar-img" onerror="this.onerror=null;this.src='/logo.png'" /></div>`}
        ${state.hideCreator ? '' : `<div class="score-creator"></div>`}
      </div>
      <div class="score-time"><i class="score-time-icon ${v.iconOff ? 'off' : 'clock'}" aria-hidden="true"></i><span class="score-time-text"></span></div>
      <div class="score-points">
        <span class="score-points-main"><b class="score-points-cur"></b><span class="score-points-rest"></span></span>
        ${v.kpiX2 ? `<span class="score-points-x2"></span>` : ''}
        ${fogVeilPlain}
      </div>
    </div>
    ${v.showRemaining ? `<div class="score-remaining"><span class="score-remaining-text"></span></div>` : ''}
    `;
  }
  els = {
    timeText: root.querySelector('.score-time-text'),
    tabText: root.querySelector('.sc-tab-text'),
    scoreChipVal: root.querySelector('.sc-score-chip-val'),
    targetLabel: root.querySelector('.sc-target-value'),
    bar: root.querySelector('.score-bar'),
    fill: root.querySelector('.score-fill'),
    sheen: root.querySelector('.score-sheen'),
    flash: root.querySelector('.score-flash'),
    ripple: root.querySelector('.score-ripple'),
    burst: root.querySelector('.score-burst'),
    overVal: root.querySelector('.score-over-val'),
    pop: root.querySelector('.score-pop'),
    popText: root.querySelector('.score-pop-text'),
    popAvatar: root.querySelector('.score-pop-avatar'),
    popGift: root.querySelector('.score-pop-gift'),
    popRunner: root.querySelector('.score-pop-runner'),
    avatarImg: root.querySelector('.score-avatar-img'),
    cardFrame: root.querySelector('.sc-card-frame'),
    creator: root.querySelector('.score-creator'),
    pointsMain: root.querySelector('.score-points-main'),
    pointsCur: root.querySelector('.score-points-cur'),
    pointsRest: root.querySelector('.score-points-rest'),
    pointsX2: root.querySelector('.score-points-x2'),
    remaining: root.querySelector('.score-remaining'),
    remainingText: root.querySelector('.score-remaining-text'),
    aura: root.querySelector('.sc-fx-aura'),
    floats: root.querySelector('.sc-fx-floats'),
    // THỜI GIAN: chip đồng hồ (cưỡi mép máu thời gian) + chữ đồng hồ + nhãn giai đoạn giữa
    timeChip: root.querySelector('.st-clock'),
    timerClock: root.querySelector('.st-clock-text'),
    phaseText: root.querySelector('.st-phase-text'),
    top5: root.querySelector('.st-top5'),
    momentum: root.querySelector('.st-momentum'),
    result: root.querySelector('.st-result'),
    resultScore: root.querySelector('.st-result-score'),
    resultLabel: root.querySelector('.st-result-label'),
  };
  // Con số điểm để "nhảy nảy" — thẻ KÊU GỌI dùng .sc-score-chip-val, ĐƯỜNG ĐUA chỉ nảy SỐ TĂNG bên trái
  // (.score-points-cur), giữ nguyên "/mục tiêu điểm" đứng yên.
  els.scoreNum = els.scoreChipVal || els.pointsCur;
  // DOM vừa dựng lại → huỷ roll đang chạy (element cũ đã tháo) để lượt sau set thẳng số vào element mới.
  if (badgeRollRaf) { cancelAnimationFrame(badgeRollRaf); badgeRollRaf = 0; }
  // .st-top5 vừa dựng lại là element RỖNG → ép nạp lại danh sách (khỏi bị trống khi chạy→kết thúc do sig không đổi).
  lastTop5Sig = '';
  // Sóng chảy đồng bộ theo đồng hồ toàn cục — chỉ đặt khi dựng lại (element mới) để không giật giữa chừng.
  root.style.setProperty('--score-flow-delay', `${(-(Date.now() % 1000) / 1000).toFixed(3)}s`);
}

function render(state = {}) {
  // 🎨 Skin mùa lễ (dùng chung) — trang trí ở <body>, độc lập việc dựng lại root mỗi render.
  if (window.OverlaySkin) OverlaySkin.applySkin(state.skin);
  // Mục tiêu = 0 (trống) → chế độ "không mục tiêu": chỉ cộng điểm, thanh luôn đầy chảy, bỏ KPI/Over/goal.
  const noTarget = !(Number(state.target) > 0);
  const target = noTarget ? 0 : Math.max(1, Number(state.target));
  const score = Math.max(0, Number(state.score) || 0);
  const over = noTarget ? 0 : Math.max(0, score - target);
  const pct = noTarget ? 100 : Math.max(0, Math.min(100, (score / target) * 100));
  // Người chạy neo ngay mép máu đang tiến; kẹp trong [9,90] để vòng tròn + huy hiệu không bị mép/cờ đích cắt.
  const popLeft = Math.max(9, Math.min(90, pct));
  const status = state.status || 'idle';
  const key = runKey(state);
  if (key !== lastRunKey) {
    lastRunKey = key;
    playedWarning = false;
    playedGoal = false;
    playedX2 = false;
    failedStatusText = FAILED_STATUS_TEXTS[0];
    lastRenderedScore = 0;
    cardFrameSrc = pickCardFrame();   // phiên mới → bốc khung avatar mới cho thẻ KÊU GỌI (chỉ dùng khi để 🎲 Ngẫu nhiên)
  }
  const frameSrc = resolveCardFrame(state);
  if (status === 'failed' && lastStatus !== 'failed') {
    failedStatusText = FAILED_STATUS_TEXTS[Math.floor(Math.random() * FAILED_STATUS_TEXTS.length)];
  }
  const avatar = mediaUrl(state.creatorAvatar || '');
  const creator = state.creatorName || 'Creator';
  const shortCreator = shortText(creator, 28);
  const content = state.content || '';
  // 3 KIỂU: ĐƯỜNG ĐUA (bar) · KÊU GỌI (card) · THỜI GIAN (timer). ?layout= ép cứng cho nguồn OBS tách kiểu,
  // ngoài ra theo state.scoreLayout (chuỗi mới), còn cardLayout cũ giữ để tương thích cấu hình đời trước.
  const layoutMode = ['bar', 'card', 'timer'].includes(forcedLayout)
    ? forcedLayout
    : (['bar', 'card', 'timer'].includes(state.scoreLayout)
        ? state.scoreLayout
        : (state.cardLayout ? 'card' : 'bar'));
  const cardLayout = layoutMode === 'card';
  const timerLayout = layoutMode === 'timer';
  const hasContent = !!content.trim();
  const statusText = scoreStatusText(status, state.timeText);
  const activeRunner = ['running', 'grace'].includes(status) && !!state.lastAdd;
  // ĐƯỜNG ĐUA (bar): người chạy hiện SUỐT phiên (kể cả lúc chưa có điểm — "chờ tăng tốc" + bụi trắng).
  // KÊU GỌI (card): giữ như cũ — chỉ hiện khi vừa có quà.
  // LƯU Ý: khi cán đích 100% CHỈ ẨN vòng tròn + hình người (qua .goal-met bằng CSS), NHƯNG GIỮ huy hiệu
  // "+N / quà lớn + avatar" để vẫn kích cầu người tặng tiếp vào phần dư (số dư/Over).
  // THỜI GIAN: không dùng người chạy (thanh biểu thị thời gian, không phải điểm) → phản hồi quà qua +N bay lên.
  const showRunner = timerLayout ? false : (cardLayout ? activeRunner : ['prestart', 'running', 'grace'].includes(status));
  const runnerUser = state.showGiftUser !== false && state.lastAddUser ? `${state.lastAddUser} ` : '';
  const runnerAtStart = pct < 28;
  const big = Number(state.lastAdd) >= Number(state.bigGiftThreshold || 500);
  // Quà lớn (≥ ngưỡng) → hiện avatar người tặng trong huy hiệu (điểm ảnh 4).
  const runnerAvatar = mediaUrl(state.lastAddAvatar || '');
  const avatarThreshold = Math.max(1, Number(state.avatarThreshold) || 1000);
  const showRunnerAvatar = !!state.lastAdd && Number(state.lastAdd) >= avatarThreshold && !!state.lastAddAvatar;
  // Huy hiệu LUÔN hiện GIÁ TRỊ THỰC của cú tặng (kim cương/điểm — chính xác đến 1 xu), KHÔNG dùng số combo
  // (×N gây hiểu lầm: 1 quà 999 xu bị hiện ×1). Chế độ 'gift' chỉ thêm icon quà đứng trước con số.
  // QUÀ LỚN (đạt ngưỡng avatar) → +giá trị + avatar bo tròn sát mép (tôn người tặng lớn, khớp Douyin ảnh 4).
  const badgeMode = ['points', 'gift'].includes(state.runnerBadgeMode) ? state.runnerBadgeMode : 'points';
  const badgeNum = Math.max(0, Number(state.lastAdd) || 0);
  const badgePrefix = `${runnerUser}+`;
  const showRunnerGift = !showRunnerAvatar && badgeMode === 'gift' && !!state.lastAddIcon;
  const runnerGiftIcon = mediaUrl(state.lastAddIcon || '');
  const remainingMs = Number(state.remainingMs) || 0;
  const durMs = Math.max(1, Number(state.durationMs) || 1);
  // THỜI GIAN — MÉP MÁU (fillP) bò ĐỀU (mỗi giây nhích = quãng đường ÷ thời gian), nối liền tới số 9, không nhảy:
  //  • đầu → giây thứ 9: 5% → 73% TUYẾN TÍNH đều theo (durMs−9s) → pill nhích đều mỗi giây, hết "chậm ở giữa"
  //  • 9 → 0 giây: 73% → 100% (rút cạn dần) → HẾT GIỜ máu RÚT SẠCH, không thừa sliver cạnh đồng hồ.
  const FILL_HANDOFF = 73; // vị trí tại giây thứ 9 = nơi số 9 bắt đầu (khớp chipPos)
  let fillP = FILL_HANDOFF;
  if (['success', 'failed', 'grace'].includes(status)) fillP = 100; // hết giờ: rút sạch máu
  else if (status === 'prestart') fillP = 5;
  else if (remainingMs > 9000) {
    const frac = (remainingMs - 9000) / Math.max(1, durMs - 9000); // 1 lúc đầu → 0 tại giây thứ 9
    fillP = 5 + (FILL_HANDOFF - 5) * (1 - frac);
  } else {
    const tt = Math.max(0, Math.min(9, remainingMs / 1000));
    fillP = FILL_HANDOFF + (100 - FILL_HANDOFF) * (1 - tt / 9); // 9s 73% → 0s 100% (cạn)
  }
  // Độ rộng fill: THỜI GIAN = 100−fillP; ĐƯỜNG ĐUA/KÊU GỌI dùng % điểm như cũ.
  const barPct = timerLayout ? (100 - fillP) : pct;
  // THỜI GIAN: cụm TOP 5 người tặng (avatar nửa chồng nhau, top 1 nổi bật) ở đầu overlay.
  // showTop5 = theo CÔNG TẮC (không theo số user) → khung LUÔN chừa sẵn chỗ, avatar hiện lên KHÔNG làm giật thanh.
  const showTop5 = timerLayout && state.timerTop5 !== false;
  const top5 = (showTop5 && Array.isArray(state.topUsers)) ? state.topUsers.slice(0, 5) : [];
  const urgent = ['running', 'grace'].includes(status) && remainingMs <= 10000 && remainingMs > 0;
  // 🌫️ Sương mù 10s cuối — CHỈ khi đang chạy (grace/hết giờ là lộ điểm). Che số điểm (+ thanh máu ở ĐƯỜNG
  // ĐUA/KÊU GỌI); kiểu THỜI GIAN chỉ che số, giữ thanh đồng hồ.
  const fogOn = !!state.fogHide && status === 'running' && remainingMs <= 10000 && remainingMs > 0;
  const nearGoal = !noTarget && ['running', 'grace'].includes(status) && pct >= 80 && score < target;
  const goalMet = !noTarget && score >= target;
  const iconOff = ['success', 'failed'].includes(status);
  // KPI nhân bù: điểm vượt mục tiêu ×hệ số. VD KPI 5.000, tặng 10.000 → 5.000 + (5.000×2) = 15.000. (Tắt khi không mục tiêu.)
  const kpiX2 = !noTarget && !!state.kpiX2;
  const kpiMult = [2, 3, 5].includes(Number(state.kpiMult)) ? Number(state.kpiMult) : 2;
  const kpix2Total = score <= target ? score : target + (score - target) * kpiMult;
  const inX2 = kpiX2 && score > target;
  // Còn bao nhiêu tới đích (kêu gọi tặng thêm) — không mục tiêu thì không hiện
  const showRemaining = !noTarget && !!state.showRemaining;
  const remainingPts = Math.max(0, target - score);
  const className = `score-obs status-${status} theme-${state.themePreset || 'custom'} size-${state.overlaySize || 'medium'} bar-${state.barStyle || 'pill'}${state.compactMode ? ' compact' : ''}${activeRunner ? ' has-add' : ''}${score > 0 ? ' has-score' : ''}${noTarget ? ' no-target' : ''}${urgent ? ' urgent' : ''}${nearGoal ? ' near-goal' : ''}${goalMet ? ' goal-met' : ''}${state.colorByProgress ? ' color-progress' : ''}${kpiX2 ? ' has-kpi-x2' : ''}${inX2 ? ' x2-active' : ''} layout-${layoutMode}${state.runnerDust === false ? ' runner-nodust' : ''}${state.fxGlowBorder ? ' fx-glowborder' : ''}${state.fxGlass ? ' fx-glass' : ''}${state.fxSparkle ? ' fx-sparkle' : ''}${state.fxSpotlight ? ' fx-spotlight' : ''}${state.fxAvatarAura ? ' fx-avataraura' : ''}${state.fxScoreBounce ? ' fx-scorebounce' : ''}${state.fxFloatPoints ? ' fx-floatpoints' : ''}${state.fxCardBreathe ? ' fx-cardbreathe' : ''}${state.fxLiquid ? ' fx-liquid' : ''}${fogOn ? ' fog-on' : ''}`;
  if (className !== lastClassName) { root.className = className; lastClassName = className; }

  root.style.setProperty('--score-time-color', state.timeColor || '#ffffff');
  const rawScale = parseInt(state.overlayScale, 10);
  if (Number.isFinite(rawScale)) { try { localStorage.setItem('scoreScale', rawScale); } catch {} }
  const useScale = Number.isFinite(rawScale) ? rawScale : (parseInt(localStorage.getItem('scoreScale'), 10) || 200);
  root.style.setProperty('--score-scale', Math.max(.8, Math.min(3, useScale / 100)));
  root.style.setProperty('--score-points-font-size', `${Math.max(12, Math.min(48, parseInt(state.scoreFontSize, 10) || 18))}px`);
  root.style.setProperty('--score-content-color', state.contentColor || '#f0eef6');
  root.style.setProperty('--score-over-color', state.overColor || '#ffffff');
  const bOpacity = Number.isFinite(Number(state.barBorderOpacity)) ? Number(state.barBorderOpacity) : 50;
  const bWidth = Number.isFinite(Number(state.barBorderWidth)) ? Number(state.barBorderWidth) : 1;
  root.style.setProperty('--score-bar-border', alphaHex(state.barBorderColor || '#ffffff', Math.max(0, Math.min(1, bOpacity / 100))));
  root.style.setProperty('--score-bar-border-width', `${Math.max(0, Math.min(6, bWidth))}px`);
  const cardAlpha = Number.isFinite(Number(state.cardBgOpacity)) ? Number(state.cardBgOpacity) : 88;
  root.style.setProperty('--score-card-bg-alpha', (Math.max(0, Math.min(100, cardAlpha)) / 100).toFixed(3));
  root.style.setProperty('--score-bar-color-1', state.barColor1 || '#b93678');
  root.style.setProperty('--score-bar-color-2', state.barColor2 || '#ff8ed1');
  root.style.setProperty('--score-wave-color', state.waveColor || '#ffffff');
  const c1 = state.barColor1 || '#b93678';
  const c2 = state.barColor2 || '#ff8ed1';
  root.style.setProperty('--score-bar-idle-gradient', `linear-gradient(90deg, ${mixHex(c2, '#172333', 58)} 0%, ${mixHex(c1, '#172333', 60)} 100%)`);
  // Đường ray Douyin (chỉ ĐƯỜNG ĐUA/bar dùng qua CSS): bán trong suốt để thấy nền video ở phần chưa đầy.
  root.style.setProperty('--score-bar-track', `linear-gradient(90deg, ${mixHexA(c2, '#0a0f18', 66, .34)} 0%, ${mixHexA(c1, '#0a0f18', 58, .5)} 100%)`);
  root.style.setProperty('--score-edge-glow', alphaHex(c1, .68));
  root.style.setProperty('--score-edge-soft', alphaHex(c1, .18));
  // Người chạy ăn theo màu chủ đề (bar) — hoặc ép hồng TikTok nếu bật công tắc.
  const forcePink = !!state.runnerForcePink;
  root.style.setProperty('--score-runner-lite', forcePink ? '#ff8cc6' : c2);
  root.style.setProperty('--score-runner-dark', forcePink ? '#f0327f' : c1);
  root.style.setProperty('--score-runner-glow', alphaHex(forcePink ? '#f0327f' : c1, .6));
  // Máu kiểu "vệt sao băng" Douyin: ĐẦU (mép trái, điểm gốc) mờ trong suốt → ĐẬM DẦN về mép đang tiến/đích;
  // thêm chút trắng nhẹ ở đuôi cho nổi viền hồng (điểm ảnh 3). colorByProgress giữ hành trình sắc màu riêng.
  root.style.setProperty('--score-fill-gradient',
    state.colorByProgress
      ? progressFillGradient(pct)
      : `linear-gradient(90deg, ${alphaHex(c2, .08)} 0%, ${alphaHex(c2, .5)} 22%, ${c2} 56%, ${c1} 100%)`);
  // THỜI GIAN: ĐẦU thanh (điểm tiếp xúc chip) = c1 → ĐỒNG BỘ MÀU với chip; sau đó mới LEM sang c2 (Preset)
  // rồi TRONG SUỐT DẦN về phía đồng hồ. Màu lem cuối tuỳ chỉnh (mặc định tím), đồng hồ vẫn đục (không trong suốt).
  const stTail = /^#[0-9a-f]{6}$/i.test(state.timerTailColor || '') ? state.timerTailColor : '#a15cf0';
  root.style.setProperty('--score-timefill-gradient',
    `linear-gradient(90deg, ${c1} 0%, ${c1} 13%, ${mixHex(c1, c2, 50)} 36%, ${c2} 60%, ${mixHexA(c2, stTail, 60, .72)} 84%, ${alphaHex(stTail, .14)} 100%)`);
  // Chip đồng hồ ăn theo MÀU ĐẦU thanh (c1) — làm PHẲNG (đơn giản, không 3D): chỉ chút sáng nhẹ trên, KHÔNG tối đáy → liền mạch với thanh máu.
  root.style.setProperty('--score-timechip-bg', `linear-gradient(180deg, ${mixHex(c1, '#ffffff', 14)} 0%, ${c1} 100%)`);
  // Card CHỐT ĐIỂM/HẾT GIỜ: viền + hào quang ăn theo MÀU 🎨 PRESET (c1) thay vì vàng cứng.
  root.style.setProperty('--score-result-border', alphaHex(c1, .92));
  root.style.setProperty('--score-result-glow', alphaHex(c1, .5));

  // Chỉ dựng lại khung khi khung xương đổi — thay vì mỗi 250ms (nguyên nhân restart animation → nhấp nháy).
  const structKey = `${status}|${state.hideAvatar ? 1 : 0}|${state.hideCreator ? 1 : 0}|${over > 0 ? 1 : 0}|${showRunner ? 1 : 0}|${kpiX2 ? 1 : 0}|${showRemaining ? 1 : 0}|${layoutMode}|${hasContent ? 1 : 0}|${showTop5 ? 1 : 0}|${fogOn ? 1 : 0}|${frameSrc ? 1 : 0}`;
  if (structKey !== lastStructKey) {
    lastStructKey = structKey;
    buildStructure(state, { iconOff, over, activeRunner, showRunner, kpiX2, showRemaining, cardLayout, timerLayout, hasContent, showTop5, fog: fogOn, frame: frameSrc, ended: ['success', 'failed'].includes(status) });
  }

  // Cập nhật tại chỗ (không dựng lại DOM → animation chạy liền mạch)
  if (els.timeText) els.timeText.textContent = statusText;
  // Tiêu đề thẻ = tên idol (mặc định); nếu điền "Nội dung" thì Nội dung ghi đè làm tên chính
  if (els.tabText) els.tabText.textContent = content.trim() ? content : creator;
  if (els.scoreChipVal) els.scoreChipVal.textContent = fmt(score);
  if (els.targetLabel) els.targetLabel.textContent = fmt(target);
  if (els.pointsCur) els.pointsCur.textContent = fmt(score);
  if (els.pointsRest) els.pointsRest.textContent = noTarget ? ' điểm' : `/${fmt(target)} điểm`;
  if (els.pointsX2) els.pointsX2.textContent = `x${kpiMult} → ${fmt(kpix2Total)} điểm`;
  if (els.remaining) {
    const showLine = showRemaining && ['prestart', 'running', 'grace'].includes(status) && remainingPts > 0;
    els.remaining.classList.toggle('is-hidden', !showLine);
    if (showLine && els.remainingText) els.remainingText.textContent = `🔥 Còn ${fmt(remainingPts)} điểm nữa!`;
  }
  if (els.fill) els.fill.style.width = `${barPct}%`;
  if (els.sheen) els.sheen.style.width = `${barPct}%`;
  if (els.bar) els.bar.style.setProperty('--score-pct', `${barPct}%`);
  // THỜI GIAN: cập nhật đồng hồ + nhãn giai đoạn; chip đồng hồ cưỡi mép máu (lùi dần về phải khi hết giờ).
  if (timerLayout) {
    // 10 giây cuối: từ giây 9 → 1 đổi sang SỐ TO gold sát đồng hồ (bỏ khung pill); hết giờ = mất số hoàn toàn.
    const secLeft = Math.ceil((Number(state.remainingMs) || 0) / 1000);
    const finalCount = status === 'running' && secLeft >= 1 && secLeft <= 9;
    // Chip chỉ hiện khi CHUẨN BỊ hoặc ĐANG CHẠY; ẩn ở idle/grace/kết thúc (tránh chip "00" dư sau đồng hồ).
    const hideClock = !['prestart', 'running'].includes(status) || (status === 'running' && secLeft <= 0);
    if (els.timeChip) {
      els.timeChip.classList.toggle('is-final', finalCount);
      els.timeChip.classList.toggle('is-hidden', hideClock);
      // Chip pill (>10s) bám MÉP MÁU (bò đều, không rush). Số 9→1 NỔI ở vùng GẦN ĐỒNG HỒ (73%→91% sát đích),
      // tách khỏi mép máu để không bị xa đích như trước.
      const t = Math.max(0, Math.min(9, remainingMs / 1000));
      const chipPos = finalCount ? (91 - (t / 9) * 18) : fillP; // số: 9s→73% … 0s→91%; pill: ở mép máu
      els.timeChip.style.left = hideClock ? '' : `${chipPos.toFixed(2)}%`;
    }
    if (els.timerClock) els.timerClock.textContent = finalCount ? String(secLeft) : timerClockText(status, state.timeText);
    if (els.phaseText) els.phaseText.textContent = timerPhaseText(status, urgent);
    // TOP 5 người tặng: chỉ dựng lại khi thứ hạng/điểm đổi (tránh reset animation avatar mỗi tick).
    if (els.top5) {
      const sig = top5.map(u => `${u.user || u.nickname}:${Math.floor(u.points || 0)}`).join('|');
      if (sig !== lastTop5Sig) {
        lastTop5Sig = sig;
        els.top5.innerHTML = top5.map((u, i) => {
          const av = mediaUrl(u.avatar || '');
          const name = esc(shortText(u.nickname || u.user || '', 14));
          return `<span class="st-top5-item r${i + 1}" style="z-index:${10 - i}" title="${name}">`
            + `${i === 0 ? '<b class="st-top5-crown">👑</b>' : ''}`
            + `<img src="${esc(av)}" onerror="this.onerror=null;this.src='/logo.png'" alt="" />`
            + `<i class="st-top5-rank">${i + 1}</i></span>`;
        }).join('');
      }
    }
    // #2 ĐỔI NGÔI TOP 1: khi hạng 1 đổi người → loé sáng + nảy avatar hạng 1 (bỏ qua lần đầu tiên).
    const top1Id = top5[0] ? (top5[0].user || top5[0].nickname || '') : '';
    if (top1Id && top1Id !== lastTop1Id) {
      if (lastTop1Id && els.top5) { const r1 = els.top5.querySelector('.st-top5-item.r1'); if (r1) fireOnce(r1, 'overtake'); }
      lastTop1Id = top1Id;
    }
    // #3 NHỊP ĐỘ TẶNG: tổng điểm ~4 giây gần nhất → chip "🔥 +N" (ẩn khi lắng xuống).
    if (els.momentum) {
      let burst = 0; const nowMs = Date.now();
      (state.recentGifts || []).forEach(g => { if (nowMs - (g.at || 0) <= 4000) burst += Number(g.points) || 0; });
      const hot = status === 'running' && burst > 0;
      els.momentum.classList.toggle('is-on', hot);
      if (hot) els.momentum.textContent = `🔥 +${fmt(burst)}`;
    }
    // #4 TIẾNG TICK 10s cuối (mỗi giây 1 lần; ≤3s cao & gấp hơn). Tự re-arm khi ra khỏi vùng 10s.
    if (state.timerFinalTick !== false && status === 'running' && secLeft <= 10 && secLeft >= 1) {
      if (secLeft !== lastTickSec) { lastTickSec = secLeft; playTick(secLeft <= 3); }
    } else if (status !== 'running' || secLeft > 10) { lastTickSec = -1; }
    // #5 CHỐT ĐIỂM HOÀNH TRÁNG: hết giờ → banner "CHỐT: N ĐIỂM" + tia sáng (bắn 1 lần/phiên).
    if (els.result) {
      const ended = ['success', 'failed'].includes(status);
      if (ended) {
        els.result.classList.add('show');
        const rkey = `${status}|${runKey(state)}`;
        if (rkey !== lastResultKey) {
          lastResultKey = rkey;
          if (els.resultLabel) els.resultLabel.textContent = status === 'failed' ? 'HẾT GIỜ' : 'ĐIỂM';
          if (els.resultScore) els.resultScore.textContent = fmt(score);
          fireOnce(els.result, 'pop');
        }
      } else {
        els.result.classList.remove('show', 'pop');
      }
    }
  }
  if (els.overVal) els.overVal.textContent = fmt(over);
  if (els.creator) { els.creator.textContent = shortCreator; els.creator.title = creator; }
  if (els.avatarImg && avatar && els.avatarImg.getAttribute('src') !== avatar) els.avatarImg.src = avatar;
  // KHUNG avatar (KÊU GỌI): đổi src khi phiên mới bốc khung khác / người dùng chọn khung khác trong Cài đặt
  // — cập nhật tại chỗ, khỏi chờ dựng lại DOM. (Bỏ khung hẳn thì structKey đã lo gỡ thẻ <img>.)
  if (els.cardFrame && frameSrc && els.cardFrame.getAttribute('src') !== frameSrc) { els.cardFrame.style.display = ''; els.cardFrame.src = frameSrc; }
  if (els.pop) {
    const hasGift = !!state.lastAdd && ['running', 'grace'].includes(status);
    els.pop.className = `score-pop${big ? ' big' : ''}${runnerAtStart ? ' at-start' : ''}${hasGift ? ' has-gift' : ' no-gift'}${showRunnerAvatar ? ' has-avatar' : ''}${showRunnerGift ? ' has-gifticon' : ''}`;
    // Bar: luôn neo giữa mép máu (CSS tự căn giữa); Card: giữ nếp cũ (dạt về 6px khi ở vạch xuất phát).
    els.pop.style.left = (cardLayout && runnerAtStart) ? '6px' : `${popLeft}%`;
    if (els.popAvatar) {
      if (showRunnerAvatar && runnerAvatar) {
        if (els.popAvatar.getAttribute('src') !== runnerAvatar) els.popAvatar.src = runnerAvatar;
        els.popAvatar.style.display = '';
      } else els.popAvatar.style.display = 'none';
    }
    if (els.popGift) {
      if (showRunnerGift && runnerGiftIcon) {
        if (els.popGift.getAttribute('src') !== runnerGiftIcon) els.popGift.src = runnerGiftIcon;
        els.popGift.style.display = '';
      } else els.popGift.style.display = 'none';
    }
    // Số huy hiệu: cú tặng MỚI để rollBadge (khối addSig bên dưới) xử lý đếm cuộn; ngoài ra set thẳng.
    const isNewGift = String(state.lastAddAt || 0) !== lastAddSig;
    if (els.popText && !(isNewGift && hasGift) && !badgeRollRaf) {
      els.popText.textContent = hasGift ? `${badgePrefix}${fmt(badgeNum)}` : '';
      badgeShownVal = hasGift ? badgeNum : 0;
    }
  }

  // Chỉ chớp sáng đầu thanh khi CÓ quà mới (theo dấu thời gian) — không chớp lại mỗi tick.
  const addSig = String(state.lastAddAt || 0);
  if (addSig !== lastAddSig) {
    lastAddSig = addSig;
    if (state.lastAddAt && ['running', 'grace'].includes(status)) {
      if (els.flash) { els.flash.style.animation = 'none'; void els.flash.offsetWidth; els.flash.style.animation = ''; }
      // Huy hiệu đếm cuộn tới giá trị cú tặng mới (mượt như Douyin)
      rollBadge(badgePrefix, badgeNum);
      // Bứt tốc khi quà lớn: người chạy lao vọt + vệt tốc độ + tiếng "vút" (chỉ ĐƯỜNG ĐUA/bar)
      if (big && !cardLayout) { fireOnce(els.popRunner, 'dash'); if (state.dashSound) playSound(state.dashSound); }
      // FX "Quà lớn tạo sóng": chỉ khi cú tặng ≥ ngưỡng
      if (big) fireOnce(els.ripple, 'go');
      // FX "Hào quang avatar": mỗi cú tặng bắn 1 vòng sáng nở quanh avatar
      if (state.fxAvatarAura && els.aura) fireOnce(els.aura, 'go');
      // FX "'+N' bay lên": chip điểm cộng bay lên từ thanh máu rồi tan
      if (state.fxFloatPoints && els.floats) spawnFloatPoint(fmt(Number(state.lastAdd) || 0), big);
    }
  }
  // FX "Số điểm nhảy nảy": bật to + loé sáng 1 nhịp khi điểm tăng
  if (state.fxScoreBounce && els.scoreNum && score > lastRenderedScore) fireOnce(els.scoreNum, 'sc-bump');
  lastRenderedScore = score;
  // FX "Cán đích bùng nổ": bắn 1 lần đúng lúc vừa đạt mục tiêu
  if (goalMet && !lastGoalMet) fireOnce(els.burst, 'go');
  lastGoalMet = goalMet;

  // Sound triggers are guarded per run so OBS/SSE refreshes do not replay them.
  if (status !== lastStatus) {
    if (status === 'prestart' || (status === 'running' && lastStatus === 'idle')) playSound(state.startSound);
    if (status === 'success') playSound(state.successSound);
    if (status === 'failed') playSound(state.failSound);
  }
  if (!playedWarning && ['running', 'grace'].includes(status) && remainingMs <= 10000 && remainingMs > 0) {
    playedWarning = true;
    playSound(state.warningSound);
  }
  if (!playedGoal && !noTarget && ['running', 'grace'].includes(status) && score >= target) {
    playedGoal = true;
    playSound(state.goalSound);
  }
  // Vào vùng nhân bù (điểm vượt mục tiêu) — chỉ phát nếu có âm riêng (goalSound đã phát lúc đạt mốc)
  if (!playedX2 && inX2 && state.x2Sound && ['running', 'grace'].includes(status)) {
    playedX2 = true;
    playSound(state.x2Sound);
  }
  lastStatus = status;
}

render({});
// SSE tự hồi phục (overlay-sse.js) → overlay tự lên lại khi stream rớt/kẹt, không cần Ctrl+R.
// Ẩn/hiện riêng theo kiểu ép cứng (?layout=): ĐƯỜNG ĐUA=scorebar · KÊU GỌI=scorecard · THỜI GIAN=scoretimer · mặc định=score.
const SCORE_VIS_KEY = { bar: 'scorebar', card: 'scorecard', timer: 'scoretimer' }[forcedLayout] || 'score';
connectSSE(`/score-events?token=${encodeURIComponent(token)}`, 'score', render, { visKey: SCORE_VIS_KEY });
