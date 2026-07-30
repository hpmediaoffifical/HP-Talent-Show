// Score overlay — port từ BIGO với state machine + theme presets + top users + runner
const token = new URLSearchParams(location.search).get('token') || '';
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

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('vi-VN'); }
// OBS-safe: CEF cũ trong OBS KHÔNG hỗ trợ color-mix() → thanh fill (chứa var()) sẽ mất nền (trong suốt).
// Tự trộn màu bằng JS ra rgba()/rgb() để chạy mọi phiên bản CEF của OBS.
function _hx(h) { h = String(h || '').trim(); const m3 = h.match(/^#([0-9a-f]{3})$/i); if (m3) h = '#' + m3[1].split('').map(c => c + c).join(''); const m = h.match(/^#([0-9a-f]{6})$/i); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function alphaHex(hex, a) { const c = _hx(hex); return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : hex; }
function mixHex(hex, other, pct) { const a = _hx(hex), b = _hx(other); if (!a || !b) return hex; const t = Math.max(0, Math.min(1, pct / 100)); const c = a.map((v, i) => Math.round(v + (b[i] - v) * t)); return `rgb(${c[0]},${c[1]},${c[2]})`; }
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
  if (status === 'failed') return 'KHÔNG HOÀN THÀNH';
  return timeText || '03:00';
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
let els = {};

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

// Nội dung bên trong thanh máu (dùng chung cho cả 2 bố cục — dải ngang & thẻ HUD)
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
      ${v.activeRunner ? `<div class="score-pop"><span class="score-pop-text"></span><b>🏃</b></div>` : ''}
      <div class="score-burst"></div>`;
}

function buildStructure(state, v) {
  if (v.cardLayout) {
    // Thẻ HUD góc GỌN: tab TÊN IDOL ở đỉnh · avatar TO giữa-trái · đồng hồ/trạng thái ở giữa · thanh máu ôm đáy
    root.innerHTML = `
    <div class="score-card">
      <div class="sc-fx-spotlight" aria-hidden="true"></div>
      <div class="sc-tab"><span class="sc-tab-text"></span></div>
      <div class="sc-card-mid">
        ${state.hideAvatar ? '' : `<div class="sc-fx-aura" aria-hidden="true"></div><div class="sc-card-avatar"><img class="score-avatar-img" onerror="this.onerror=null;this.src='/logo.png'" /></div>`}
        <div class="sc-card-clock"><span class="score-time-text sc-clock-text"></span></div>
        ${v.kpiX2 ? `<div class="sc-card-kpi2"><span class="score-points-x2"></span></div>` : ''}
      </div>
      <div class="sc-cardbar-wrap">
        <div class="score-bar sc-cardbar">${barInnerHTML(v, false)}</div>
        <div class="sc-cardbar-labels${v.over > 0 ? ' has-over' : ''}">
          ${v.over > 0 ? `<span class="sc-card-over">+OVER <b class="score-over-val"></b></span>` : ''}
          <span class="sc-score-chip"><span class="sc-score-chip-val"></span></span>
          <span class="sc-target-label"><small>ĐIỂM</small><b class="sc-target-value"></b></span>
        </div>
      </div>
      <div class="sc-fx-floats" aria-hidden="true"></div>
    </div>
    ${v.showRemaining ? `<div class="score-remaining"><span class="score-remaining-text"></span></div>` : ''}
    `;
  } else {
    root.innerHTML = `
    <div class="score-barwrap"><div class="score-bar">${barInnerHTML(v)}</div><div class="score-flag">⚑</div></div>
    <div class="score-meta">
      <div class="score-person">
        ${state.hideAvatar ? '' : `<div class="score-avatar"><img class="score-avatar-img" onerror="this.onerror=null;this.src='/logo.png'" /></div>`}
        ${state.hideCreator ? '' : `<div class="score-creator"></div>`}
      </div>
      <div class="score-time"><i class="score-time-icon ${v.iconOff ? 'off' : 'clock'}" aria-hidden="true"></i><span class="score-time-text"></span></div>
      <div class="score-points">
        <span class="score-points-main"></span>
        ${v.kpiX2 ? `<span class="score-points-x2"></span>` : ''}
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
    avatarImg: root.querySelector('.score-avatar-img'),
    creator: root.querySelector('.score-creator'),
    pointsMain: root.querySelector('.score-points-main'),
    pointsX2: root.querySelector('.score-points-x2'),
    remaining: root.querySelector('.score-remaining'),
    remainingText: root.querySelector('.score-remaining-text'),
    aura: root.querySelector('.sc-fx-aura'),
    floats: root.querySelector('.sc-fx-floats'),
  };
  // Con số điểm để "nhảy nảy" — thẻ KÊU GỌI dùng .sc-score-chip-val, thanh ngang dùng .score-points-main
  els.scoreNum = els.scoreChipVal || els.pointsMain;
  // Sóng chảy đồng bộ theo đồng hồ toàn cục — chỉ đặt khi dựng lại (element mới) để không giật giữa chừng.
  root.style.setProperty('--score-flow-delay', `${(-(Date.now() % 1000) / 1000).toFixed(3)}s`);
}

