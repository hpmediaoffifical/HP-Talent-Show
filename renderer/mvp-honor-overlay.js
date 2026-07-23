// MVP Honor overlay (OBS Browser Source) — render các thẻ vinh danh avatar.
// State {cards:[...]} đến qua SSE /mvp-honor-events. Mỗi thẻ = khung PNG (đè) + avatar tròn + chữ ribbon,
// đặt tuyệt đối trên sân khấu 1080x1920 theo overlay{x,y,scale,rot}.
//
// Cập nhật KEYED theo id để KHÔNG dựng lại <img> avatar mỗi lần đổi state (tránh nháy/tải lại avatar trên OBS).
(function () {
  const token = new URLSearchParams(location.search).get('token') || '';
  if (new URLSearchParams(location.search).get('review') === '1') {
    document.body.classList.add('overlay-review');
    const bg = new URLSearchParams(location.search).get('reviewBg') || 'transparent';
    if (/^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d+)\))$/i.test(bg)) document.body.style.setProperty('--review-bg', bg);
  }
  const stage = document.getElementById('mvpStage');
  const nodes = new Map(); // id -> { root, avImg, frame, text, name, sig, avSrc, frameSrc }

  // Kích thước khung (rộng luôn 1080 để hiển thị SẮC NÉT 1:1 trên OBS; chỉ đổi chiều cao).
  const CANVAS = { '1:1': 1080, '3:4': 1440, '9:16': 1920 };
  function applyCanvas(ratio) {
    const h = CANVAS[ratio] || CANVAS['1:1'];
    stage.style.width = '1080px';
    stage.style.height = h + 'px';
  }

  // Avatar TikTok load thẳng bị OBS chặn (CORS/403) → qua proxy /avatar. data URL (ảnh tải lên) dùng trực tiếp.
  function avatarUrl(a) {
    const s = String(a || '');
    if (!s) return '/logo.png';
    if (/^data:/i.test(s)) return s;
    if (/^[a-f0-9]{40}$/i.test(s)) return `/avatar?key=${encodeURIComponent(s)}`;
    if (/^https?:\/\//i.test(s)) return `/avatar?url=${encodeURIComponent(s)}`;
    return s;
  }
  function frameUrl(f) {
    const s = String(f || '');
    if (!s) return '';
    if (/^https?:\/\/|^data:|^\//.test(s)) return s;
    return '/' + s.replace(/^\/+/, '');
  }
  // Ảnh plaque danh hiệu đi cùng bộ với khung avatar: N.png → Na.png (chèn 'a' trước .png).
  function plaqueUrl(frame) {
    const s = String(frame || '');
    if (!s || !/\.png$/i.test(s)) return '';
    return frameUrl(s.replace(/\.png$/i, 'a.png'));
  }
  function onAvErr(img) {
    const n = (img._err = (img._err || 0) + 1);
    if (n >= 3 || !/\/avatar\?/.test(img.src)) { img.onerror = null; img.src = '/logo.png'; return; }
    img.src = img.src + (img.src.includes('?') ? '&' : '?') + 'r=' + n; // thử lại: proxy tự fetch/cache
  }
  function hexToRgba(hex, op) {
    const h = String(hex || '#000000').replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) || 0, g = parseInt(h.slice(2, 4), 16) || 0, b = parseInt(h.slice(4, 6), 16) || 0;
    return `rgba(${r},${g},${b},${Math.max(0, Math.min(100, Number(op) === 0 ? 0 : (Number(op) || 100))) / 100})`;
  }

  function textBackground(c) {
    if (c.textStyle === 'gradient') return `linear-gradient(135deg, ${hexToRgba(c.bgColor, c.bgOpacity)}, ${hexToRgba(c.bgColor2, c.bgOpacity)})`;
    // Plaque: chuyển màu DỌC (trên sáng → dưới tối) cho cảm giác kim loại nổi khối.
    if (c.textStyle === 'plaque') return `linear-gradient(180deg, ${hexToRgba(c.bgColor, c.bgOpacity)}, ${hexToRgba(c.bgColor2, c.bgOpacity)})`;
    if (c.textStyle === 'neon') return 'transparent';
    return hexToRgba(c.bgColor, c.bgOpacity);
  }

  function build(c) {
    const root = document.createElement('div');
    root.className = 'mvp-card';
    const inner = document.createElement('div');
    inner.className = 'mvp-inner';
    const avWrap = document.createElement('div');
    avWrap.className = 'mvp-avwrap';
    const avImg = document.createElement('img');
    avImg.className = 'mvp-av';
    avImg.onerror = () => onAvErr(avImg);
    const frame = document.createElement('img');
    frame.className = 'mvp-frame';
    frame.alt = '';
    const name = document.createElement('div');
    name.className = 'mvp-name';
    avWrap.appendChild(avImg);
    avWrap.appendChild(frame);
    avWrap.appendChild(name);
    const text = document.createElement('div');
    text.className = 'mvp-text';
    // Ảnh plaque (đè nền cho chữ) + nhãn chữ tách riêng để set textContent không xoá mất <img>.
    const plaqueImg = document.createElement('img');
    plaqueImg.className = 'mvp-plaque-img';
    plaqueImg.alt = '';
    const textLabel = document.createElement('span');
    textLabel.className = 'mvp-text-label';
    text.appendChild(plaqueImg);
    text.appendChild(textLabel);
    // Ảnh plaque tải xong → dùng ảnh (và lấy đúng tỷ lệ ảnh). Lỗi/không có → quay lại plaque CSS.
    plaqueImg.onload = () => {
      if (!plaqueImg.src) return;
      text.classList.add('has-plaque-img');
      if (plaqueImg.naturalWidth && plaqueImg.naturalHeight) {
        text.style.aspectRatio = plaqueImg.naturalWidth + ' / ' + plaqueImg.naturalHeight;
      }
    };
    plaqueImg.onerror = () => { text.classList.remove('has-plaque-img'); };
    inner.appendChild(avWrap);
    inner.appendChild(text);
    root.appendChild(inner);
    stage.appendChild(root);
    const node = { root, inner, avImg, frame, text, textLabel, plaqueImg, name, avWrap, sig: '', avSrc: '', frameSrc: '', plaqueSrc: '' };
    nodes.set(c.id, node);
    return node;
  }

  function apply(node, c) {
    const { root, inner, avImg, frame, text, textLabel, plaqueImg, name, avWrap } = node;
    const avSize = c.avatarSize;
    const frameW = Math.round(avSize * (c.frameScale / 100));
    const hasFrame = !!c.frame;

    // Vị trí / biến đổi trên sân khấu
    root.style.left = c.overlay.x + 'px';
    root.style.top = c.overlay.y + 'px';
    root.style.transform = `scale(${c.overlay.scale}) rotate(${c.overlay.rot}deg)`;
    root.classList.toggle('is-vertical', c.layout === 'vertical');
    root.classList.toggle('is-attached', c.layout === 'attached');

    // Avatar (chỉ đổi src khi khác → tránh nháy)
    const avSrc = avatarUrl(c.avatar);
    if (avSrc !== node.avSrc) { node.avSrc = avSrc; avImg.src = avSrc; avImg._err = 0; }
    avImg.style.width = avSize + 'px';
    avImg.style.height = avSize + 'px';

    // Khung
    avWrap.style.width = (hasFrame ? frameW : avSize) + 'px';
    avWrap.style.height = (hasFrame ? '' : avSize + 'px');
    const frameSrc = hasFrame ? frameUrl(c.frame) : '';
    if (frameSrc !== node.frameSrc) { node.frameSrc = frameSrc; if (frameSrc) frame.src = frameSrc; }
    frame.style.display = hasFrame ? 'block' : 'none';

    // Tên dưới avatar
    name.textContent = c.showName ? (c.name || '') : '';
    name.style.display = c.showName && c.name ? 'block' : 'none';
    name.style.fontSize = (c.nameSize || 40) + 'px';

    // Chữ vinh danh (nhãn tách riêng để không xoá ảnh plaque). showText tắt = ẩn cả danh hiệu & nền.
    const showText = c.showText !== false && !!c.text;
    textLabel.textContent = showText ? c.text : '';
    text.style.display = showText ? 'block' : 'none';
    text.style.fontSize = c.fontSize + 'px';
    text.style.color = c.color;
    // Quản lý class bằng classList (giữ 'has-plaque-img' do ảnh gắn khi tải xong).
    text.classList.remove('style-plaque', 'style-neon', 'style-solid', 'style-gradient');
    text.classList.add('style-' + c.textStyle);
    text.style.background = showText ? textBackground(c) : 'transparent';
    text.style.setProperty('--mvp-link-color', c.bgColor);
    text.style.setProperty('--mvp-plaque-w', frameW + 'px');

    // Ảnh plaque danh hiệu Na.png (chỉ khi kiểu "Khung viền nổi", có khung & có chữ, và bật dùng ảnh).
    const usePlaque = c.textStyle === 'plaque' && c.usePlaqueImg !== false && hasFrame && showText;
    const plaqueSrc = usePlaque ? plaqueUrl(c.frame) : '';
    if (plaqueSrc !== node.plaqueSrc) {
      node.plaqueSrc = plaqueSrc;
      if (plaqueSrc) {
        plaqueImg.src = plaqueSrc; // onload sẽ gắn has-plaque-img; onerror giữ plaque CSS
      } else {
        plaqueImg.removeAttribute('src');
        text.classList.remove('has-plaque-img');
        text.style.aspectRatio = '';
      }
    }
    if (c.textStyle === 'neon') {
      text.style.textShadow = `0 0 6px ${c.bgColor}, 0 0 14px ${c.bgColor}, 0 0 26px ${c.bgColor2}`;
      text.style.webkitTextStroke = '';
    } else if (c.textStyle === 'plaque') {
      text.style.textShadow = '0 2px 3px rgba(0,0,0,.6), 0 1px 0 rgba(255,255,255,.18)';
    } else {
      text.style.textShadow = '0 2px 4px rgba(0,0,0,.45)';
    }

    // Animation xuất hiện: chỉ chạy khi thẻ mới hoặc đổi kiểu anim (không lặp mỗi heartbeat)
    const animSig = c.entryAnim;
    if (node.anim !== animSig) {
      node.anim = animSig;
      inner.classList.remove('anim-popBounce', 'anim-zoomFade', 'anim-slideRight', 'anim-slideUp', 'anim-flip', 'anim-dropBounce', 'anim-spotlight', 'anim-zoomShake');
      if (c.entryAnim && c.entryAnim !== 'none') {
        // reflow để replay animation
        void inner.offsetWidth;
        inner.classList.add('anim-' + c.entryAnim);
      }
    }
  }

  // ===== WebAudio: fanfare "công bố" (giống tab VÒNG QUAY để chạy được trên OBS/CEF) =====
  let actx = null;
  function ac() {
    try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx && actx.state === 'suspended') actx.resume(); } catch (e) { actx = null; }
    return actx;
  }
  // CEF khoá WebAudio sau khi Browser Source reset; một cú click/phím trên overlay mở lại context.
  document.addEventListener('pointerdown', ac, { passive: true });
  document.addEventListener('keydown', ac);
  function blip(freq, dur, vol) {
    const a = ac(); if (!a) return;
    const t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function playReveal(i, total) {
    const scale = [523, 587, 659, 698, 784, 880, 988, 1047];
    blip(scale[Math.min(i, scale.length - 1)], 0.18, 0.2);
    if (i === total - 1) [523, 659, 784, 1047].forEach((f, k) => setTimeout(() => blip(f, 0.22, 0.22), 120 + k * 90));
  }
  // Pháo giấy: các mảnh màu văng ra rồi mờ (chỉ transform+opacity → an toàn OBS).
  function confettiBurst(root) {
    const wrap = document.createElement('div'); wrap.className = 'mvp-confetti';
    const colors = ['#ff3d71', '#ffd23f', '#2ec4ff', '#38d67a', '#c86bff', '#ff9f1c'];
    for (let i = 0; i < 18; i++) {
      const p = document.createElement('i');
      const a = (i / 18) * Math.PI * 2 + (i % 2 ? 0.35 : -0.2), dist = 70 + (i % 4) * 26;
      p.style.setProperty('--cx', (Math.cos(a) * dist).toFixed(1) + 'px');
      p.style.setProperty('--cy', (Math.sin(a) * dist - 48).toFixed(1) + 'px');
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (i * 7) + 'ms';
      wrap.appendChild(p);
    }
    root.appendChild(wrap);
    setTimeout(() => { try { wrap.remove(); } catch {} }, 1500);
  }

  // ===== Màn công bố tuần tự — ẩn hết rồi cho các thẻ hiện lần lượt (kích bằng revealNonce) =====
  const ANIM_CLASSES = ['anim-popBounce', 'anim-zoomFade', 'anim-slideRight', 'anim-slideUp', 'anim-flip', 'anim-dropBounce', 'anim-spotlight', 'anim-zoomShake'];
  const rev = { inited: false, nonce: 0, timers: [], hidden: new Set() };
  function clearRevTimers() { rev.timers.forEach(clearTimeout); rev.timers = []; }
  function replayEntry(node, anim) {
    node.inner.classList.remove(...ANIM_CLASSES);
    if (anim && anim !== 'none') { void node.inner.offsetWidth; node.inner.classList.add('anim-' + anim); node.anim = anim; }
  }
  function startReveal(state, cards) {
    clearRevTimers();
    const stagger = Math.max(0, Math.min(5, Number(state.revealStagger) || 0));
    const autoHide = Math.max(0, Math.min(120, Number(state.revealAutoHide) || 0));
    const exit = ['fade', 'slideDown', 'zoomOut'].includes(state.revealExit) ? state.revealExit : 'fade';
    const sound = state.revealSound !== false;
    const list = cards.filter(c => c && c.id && nodes.has(c.id)).map(c => ({ c, node: nodes.get(c.id) }));
    rev.hidden = new Set(list.map(x => x.c.id));
    list.forEach(({ node }) => { node.root.classList.add('reveal-hidden'); node.inner.classList.remove('exit-fade', 'exit-slideDown', 'exit-zoomOut'); });
    list.forEach(({ c, node }, i) => {
      rev.timers.push(setTimeout(() => {
        node.root.classList.remove('reveal-hidden');
        rev.hidden.delete(c.id);
        replayEntry(node, c.entryAnim);
        if (sound) playReveal(i, list.length);
        if (c.celebrate) confettiBurst(node.root);
      }, Math.round(i * stagger * 1000)));
    });
    if (autoHide > 0 && list.length) {
      const endAt = ((list.length - 1) * stagger + autoHide) * 1000;
      rev.timers.push(setTimeout(() => {
        list.forEach(({ node }) => { node.inner.classList.remove(...ANIM_CLASSES); node.inner.classList.add('exit-' + exit); });
        rev.timers.push(setTimeout(() => {
          list.forEach(({ c, node }) => { node.root.classList.add('reveal-hidden'); rev.hidden.add(c.id); node.inner.classList.remove('exit-' + exit); });
        }, 520));
      }, Math.round(endAt)));
    }
  }
  function handleReveal(state, cards) {
    const nonce = Number(state && state.revealNonce) || 0;
    if (!rev.inited) { rev.inited = true; rev.nonce = nonce; return; }  // lần tải đầu: hiện bình thường, không tự diễn lại
    if (nonce && nonce !== rev.nonce) { rev.nonce = nonce; startReveal(state, cards); return; }
    // Giữ nguyên thẻ đang ẩn (chưa tới lượt / đã tự-ẩn) qua các lần đồng bộ định kỳ.
    for (const id of rev.hidden) { const n = nodes.get(id); if (n) n.root.classList.add('reveal-hidden'); }
  }

  // ===== AUTO — xoay vòng liên tục: hiện TỪNG khung avatar rồi tự chuyển sang khung kế, lặp lại =====
  let lastState = null;
  const auto = { on: false, timer: null, idx: 0, curId: '' };
  function autoClear() { if (auto.timer) { clearTimeout(auto.timer); auto.timer = null; } }
  function stopAuto() {
    if (!auto.on && !auto.timer) return;
    auto.on = false; auto.curId = ''; autoClear();
    // Trả về trạng thái bình thường: hiện lại tất cả.
    nodes.forEach(n => { n.root.classList.remove('reveal-hidden'); n.inner.classList.remove('exit-fade', 'exit-slideDown', 'exit-zoomOut'); });
  }
  function startAuto() { if (auto.on) return; auto.on = true; auto.idx = 0; autoTick(); }
  function autoTick() {
    if (!auto.on) return;
    autoClear();
    const cards = (lastState && Array.isArray(lastState.cards)) ? lastState.cards : [];
    const list = cards.filter(c => c && c.id && nodes.has(c.id)).map(c => ({ c, node: nodes.get(c.id) }));
    if (!list.length) { auto.timer = setTimeout(autoTick, 1000); return; }
    const dwell = (Number(lastState.revealAutoHide) > 0 ? Number(lastState.revealAutoHide) : 5) * 1000;
    const exit = ['fade', 'slideDown', 'zoomOut'].includes(lastState.revealExit) ? lastState.revealExit : 'fade';
    const i = auto.idx % list.length;
    const cur = list[i];
    auto.curId = cur.c.id;
    // Ẩn tất cả, chỉ hiện khung hiện tại (kèm anim vào + âm thanh + pháo giấy nếu bật).
    list.forEach(({ node }) => { node.root.classList.add('reveal-hidden'); node.inner.classList.remove('exit-fade', 'exit-slideDown', 'exit-zoomOut'); });
    cur.node.root.classList.remove('reveal-hidden');
    replayEntry(cur.node, cur.c.entryAnim);
    if (cur.c.celebrate) confettiBurst(cur.node.root);
    auto.timer = setTimeout(() => {
      cur.node.inner.classList.remove(...ANIM_CLASSES);
      cur.node.inner.classList.add('exit-' + exit);
      auto.timer = setTimeout(() => {
        cur.node.inner.classList.remove('exit-' + exit);
        cur.node.root.classList.add('reveal-hidden');
        auto.idx = (auto.idx + 1) % Math.max(1, list.length);
        autoTick();
      }, 520);
    }, dwell);
  }
  // Sau mỗi lần render (thẻ có thể vừa dựng lại): giữ đúng chỉ khung hiện tại hiện, tránh nháy.
  function autoEnforce() { nodes.forEach((n, id) => { if (id === auto.curId) n.root.classList.remove('reveal-hidden'); else n.root.classList.add('reveal-hidden'); }); }

  function render(state) {
    applyCanvas(state && state.canvas);
    lastState = state;
    const cards = (state && Array.isArray(state.cards)) ? state.cards : [];
    const seen = new Set();
    for (const c of cards) {
      if (!c || !c.id) continue;
      seen.add(c.id);
      const node = nodes.get(c.id) || build(c);
      apply(node, c);
    }
    for (const [id, node] of nodes) {
      if (!seen.has(id)) { try { node.root.remove(); } catch {} nodes.delete(id); }
    }
    if (state && state.autoPlay) { startAuto(); if (auto.curId) autoEnforce(); }
    else { stopAuto(); handleReveal(state, cards); }
  }

  applyCanvas('1:1');
  // OBS CEF trên một số máy giữ kết nối EventSource ở trạng thái mở nhưng không chuyển event
  // vào JavaScript. Lấy state HTTP ngay từ đầu và đồng bộ định kỳ để thẻ không bị trắng.
  function pullState() {
    fetch(`/mvp-honor-state?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(state => { if (state) render(state); })
      .catch(() => {});
  }
  pullState();
  setInterval(pullState, 2500);
  window.connectSSE(`/mvp-honor-events?token=${encodeURIComponent(token)}`, 'mvphonor', render);
})();
