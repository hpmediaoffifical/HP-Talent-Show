// THẺ BÀI · Lật 3D — cuộn nhiều thẻ rồi lộ 1 lá ra giữa màn hình + ÂM THANH + PHÁO HOA + nhiều KIỂU LỘ.
// DÙNG CHUNG stream /card-flip-events. Đồng bộ với thanh ngang qua flipAt (giờ server) + serverNow.
const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
if (params.get('review') === '1') {
  document.body.classList.add('overlay-review');
  const bg = params.get('reviewBg') || 'transparent';
  if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
}

const SPINS = 5;         // số vòng cuộn (kiểu Vòng tròn)
const REVEAL_MS = 1000;  // thời gian lộ (zoom + lật ra giữa) — dài hơn chút cho mượt
const HIDE_MS = 650;     // thời gian mờ tắt khi bỏ lật
const RING_MAX = 14;     // trần số thẻ trên vòng
const STYLES = ['ring', 'fan', 'stack', 'fly', 'wave', 'tunnel', 'helix', 'spiral'];

const root = document.getElementById('cfxRoot');
const ring = document.getElementById('cfxRing');
const hero = document.getElementById('cfxHero');
const heroInner = document.getElementById('cfxHeroInner');
const content = document.getElementById('cfxContent');
const glow = document.querySelector('.cfx-glow');
const sparks = document.getElementById('cfxParticles');

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function easeOutQuint(p) { return 1 - Math.pow(1 - p, 5); }
function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }
function easeInCubic(p) { return p * p * p; }

let skew = 0;                 // Date.now() - serverNow
let phase = 'idle';          // idle | active | hiding
let hideAt = 0;
let raf = 0;
let ringCards = [];
let cur = { key: null, target: null, spinMs: 3000, step: 72, radius: 26, tIdx: 0, N: 1,
            style: 'ring', actual: 'ring', sound: true, vol: 0.7, particles: true, accent: '#ffd94a', revealed: false };

// Chế độ "random": mỗi lượt lộ bốc 1 kiểu KHÔNG lặp (chạy hết cả bộ mới xáo lại, tránh trùng liền).
let fxBag = [];
function pickRandomStyle() {
  if (!fxBag.length) {
    fxBag = STYLES.filter(s => s !== cur.actual);
    for (let i = fxBag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [fxBag[i], fxBag[j]] = [fxBag[j], fxBag[i]]; }
  }
  return fxBag.shift();
}

// ===================== ÂM THANH (tổng hợp WebAudio, không cần file) =====================
let actx = null;
let _noiseBuf = null;
function audio() {
  try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
// Làm ấm sẵn AudioContext để tiếng phát NGAY khoảnh khắc bấm (không trễ vì resume/khởi tạo lần đầu).
function warmAudio() { const ac = audio(); if (ac && !_noiseBuf) { _noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 1.5), ac.sampleRate); const d = _noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } }
function noiseSource(ac) { if (!_noiseBuf) warmAudio(); const s = ac.createBufferSource(); s.buffer = _noiseBuf; s.loop = true; return s; }
// "Xào bài": vài tiếng tách riffle NGAY tức thì + tiếng vút cuộn (đánh mạnh ngay đầu, không lên chậm).
function playSpin(durMs) {
  if (!cur.sound) return; const ac = audio(); if (!ac) return;
  const dur = Math.max(0.4, durMs / 1000), t0 = ac.currentTime;
  // Riffle: 7 tách ngắn dồn dập ngay lập tức.
  for (let i = 0; i < 7; i++) {
    const st = t0 + i * 0.032;
    const s = noiseSource(ac);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, st);
    g.gain.linearRampToValueAtTime(0.16 * cur.vol, st + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, st + 0.05);
    s.connect(hp).connect(g).connect(ac.destination);
    s.start(st); s.stop(st + 0.06);
  }
  // Vút cuộn: đánh MẠNH NGAY (attack 8ms) rồi ngân theo thời gian cuộn.
  const s = noiseSource(ac);
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(400, t0);
  bp.frequency.exponentialRampToValueAtTime(2200, t0 + dur * 0.85);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.26 * cur.vol, t0 + 0.008);   // tức thì
  g.gain.exponentialRampToValueAtTime(0.05 * cur.vol, t0 + dur * 0.92);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(bp).connect(g).connect(ac.destination);
  s.start(t0); s.stop(t0 + dur);
}
function playReveal() {
  if (!cur.sound) return; const ac = audio(); if (!ac) return;
  const t0 = ac.currentTime;
  [660, 990, 1320].forEach((f, idx) => {
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime((idx === 0 ? 0.22 : 0.12) * cur.vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
    o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + 1.25);
  });
  for (let i = 0; i < 6; i++) {
    const o = ac.createOscillator(); o.type = 'triangle';
    o.frequency.value = 1300 + Math.random() * 1700;
    const g = ac.createGain(); const st = t0 + 0.04 + i * 0.045;
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.08 * cur.vol, st + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, st + 0.26);
    o.connect(g).connect(ac.destination); o.start(st); o.stop(st + 0.3);
  }
}