function render(state = {}) {
  // Mục tiêu = 0 (trống) → chế độ "không mục tiêu": chỉ cộng điểm, thanh luôn đầy chảy, bỏ KPI/Over/goal.
  const noTarget = !(Number(state.target) > 0);
  const target = noTarget ? 0 : Math.max(1, Number(state.target));
  const score = Math.max(0, Number(state.score) || 0);
  const over = noTarget ? 0 : Math.max(0, score - target);
  const pct = noTarget ? 100 : Math.max(0, Math.min(100, (score / target) * 100));
  const popLeft = Math.max(11, Math.min(88, pct));
  const status = state.status || 'idle';
  const key = runKey(state);
  if (key !== lastRunKey) {
    lastRunKey = key;
    playedWarning = false;
    playedGoal = false;
    playedX2 = false;
    lastRenderedScore = 0;
  }
  const avatar = mediaUrl(state.creatorAvatar || '');
  const creator = state.creatorName || 'Creator';
  const shortCreator = shortText(creator, 28);
  const content = state.content || '';
  const cardLayout = !!state.cardLayout;
  const hasContent = !!content.trim();
  const statusText = scoreStatusText(status, state.timeText);
  const activeRunner = ['running', 'grace'].includes(status) && !!state.lastAdd;
  const runnerUser = state.showGiftUser !== false && state.lastAddUser ? `${state.lastAddUser} ` : '';
  const runnerPoints = state.lastAdd ? `+${fmt(state.lastAdd)}` : '';
  const runnerAtStart = pct < 28;
  const big = Number(state.lastAdd) >= Number(state.bigGiftThreshold || 500);
  const remainingMs = Number(state.remainingMs) || 0;
  const urgent = ['running', 'grace'].includes(status) && remainingMs <= 10000 && remainingMs > 0;
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
  const className = `score-obs status-${status} theme-${state.themePreset || 'custom'} size-${state.overlaySize || 'medium'} bar-${state.barStyle || 'pill'}${state.compactMode ? ' compact' : ''}${activeRunner ? ' has-add' : ''}${score > 0 ? ' has-score' : ''}${noTarget ? ' no-target' : ''}${urgent ? ' urgent' : ''}${nearGoal ? ' near-goal' : ''}${goalMet ? ' goal-met' : ''}${state.colorByProgress ? ' color-progress' : ''}${kpiX2 ? ' has-kpi-x2' : ''}${inX2 ? ' x2-active' : ''}${cardLayout ? ' layout-card' : ' layout-bar'}${state.fxGlowBorder ? ' fx-glowborder' : ''}${state.fxGlass ? ' fx-glass' : ''}${state.fxSparkle ? ' fx-sparkle' : ''}${state.fxSpotlight ? ' fx-spotlight' : ''}${state.fxAvatarAura ? ' fx-avataraura' : ''}${state.fxScoreBounce ? ' fx-scorebounce' : ''}${state.fxFloatPoints ? ' fx-floatpoints' : ''}${state.fxCardBreathe ? ' fx-cardbreathe' : ''}${state.fxLiquid ? ' fx-liquid' : ''}`;
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
  root.style.setProperty('--score-edge-glow', alphaHex(c1, .68));
  root.style.setProperty('--score-edge-soft', alphaHex(c1, .18));
  // Đuôi mờ trong suốt → đầu (mép đang tiến) đậm/sáng nhất
  root.style.setProperty('--score-fill-gradient',
    state.colorByProgress
      ? progressFillGradient(pct)
      : `linear-gradient(90deg, ${c2} 0%, ${c2} 38%, ${c1} 82%, ${c1} 100%)`);

  // Chỉ dựng lại khung khi khung xương đổi — thay vì mỗi 250ms (nguyên nhân restart animation → nhấp nháy).
  const structKey = `${status}|${state.hideAvatar ? 1 : 0}|${state.hideCreator ? 1 : 0}|${over > 0 ? 1 : 0}|${activeRunner ? 1 : 0}|${kpiX2 ? 1 : 0}|${showRemaining ? 1 : 0}|${cardLayout ? 1 : 0}|${hasContent ? 1 : 0}`;
  if (structKey !== lastStructKey) {
    lastStructKey = structKey;
    buildStructure(state, { iconOff, over, activeRunner, kpiX2, showRemaining, cardLayout, hasContent });
  }

  // Cập nhật tại chỗ (không dựng lại DOM → animation chạy liền mạch)
  if (els.timeText) els.timeText.textContent = statusText;
  // Tiêu đề thẻ = tên idol (mặc định); nếu điền "Nội dung" thì Nội dung ghi đè làm tên chính
  if (els.tabText) els.tabText.textContent = content.trim() ? content : creator;
  if (els.scoreChipVal) els.scoreChipVal.textContent = fmt(score);
  if (els.targetLabel) els.targetLabel.textContent = fmt(target);
  if (els.pointsMain) els.pointsMain.textContent = noTarget ? `${fmt(score)} điểm` : `${fmt(score)}/${fmt(target)} điểm`;
  if (els.pointsX2) els.pointsX2.textContent = `x${kpiMult} → ${fmt(kpix2Total)} điểm`;
  if (els.remaining) {
    const showLine = showRemaining && ['prestart', 'running', 'grace'].includes(status) && remainingPts > 0;
    els.remaining.classList.toggle('is-hidden', !showLine);
    if (showLine && els.remainingText) els.remainingText.textContent = `🔥 Còn ${fmt(remainingPts)} điểm nữa!`;
  }
  if (els.fill) els.fill.style.width = `${pct}%`;
  if (els.sheen) els.sheen.style.width = `${pct}%`;
  if (els.bar) els.bar.style.setProperty('--score-pct', `${pct}%`);
  if (els.overVal) els.overVal.textContent = fmt(over);
  if (els.creator) { els.creator.textContent = shortCreator; els.creator.title = creator; }
  if (els.avatarImg && avatar && els.avatarImg.getAttribute('src') !== avatar) els.avatarImg.src = avatar;
  if (els.pop) {
    els.pop.className = `score-pop${big ? ' big' : ''}${runnerAtStart ? ' at-start' : ''}`;
    els.pop.style.left = runnerAtStart ? '6px' : `${popLeft}%`;
    if (els.popText) els.popText.textContent = `${runnerUser}${runnerPoints}`;
  }

  // Chỉ chớp sáng đầu thanh khi CÓ quà mới (theo dấu thời gian) — không chớp lại mỗi tick.
  const addSig = String(state.lastAddAt || 0);
  if (addSig !== lastAddSig) {
    lastAddSig = addSig;
    if (state.lastAddAt && ['running', 'grace'].includes(status)) {
      if (els.flash) { els.flash.style.animation = 'none'; void els.flash.offsetWidth; els.flash.style.animation = ''; }
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
connectSSE(`/score-events?token=${encodeURIComponent(token)}`, 'score', render);
