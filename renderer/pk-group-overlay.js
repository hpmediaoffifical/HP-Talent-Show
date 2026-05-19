const token = new URLSearchParams(location.search).get('token') || '';
if (new URLSearchParams(location.search).get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = new URLSearchParams(location.search).get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}
const root = document.getElementById('pkGroupRoot');
let noteEl = null;
let noteKey = '';
let boardStyleKey = '';

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('en-US'); }
function hexToRgb(hex, fb = '0,0,0') {
  const m = String(hex || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return fb;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
function giftHtml(gift) {
  return `<span class="pkg-gift" title="${esc(gift.giftName || gift.name || '')}">${gift.icon ? `<img src="${esc(gift.icon)}" />` : '🎁'}</span>`;
}
function shortName(value) {
  const s = String(value || '').trim();
  return s.length > 18 ? s.slice(0, 18) + '...' : s;
}

function textColorFor(bg, enabled) {
  if (!enabled) return '#ffffff';
  const m = String(bg || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#111827' : '#ffffff';
}

function rankParticipants(participants) {
  return participants.slice().sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
}

function render(state = {}) {
  const participants = Array.isArray(state.participants) ? state.participants : [];
  const sec = Math.ceil((state.remainingMs || 0) / 1000);
  const status = state.status || 'idle';
  const urgent = status === 'running' && sec <= 10 && sec > 0;
  const statusText = status === 'prestart' ? `Chuẩn bị ${sec}s`
    : status === 'running' ? `${sec}s`
    : status === 'grace' ? 'ĐANG TÍNH ĐIỂM'
    : status === 'finished' ? 'KẾT THÚC'
    : '';
  const statusIcon = status === 'finished' ? 'off' : (statusText ? 'clock' : '');
  const layout = state.layoutMode === 'separated' ? 'separated' : 'joined';
  const total = participants.reduce((sum, p) => sum + (Number(p.score) || 0), 0);
  const max = Math.max(1, ...participants.map(p => Number(p.score) || 0));
  const minWidth = 8;
  const ranked = rankParticipants(participants);
  const leaderId = ranked[0]?.id || '';
  const boostActive = state.boostId && Date.now() - (Number(state.boostAt) || 0) < 1300;
  const boostDir = state.boostDir === 'left' ? 'left' : 'right';
  const rankMap = new Map(ranked.map((p, i) => [p.id, i + 1]));
  const widthOf = (p) => layout === 'separated'
    ? Math.max(minWidth, (Number(p.score) || 0) / max * 100)
    : (total > 0 ? Math.max(minWidth, (Number(p.score) || 0) / total * 100) : 100 / Math.max(1, participants.length));
  const joinedDirOf = (p) => {
    let mid = 0;
    for (const item of participants) {
      const w = widthOf(item);
      if (item.id === p.id) return mid + w / 2 > 50 ? 'left' : 'right';
      mid += w;
    }
    return boostDir;
  };

  const body = layout === 'joined'
    ? `<div class="pkg-joined-stage">
        <div class="pkg-joined-names">${participants.map(p => `<div style="--c:${esc(p.color || '#FE2C55')};--tc:${textColorFor(p.color, state.autoTextContrast)};width:${widthOf(p)}%">${p.avatar ? `<img src="${esc(p.avatar)}" />` : ''}<b>${esc(shortName(p.name || p.tiktokId || 'Creator'))}</b></div>`).join('')}</div>
        <div class="pkg-joined-bar">${participants.map(p => {
          const isLeader = p.id === leaderId;
          const score = Number(p.score) || 0;
          const streak = Number(p.streak) || 0;
          return `<div class="pkg-segment${isLeader ? ' leader' : ''}" style="--c:${esc(p.color || '#FE2C55')};--tc:${textColorFor(p.color, state.autoTextContrast)};width:${widthOf(p)}%"><b>${isLeader ? `Hạng 1 (${fmt(score)})` : fmt(score)}</b>${boostActive && state.boostId === p.id ? `<span class="pkg-boost dir-${joinedDirOf(p)}" aria-hidden="true"><i></i></span>` : ''}${streak > 0 ? `<span class="pkg-streak" title="MVP ${fmt(streak)}"><small>MVP</small><em>${fmt(streak)}</em></span>` : ''}</div>`;
        }).join('')}</div>
        <div class="pkg-joined-gifts">${participants.map(p => `<div style="--c:${esc(p.color || '#FE2C55')};width:${widthOf(p)}%">${(p.gifts || []).map(giftHtml).join('')}</div>`).join('')}</div>
      </div>`
    : `<div class="pkg-separated-list">${participants.map(p => {
        const score = Number(p.score) || 0;
        const width = widthOf(p);
        const isLeader = p.id === leaderId;
        return `<div class="pkg-card${isLeader ? ' leader' : ''}" style="--c:${esc(p.color || '#FE2C55')};--tc:${textColorFor(p.color, state.autoTextContrast)}">
          <div class="pkg-card-person">${p.avatar ? `<img src="${esc(p.avatar)}" />` : ''}<b>${esc(shortName(p.name || p.tiktokId || 'Creator'))}</b></div>
          <div class="pkg-card-head"><div class="pkg-card-bar${isLeader ? ' leader' : ''}"><i style="width:${width}%"></i><b>${isLeader ? `Hạng 1 (${fmt(score)})` : fmt(score)}</b>${boostActive && state.boostId === p.id ? `<span class="pkg-boost dir-${boostDir}" style="--boost-left:${width}%" aria-hidden="true"><i></i></span>` : ''}${Number(p.streak) > 0 ? `<span class="pkg-streak" title="MVP ${fmt(p.streak)}"><small>MVP</small><em>${fmt(p.streak)}</em></span>` : ''}</div></div>
          <div class="pkg-card-gifts">${(p.gifts || []).map(giftHtml).join('')}</div>
        </div>`;
      }).join('')}</div>`;
  const noteText = String(state.noteText || '').trim();
  const noteLong = noteText.length > 42;
  const nextNoteKey = state.noteEnabled && noteText
    ? JSON.stringify([noteText, noteLong, state.noteEffect || 'soft', state.noteBgColor || '#1f2430', state.noteTextColor || '#fff', Math.max(6, Number(state.noteSpeedSec) || 16)])
    : '';
  const overlayScale = Math.max(.8, Math.min(3, (parseInt(state.overlayScale, 10) || 100) / 100));
  const sparkDelay = -((Date.now() % 1800) / 1000).toFixed(3);
  root.style.setProperty('--pkg-scale', overlayScale);

  if (!root.querySelector('.pkg-board')) {
    root.innerHTML = '<div class="pkg-board"><div id="pkgNoteMount"></div><div id="pkgBodyMount"></div><div class="pkg-title"><b></b></div></div>';
  }
  const board = root.querySelector('.pkg-board');
  board.className = `pkg-board mode-${layout} status-${esc(status)}${urgent ? ' urgent' : ''}`;
  const nextBoardStyleKey = [state.textSize, state.giftSize, state.separatedGap, overlayScale].join('|');
  if (boardStyleKey !== nextBoardStyleKey) {
    boardStyleKey = nextBoardStyleKey;
    board.style.cssText = `
    --pkg-text:${Math.max(14, Math.min(42, parseInt(state.textSize, 10) || 20))}px;
    --pkg-gift:${Math.max(28, Math.min(90, parseInt(state.giftSize, 10) || 42))}px;
    --pkg-separated-gap:${Math.max(0, Math.min(800, parseInt(state.separatedGap, 10) || 0))}px;
    --pkg-scale:${overlayScale};
  `;
  }
  board.style.setProperty('--pkg-spark-delay', `${sparkDelay}s`);
  const bodyMount = document.getElementById('pkgBodyMount');
  if (bodyMount) bodyMount.innerHTML = body;
  const title = board.querySelector('.pkg-title b');
  if (title) title.innerHTML = statusText ? `<span class="pkg-time-icon ${statusIcon}" aria-hidden="true"></span><span>${esc(statusText)}</span>` : '';

  const noteMount = document.getElementById('pkgNoteMount');
  if (noteMount && nextNoteKey) {
    if (!noteEl || noteKey !== nextNoteKey) {
      noteMount.replaceChildren();
      const div = document.createElement('div');
      div.innerHTML = `<div class="pkg-note pkg-note-${esc(state.noteEffect || 'soft')}${noteLong ? ' is-long' : ''}" style="--note-bg:${esc(state.noteBgColor || '#1f2430')};--note-color:${esc(state.noteTextColor || '#fff')};--note-speed:${Math.max(6, Number(state.noteSpeedSec) || 16)}s">${noteLong ? `<span><i>${esc(noteText)}</i><i aria-hidden="true">${esc(noteText)}</i></span>` : `<b>${esc(noteText)}</b>`}</div>`;
      noteEl = div.firstElementChild;
      noteKey = nextNoteKey;
    }
    if (noteEl.parentNode !== noteMount) noteMount.appendChild(noteEl);
  } else {
    noteMount?.replaceChildren();
    noteEl = null;
    noteKey = '';
  }
}

render({});
const es = new EventSource(`/pk-group-events?token=${encodeURIComponent(token)}`);
es.addEventListener('pkgroup', e => { try { render(JSON.parse(e.data || '{}')); } catch {} });
