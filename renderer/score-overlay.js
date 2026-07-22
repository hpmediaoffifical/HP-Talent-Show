// Score overlay — port từ BIGO với state machine + theme presets + top users + milestones + runner
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

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('vi-VN'); }
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
  const tail = `hsl(${(hue + 16).toFixed(0)}, 88%, 67%)`;   // đuôi: nhạt, hơi lệch tông
  return `linear-gradient(90deg,`
    + ` color-mix(in srgb, ${tail}, transparent 74%) 0%,`
    + ` color-mix(in srgb, ${tail}, transparent 30%) 22%,`
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

function render(state = {}) {
  const target = Math.max(1, Number(state.target) || 1);
  const score = Math.max(0, Number(state.score) || 0);
  const over = Math.max(0, score - target);
  const pct = Math.max(0, Math.min(100, (score / target) * 100));
  const popLeft = Math.max(11, Math.min(88, pct));
  const status = state.status || 'idle';
  const key = runKey(state);
  if (key !== lastRunKey) {
    lastRunKey = key;
    playedWarning = false;
    playedGoal = false;
  }
  const avatar = mediaUrl(state.creatorAvatar || '');
  const creator = state.creatorName || 'Creator';
  const shortCreator = shortText(creator, 28);
  const content = state.content || '';
  const statusText = scoreStatusText(status, state.timeText);
  const activeRunner = ['running', 'grace'].includes(status) && !!state.lastAdd;
  const runnerUser = state.showGiftUser !== false && state.lastAddUser ? `${state.lastAddUser} ` : '';
  const runnerPoints = state.lastAdd ? `+${fmt(state.lastAdd)}` : '';
  const runnerAtStart = pct < 28;
  const remainingMs = Number(state.remainingMs) || 0;
  const urgent = ['running', 'grace'].includes(status) && remainingMs <= 10000 && remainingMs > 0;
  const nearGoal = ['running', 'grace'].includes(status) && pct >= 80 && score < target;
  const goalMet = score >= target;
  const milestoneValues = [];
  const milestones = milestoneValues.map(v => `<span class="score-marker ${score >= v ? 'reached' : ''}" style="left:${Math.max(0, Math.min(100, (v / target) * 100))}%"></span>`).join('');
  const reachedMilestones = milestoneValues.filter(v => score >= v).length;
  const topUsers = Array.isArray(state.topUsers) ? state.topUsers : [];
  const topText = topUsers.length ? topUsers.map(u => `${esc(u.user || '?')} ${fmt(u.points)}`).join(' | ') : '';
  root.className = `score-obs status-${status} theme-${state.themePreset || 'custom'} size-${state.overlaySize || 'medium'} bar-${state.barStyle || 'pill'}${state.compactMode ? ' compact' : ''}${state.milestoneGradientEnabled ? ' milestone-gradient' : ''}${activeRunner ? ' has-add' : ''}${score > 0 ? ' has-score' : ''}${urgent ? ' urgent' : ''}${nearGoal ? ' near-goal' : ''}${goalMet ? ' goal-met' : ''}${state.colorByProgress ? ' color-progress' : ''}`;
  root.style.setProperty('--score-time-color', state.timeColor || '#ffffff');
  const rawScale = parseInt(state.overlayScale, 10);
  if (Number.isFinite(rawScale)) { try { localStorage.setItem('scoreScale', rawScale); } catch {} }
  const useScale = Number.isFinite(rawScale) ? rawScale : (parseInt(localStorage.getItem('scoreScale'), 10) || 100);
  root.style.setProperty('--score-scale', Math.max(.8, Math.min(3, useScale / 100)));
  root.style.setProperty('--score-points-font-size', `${Math.max(12, Math.min(48, parseInt(state.scoreFontSize, 10) || 18))}px`);
  root.style.setProperty('--score-content-color', state.contentColor || '#f0eef6');
  root.style.setProperty('--score-over-color', state.overColor || '#ff0000');
  root.style.setProperty('--score-bar-color-1', state.barColor1 || '#b93678');
  root.style.setProperty('--score-bar-color-2', state.barColor2 || '#ff8ed1');
  root.style.setProperty('--score-wave-color', state.waveColor || '#ffffff');
  // Đồng bộ pha sóng theo đồng hồ toàn cục → innerHTML dựng lại mỗi render vẫn không làm sóng nhảy
  root.style.setProperty('--score-flow-delay', `${(-(Date.now() % 1000) / 1000).toFixed(3)}s`);
  const stageColors = ['#ff4f9a', '#ffb84f', '#ffe66d', '#35ffcf', '#7aa7ff', '#c79cff'];
  const usedColors = stageColors.slice(0, Math.max(2, Math.min(stageColors.length, reachedMilestones + 2)));
  const c1 = state.barColor1 || '#b93678';
  const c2 = state.barColor2 || '#ff8ed1';
  // Đuôi mờ trong suốt → đầu (mép đang tiến) đậm/sáng nhất
  root.style.setProperty('--score-fill-gradient',
    state.colorByProgress
      ? progressFillGradient(pct)
      : (state.milestoneGradientEnabled && reachedMilestones > 0
        ? `linear-gradient(90deg, color-mix(in srgb, ${usedColors[0]}, transparent 62%) 0%, ${usedColors.join(', ')})`
        : `linear-gradient(90deg, color-mix(in srgb, ${c2}, transparent 74%) 0%, color-mix(in srgb, ${c2}, transparent 34%) 22%, ${c2} 46%, ${c1} 88%, color-mix(in srgb, ${c1}, #000 8%) 100%)`));
  root.innerHTML = `
    <div class="score-time"><i class="score-time-icon ${['success','failed'].includes(status) ? 'off' : 'clock'}" aria-hidden="true"></i><span>${esc(statusText)}</span></div>
    <div class="score-bar" style="--score-pct:${pct}%">
      <div class="score-fill" style="width:${pct}%"></div>
      <div class="score-sheen" style="width:${pct}%"></div>
      <div class="score-flash"></div>
      <div class="score-wave"></div>
      ${milestones}
      ${over > 0 ? `<div class="score-over">+Over: ${fmt(over)}</div>` : ''}
      ${activeRunner ? `<div class="score-pop ${Number(state.lastAdd) >= Number(state.bigGiftThreshold || 500) ? 'big' : ''} ${runnerAtStart ? 'at-start' : ''}" style="left:${runnerAtStart ? 6 : popLeft}${runnerAtStart ? 'px' : '%'}"><span>${esc(runnerUser)}${runnerPoints}</span><b>🏃</b></div>` : ''}
      <div class="score-flag">⚑</div>
    </div>
    <div class="score-meta">
      <div class="score-person">
        ${state.hideAvatar ? '' : `<div class="score-avatar">${avatar ? `<img src="${esc(avatar)}" onerror="this.onerror=null;this.src='/logo.png'" />` : '👤'}</div>`}
        ${state.hideCreator ? '' : `<div class="score-creator" title="${esc(creator)}">${esc(shortCreator)}</div>`}
      </div>
      <div class="score-points">${fmt(score)}/${fmt(target)}</div>
    </div>
    ${content ? `<div class="score-content-line"><div class="score-content">${esc(content)}</div></div>` : ''}
    ${false && state.showTopUsers !== false && topText ? `<div class="score-extra">Top: ${topText}</div>` : ''}
    `;

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
  if (!playedGoal && ['running', 'grace'].includes(status) && score >= target) {
    playedGoal = true;
    playSound(state.goalSound);
  }
  lastStatus = status;
}

render({});
// SSE tự hồi phục (overlay-sse.js) → overlay tự lên lại khi stream rớt/kẹt, không cần Ctrl+R.
connectSSE(`/score-events?token=${encodeURIComponent(token)}`, 'score', render);
