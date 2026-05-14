// PK Đôi overlay — adapt từ BIGO Action
const token = new URLSearchParams(location.search).get('token') || '';
const root = document.getElementById('pkDuoRoot');
const audio = document.getElementById('pkSound');

let lastStatus = '';
let lastUrgent = false;

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('en-US'); }
function hexToRgb(hex, fb = '0,0,0') {
  const m = String(hex || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return fb;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
function giftHtml(gift) {
  return `<span class="pkduo-gift-icon" title="${esc(gift.giftName || gift.name || '')}">${gift.icon ? `<img src="${esc(gift.icon)}" />` : '🎁'}</span>`;
}
function giftTrack(gifts) {
  const html = (gifts || []).map(giftHtml).join('');
  return `<span class="pkduo-gift-track"><span class="pkduo-gift-seq">${html}</span><span class="pkduo-gift-seq" aria-hidden="true">${html}</span><span class="pkduo-gift-seq" aria-hidden="true">${html}</span></span>`;
}
function shortName(value) {
  const s = String(value || '').trim();
  return s.length > 8 ? s.slice(0, 8) + '...' : s;
}

function playIfNew(soundUrl, status, urgent) {
  if (!soundUrl) return;
  // Chỉ play khi status mới chuyển sang trigger
  const key = `${status}|${urgent}`;
  if (key === lastStatus + '|' + lastUrgent) return;
  audio.src = soundUrl;
  audio.play().catch(() => {});
}

function render(state = {}) {
  const a = state.teamA || { name: 'ĐỘI A', color: '#FE2C55', gifts: [] };
  const b = state.teamB || { name: 'ĐỘI B', color: '#25F4EE', gifts: [] };
  const sec = Math.ceil((state.remainingMs || 0) / 1000);
  const status = state.status || 'idle';
  const statusText =
    status === 'prestart' ? `${sec}s` :
    status === 'running' ? `${sec}s` :
    status === 'finished' ? '🏁 Kết thúc' :
    status === 'grace' ? 'ĐANG TÍNH ĐIỂM' :
    (state.content || 'Vui lòng chờ');

  const aWidth = Math.max(8, Math.min(92, 50 + Number(state.push || 0)));
  const urgent = status === 'running' && sec <= 10 && sec > 0;
  const neutral = Number(state.scoreA || 0) === Number(state.scoreB || 0);
  const aLead = Number(state.scoreA || 0) > Number(state.scoreB || 0);
  const centerIcon = neutral ? '/pk-duo-neutral.svg' : '/pk-duo-rocket.svg';
  const centerClass = neutral ? 'neutral' : (aLead ? '' : 'flip');
  const barClass = neutral ? 'neutral' : (aLead ? 'lead-a' : 'lead-b');
  const sweepDelay = -((Date.now() % 3000) / 1000).toFixed(3);
  const giftDelay = -((Date.now() % 9000) / 1000).toFixed(3);

  const giftMode = state.giftDisplayMode === 'wrap' ? 'wrap' : 'scroll';
  root.innerHTML = `<div class="pkduo-board status-${esc(status)} gift-${giftMode}${urgent ? ' urgent' : ''}" style="
    --pk-a:${esc(a.color || '#FE2C55')};
    --pk-b:${esc(b.color || '#25F4EE')};
    --pk-bg:${hexToRgb(state.bgColor || '#000000')};
    --pk-bg-opacity:${((Number(state.bgOpacity ?? 82)) / 100).toFixed(2)};
    --pk-gift:${Math.max(28, Math.min(90, parseInt(state.giftSize, 10) || 46))}px;
    --pk-text:${Math.max(14, Math.min(42, parseInt(state.textSize, 10) || 21))}px;
    --pk-a-width:${aWidth}%;
    --pk-sweep-delay:${sweepDelay}s;
    --pk-gift-delay:${giftDelay}s
  ">
    ${state.content ? `<div class="pkduo-content">${esc(state.content)}</div>` : ''}
    <div class="pkduo-head">
      <b><span class="pkduo-creator left">${a.creatorAvatar ? `<img src="${esc(a.creatorAvatar)}" />` : ''}<i>${esc(shortName(a.creatorName || a.name || 'TEAM A'))}</i></span></b>
      <span>${esc(statusText)}</span>
      <b><span class="pkduo-creator right">${b.creatorAvatar ? `<img src="${esc(b.creatorAvatar)}" />` : ''}<i>${esc(shortName(b.creatorName || b.name || 'TEAM B'))}</i></span></b>
    </div>
    <div class="pkduo-gifts">
      <div class="pkduo-gift-lane left">${giftMode === 'scroll' ? giftTrack(a.gifts) : (a.gifts || []).map(giftHtml).join('')}</div>
      <i></i>
      <div class="pkduo-gift-lane right">${giftMode === 'scroll' ? giftTrack(b.gifts) : (b.gifts || []).map(giftHtml).join('')}</div>
    </div>
    <div class="pkduo-bar ${barClass}">
      <strong class="score-a">${fmt(state.scoreA)}</strong>
      <span class="pkduo-team-label a">HP MEDIA</span>
      <em class="${centerClass}"><img src="${centerIcon}" alt="" /></em>
      <span class="pkduo-team-label b">HP MEDIA</span>
      <strong class="score-b">${fmt(state.scoreB)}</strong>
    </div>
  </div>`;

  // Sound triggers
  if (status === 'prestart' && lastStatus !== 'prestart') playIfNew(state.startSound, status, urgent);
  if (urgent && !lastUrgent) playIfNew(state.warningSound, status, urgent);
  if (status === 'finished' && lastStatus !== 'finished') {
    if (Number(state.scoreA || 0) > Number(state.scoreB || 0)) playIfNew(state.teamASound, status, urgent);
    else if (Number(state.scoreB || 0) > Number(state.scoreA || 0)) playIfNew(state.teamBSound, status, urgent);
    else playIfNew(state.drawSound, status, urgent);
  }
  lastStatus = status; lastUrgent = urgent;
}

render({});
const es = new EventSource(`/pk-duo-events?token=${encodeURIComponent(token)}`);
es.addEventListener('pkduo', e => { try { render(JSON.parse(e.data || '{}')); } catch {} });
