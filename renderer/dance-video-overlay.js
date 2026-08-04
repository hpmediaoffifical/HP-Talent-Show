// NHẠC DANCE · Video overlay.
// - Lớp MAIN: video quà phát lần lượt theo 🎬 Hàng đợi hiệu ứng (do renderer điều khiển). Mỗi lượt là
//   một playId duy nhất; phát xong/lỗi → POST /dance-video-ended để renderer bước sang lượt kế.
// - Lớp BG ("Chạy nền"): danh sách clip phát tuần tự, đè LÊN TRÊN mọi lớp khác, không cần round-trip.
// File cục bộ được stream qua /dance-media (OBS http origin không load được file://).
const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
// Kênh overlay: webm1 (video thường) | webm2 (nền) | webm3 (Biến Hình). Mỗi kênh 1 link OBS riêng.
const CH = ['webm1', 'webm2', 'webm3'].includes(params.get('ch')) ? params.get('ch') : 'webm1';
if (params.get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = params.get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}

const vMain = document.getElementById('dvMain');
const vBg = document.getElementById('dvBg');

// "Tốc độ theo quà": hệ số nhân tốc độ tạm thời áp CHO CẢ 2 lớp, đổi realtime giữa clip (không nạp lại).
let curSpeed = 1, baseMainRate = 1;
function clampRate(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.max(0.25, Math.min(3, n)) : 1; }
function applySpeed() {
  try { vMain.playbackRate = clampRate(baseMainRate * curSpeed); } catch (_) {}
  try { vBg.playbackRate = clampRate((Number(bgRate) > 0 ? bgRate : 1) * curSpeed); } catch (_) {}
}

function clamp01(v) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1; }
function mediaUrl(src) { return '/dance-media?token=' + encodeURIComponent(token) + '&src=' + encodeURIComponent(src); }
function postEnded(playId, layer) {
  try { fetch('/dance-video-ended?ch=' + encodeURIComponent(CH) + '&playId=' + encodeURIComponent(playId) + '&layer=' + encodeURIComponent(layer) + '&token=' + encodeURIComponent(token), { method: 'POST' }).catch(() => {}); } catch (_) {}
}

// Đặt vị trí + kích thước cho 1 lớp video. pos: full|center|tl|tr|bl|br. size = % chiều rộng khung.
function applyPlacement(el, pos, size, fit) {
  el.classList.toggle('dv-full', pos === 'full');
  el.style.objectFit = fit === 'cover' ? 'cover' : 'contain';
  if (pos === 'full') return; // .dv-full lo phần còn lại
  const s = Math.max(5, Math.min(100, Number(size) || 100));
  const M = '3vh';
  el.style.width = s + 'vw';
  el.style.height = 'auto';
  el.style.left = el.style.right = el.style.top = el.style.bottom = 'auto';
  el.style.transform = 'none';
  if (pos === 'tl') { el.style.left = M; el.style.top = M; }
  else if (pos === 'tr') { el.style.right = M; el.style.top = M; }
  else if (pos === 'bl') { el.style.left = M; el.style.bottom = M; }
  else if (pos === 'br') { el.style.right = M; el.style.bottom = M; }
  else { el.style.left = '50%'; el.style.top = '50%'; el.style.transform = 'translate(-50%,-50%)'; } // center
}

