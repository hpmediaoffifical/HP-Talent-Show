// PK Đôi overlay — adapt từ BIGO Action
const token = new URLSearchParams(location.search).get('token') || '';
if (new URLSearchParams(location.search).get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = new URLSearchParams(location.search).get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}
const root = document.getElementById('pkDuoRoot');
const audio = document.getElementById('pkSound');

let lastStatus = '';
let lastUrgent = false;
let lastRunKey = '';
let playedStart = false;
let playedWarning = false;
let playedResult = false;
let lastScoreA = 0;
let lastScoreB = 0;
let hasPrevScore = false;
// Vinh danh TOP tặng quà: nhớ MVP (top1) và tập id top3 mỗi bên để bắn hiệu ứng 1 nhịp
// khi ĐỔI người dẫn đầu / có người MỚI lọt top (innerHTML dựng lại mỗi render nên class
// một-nhịp chỉ dính đúng render phát hiện thay đổi → chạy đúng 1 lần).
let lastMvpA = '', lastMvpB = '';
let prevTopA = new Set(), prevTopB = new Set();

// --- Nội suy "đẩy máu" mượt cho ranh giới (gradient stop + tên lửa + vệt sáng) ---
// Ranh giới đọc biến --pk-a-width KẾ THỪA từ root. innerHTML dựng lại mỗi sự kiện SSE nhưng
// root.style sống sót, nên ta nội suy biến trên root bằng rAF: gradient/tên lửa/seam đều trôi
// theo cùng nhịp thay vì búng ngay. Có chút "quá đà" nhẹ (easeOutBack) tạo cảm giác lực đẩy.
const PUSH_MS = 520;
const easeOutBack = t => { const c = 1.5; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
let widthCur = 50, widthFrom = 50, widthTarget = 50, widthT0 = 0, widthRaf = 0;
function applyWidth(v) { root.style.setProperty('--pk-a-width', v.toFixed(3) + '%'); }
function stepWidth(now) {
  const t = Math.min(1, (now - widthT0) / PUSH_MS);
  widthCur = widthFrom + (widthTarget - widthFrom) * easeOutBack(t);
  applyWidth(widthCur);
  widthRaf = t < 1 ? requestAnimationFrame(stepWidth) : 0;
}
function pushWidth(target, snap) {
  // Tick đồng hồ mỗi giây re-render với cùng target: đang chạy dở thì để yên, khỏi reset easing.
  if (!snap && widthRaf && Math.abs(target - widthTarget) < 0.01) return;
  widthTarget = target;
  if (snap) {
    if (widthRaf) { cancelAnimationFrame(widthRaf); widthRaf = 0; }
    widthCur = widthFrom = target;
    applyWidth(target);
    return;
  }
  if (Math.abs(target - widthCur) < 0.01) return;
  widthFrom = widthCur;
  widthT0 = performance.now();
  if (!widthRaf) widthRaf = requestAnimationFrame(stepWidth);
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('en-US'); }
function mmss(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
// Avatar TikTok CDN load trực tiếp bị chặn trong OBS Browser Source → phải qua proxy /avatar.
function mediaUrl(value) {
  const s = String(value || '').trim();
  if (!s || /logo[\\/]hp-logo\.(png|ico)$/i.test(s)) return '/logo.png';
  if (/^https?:\/\//i.test(s)) return `/avatar?url=${encodeURIComponent(s)}`;
  return s;
}
function hexToRgb(hex, fb = '0,0,0') {
  const m = String(hex || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return fb;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
// Icon giữa (VS / tên lửa) nhúng INLINE thay vì <img src=*.svg>. Trên OBS Browser Source
// (OSR/CEF) ảnh SVG rời gắn qua <img> hay bị đen; SVG inline thì gradient render chuẩn.
const CENTER_BOOST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 48" aria-hidden="true"><defs><linearGradient id="pkBody" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#37d5ff"/><stop offset="0.48" stop-color="#ffffff"/><stop offset="1" stop-color="#ffd84d"/></linearGradient><linearGradient id="pkEdge" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#2a72ff"/><stop offset="1" stop-color="#ff5a38"/></linearGradient><linearGradient id="pkFlame" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff7a8"/><stop offset="0.5" stop-color="#ff9b32"/><stop offset="1" stop-color="#ff2b4d"/></linearGradient><radialGradient id="pkGlow" cx="0.5" cy="0.5" r="0.65"><stop offset="0" stop-color="#ffffff" stop-opacity="0.8"/><stop offset="0.55" stop-color="#5fa9ff" stop-opacity="0.32"/><stop offset="1" stop-color="#1a54ff" stop-opacity="0"/></radialGradient></defs><ellipse cx="52" cy="24" rx="40" ry="16" fill="url(#pkGlow)" opacity="0.6"/><g stroke="#ffd84d" stroke-width="2.5" stroke-linecap="round" opacity="0.85"><line x1="4" y1="10" x2="25" y2="10"/><line x1="0" y1="24" x2="28" y2="24"/><line x1="4" y1="38" x2="25" y2="38"/></g><path d="M21 24 2 13c11 1 20 5 27 11C22 31 13 35 2 35Z" fill="url(#pkFlame)"/><path d="M24 24 10 18c7 1 13 3 18 6C24 28 17 31 10 30Z" fill="#fff8b8" opacity="0.92"/><path d="M20 17H58V7L91 24 58 41V31H20l10-7Z" fill="url(#pkBody)" stroke="url(#pkEdge)" stroke-width="3" stroke-linejoin="round"/><path d="M35 17H58V11L82 24 58 37V31H35l9-7Z" fill="#ffffff" opacity="0.32"/><path d="M52 14 64 24 52 34" fill="none" stroke="#1a54ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/><circle cx="73" cy="24" r="3" fill="#ffffff"/></svg>`;
const CENTER_NEUTRAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 48" aria-hidden="true"><defs><linearGradient id="ring" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#78d6d7"/><stop offset="1" stop-color="#ffd84d"/></linearGradient><linearGradient id="vs" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#ff5f8d"/><stop offset="0.5" stop-color="#ffffff"/><stop offset="1" stop-color="#6f87ff"/></linearGradient><radialGradient id="glow" cx="0.5" cy="0.5" r="0.68"><stop offset="0" stop-color="#ffffff" stop-opacity="0.82"/><stop offset="0.48" stop-color="#78d6d7" stop-opacity="0.36"/><stop offset="1" stop-color="#78d6d7" stop-opacity="0"/></radialGradient></defs><ellipse cx="48" cy="24" rx="37" ry="17" fill="url(#glow)" opacity="0.62"/><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M22 24H8m10-8-10 8 10 8" stroke="#ff5f8d" stroke-width="5" opacity="0.95"/><path d="M74 24h14m-10-8 10 8-10 8" stroke="#6f87ff" stroke-width="5" opacity="0.95"/></g><circle cx="48" cy="24" r="18" fill="#151821" opacity="0.82" stroke="url(#ring)" stroke-width="4"/><circle cx="48" cy="24" r="11" fill="#ffffff" opacity="0.12" stroke="#ffffff" stroke-width="1.5"/><text x="48" y="29" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="950" fill="url(#vs)" letter-spacing="-1">VS</text></svg>`;
function giftHtml(gift) {
  return `<span class="pkduo-gift-icon" title="${esc(gift.giftName || gift.name || '')}">${gift.icon ? `<img src="${esc(gift.icon)}" />` : '🎁'}</span>`;
}
function giftTrack(gifts) {
  const html = (gifts || []).map(giftHtml).join('');
  return `<span class="pkduo-gift-track"><span class="pkduo-gift-seq">${html}</span><span class="pkduo-gift-seq" aria-hidden="true">${html}</span><span class="pkduo-gift-seq" aria-hidden="true">${html}</span></span>`;
}
function shortName(value) {
  const s = String(value || '').trim();
  return s.length > 18 ? s.slice(0, 18) + '...' : s;
}

// Vinh danh TOP 3 người tặng quà 1 bên.
// side 'a'/'b' quyết định màu viền (kế thừa --pk-a/--pk-b qua CSS).
// TOP1 to nhất + vương miện MVP; TOP2 vừa; TOP3 nhỏ. Thứ tự DOM luôn top1→top3;
// CSS đảo hướng bên trái để TOP1 nằm phía TRONG (sát tâm), TOP3 ngoài cùng.
// `swapMvp` = đổi MVP → bắn 1 nhịp; `entered` = Set id vừa lọt top → pop nhẹ.
function championsHtml(list, side, swapMvp, entered) {
  const top = (Array.isArray(list) ? list : []).slice(0, 3);
  if (!top.length) return '';
  return top.map((g, i) => {
    const rank = i + 1;
    const key = g.uniqueId || g.nickname || '';
    const isMvp = rank === 1;
    const cls = `pkduo-champ r${rank}${isMvp ? ' mvp' : ''}${isMvp && swapMvp ? ' swap' : ''}${entered.has(key) ? ' enter' : ''}`;
    const av = `<img src="${esc(mediaUrl(g.avatar))}" onerror="this.onerror=null;this.src='/logo.png'" />`;
    return `<span class="${cls}" title="${esc(g.nickname || key)}${g.total ? ' • ' + fmt(g.total) : ''}">${isMvp ? '<i class="pkduo-champ-crown" aria-hidden="true">👑</i>' : `<i class="pkduo-champ-rank" aria-hidden="true">${rank}</i>`}<span class="pkduo-champ-ava">${av}</span></span>`;
  }).join('');
}

function playSound(soundUrl) {
  if (!soundUrl) return;
  audio.src = soundUrl;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function render(state = {}) {
  const a = state.teamA || { name: 'ĐỘI A', color: '#FE2C55', gifts: [] };
  const b = state.teamB || { name: 'ĐỘI B', color: '#25F4EE', gifts: [] };
  const sec = Math.ceil((state.remainingMs || 0) / 1000);
  const status = state.status || 'idle';
  const runKey = String(state.startedAt || 'idle');
  if (runKey !== lastRunKey) {
    lastRunKey = runKey;
    playedStart = false;
    playedWarning = false;
    playedResult = false;
    hasPrevScore = false;
  }
  // Phát hiện bên vừa tăng điểm → tạo surge một nhịp + số nảy lên
  const sA = Number(state.scoreA || 0), sB = Number(state.scoreB || 0);
  let gainClass = '';
  if (hasPrevScore) {
    const dA = sA - lastScoreA, dB = sB - lastScoreB;
    if (dA > 0 && dB > 0) gainClass = dA >= dB ? 'gain-a' : 'gain-b';
    else if (dA > 0) gainClass = 'gain-a';
    else if (dB > 0) gainClass = 'gain-b';
  }
  const statusText =
    status === 'prestart' ? `${sec}s` :
    status === 'running' ? mmss(sec) :
    status === 'finished' ? '🏁 Kết thúc' :
    status === 'grace' ? 'ĐANG TÍNH ĐIỂM' :
    '';
  const statusIcon = status === 'finished' ? 'off' : (statusText ? 'clock' : '');

  const aWidth = Math.max(8, Math.min(92, 50 + Number(state.push || 0)));
  const urgent = status === 'running' && sec <= 10 && sec > 0;
  const neutral = Number(state.scoreA || 0) === Number(state.scoreB || 0);
  const aLead = Number(state.scoreA || 0) > Number(state.scoreB || 0);
  const showResult = status === 'finished';
  const aResult = showResult ? (neutral ? 'DRAW' : (aLead ? 'WIN' : 'LOSE')) : '';
  const bResult = showResult ? (neutral ? 'DRAW' : (aLead ? 'LOSE' : 'WIN')) : '';
  const centerIcon = neutral ? CENTER_NEUTRAL_SVG : CENTER_BOOST_SVG;
  const centerClass = neutral ? 'neutral' : (aLead ? '' : 'flip');
  const barClass = neutral ? 'neutral' : (aLead ? 'lead-a' : 'lead-b');
  const sweepDelay = -((Date.now() % 3000) / 1000).toFixed(3);
  const giftDelay = -((Date.now() % 9000) / 1000).toFixed(3);
  // Đồng bộ pha sóng chevron theo đồng hồ toàn cục → dù innerHTML dựng lại mỗi render, sóng vẫn chạy liền mạch (không nhảy 1 2 1 2)
  const flowDelay = -((Date.now() % 1000) / 1000).toFixed(3);

  const giftMode = state.giftDisplayMode === 'wrap' ? 'wrap' : 'scroll';
  const singleGiftMode = !!state.joinMode;
  // Phe chỉ chọn ≤1 quà → hiện đúng 1 quà TĨNH (không nhân 3 bản chạy marquee).
  const laneStatic = (gifts) => singleGiftMode || giftMode !== 'scroll' || (gifts || []).length <= 1;
  const giftLaneHtml = (gifts) => laneStatic(gifts) ? (gifts || []).map(giftHtml).join('') : giftTrack(gifts);
  const soloClass = (gifts) => (giftMode === 'scroll' && !singleGiftMode && (gifts || []).length <= 1) ? ' lane-static' : '';
  const contentText = String(state.content || '').trim();
  const contentLong = contentText.length > 18;
  // Nhớ scale gần nhất (localStorage) → khi OBS kết nối lại lúc app đang idle mà state rỗng, vẫn vẽ đúng cỡ ngay, không tụt về 100% (nhỏ)
  const rawScale = parseInt(state.overlayScale, 10);
  if (Number.isFinite(rawScale)) { try { localStorage.setItem('pkDuoScale', rawScale); } catch {} }
  const useScale = Number.isFinite(rawScale) ? rawScale : (parseInt(localStorage.getItem('pkDuoScale'), 10) || 100);
  const overlayScale = Math.max(.8, Math.min(3, useScale / 100));
  root.style.setProperty('--pk-scale', overlayScale);

  // --- Vinh danh TOP tặng quà: dữ liệu + phát hiện đổi MVP / người mới lọt top ---
  const topA = Array.isArray(state.topA) ? state.topA : [];
  const topB = Array.isArray(state.topB) ? state.topB : [];
  const idOf = g => g.uniqueId || g.nickname || '';
  const mvpA = idOf(topA[0] || {}), mvpB = idOf(topB[0] || {});
  const nowTopA = new Set(topA.map(idOf).filter(Boolean));
  const nowTopB = new Set(topB.map(idOf).filter(Boolean));
  // Chỉ bắn khi ĐỔI (đã có MVP trước đó và khác) → tránh lóe lúc người đầu tiên xuất hiện.
  const swapA = !!(lastMvpA && mvpA && mvpA !== lastMvpA);
  const swapB = !!(lastMvpB && mvpB && mvpB !== lastMvpB);
  // "enter" chỉ khi đã từng có danh sách trước đó (khỏi pop hàng loạt ở lần đầu).
  const enterA = new Set([...nowTopA].filter(id => prevTopA.size && !prevTopA.has(id)));
  const enterB = new Set([...nowTopB].filter(id => prevTopB.size && !prevTopB.has(id)));
  // Delay đồng bộ đồng hồ toàn cục → animation vô hạn (nhịp sáng MVP) không giật khi innerHTML dựng lại.
  const champDelay = -((Date.now() % 2400) / 1000).toFixed(3);
  const hasChamps = topA.length || topB.length;

  root.innerHTML = `<div class="pkduo-board status-${esc(status)} gift-${giftMode}${singleGiftMode ? ' gift-single' : ''}${urgent ? ' urgent' : ''} ${barClass}${gainClass ? ' ' + gainClass : ''}${hasChamps ? ' has-champs' : ''}" style="
    --pk-a:${esc(a.color || '#FE2C55')};
    --pk-b:${esc(b.color || '#25F4EE')};
    --pk-bg:${hexToRgb(state.bgColor || '#000000')};
    --pk-bg-opacity:${((Number(state.bgOpacity ?? 82)) / 100).toFixed(2)};
    --pk-gift:${Math.max(28, Math.min(90, parseInt(state.giftSize, 10) || 46))}px;
    --pk-text:${Math.max(14, Math.min(42, parseInt(state.textSize, 10) || 21))}px;
    --pk-scale:${overlayScale};
    --pk-sweep-delay:${sweepDelay}s;
    --pk-gift-delay:${giftDelay}s;
    --pk-flow-delay:${flowDelay}s;
    --pk-champ-delay:${champDelay}s
  ">
    ${contentText ? `<div class="pkduo-content${contentLong ? ' is-long' : ''}">${contentLong ? `<span class="pkduo-content-track"><span>${esc(contentText)}</span><span aria-hidden="true">${esc(contentText)}</span></span>` : `<span class="pkduo-content-text">${esc(contentText)}</span>`}</div>` : ''}
    <div class="pkduo-head">
      <b><span class="pkduo-creator left">${a.creatorAvatar ? `<img src="${esc(mediaUrl(a.creatorAvatar))}" onerror="this.onerror=null;this.src='/logo.png'" />` : ''}<i>${esc(shortName(a.name || 'TEAM A'))}</i></span></b>
      <span>${statusText ? `<i class="pkduo-time-icon ${statusIcon}" aria-hidden="true"></i><b>${esc(statusText)}</b>` : ''}</span>
      <b><span class="pkduo-creator right">${b.creatorAvatar ? `<img src="${esc(mediaUrl(b.creatorAvatar))}" onerror="this.onerror=null;this.src='/logo.png'" />` : ''}<i>${esc(shortName(b.name || 'TEAM B'))}</i></span></b>
    </div>
    <div class="pkduo-gifts">
      <div class="pkduo-gift-lane left${soloClass(a.gifts)}">${giftLaneHtml(a.gifts)}${aResult ? `<strong class="pkduo-result ${esc(aResult.toLowerCase())}">${esc(aResult)}</strong>` : ''}</div>
      <i></i>
      <div class="pkduo-gift-lane right${soloClass(b.gifts)}">${giftLaneHtml(b.gifts)}${bResult ? `<strong class="pkduo-result ${esc(bResult.toLowerCase())}">${esc(bResult)}</strong>` : ''}</div>
    </div>
    <div class="pkduo-bar ${barClass}">
      <span class="pkduo-surge"></span>
      <strong class="score-a">${fmt(state.scoreA)}</strong>
      <span class="pkduo-team-label a">HP MEDIA</span>
      <em class="${centerClass}">${centerIcon}</em>
      <span class="pkduo-team-label b">HP MEDIA</span>
      <strong class="score-b">${fmt(state.scoreB)}</strong>
    </div>
  </div><div class="pkduo-champs" aria-label="Vinh danh người tặng quà">
    <div class="pkduo-champ-side left">${championsHtml(topA, 'a', swapA, enterA)}</div>
    <div class="pkduo-champ-mid" aria-hidden="true"></div>
    <div class="pkduo-champ-side right">${championsHtml(topB, 'b', swapB, enterB)}</div>
  </div>`;

  // Đẩy ranh giới tới vị trí mới: snap khi trận mới bắt đầu / render đầu (tránh trượt từ 50%),
  // còn lại thì nội suy mượt. hasPrevScore lúc này vẫn là trạng thái trước (được set true ở cuối).
  pushWidth(aWidth, !hasPrevScore);

  // Sound triggers
  if (!playedStart && (status === 'prestart' || status === 'running')) {
    playedStart = true;
    playSound(state.startSound);
  }
  if (!playedWarning && urgent) {
    playedWarning = true;
    playSound(state.warningSound);
  }
  if (status === 'finished' && lastStatus !== 'finished') {
    if (!playedResult) {
      playedResult = true;
      if (Number(state.scoreA || 0) > Number(state.scoreB || 0)) playSound(state.teamASound);
      else if (Number(state.scoreB || 0) > Number(state.scoreA || 0)) playSound(state.teamBSound);
      else playSound(state.drawSound);
    }
  }
  lastStatus = status; lastUrgent = urgent;
  lastScoreA = sA; lastScoreB = sB; hasPrevScore = true;
  lastMvpA = mvpA; lastMvpB = mvpB; prevTopA = nowTopA; prevTopB = nowTopB;
}

render({});
// SSE tự hồi phục (connectSSE ở overlay-sse.js) → overlay tự lên lại khi stream rớt/kẹt,
// không cần Ctrl+R hay tác động OBS lúc kết nối LIVE.
connectSSE(`/pk-duo-events?token=${encodeURIComponent(token)}`, 'pkduo', render);
