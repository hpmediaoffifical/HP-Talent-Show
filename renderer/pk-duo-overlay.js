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
function fmt(n) { return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('vi-VN'); }
function mmss(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
// Avatar TikTok CDN load trực tiếp bị chặn trong OBS Browser Source → phải qua proxy /avatar.
function mediaUrl(value, key = '') {
  const s = String(value || '').trim();
  if (!s || /logo[\\/]hp-logo\.(png|ico)$/i.test(s)) return '/logo.png';
  if (/^[a-f0-9]{40}$/i.test(key)) return `/avatar?key=${encodeURIComponent(key)}`;
  if (/^https?:\/\//i.test(s)) return `/avatar?url=${encodeURIComponent(s)}`;
  return s;
}
// Ảnh avatar lỗi (proxy cold-miss/timeout tức thời trên OBS) → THỬ LẠI vài lần rồi mới rơi về logo,
// thay vì kẹt logo vĩnh viễn. Bust cache trình duyệt bằng &_r để không dùng lại lỗi đã cache;
// proxy cache theo URL gốc nên lần thử sau phục vụ ngay từ cache ấm.
window.avRetry = function (img) {
  const n = +(img.dataset.avTry || 0);
  if (n >= 3 || !/\/avatar\?/.test(img.src)) { img.onerror = null; img.src = '/logo.png'; return; }
  img.dataset.avTry = n + 1;
  const clean = img.src.replace(/[?&]_r=\d+/, '');
  setTimeout(() => { img.src = clean + (clean.includes('?') ? '&' : '?') + '_r=' + (n + 1); }, 500 + n * 800);
};
function hexToRgb(hex, fb = '0,0,0') {
  const m = String(hex || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return fb;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
// Icon giữa (VS / tên lửa) nhúng INLINE thay vì <img src=*.svg>. Trên OBS Browser Source
// (OSR/CEF) ảnh SVG rời gắn qua <img> hay bị đen; SVG inline thì gradient render chuẩn.
// Mũi tên "boost dial" giữa thanh máu: đĩa tròn gọn (footprint hình tròn nên XOAY không lòi ra
// ngoài thanh cao 42px, không bị OBS cắt), mũi tên chevron cyan→vàng chỉ hướng đẩy. Đứng yên thì
// xoay vòng tròn (pkDuoArrowSpin), có người lên quà thì lao tới / bị đẩy lùi (pkDuoArrowDash*).
const CENTER_ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="pkArrShaft" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#37d5ff"/><stop offset="1" stop-color="#eafcff"/></linearGradient><linearGradient id="pkArrHead" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#eafcff"/><stop offset="1" stop-color="#ffd84d"/></linearGradient><radialGradient id="pkArrGlow" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#eafcff" stop-opacity="0.9"/><stop offset="0.55" stop-color="#37d5ff" stop-opacity="0.35"/><stop offset="1" stop-color="#1a54ff" stop-opacity="0"/></radialGradient></defs><circle cx="24" cy="24" r="23" fill="url(#pkArrGlow)"/><circle cx="24" cy="24" r="17" fill="#0e2233" opacity="0.55" stroke="#eafcff" stroke-opacity="0.35" stroke-width="1.5"/><g stroke="#37d5ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.55"><path d="M6 17 12 24 6 31"/></g><g stroke-linecap="round" stroke-linejoin="round"><path d="M12 24H28" fill="none" stroke="url(#pkArrShaft)" stroke-width="6"/><path d="M26 13 42 24 26 35Z" fill="url(#pkArrHead)" stroke="#1a9fd6" stroke-width="2"/></g><circle cx="15" cy="24" r="3.2" fill="#ffffff"/></svg>`;
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
    const av = `<img src="${esc(mediaUrl(g.avatar))}" onerror="avRetry(this)" />`;
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
  // Chuỗi WIN: hiện "WIN: N" ở hàng dưới (ngang avatar người tặng quà), sát mép ngoài mỗi bên.
  // Nền pill vàng đặc → nổi rõ trên video, không bị chìm như đặt trên nền tối phần đầu. Bên không có chuỗi thì ẩn.
  const aStreak = Math.max(0, parseInt(a.winStreak, 10) || 0);
  const bStreak = Math.max(0, parseInt(b.winStreak, 10) || 0);
  // Bậc leo thang: WIN càng cao càng rực (chỉ bằng MÀU + nhịp nhấp nháy, không icon).
  // t1(1-2) xám gọn → t5(10+) vàng huyền thoại. Badge nằm trong luồng flex, cách avatar TOP MVP bằng gap+margin.
  const streakTier = (n) => n >= 10 ? 't5' : n >= 7 ? 't4' : n >= 5 ? 't3' : n >= 3 ? 't2' : 't1';
  const streakBadge = (n, side) => n > 0 ? `<b class="pkduo-win-streak ${side} ${streakTier(n)}">WIN: ${n}</b>` : '';
  const centerIcon = CENTER_ARROW_SVG;
  // Mũi tên luôn XOAY khi đứng yên; hướng chỉ (flip) chỉ lộ ra lúc lao/đẩy (dash) vì lúc đó ngừng xoay.
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
  const useScale = Number.isFinite(rawScale) ? rawScale : (parseInt(localStorage.getItem('pkDuoScale'), 10) || 200);
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
      <b><span class="pkduo-creator left">${a.creatorAvatar ? `<img src="${esc(mediaUrl(a.creatorAvatar, a.creatorAvatarKey))}" onerror="avRetry(this)" />` : ''}<i>${esc(shortName(a.name || 'TEAM A'))}</i></span></b>
      <span>${statusText ? `<i class="pkduo-time-icon ${statusIcon}" aria-hidden="true"></i><b>${esc(statusText)}</b>` : ''}</span>
      <b><span class="pkduo-creator right">${b.creatorAvatar ? `<img src="${esc(mediaUrl(b.creatorAvatar, b.creatorAvatarKey))}" onerror="avRetry(this)" />` : ''}<i>${esc(shortName(b.name || 'TEAM B'))}</i></span></b>
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
    <div class="pkduo-champ-side left">${championsHtml(topA, 'a', swapA, enterA)}${streakBadge(aStreak, 'a')}</div>
    <div class="pkduo-champ-mid" aria-hidden="true"></div>
    <div class="pkduo-champ-side right">${championsHtml(topB, 'b', swapB, enterB)}${streakBadge(bStreak, 'b')}</div>
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
