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

// --- Động lượng (momentum) + combo cho mũi tên: tính CLIENT-SIDE từ biến động điểm ---
// momA/momB = EMA điểm ghi gần đây mỗi bên (phân rã theo thời gian thực), cho biết ai ĐANG lên tay
// (khác tổng điểm). momSig ∈ [-1..1] (+ = A lên tay). Lean của "lõi" nội suy mượt bằng rAF trên
// biến --pk-mom ở root (sống sót qua innerHTML dựng lại, giống --pk-a-width).
let momA = 0, momB = 0, momClock = 0;
let momCur = 0, momFrom = 0, momTarget = 0, momT0 = 0, momRaf = 0;
function applyMom(v) { root.style.setProperty('--pk-mom', v.toFixed(4)); root.style.setProperty('--pk-mom-abs', Math.abs(v).toFixed(4)); }
function stepMom(now) {
  const t = Math.min(1, (now - momT0) / PUSH_MS);
  momCur = momFrom + (momTarget - momFrom) * easeOutBack(t);
  applyMom(momCur);
  momRaf = t < 1 ? requestAnimationFrame(stepMom) : 0;
}
function pushMom(target, snap) {
  if (snap) { if (momRaf) { cancelAnimationFrame(momRaf); momRaf = 0; } momCur = momFrom = momTarget = target; applyMom(target); return; }
  if (momRaf && Math.abs(target - momTarget) < 0.001) return;
  if (Math.abs(target - momCur) < 0.001) { momTarget = target; return; }
  momTarget = target; momFrom = momCur; momT0 = performance.now();
  if (!momRaf) momRaf = requestAnimationFrame(stepMom);
}
// Combo: số lần một bên ghi điểm liên tiếp trong cửa sổ ~4.5s.
let comboSide = '', comboCount = 0, comboAt = 0;
// Layout Douyin — "+N" loé tại ranh giới: nhớ lần đẩy gần nhất để giữ hiện ~1.1s qua vài nhịp SSE.
let dyPushAmt = 0, dyPushSide = '', dyPushAt = 0;

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
// SKIN "Lõi động lượng": quả cầu năng lượng (SVG neutral, viền/quầng tô màu bên đang lên tay bằng CSS var).
const CORE_ORB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" aria-hidden="true"><defs><radialGradient id="pkCoreG" cx="0.42" cy="0.4" r="0.62"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#eafcff"/><stop offset="1" stop-color="#2aa7dd"/></radialGradient></defs><circle cx="20" cy="20" r="11" fill="url(#pkCoreG)"/><circle cx="20" cy="20" r="11" fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="1.4"/><circle cx="15.5" cy="15.5" r="2.6" fill="#ffffff"/></svg>`;
// SKIN "Dây kéo co": nút thắt dây thừng ở ranh giới.
const ROPE_KNOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="11" fill="#3a2a17" stroke="#e8c48a" stroke-width="2.4"/><path d="M11 14 L29 26 M11 26 L29 14 M20 8 L20 32" stroke="#f0d29a" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>`;
// SKIN "Pháo combo": nòng pháo chỉ hướng đẩy (flip như classic), có quầng sạc theo combo.
const CANNON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 40" aria-hidden="true"><defs><radialGradient id="pkCanGlow" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#ffe89a" stop-opacity="0.9"/><stop offset="1" stop-color="#ff9a2a" stop-opacity="0"/></radialGradient></defs><g stroke-linejoin="round"><rect x="5" y="13" width="19" height="14" rx="4" fill="#26314c" stroke="#7fd4ff" stroke-width="2"/><path d="M22 10 L40 20 L22 30 Z" fill="#ffd84d" stroke="#e0a83c" stroke-width="2"/><circle cx="12" cy="20" r="4.4" fill="url(#pkCanGlow)"/><circle cx="12" cy="20" r="3" fill="#eafcff"/></g></svg>`;
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
function championsHtml(list, side, swapMvp, entered, showName) {
  const top = (Array.isArray(list) ? list : []).slice(0, 3);
  if (!top.length) return '';
  return top.map((g, i) => {
    const rank = i + 1;
    const key = g.uniqueId || g.nickname || '';
    const isMvp = rank === 1;
    const cls = `pkduo-champ r${rank}${isMvp ? ' mvp' : ''}${isMvp && swapMvp ? ' swap' : ''}${entered.has(key) ? ' enter' : ''}`;
    const av = `<img src="${esc(mediaUrl(g.avatar))}" onerror="avRetry(this)" />`;
    // Tên MVP: nameplate mờ đè đáy avatar (chỉ TOP1, khi bật) → không đội khung, không tràn hàng.
    const nameTag = (isMvp && showName && (g.nickname || key)) ? `<b class="pkduo-champ-name">${esc(g.nickname || key)}</b>` : '';
    return `<span class="${cls}" title="${esc(g.nickname || key)}${g.total ? ' • ' + fmt(g.total) : ''}">${isMvp ? '<i class="pkduo-champ-crown" aria-hidden="true">👑</i>' : `<i class="pkduo-champ-rank" aria-hidden="true">${rank}</i>`}<span class="pkduo-champ-ava">${av}</span>${nameTag}</span>`;
  }).join('');
}

function playSound(soundUrl) {
  if (!soundUrl) return;
  audio.src = soundUrl;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

// Bố cục Douyin: icon quà VƯỢT bề rộng lane (quá nền thẻ) thì tự cuộn (marquee) — chỉ khi chế độ Cuộn ('scroll').
// Nhân đôi seq để translateX(-50%) liền mạch; đồng bộ pha theo đồng hồ chung → không giật khi render dựng lại DOM.
function wireDyGiftMarquee(scrollMode) {
  if (!scrollMode) return;
  root.querySelectorAll('.dy-gift').forEach(lane => {
    const seq = lane.querySelector('.dy-gift-seq');
    if (!seq) return;
    const oneW = seq.scrollWidth;
    if (oneW > lane.clientWidth + 2) {
      lane.classList.add('is-scroll');
      seq.innerHTML += seq.innerHTML;                 // 2 bản → -50% liền mạch
      const dur = Math.max(6, oneW / 46);             // ~46px/giây
      lane.style.setProperty('--dy-gift-dur', dur.toFixed(2) + 's');
      lane.style.setProperty('--dy-gift-delay', (-((Date.now() / 1000) % dur)).toFixed(3) + 's');
    }
  });
}

function render(state = {}) {
  // 🎨 Skin mùa lễ (dùng chung) — trang trí ở <body>, độc lập với việc dựng lại root mỗi render.
  if (window.OverlaySkin) OverlaySkin.applySkin(state.skin);
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
    momA = momB = momClock = 0; comboSide = ''; comboCount = 0; comboAt = 0; pushMom(0, true);
    dyPushAmt = 0; dyPushSide = ''; dyPushAt = 0;
  }
  // Phát hiện bên vừa tăng điểm → tạo surge một nhịp + số nảy lên
  const sA = Number(state.scoreA || 0), sB = Number(state.scoreB || 0);
  const dA = hasPrevScore ? sA - lastScoreA : 0;
  const dB = hasPrevScore ? sB - lastScoreB : 0;
  let gainClass = '';
  if (dA > 0 && dB > 0) gainClass = dA >= dB ? 'gain-a' : 'gain-b';
  else if (dA > 0) gainClass = 'gain-a';
  else if (dB > 0) gainClass = 'gain-b';
  // --- Cập nhật ĐỘNG LƯỢNG (EMA phân rã theo thời gian thực) + COMBO ---
  const nowMs = performance.now();
  if (momClock) { const k = Math.exp(-(nowMs - momClock) / 2200); momA *= k; momB *= k; }
  momClock = nowMs;
  if (dA > 0) momA += dA;
  if (dB > 0) momB += dB;
  const momSig = (momA + momB) > 0 ? (momA - momB) / (momA + momB) : 0; // [-1..1], + = A đang lên tay
  if (dA > 0 || dB > 0) {
    const gs = dA >= dB ? 'A' : 'B';
    if (gs === comboSide && (nowMs - comboAt) < 4500) comboCount++; else { comboSide = gs; comboCount = 1; }
    comboAt = nowMs;
  } else if (comboAt && (nowMs - comboAt) > 4500) { comboCount = 0; comboSide = ''; }
  // Đếm lùi khẩn cấp: giây thứ 10 → đồng hồ LẮC LƯ báo hiệu (số vẫn đứng yên);
  // từ giây 9 trở đi → hiện SỐ GIÂY nguyên TO + chớp đỏ, bỏ icon cho gọn giữa.
  const tick10 = status === 'running' && sec === 10;
  const finalCount = status === 'running' && sec <= 9 && sec > 0;
  const statusText =
    status === 'prestart' ? `${sec}` :
    status === 'running' ? (finalCount ? String(sec) : mmss(sec)) :
    status === 'finished' ? 'Kết thúc' :
    status === 'grace' ? 'ĐANG TÍNH ĐIỂM' :
    '';
  // Kết thúc / 9s cuối / prestart 3-2-1: KHÔNG icon để SỐ căn giữa gọn & to; running (>10s) & grace vẫn có đồng hồ.
  const statusIcon = (status === 'finished' || finalCount || status === 'prestart') ? '' : (statusText ? 'clock' : '');

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
  // Mũi tên ĐỨNG YÊN, chỉ về phía bên đang bị đẩy (bên thua): A dẫn → chỉ phải (về B); B dẫn → flip chỉ trái.
  const centerClass = neutral ? 'neutral' : (aLead ? '' : 'flip');
  const barClass = neutral ? 'neutral' : (aLead ? 'lead-a' : 'lead-b');

  // ===== SKIN MŨI TÊN =====
  // classic (đứng yên chỉ hướng) | core (lõi động lượng) | rope (dây kéo co) | cannon (pháo combo).
  const arrowStyle = ['classic', 'core', 'rope', 'cannon'].includes(state.arrowStyle) ? state.arrowStyle : 'classic';
  pushMom(momSig, !hasPrevScore);
  const surgeSide = momSig >= 0 ? 'a' : 'b';           // bên đang lên tay → tô màu lõi/đuôi
  const surgeCol = surgeSide === 'a' ? (a.color || '#FE2C55') : (b.color || '#25F4EE');
  const comboTier = comboCount >= 6 ? 3 : comboCount >= 4 ? 2 : comboCount >= 2 ? 1 : 0;
  // Trạng thái trận (áp dụng mọi skin): áp đảo (cách biệt lớn) / lội ngược dòng (bên thua đang lên tay mạnh).
  const gap = Math.abs(Number(state.push || 0));
  const blowout = status === 'running' && gap >= 30;
  const comeback = status === 'running' && !neutral && Math.abs(momSig) > 0.4 && ((aLead && momSig < 0) || (!aLead && momSig > 0));
  // Dựng phần tử giữa theo skin + lớp phụ (dây thừng / đạn pháo).
  let emInner, emExtra = '', barExtra = '', comboBadge = '';
  if (arrowStyle === 'core') {
    emInner = `<span class="pk-core-tail" aria-hidden="true"></span><span class="pk-core-ring" aria-hidden="true"></span><span class="pk-core-orb">${CORE_ORB_SVG}</span>`;
    emExtra = ` mom-${surgeSide}${comboTier ? ` charge-c${comboTier}` : ''}`;
  } else if (arrowStyle === 'rope') {
    emInner = ROPE_KNOT_SVG;
    barExtra = `<span class="pk-rope" aria-hidden="true"></span>`;
  } else if (arrowStyle === 'cannon') {
    emInner = `<span class="pk-shot" aria-hidden="true"></span>${CANNON_SVG}`;
    emExtra = comboTier ? ` charge-c${comboTier}` : '';
  } else {
    emInner = CENTER_ARROW_SVG;
  }
  const emClass = `arw-${arrowStyle} ${centerClass}${emExtra}`;
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

  // --- Fragments dùng chung cả 2 bố cục ---
  const contentHtml = contentText ? `<div class="pkduo-content${contentLong ? ' is-long' : ''}">${contentLong ? `<span class="pkduo-content-track"><span>${esc(contentText)}</span><span aria-hidden="true">${esc(contentText)}</span></span>` : `<span class="pkduo-content-text">${esc(contentText)}</span>`}</div>` : '';
  const creatorLeftHtml = `<b><span class="pkduo-creator left">${a.creatorAvatar ? `<img src="${esc(mediaUrl(a.creatorAvatar, a.creatorAvatarKey))}" onerror="avRetry(this)" />` : ''}<i>${esc(shortName(a.name || 'TEAM A'))}</i></span></b>`;
  const creatorRightHtml = `<b><span class="pkduo-creator right">${b.creatorAvatar ? `<img src="${esc(mediaUrl(b.creatorAvatar, b.creatorAvatarKey))}" onerror="avRetry(this)" />` : ''}<i>${esc(shortName(b.name || 'TEAM B'))}</i></span></b>`;
  const statusInner = statusText ? `${statusIcon ? `<i class="pkduo-time-icon ${statusIcon}" aria-hidden="true"></i>` : ''}<b>${esc(statusText)}</b>` : '';
  const resultA = aResult ? `<strong class="pkduo-result ${esc(aResult.toLowerCase())}">${esc(aResult)}</strong>` : '';
  const resultB = bResult ? `<strong class="pkduo-result ${esc(bResult.toLowerCase())}">${esc(bResult)}</strong>` : '';
  const showGifterName = state.championNames === true;
  const champsAHtml = championsHtml(topA, 'a', swapA, enterA, showGifterName);
  const champsBHtml = championsHtml(topB, 'b', swapB, enterB, showGifterName);
  const barHtml = `<div class="pkduo-bar ${barClass} arw-style-${arrowStyle}${blowout ? ' blowout' : ''}${comeback ? ' comeback' : ''}">
      <span class="pkduo-surge"></span>
      ${barExtra}
      <strong class="score-a">${fmt(state.scoreA)}</strong>
      <span class="pkduo-team-label a">HP MEDIA</span>
      <em class="${emClass}" style="--pk-surge:${esc(surgeCol)};--pk-surge-rgb:${hexToRgb(surgeCol, '55,213,255')}">${emInner}${comboBadge}</em>
      <span class="pkduo-team-label b">HP MEDIA</span>
      <strong class="score-b">${fmt(state.scoreB)}</strong>
    </div>`;

  const boardStyle = `
    --pk-a:${esc(a.color || '#FE2C55')};
    --pk-a-rgb:${hexToRgb(a.color || '#FE2C55', '254,44,85')};
    --pk-b:${esc(b.color || '#25F4EE')};
    --pk-b-rgb:${hexToRgb(b.color || '#25F4EE', '37,244,238')};
    --pk-bg:${hexToRgb(state.bgColor || '#000000')};
    --pk-bg-opacity:${((Number(state.bgOpacity ?? 82)) / 100).toFixed(2)};
    --pk-gift:${Math.max(28, Math.min(90, parseInt(state.giftSize, 10) || 46))}px;
    --pk-text:${Math.max(14, Math.min(42, parseInt(state.textSize, 10) || 21))}px;
    --pk-scale:${overlayScale};
    --pk-sweep-delay:${sweepDelay}s;
    --pk-gift-delay:${giftDelay}s;
    --pk-flow-delay:${flowDelay}s;
    --pk-champ-delay:${champDelay}s`;
  const boardClass = `pkduo-board status-${esc(status)} gift-${giftMode}${singleGiftMode ? ' gift-single' : ''}${urgent ? ' urgent' : ''}${tick10 ? ' tick10' : ''}${finalCount ? ' final-count' : ''} ${barClass}${gainClass ? ' ' + gainClass : ''}${hasChamps ? ' has-champs' : ''}`;

  if (state.barLayout === 'douyin') {
    // ===== BỐ CỤC DOUYIN =====
    // Thanh máu nổi (không hộp): điểm 2 đầu là pill, gạch trắng dày = ranh giới; "+N" xanh loé khi đẩy,
    // số đếm lùi TO độc lập ở ranh giới trong 10s cuối. Dưới thanh: [chuỗi][thẻ Creator][đồng hồ][thẻ Creator][chuỗi].
    // Thẻ = tên + icon+tên quà của phe + avatar Creator (phía trong). Kết thúc: WIN/LOSE + hàng avatar TOP người tặng.
    // Cập nhật "+N": ghi lại lần đẩy để giữ hiện qua vài nhịp (render ~250ms/lần) → chữ không chớp tắt tức thì.
    if (dA > 0 || dB > 0) { dyPushAmt = Math.max(dA, dB); dyPushSide = dA >= dB ? 'a' : 'b'; dyPushAt = nowMs; }
    const showPush = dyPushAmt > 0 && (nowMs - dyPushAt) < 1100;
    const dyUrgent = status === 'running' && sec <= 10 && sec > 0;
    // 10s cuối (giống Douyin): CHỈ số, nằm ngay vùng đồng hồ giữa nhưng tách biệt + to hơn (không đặt ở ranh giới).
    const dyTimer =
      status === 'prestart' ? `<b class="big">${sec}</b>` :
      status === 'running' ? (dyUrgent ? `<b class="dy-final">${sec}</b>` : mmss(sec)) :
      status === 'finished' ? 'KẾT THÚC' :
      status === 'grace' ? 'TÍNH ĐIỂM' : '';
    // CHỈ icon quà (bỏ tên) → hiện được NHIỀU icon của phe; rỗng nếu không có quà.
    const dyGiftTag = (gifts) => {
      const list = (Array.isArray(gifts) ? gifts : (gifts ? [gifts] : [])).filter(Boolean);
      if (!list.length) return '';
      const icons = list.map(g => g.icon ? `<img src="${esc(g.icon)}" title="${esc(g.giftName || g.name || '')}" />` : '<span class="dy-gift-emo">🎁</span>').join('');
      return `<span class="dy-gift"><span class="dy-gift-seq">${icons}</span></span>`;
    };
    // TOP người tặng: MVP (rank 1) DOM đầu → CSS đẩy về phía TRONG (gần Creator) + to hơn; số 1/2/3 tối giản.
    const dyGifterSet = (list) => (Array.isArray(list) ? list : []).slice(0, 3).map((g, i) => `<span class="dy-gitem r${i + 1}"><img class="dy-gav" src="${esc(mediaUrl(g.avatar))}" onerror="avRetry(this)" /><i class="dy-grank">${i + 1}</i></span>`).join('');
    // Nền CHUỖI 2 lớp hình mũi tên hướng về Creator: l2 (sau) màu phe, mờ nhiều, mũi bo cong nhẹ chĩa ra;
    // l1 (trước) màu vàng hơi mờ ôm số. Side B lật ngang bằng CSS. Fill tô qua CSS (đọc --pk-*-rgb, OBS-safe).
    // 2 lớp CÙNG hình (cạnh chéo cùng độ dốc run24/rise27 → song song, mũi tên giống nhau), chỉ KHÁC chiều dài:
    // l2 (sau) dài tới x106, l1 (trước) ngắn tới x68 → phần hồng vươn khỏi khối vàng là mũi tên song song.
    const DY_STREAK_BG = `<span class="dy-streak-bg" aria-hidden="true"><svg viewBox="0 0 108 58" preserveAspectRatio="none"><path class="l2" d="M2 2 L82 2 L106 29 L82 56 L2 56 Z"/><path class="l1" d="M2 2 L44 2 L68 29 L44 56 L2 56 Z"/></svg></span>`;
    // CHỈ phe CÓ chuỗi mới hiện hình + thông tin chuỗi; phe không có (0) để ô trống giữ chỗ (không nhảy layout).
    const dyStreak = (n, side) => `<div class="dy-streak ${side}">${n > 0 ? `${DY_STREAK_BG}<span class="n">${n}</span><span class="lb">CHUỖI</span>` : ''}</div>`;
    const dyAva = (t) => `<img class="dy-ava" src="${esc(mediaUrl(t.creatorAvatar, t.creatorAvatarKey))}" onerror="avRetry(this)" />`;
    // Đốm trắng "bong bóng" (phẳng, không 3D) bay từ gạch trắng ra 2 bên → cảm giác đẩy nhẹ.
    // Tham số to/nhỏ/lệch cố định theo index (không random mỗi render kẻo giật); delay đồng bộ đồng hồ chung.
    let dyBubblesHtml = '';
    if (status === 'running' || status === 'prestart') {
      const BN = 12, BDUR = 2600, SZ = [8, 13, 6, 11, 9, 15, 7, 12, 6, 13, 9, 11];
      let bs = '';
      for (let i = 0; i < BN; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        const dist = 40 + ((i * 13) % 48);
        const vy = ((i * 29) % 32) - 16;
        const delay = (-(((Date.now() + i * (BDUR / BN)) % BDUR) / 1000)).toFixed(3);
        bs += `<i class="dy-bubble" style="--bs:${SZ[i]}px;--bx:${dir * dist}px;--by:${vy}px;animation-delay:${delay}s"></i>`;
      }
      dyBubblesHtml = `<span class="dy-bubbles" aria-hidden="true">${bs}</span>`;
    }
    root.innerHTML = `<div class="${boardClass} dy-layout" style="${boardStyle}">
    <div class="dy-bar ${barClass}">
      <strong class="dy-score a">${fmt(state.scoreA)}</strong>
      <strong class="dy-score b">${fmt(state.scoreB)}</strong>
      ${dyBubblesHtml}
      <span class="dy-seam" aria-hidden="true"></span>
      ${showPush ? `<span class="dy-push ${dyPushSide}">+${fmt(dyPushAmt)}</span>` : ''}
      ${dyUrgent ? `<b class="dy-bigcount">${sec}</b>` : ''}
    </div>
    <div class="dy-row">
      ${dyStreak(aStreak, 'a')}
      <div class="dy-card a">
        <div class="dy-card-text"><div class="dy-name">${esc(shortName(a.name || 'TEAM A'))}</div>${dyGiftTag(a.gifts)}</div>
        ${dyAva(a)}
        ${resultA}
      </div>
      <div class="dy-timer">${dyTimer}</div>
      <div class="dy-card b">
        ${dyAva(b)}
        <div class="dy-card-text"><div class="dy-name">${esc(shortName(b.name || 'TEAM B'))}</div>${dyGiftTag(b.gifts)}</div>
        ${resultB}
      </div>
      ${dyStreak(bStreak, 'b')}
    </div>
    ${showResult ? `<div class="dy-under" aria-label="TOP người tặng"><div class="dy-gset a">${dyGifterSet(topA)}</div><div class="dy-gset b">${dyGifterSet(topB)}</div></div>` : ''}
  </div>`;
    wireDyGiftMarquee(state.giftDisplayMode !== 'wrap');
  } else if (singleGiftMode) {
    // ===== BỐ CỤC CHỌN PHE (1 quà) =====
    // Head: [Avatar+tên Creator A] · ‹ Vòng N ›/‹ Chuỗi đấu › · [tên+Avatar Creator B]
    // Action: [icon quà + avatar người tặng A] · [đếm lùi / KẾT THÚC] · [avatar người tặng B + icon quà]
    //   → WIN/LOSE đè lên cụm avatar+tên người tặng của mỗi bên.
    // Bar máu giữ nguyên. Dưới cùng chỉ còn huy hiệu chuỗi WIN.
    const giftA = (a.gifts && a.gifts[0]) ? giftHtml(a.gifts[0]) : '';
    const giftB = (b.gifts && b.gifts[0]) ? giftHtml(b.gifts[0]) : '';
    const roundText = state.roundNo ? `Vòng ${state.roundNo}` : 'Chuỗi đấu';
    root.innerHTML = `<div class="${boardClass} single-layout" style="${boardStyle}">
    <div class="pkduo-head">
      ${creatorLeftHtml}
      <span class="pkduo-round"><i class="chev">‹</i><b>${esc(roundText)}</b><i class="chev">›</i></span>
      ${creatorRightHtml}
    </div>
    <div class="pkduo-action">
      <div class="pkduo-action-side left">
        <span class="pkduo-action-gift">${giftA}</span>
        <div class="pkduo-action-champs">${champsAHtml}</div>
        ${resultA}
      </div>
      <div class="pkduo-action-center status-${esc(status)}">${statusInner}</div>
      <div class="pkduo-action-side right">
        <div class="pkduo-action-champs">${champsBHtml}</div>
        <span class="pkduo-action-gift">${giftB}</span>
        ${resultB}
      </div>
    </div>
    ${barHtml}
  </div><div class="pkduo-champs streak-only" aria-label="Chuỗi WIN">
    <div class="pkduo-champ-side left">${streakBadge(aStreak, 'a')}</div>
    <div class="pkduo-champ-mid" aria-hidden="true"></div>
    <div class="pkduo-champ-side right">${streakBadge(bStreak, 'b')}</div>
  </div>`;
  } else {
    // ===== BỐ CỤC CỐ ĐỊNH (nhiều quà) — giữ nguyên =====
    root.innerHTML = `<div class="${boardClass}" style="${boardStyle}">
    ${contentHtml}
    <div class="pkduo-head">
      ${creatorLeftHtml}
      <span>${statusInner}</span>
      ${creatorRightHtml}
    </div>
    <div class="pkduo-gifts">
      <div class="pkduo-gift-lane left${soloClass(a.gifts)}">${giftLaneHtml(a.gifts)}${resultA}</div>
      <i></i>
      <div class="pkduo-gift-lane right${soloClass(b.gifts)}">${giftLaneHtml(b.gifts)}${resultB}</div>
    </div>
    ${barHtml}
  </div><div class="pkduo-champs" aria-label="Vinh danh người tặng quà">
    <div class="pkduo-champ-side left">${champsAHtml}${streakBadge(aStreak, 'a')}</div>
    <div class="pkduo-champ-mid" aria-hidden="true"></div>
    <div class="pkduo-champ-side right">${champsBHtml}${streakBadge(bStreak, 'b')}</div>
  </div>`;
  }

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
