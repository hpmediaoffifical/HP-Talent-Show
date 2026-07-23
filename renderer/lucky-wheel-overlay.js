// Vòng quay may mắn (OBS Browser Source).
// State {title, style, spinSeconds, sound, confetti, showResult, segments:[{id,text,note,type,color}], spin}
// đến qua SSE /lucky-wheel-events. Máy chủ đã chọn ô trúng và điểm dừng (spin.index, spin.landingOffset) → overlay quay TỚI đúng ô đó,
// nên OBS và cửa sổ Review luôn dừng cùng kết quả. Âm thanh tạo bằng WebAudio (không cần file rời).
(function () {
  if (new URLSearchParams(location.search).get('review') === '1') {
    document.body.classList.add('overlay-review');
    var reviewBg = new URLSearchParams(location.search).get('reviewBg') || 'transparent';
    if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(reviewBg)) {
      document.body.style.setProperty('--review-bg', reviewBg);
    }
  }

  var stage = document.getElementById('lwStage');
  var titleEl = document.getElementById('lwTitle');
  var countEl = document.getElementById('lwCount');
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

  var token = new URLSearchParams(location.search).get('token') || '';
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
  var soundOn = true, confettiOn = true, showResultOn = true, fontScale = 100;
  var SPIN_BUFFER_MS = 4000; // vẫn coi là "còn tươi" trong ~4s sau khi lượt quay kết thúc

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
  // OBS/CEF có thể khóa WebAudio sau khi Browser Source reset. Một lần click hoặc
  // Ctrl+Space trên overlay sẽ mở lại context để các lượt quay từ app vẫn có tiếng.
  document.addEventListener('pointerdown', ac, { passive: true });
  document.addEventListener('keydown', ac);
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
  function playJackpot() {
    if (!soundOn) return;
    [523, 659, 784, 1047, 1319].forEach(function (f, i) { setTimeout(function () { blip(f, 0.24, 'triangle', 0.24); }, i * 105); });
  }
  function playLose() {
    if (!soundOn) return;
    [392, 330, 262].forEach(function (f, i) { setTimeout(function () { blip(f, 0.22, 'sawtooth', 0.16); }, i * 150); });
  }

  // ---------- Vẽ vòng quay ----------
  function fontFor(n) {
    if (n <= 4) return 62; if (n <= 6) return 54; if (n <= 8) return 48;
    if (n <= 10) return 42; if (n <= 14) return 36; return 30;
  }
  function maxCharsFor(n) { if (n <= 6) return 17; if (n <= 10) return 15; if (n <= 16) return 12; return 10; }
  function trunc(s, m) { s = String(s || ''); return s.length > m ? s.slice(0, m - 1) + '…' : s; }
  function shade(hex, amount) {
    var h = String(hex || '#888888').replace('#', '');
    var rgb = [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
    return 'rgb(' + rgb.map(function (v) { return Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)); }).join(',') + ')';
  }

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
    var seg = TWO_PI / n, font = Math.round(fontFor(n) * fontScale / 100), mc = maxCharsFor(n);
    ctx.save(); ctx.translate(CX, CY); ctx.rotate(rot);
    for (var i = 0; i < n; i++) {
      var a0 = i * seg, a1 = (i + 1) * seg;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a1); ctx.closePath();
      var base = segs[i].color || '#888';
      // Tối dần ra mép và sáng quanh tâm tạo mặt cong 3D, nhưng không thay đổi hình học ô.
      var face = ctx.createRadialGradient(0, 0, R * 0.06, 0, 0, R);
      face.addColorStop(0, shade(base, 0.3));
      face.addColorStop(0.48, base);
      face.addColorStop(1, shade(base, -0.22));
      ctx.fillStyle = face; ctx.fill();
      ctx.save(); ctx.clip();
      var shine = ctx.createLinearGradient(-R, -R, R, R);
      shine.addColorStop(0, 'rgba(255,255,255,.28)');
      shine.addColorStop(0.3, 'rgba(255,255,255,0)');
      shine.addColorStop(0.72, 'rgba(0,0,0,0)');
      shine.addColorStop(1, 'rgba(0,0,0,.2)');
      ctx.fillStyle = shine; ctx.fillRect(-R, -R, R * 2, R * 2);
      ctx.restore();
      ctx.lineWidth = 3; ctx.strokeStyle = st.stroke; ctx.stroke();
      // Chữ trên ô
      ctx.save(); ctx.rotate(a0 + seg / 2);
      ctx.fillStyle = pickText(segs[i].color);
      ctx.font = '800 ' + font + 'px "Be Vietnam Pro", "Segoe UI", sans-serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1;
      ctx.fillText(trunc(segs[i].text, mc), R - 26, 0);
      ctx.restore();
    }
    ctx.restore();
    // Vành ngoài
    var rim = ctx.createLinearGradient(CX - R, CY - R, CX + R, CY + R);
    rim.addColorStop(0, '#ffffff'); rim.addColorStop(0.14, st.rim); rim.addColorStop(0.54, '#ffffff'); rim.addColorStop(0.72, st.rim); rim.addColorStop(1, '#08090f');
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, TWO_PI);
    ctx.lineWidth = 26; ctx.strokeStyle = rim; ctx.stroke();
    ctx.beginPath(); ctx.arc(CX, CY, R - 18, 0, TWO_PI);
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,.46)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(CX, CY, R - 29, 0, TWO_PI);
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,.23)'; ctx.stroke();
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
  // Minimum-jerk tạo vận tốc/gia tốc bằng 0 ở đầu và cuối, nên quay-hãm tự nhiên hơn ease-out đơn thuần.
  function easeSpin(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  // Quay như đời thực: bung nhanh lúc đầu rồi chậm rải dần, bò từng chút ở cuối.
  // k càng lớn (slowSec càng cao) đuôi càng dài. Đoạn đầu (a) dùng Hermite bậc 3 khớp
  // vị trí + vận tốc với ease-out ở mốc a và vận tốc 0 tại t=0 → khởi động êm, không giật.
  function tailPower(slowSec) { var s = Math.max(0, Math.min(6, Number(slowSec)) || 0); return 2.2 + s * 0.6; }
  function easeWheel(t, k) {
    if (t >= 1) return 1;
    if (t <= 0) return 0;
    var a = 0.14;
    var G = 1 - Math.pow(1 - a, k);
    var D = k * Math.pow(1 - a, k - 1);
    if (t < a) {
      var b = (3 * G - D * a) / (a * a);
      var c = (D - 2 * G / a) / (a * a);
      return b * t * t + c * t * t * t;
    }
    return 1 - Math.pow(1 - t, k);
  }
  function playEdgeCatch(offset) {
    var cls = offset < 0 ? 'edge-catch-left' : 'edge-catch-right';
    pointer.classList.remove('tick', 'edge-catch-left', 'edge-catch-right');
    void pointer.offsetWidth;
    pointer.classList.add(cls);
    playTick();
  }

  function startSpin(spin) {
    var n = segs.length; if (!n) return;
    var idx = Math.max(0, Math.min(n - 1, spin.index | 0));
    var seg = TWO_PI / n;
    var offset = Math.max(-0.465, Math.min(0.465, Number(spin.landingOffset) || 0));
    var landing = idx * seg + seg / 2 + offset * seg;
    var desired = norm(POINTER - landing);
    var startRot = rot;
    var delta = norm(desired - norm(startRot));
    var dur = Math.max(2, Math.min(15, Number(spin.duration) || 5)) * 1000;
    var turns = 5 + Math.floor(dur / 1500);
    var finalRot = startRot + turns * TWO_PI + delta;
    var k = tailPower(spin.slowSec != null ? spin.slowSec : 3);

    hideResult();
    spinning = true;
    hub.classList.add('spinning');
    setSpinner(spin.spinner);

    var lastIdx = -1, t0 = null, catchTriggered = false;
    function frame(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      rot = startRot + (finalRot - startRot) * easeWheel(p, k);
      // Hãm rất nhẹ về điểm dừng. Khi sát vạch, kim có thể lướt qua mép rồi trở lại,
      // tạo cảm giác cơ khí nhưng khung cuối luôn nằm trong ô mà máy chủ đã chọn.
      if (p > 0.93 && Math.abs(offset) > 0.36) {
        var settle = (p - 0.93) / 0.07;
        var edgeStrength = Math.max(0, Math.min(1, (Math.abs(offset) - 0.36) / 0.105));
        var settleAmount = 0.035 + edgeStrength * 0.085;
        rot += -Math.sign(offset) * seg * settleAmount * Math.sin(Math.PI * settle) * (1 - 0.25 * settle);
      }
      if (!catchTriggered && spin.edgeCatch && p > 0.935) {
        catchTriggered = true;
        playEdgeCatch(offset);
      }
      draw();
      // tick khi ô dưới kim đổi
      var curIdx = Math.floor(norm(POINTER - rot) / seg) % n;
      if (curIdx !== lastIdx) {
        lastIdx = curIdx;
        if (p < 0.995) { playTick(); pointer.classList.remove('tick'); void pointer.offsetWidth; pointer.classList.add('tick'); }
      }
      if (p < 1) { requestAnimationFrame(frame); }
      else { spinning = false; hub.disabled = false; hub.classList.remove('spinning'); land(idx, spin.result); }
    }
    requestAnimationFrame(frame);
  }

  function land(idx, spinResult) {
    var seg = spinResult || segs[idx]; if (!seg) return;
    var type = seg.type || 'info';
    if (seg.jackpot) { playJackpot(); flashWinLights(true); if (confettiOn) burstConfetti('jackpot'); }
    else if (type === 'reward') { playWin(); flashWinLights(false); if (confettiOn) burstConfetti('reward'); }
    else if (type === 'penalty') { playLose(); }
    else { playWin(); if (confettiOn) burstConfetti('info'); }
    if (showResultOn) showResult(seg);
  }

  function setSpinner(sp) {
    if (sp && sp.name) {
      var av = avatarUrl(sp.avatar);
      // Chip người quay: dùng avatar thành viên thay cho icon 🎯 (fallback 🎯 nếu thiếu avatar)
      spinnerEl.innerHTML = '';
      if (av) {
        var img = document.createElement('img');
        img.className = 'lw-spinner-av';
        img.alt = '';
        img.src = av;
        // Nếu avatar lỗi thì bỏ ảnh, hiện lại icon 🎯 để không trơ khung trắng
        img.onerror = function () { img.remove(); spinnerEl.insertBefore(document.createTextNode('🎯 '), spinnerEl.firstChild); };
        spinnerEl.appendChild(img);
      } else {
        spinnerEl.appendChild(document.createTextNode('🎯 '));
      }
      var nameEl = document.createElement('span');
      nameEl.className = 'lw-spinner-name';
      nameEl.textContent = sp.name;
      spinnerEl.appendChild(nameEl);
      if (av) { hubAv.src = av; hub.classList.add('has-av'); }
      else { hub.classList.remove('has-av'); }
    } else {
      spinnerEl.textContent = '';
      hub.classList.remove('has-av');
    }
  }

  function requestSpin() {
    if (spinning || hub.disabled) return;
    hub.disabled = true;
    fetch('/lucky-wheel-spin?token=' + encodeURIComponent(token), { method: 'POST' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        // SSE sẽ bắt đầu animation khi server chấp nhận; nếu bị từ chối thì mở nút lại.
        if (!data || !data.ok) hub.disabled = false;
      })
      .catch(function () { hub.disabled = false; });
  }
  hub.addEventListener('click', requestSpin);
  document.addEventListener('keydown', function (e) {
    if (!e.ctrlKey || e.shiftKey || e.altKey || e.code !== 'Space') return;
    e.preventDefault();
    requestSpin();
  });

  function showResult(seg) {
    var type = seg.type || 'info';
    resultEl.setAttribute('data-type', type);
    resultEl.setAttribute('data-jackpot', seg.jackpot ? '1' : '0');
    resultTag.textContent = seg.jackpot ? '⭐ JACKPOT' : (type === 'reward' ? '🎁 THƯỞNG' : (type === 'penalty' ? '⚡ PHẠT' : '✨ KẾT QUẢ'));
    resultText.textContent = seg.text || '';
    resultNote.textContent = seg.note || '';
    resultEl.setAttribute('data-show', '0');
    void resultEl.offsetWidth;
    resultEl.setAttribute('data-show', '1');
  }
  function hideResult() { resultEl.setAttribute('data-show', '0'); }

  function flashWinLights(jackpot) {
    stage.classList.remove('win-lights', 'jackpot-lights');
    void stage.offsetWidth;
    stage.classList.add(jackpot ? 'jackpot-lights' : 'win-lights');
  }

  // ---------- Confetti (tự vẽ, không thư viện) ----------
  var parts = [], confRAF = null;
  var COLORS = ['#ff3d71', '#00e0c7', '#ffd23f', '#7a5cff', '#38d67a', '#ff9f1c', '#ffffff'];
  function burstConfetti(kind) {
    var count = kind === 'jackpot' ? 280 : (kind === 'reward' ? 160 : 90);
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
    // CẤU HÌNH HIỂN THỊ: LUÔN áp dụng. Vẽ lại vòng quay là idempotent nên an toàn kể cả
    // khi state đến từ HTTP poll trễ hay ngay sau khi app khởi động lại. (Trước đây chặn
    // theo stateRevision — nhưng revision reset về 0 mỗi lần mở lại app, khiến OBS đang
    // mở sẵn từ chối MỌI state mới → kẹt "vòng rỗng". Bỏ hẳn, đổi sang chống-quay-lại
    // theo thời điểm thực của lượt quay ở dưới.)
    titleEl.textContent = state.showTitle !== false ? (state.title || '') : '';
    if (countEl) countEl.textContent = (state.showCount !== false) ? ('🎯 Lượt quay: ' + (state.spinCount || 0)) : '';
    soundOn = state.sound !== false;
    confettiOn = state.confetti !== false;
    showResultOn = state.showResult !== false;
    fontScale = Math.max(50, Math.min(200, Number(state.fontScale) || 100));
    applyStyle(state.style);
    segs = Array.isArray(state.segments) ? state.segments : [];

    var spin = state.spin;
    if (spin && spin.spinId && spin.spinId !== lastSpinId) {
      lastSpinId = spin.spinId;
      var dur = Math.max(2, Math.min(15, Number(spin.duration) || 5)) * 1000;
      var age = Date.now() - (Number(spin.startAt) || 0);
      // CHỈ quay khi lượt còn trong (hoặc vừa kết thúc) cửa sổ quay. Nhờ vậy:
      //  (1) một gói poll đến trễ không phát lại một lượt cũ đã xong;
      //  (2) OBS mới mở/nối lại không tự quay một lượt đã kết thúc từ lâu (spin vẫn nằm
      //      trong state cho tới lần reset) — chỉ vẽ vòng quay ở trạng thái nghỉ.
      if (segs.length && age < dur + SPIN_BUFFER_MS) { startSpin(spin); return; }
      if (!spinning) { draw(); setSpinner(spin.spinner); }
      return;
    }
    if (!spinning) {
      draw(); // cập nhật ô/màu/style khi không đang quay
      setSpinner(spin ? spin.spinner : state.selectedSpinner);
    }
    if (!spin) { hideResult(); setSpinner(state.selectedSpinner); }
  }

  draw();
  // Một số bản OBS CEF mở trang nhưng EventSource ở trạng thái connected mà không
  // đưa event vào JavaScript. Lấy state ngay và poll nhẹ để canvas vẫn có dữ liệu.
  function pullState() {
    fetch('/lucky-wheel-state?token=' + encodeURIComponent(token), { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (state) { if (state) render(state); })
      .catch(function () {});
  }
  pullState();
  setInterval(pullState, 2500);
  window.connectSSE('/lucky-wheel-events?token=' + encodeURIComponent(token), 'luckywheel', render);
})();