// ===================== PHÁO HOA / LẤP LÁNH =====================
function spawnBurst() {
  if (!cur.particles || !sparks) return;
  const M = 36;
  for (let i = 0; i < M; i++) {
    const p = document.createElement('div'); p.className = 'cfx-spark';
    const ang = Math.random() * Math.PI * 2, dist = 20 + Math.random() * 38;
    p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'vmin');
    p.style.setProperty('--dy', (Math.sin(ang) * dist - 5).toFixed(1) + 'vmin');
    p.style.setProperty('--sz', (0.7 + Math.random() * 1.5).toFixed(2) + 'vmin');
    p.style.setProperty('--rot', (Math.random() * 540 - 270).toFixed(0) + 'deg');
    p.style.background = (i % 3 === 0) ? '#ffffff' : cur.accent;
    p.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
    sparks.appendChild(p);
    setTimeout(() => p.remove(), 1600);
  }
}

// ===================== DỰNG CẢNH =====================
function buildScene(cards, target, st) {
  const cs = st.cardStyle === 'pink' ? 'pink' : 'gold';
  cur.accent = st.titleColor || '#ffd94a';
  root.style.setProperty('--cfx-style-back', `url("/card-assets/${cs}/back.png")`);
  root.style.setProperty('--cfx-style-front', `url("/card-assets/${cs}/front.png")`);
  root.style.setProperty('--cfx-accent', cur.accent);
  // Triplet cho rgba(var(--cfx-accent-rgb), a) thay color-mix() (CEF cũ của OBS không hỗ trợ → quầng sáng biến mất).
  root.style.setProperty('--cfx-accent-rgb', (function (h) { const m = /^#([0-9a-f]{6})$/i.exec(String(h || '')); if (!m) return '255,217,74'; const n = parseInt(m[1], 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; })(cur.accent));
  // Cỡ chữ NỘI DUNG lá lớn theo cùng thông số "Cỡ chữ trong thẻ" (18px ↔ 3.4vmin, co giãn theo).
  root.style.setProperty('--cfx-font', `${(clamp(+st.cardTextSize || 18, 8, 90) / 18 * 3.4).toFixed(2)}vmin`);

  let disp = cards.slice(0, RING_MAX);
  if (!disp.some(c => c.id === target.id)) disp[disp.length - 1] = target;
  const N = Math.max(1, disp.length);
  const step = 360 / N;
  const radius = Math.max(26, (12 / Math.tan(Math.PI / Math.max(3, N))) * 1.15);
  ring.innerHTML = disp.map((c, i) => `<div class="cfx-card" style="--a:${(i * step).toFixed(3)}deg;--r:${radius.toFixed(2)}vmin"></div>`).join('');
  ringCards = [...ring.querySelectorAll('.cfx-card')];
  ring.className = `cfx-ring cfx-${cur.actual}`;

  content.textContent = target.text || '';
  cur.step = step; cur.radius = radius; cur.N = N; cur.tIdx = disp.findIndex(c => c.id === target.id);
  cur.revealed = false;
}

// Transform mỗi thẻ trong pha CUỘN theo từng KIỂU (mọi kiểu ngoài 'ring').
function spinCard(style, i, N, e, elapsed, radius) {
  const mid = (N - 1) / 2, R = Math.PI / 180;
  if (style === 'fan') {
    const a = (i - mid) * (66 / Math.max(1, N - 1)) * e + Math.sin(elapsed / 450) * 4;
    return `rotate(${a.toFixed(2)}deg)`;               // xoè quạt (transform-origin dưới đáy)
  }
  if (style === 'stack') {
    const jx = Math.sin(elapsed / 120 + i * 1.7) * (1 - e) * 1.4;
    const jy = (i - mid) * 0.5 + Math.cos(elapsed / 150 + i) * (1 - e) * 0.8;
    const jr = Math.sin(elapsed / 90 + i * 1.3) * (1 - e) * 7;
    return `translate(${jx.toFixed(2)}vmin, ${jy.toFixed(2)}vmin) rotate(${jr.toFixed(2)}deg)`;
  }
  if (style === 'wave') {
    const x = (i - mid) * 6.4;
    const y = Math.sin(elapsed / 260 + i * 0.7) * 3.4;
    const rot = Math.sin(elapsed / 320 + i * 0.7) * 9;
    return `translate(${x.toFixed(2)}vmin, ${y.toFixed(2)}vmin) rotate(${rot.toFixed(2)}deg)`;
  }
  if (style === 'tunnel') {
    // Bài lao thẳng về phía người xem (đường hầm) — cần perspective của .cfx-scene.
    const z = (((elapsed * 0.06 + i * (110 / N)) % 110) - 78);
    return `translate(${(Math.cos(i * 1.6) * 7).toFixed(1)}vmin, ${(Math.sin(i * 1.9) * 7).toFixed(1)}vmin) translateZ(${z.toFixed(1)}vmin)`;
  }
  if (style === 'helix') {
    const ang = i * (360 / N) + elapsed * 0.2;
    return `translateY(${((i - mid) * 3.2).toFixed(1)}vmin) rotateY(${ang.toFixed(0)}deg) translateZ(${(radius || 24).toFixed(1)}vmin)`;
  }
  if (style === 'spiral') {
    const ang = i * 137.5 + elapsed * 0.16;
    const r = 6 + (i / Math.max(1, N)) * 34;
    return `translate(${(Math.cos(ang * R) * r).toFixed(1)}vmin, ${(Math.sin(ang * R) * r).toFixed(1)}vmin) rotate(${ang.toFixed(0)}deg)`;
  }
  // fly: xoáy tròn hội tụ vào giữa
  const ang = i * (360 / N) + elapsed * 0.2, r = (1 - e) * 46 + 11;
  return `translate(${(Math.cos(ang * R) * r).toFixed(1)}vmin, ${(Math.sin(ang * R) * r).toFixed(1)}vmin) rotate(${ang.toFixed(0)}deg)`;
}

function renderActive(elapsed) {
  root.style.display = 'block'; root.style.opacity = '1';
  const spinMs = cur.spinMs, style = cur.actual, Rend = -cur.tIdx * cur.step;

  if (elapsed < spinMs) {
    const e = easeOutQuint(clamp(elapsed / spinMs, 0, 1));
    if (style === 'ring') {
      ring.style.transform = `rotateX(6deg) rotateY(${(Rend - SPINS * 360 * (1 - e)).toFixed(2)}deg)`;
    } else {
      ring.style.transform = (style === 'helix' || style === 'tunnel') ? 'rotateX(5deg)' : 'none';
      ringCards.forEach((el, i) => { el.style.transform = spinCard(style, i, cur.N, e, elapsed, cur.radius); });
    }
    ring.style.opacity = '1'; hero.style.opacity = '0';
    glow.style.opacity = String(clamp((elapsed - spinMs * 0.6) / 500, 0, 1) * 0.85);
    return;
  }
  const rt = elapsed - spinMs;
  if (!cur.revealed) { cur.revealed = true; playReveal(); spawnBurst(); }  // chuông + pháo hoa đúng lúc lộ
  if (rt < REVEAL_MS) {
    const er = easeOutCubic(clamp(rt / REVEAL_MS, 0, 1));
    if (style === 'ring') ring.style.transform = `rotateX(6deg) rotateY(${Rend.toFixed(2)}deg)`;
    ring.style.opacity = String(1 - er);
    hero.style.opacity = String(er);
    hero.style.transform = `translateY(${((1 - er) * 6).toFixed(2)}vmin) scale(${(0.5 + 0.5 * er).toFixed(3)})`;
    heroInner.style.transform = `rotateY(${(180 * er).toFixed(2)}deg)`;   // úp → lật hẳn sang MẶT TRƯỚC
    glow.style.opacity = String(0.85 * er + 0.15);
    return;
  }
  ring.style.opacity = '0';
  hero.style.opacity = '1';
  hero.style.transform = `translateY(${(Math.sin(elapsed / 900) * 0.8).toFixed(3)}vmin) scale(1)`;
  heroInner.style.transform = 'rotateY(180deg)';   // giữ MẶT TRƯỚC (nội dung)
  glow.style.opacity = '0.85';
}

function tick() {
  const now = Date.now();
  if (phase === 'active') {
    renderActive(now - ((cur.target.flipAt || 0) + skew));
    raf = requestAnimationFrame(tick);
  } else if (phase === 'hiding') {
    const p = clamp((now - hideAt) / HIDE_MS, 0, 1);
    root.style.opacity = String(1 - easeInCubic(p));
    if (p >= 1) { phase = 'idle'; root.style.display = 'none'; ring.innerHTML = ''; ringCards = []; raf = 0; return; }
    raf = requestAnimationFrame(tick);
  } else { raf = 0; }
}
function ensureRaf() { if (!raf) raf = requestAnimationFrame(tick); }

function onData(st) {
  st = st || {};
  if (Number.isFinite(+st.serverNow)) skew = Date.now() - (+st.serverNow);
  const cards = Array.isArray(st.cards) ? st.cards : [];
  cur.spinMs = clamp(Math.round(+st.spinMs || 3000), 800, 8000);
  cur.style = (STYLES.includes(st.fxStyle) || st.fxStyle === 'random') ? st.fxStyle : 'ring';
  cur.sound = st.sound !== false;
  cur.vol = clamp((+st.soundVolume || 70) / 100, 0, 1);
  cur.particles = st.particles !== false;
  const fxOn = st.fx !== false;

  let target = null;
  if (fxOn) for (const c of cards) if (c.flipped && (!target || (c.flipAt || 0) > (target.flipAt || 0))) target = c;
  const key = target ? `${target.id}|${target.flipAt}` : null;

  if (key !== cur.key) {
    if (key) {
      cur.key = key; cur.target = target;
      // MỖI LƯỢT LỘ mới bốc kiểu thật: 'random' → chọn ngẫu nhiên không lặp; còn lại giữ đúng kiểu đã chọn.
      cur.actual = (cur.style === 'random') ? pickRandomStyle() : cur.style;
      playSpin(cur.spinMs);        // phát NGAY (trước cả khi dựng DOM) để không trễ
      buildScene(cards, target, st);
      phase = 'active'; root.style.display = 'block'; root.style.opacity = '1';
      ensureRaf();
    } else if (phase === 'active') {
      cur.key = null; phase = 'hiding'; hideAt = Date.now(); ensureRaf();
    } else {
      cur.key = null;
    }
  } else if (key) {
    cur.target = target;
    content.textContent = target.text || '';
  }
}

try { warmAudio(); } catch (_) {}   // ấm sẵn ngữ cảnh âm thanh → tiếng phát tức thì lần đầu
connectSSE(`/card-flip-events?token=${encodeURIComponent(token)}`, 'cardflip', onData, { visKey: 'cardflipfx' });
