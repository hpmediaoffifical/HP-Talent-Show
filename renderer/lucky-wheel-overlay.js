// Vòng quay may mắn (OBS Browser Source).
// State {title, style, spinSeconds, sound, confetti, showResult, segments:[{id,text,note,type,color}], spin}
// đến qua SSE /lucky-wheel-events. Máy chủ đã chọn ô trúng (spin.index) → overlay quay TỚI đúng ô đó,
// nên OBS và cửa sổ Review luôn dừng cùng kết quả. Âm thanh tạo bằng WebAudio (không cần file rời).
(function () {
  var stage = document.getElementById('lwStage');
  var titleEl = document.getElementById('lwTitle');
  var canvas = document.getElementById('lwCanvas');
  var ctx = canvas.getContext('2d');
  var confCanvas = document.getElementById('lwConfetti');
  var confCtx = confCanvas.getContext('2d');
  var pointer = document.querySelector('.lw-pointer');
  var hub = document.getElementById('lwHub');
  var hubAv = document.getElementById('lwHubAv');
  var hubTxt = document.getElementById('lwHubTxt');
  var spinnerEl = document.getElementById('lwSpinner');
  var resultEl = document.getElementById('lwResult');
  var resultTag = document.getElementById('lwResultTag');
  var resultText = document.getElementById('lwResultText');
  var resultNote = document.getElementById('lwResultNote');

  var SIZE = 1120, CX = SIZE / 2, CY = SIZE / 2, R = SIZE / 2 - 18;
  var TWO_PI = Math.PI * 2, POINTER = -Math.PI / 2; // kim ở 12 giờ

  var STYLES = {
    neon:   { rim: '#0d0d1a', hub: '#e8365d', glow: '#ff3d71', title: '#ffffff', stroke: 'rgba(255,255,255,.28)' },
    gold:   { rim: '#3a2607', hub: '#c8a24a', glow: '#ffcf5a', title: '#fff5d6', stroke: 'rgba(255,240,200,.35)' },
    pastel: { rim: '#f0e6ff', hub: '#ff87ab', glow: '#ffb3d1', title: '#ffffff', stroke: 'rgba(90,60,85,.25)' },
    dark:   { rim: '#0b0e13', hub: '#4c8dff', glow: '#6ba8ff', title: '#e8eef7', stroke: 'rgba(255,255,255,.16)' },
  };

  var segs = [];
  var styleName = 'neon';
  var rot = -Math.PI / 2;   // góc quay hiện tại (nghỉ) — giữ vị trí đã dừng
  var spinning = false;
  var lastSpinId = '';
  var soundOn = true, confettiOn = true, showResultOn = true;

  // ---------- Avatar proxy (giống các overlay khác) ----------
  function avatarUrl(a) {
    var s = String(a || '');
    if (!s) return '';
    if (/^data:/i.test(s)) return s;
    if (/^[a-f0-9]{40}$/i.test(s)) return '/avatar?key=' + encodeURIComponent(s);
    if (/^https?:\/\//i.test(s)) return '/avatar?url=' + encodeURIComponent(s);
    return s;
  }

  // ---------- WebAudio: tick + jingle thắng/thua ----------
  var actx = null;
  function ac() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
    if (actx && actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
    return actx;
  }
  function blip(freq, dur, type, vol) {
    var a = ac(); if (!a) return;
    var t = a.currentTime;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.06));
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + (dur || 0.06) + 0.02);
  }
  function playTick() { if (soundOn) blip(1350, 0.05, 'square', 0.12); }
  function playWin() {
    if (!soundOn) return;
    [523, 659, 784, 1047].forEach(function (f, i) { setTimeout(function () { blip(f, 0.16, 'triangle', 0.2); }, i * 110); });
  }
  function playLose() {
    if (!soundOn) return;
    [392, 330, 262].forEach(function (f, i) { setTimeout(function () { blip(f, 0.22, 'sawtooth', 0.16); }, i * 150); });
  }

  // ---------- Vẽ vòng quay ----------
  function fontFor(n) {
    if (n <= 4) return 46; if (n <= 6) return 40; if (n <= 8) return 34;
    if (n <= 10) return 28; if (n <= 14) return 22; return 17;
  }
  function maxCharsFor(n) { if (n <= 6) return 16; if (n <= 10) return 12; if (n <= 16) return 9; return 7; }
  function trunc(s, m) { s = String(s || ''); return s.length > m ? s.slice(0, m - 1) + '…' : s; }

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    var st = STYLES[styleName] || STYLES.neon;
    var n = segs.length;
    if (!n) {
      // Vòng rỗng: vẽ vành + gợi ý
      ctx.beginPath(); ctx.arc(CX, CY, R, 0, TWO_PI); ctx.fillStyle = 'rgba(20,20,30,.6)'; ctx.fill();
      ctx.lineWidth = 26; ctx.strokeStyle = st.rim; ctx.stroke();
      return;
    }
    var seg = TWO_PI / n, font = fontFor(n), mc = maxCharsFor(n);
    ctx.save(); ctx.translate(CX, CY); ctx.rotate(rot);
    for (var i = 0; i < n; i++) {
      var a0 = i * seg, a1 = (i + 1) * seg;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a1); ctx.closePath();
      ctx.fillStyle = segs[i].color || '#888'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = st.stroke; ctx.stroke();
      // Chữ trên ô
      ctx.save(); ctx.rotate(a0 + seg / 2);
      ctx.fillStyle = pickText(segs[i].color);
      ctx.font = '700 ' + font + 'px "Be Vietnam Pro", "Segoe UI", sans-serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
      ctx.fillText(trunc(segs[i].text, mc), R - 30, 0);
      ctx.restore();
    }
    ctx.restore();
    // Vành ngoài
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, TWO_PI);
    ctx.lineWidth = 26; ctx.strokeStyle = st.rim; ctx.stroke();
    // Chấm bi trang trí trên vành
    var dots = Math.min(24, Math.max(8, n * 2));
    for (var d = 0; d < dots; d++) {
      var ang = d / dots * TWO_PI;
      ctx.beginPath();
      ctx.arc(CX + Math.cos(ang) * R, CY + Math.sin(ang) * R, 5, 0, TWO_PI);
      ctx.fillStyle = (d % 2 ? '#fff' : st.glow); ctx.fill();
    }
  }

  // Chọn màu chữ tương phản với nền ô
  function pickText(hex) {
    var h = String(hex || '#888888').replace('#', '');
    var r = parseInt(h.slice(0, 2), 16) || 0, g = parseInt(h.slice(2, 4), 16) || 0, b = parseInt(h.slice(4, 6), 16) || 0;
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? '#2a2233' : '#ffffff';
  }

  // ---------- Animation quay ----------
  function norm(a) { a %= TWO_PI; return a < 0 ? a + TWO_PI : a; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function startSpin(spin) {
    var n = segs.length; if (!n) return;
    var idx = Math.max(0, Math.min(n - 1, spin.index | 0));
    var seg = TWO_PI / n;
    var center = idx * seg + seg / 2;
    var desired = norm(POINTER - center);
    var startRot = rot;
    var delta = norm(desired - norm(startRot));
    var dur = Math.max(2, Math.min(15, Number(spin.duration) || 5)) * 1000;
    var turns = 5 + Math.floor(dur / 1500);
    var finalRot = startRot + turns * TWO_PI + delta;

    hideResult();
    spinning = true;
    hub.classList.add('spinning');
    setSpinner(spin.spinner);

    var lastIdx = -1, t0 = null;
    function frame(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      rot = startRot + (finalRot - startRot) * easeOut(p);
      draw();
      // tick khi ô dưới kim đổi
      var curIdx = Math.floor(norm(POINTER - rot) / seg) % n;
      if (curIdx !== lastIdx) {
        lastIdx = curIdx;
        if (p < 0.995) { playTick(); pointer.classList.remove('tick'); void pointer.offsetWidth; pointer.classList.add('tick'); }
      }
      if (p < 1) { requestAnimationFrame(frame); }
      else { spinning = false; hub.classList.remove('spinning'); land(idx); }
    }
    requestAnimationFrame(frame);
  }

  function land(idx) {
    var seg = segs[idx]; if (!seg) return;
    var type = seg.type || 'info';
    if (type === 'reward') { playWin(); if (confettiOn) burstConfetti('reward'); }
    else if (type === 'penalty') { playLose(); }
    else { playWin(); if (confettiOn) burstConfetti('info'); }
    if (showResultOn) showResult(seg);
  }

  function setSpinner(sp) {
    if (sp && sp.name) {
      spinnerEl.textContent = '🎯 ' + sp.name;
      var av = avatarUrl(sp.avatar);
      if (av) { hubAv.src = av; hub.classList.add('has-av'); }
      else { hub.classList.remove('has-av'); }
    } else {
      spinnerEl.textContent = '';
      hub.classList.remove('has-av');
    }
  }

  function showResult(seg) {
    var type = seg.type || 'info';
    resultEl.setAttribute('data-type', type);
    resultTag.textContent = type === 'reward' ? '🎁 THƯỞNG' : (type === 'penalty' ? '⚡ PHẠT' : '✨ KẾT QUẢ');
    resultText.textContent = seg.text || '';
    resultNote.textContent = seg.note || '';
    resultEl.setAttribute('data-show', '0');
    void resultEl.offsetWidth;
    resultEl.setAttribute('data-show', '1');
  }
  function hideResult() { resultEl.setAttribute('data-show', '0'); }

  // ---------- Confetti (tự vẽ, không thư viện) ----------
  var parts = [], confRAF = null;
  var COLORS = ['#ff3d71', '#00e0c7', '#ffd23f', '#7a5cff', '#38d67a', '#ff9f1c', '#ffffff'];
  function burstConfetti(kind) {
    var count = kind === 'reward' ? 160 : 90;
    for (var i = 0; i < count; i++) {
      var ang = Math.random() * TWO_PI, spd = 6 + Math.random() * 14;
      parts.push({
        x: CX, y: CY, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 6,
        g: 0.28 + Math.random() * 0.18, life: 60 + Math.random() * 40, age: 0,
        size: 8 + Math.random() * 10, col: COLORS[(Math.random() * COLORS.length) | 0],
        rot: Math.random() * TWO_PI, vr: (Math.random() - 0.5) * 0.4,
      });
    }
    if (!confRAF) confRAF = requestAnimationFrame(confStep);
  }
  function confStep() {
    confCtx.clearRect(0, 0, SIZE, SIZE);
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.age++; p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vx *= 0.99;
      if (p.age > p.life || p.y > SIZE + 40) { parts.splice(i, 1); continue; }
      confCtx.save(); confCtx.translate(p.x, p.y); confCtx.rotate(p.rot);
      confCtx.globalAlpha = Math.max(0, 1 - p.age / p.life);
      confCtx.fillStyle = p.col;
      confCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      confCtx.restore();
    }
    if (parts.length) { confRAF = requestAnimationFrame(confStep); }
    else { confRAF = null; confCtx.clearRect(0, 0, SIZE, SIZE); }
  }

  // ---------- Áp style ----------
  function applyStyle(name) {
    styleName = STYLES[name] ? name : 'neon';
    var st = STYLES[styleName];
    stage.setAttribute('data-style', styleName);
    var r = document.documentElement.style;
    r.setProperty('--lw-rim', st.rim);
    r.setProperty('--lw-hub', st.hub);
    r.setProperty('--lw-glow', st.glow);
    r.setProperty('--lw-title', st.title);
  }

  // ---------- Nhận state ----------
  function render(state) {
    if (!state) return;
    titleEl.textContent = state.title || '';
    soundOn = state.sound !== false;
    confettiOn = state.confetti !== false;
    showResultOn = state.showResult !== false;
    applyStyle(state.style);
    segs = Array.isArray(state.segments) ? state.segments : [];

    var spin = state.spin;
    if (spin && spin.spinId && spin.spinId !== lastSpinId) {
      lastSpinId = spin.spinId;
      // Đợi 1 frame để segs đã set, rồi quay
      if (segs.length) startSpin(spin);
      else draw();
    } else if (!spinning) {
      draw(); // cập nhật ô/màu/style khi không đang quay
    }
    if (!spin) { lastSpinId = ''; hideResult(); setSpinner(null); }
  }

  draw();
  window.connectSSE('/lucky-wheel-events', 'luckywheel', render);
})();