// ---------- Lớp MAIN (hàng đợi) ----------
// handledMainId = playId đang/đã xử lý. Không bao giờ phát lại cùng id (chống heartbeat lặp lại clip).
let handledMainId = null;
function stopMain() {
  try { vMain.pause(); } catch (_) {}
  vMain.onended = vMain.onerror = null;
  vMain.removeAttribute('src');
  try { vMain.load(); } catch (_) {}
  vMain.style.display = 'none';
}
function playMain(main) {
  const pid = main.playId;
  applyPlacement(vMain, main.pos, main.size, main.fit);
  vMain.volume = clamp01((main.volume == null ? 100 : main.volume) / 100);
  vMain.style.display = 'block';
  const done = () => { if (pid !== handledMainId) return; vMain.onended = vMain.onerror = null; vMain.style.display = 'none'; postEnded(pid, 'main'); };
  vMain.onended = done;
  vMain.onerror = done;
  vMain.src = mediaUrl(main.src);
  try { vMain.currentTime = 0; } catch (_) {}
  baseMainRate = (Number(main.rate) > 0 ? Number(main.rate) : 1);
  try { vMain.playbackRate = clampRate(baseMainRate * curSpeed); } catch (_) {}
  vMain.play().catch(done);
}

// ---------- Lớp BG ("Chạy nền") ----------
let handledBgSeq = 0;
let bgClips = [], bgIdx = 0, bgLoop = false, bgVol = 1, bgRate = 1;
function stopBg() {
  try { vBg.pause(); } catch (_) {}
  vBg.onended = vBg.onerror = null;
  vBg.removeAttribute('src');
  try { vBg.load(); } catch (_) {}
  vBg.style.display = 'none';
}
function playBgNext(seq) {
  if (seq !== handledBgSeq) return; // đã bị thay bằng lượt nền mới
  if (bgIdx >= bgClips.length) {
    if (bgLoop && bgClips.length) bgIdx = 0;
    else { postEnded(seq, 'bg'); stopBg(); return; } // báo renderer dọn dải "Chạy nền"
  }
  const url = bgClips[bgIdx++];
  vBg.volume = bgVol;
  vBg.style.display = 'block';
  const next = () => { if (seq === handledBgSeq) playBgNext(seq); };
  vBg.onended = next;
  vBg.onerror = next;
  vBg.src = mediaUrl(url);
  try { vBg.currentTime = 0; } catch (_) {}
  try { vBg.playbackRate = clampRate((Number(bgRate) > 0 ? bgRate : 1) * curSpeed); } catch (_) {}
  vBg.play().catch(next);
}
function startBg(bg) {
  bgClips = Array.isArray(bg.clips) ? bg.clips.filter(Boolean) : [];
  bgLoop = !!bg.loop;
  bgVol = clamp01((bg.volume == null ? 100 : bg.volume) / 100);
  bgRate = Number(bg.rate) > 0 ? Number(bg.rate) : 1;
  applyPlacement(vBg, bg.pos, bg.size, bg.fit);
  bgIdx = 0;
  if (!bgClips.length) { stopBg(); return; }
  playBgNext(handledBgSeq);
}

function onState(st) {
  st = st || {};
  // Tốc độ theo quà: đổi hệ số → áp ngay cho clip đang phát (không nạp lại video).
  const sp = clampRate(st.speed);
  if (sp !== curSpeed) { curSpeed = sp; applySpeed(); }
  // MAIN
  const main = st.main;
  if (main && main.playId && main.src) {
    if (main.playId !== handledMainId) { handledMainId = main.playId; playMain(main); }
  } else if (handledMainId !== null) {
    handledMainId = null; stopMain();
  }
  // BG
  const bg = st.bg;
  const seq = bg && Number(bg.seq) || 0;
  if (seq && seq !== handledBgSeq) { handledBgSeq = seq; startBg(bg); }
  else if (!seq && handledBgSeq) { handledBgSeq = 0; stopBg(); }
}

// Ẩn/hiện riêng từng kênh: WEBM 1=dancevideo · WEBM 2=dancevideo2 · WEBM 3=dancevideo3.
const DANCE_VIS_KEY = { webm1: 'dancevideo', webm2: 'dancevideo2', webm3: 'dancevideo3' }[CH] || 'dancevideo';
connectSSE('/dance-video-events?ch=' + encodeURIComponent(CH) + '&token=' + encodeURIComponent(token), 'dancevideo', onState, { staleMs: 12000, visKey: DANCE_VIS_KEY });
