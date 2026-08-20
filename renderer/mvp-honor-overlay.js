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
  // Nền tiêu đề đi cùng bộ với khung avatar. Hai bản: N.png → Na.apng (nền ĐỘNG, khổ ngang) và
  // N.png → Nv.png (bảng tên DỌC, mảnh, bản gốc của bộ khung). Trả về DANH SÁCH ứng viên theo thứ
  // tự ưu tiên — ảnh đầu lỗi thì tự rơi sang ảnh sau, hết thì về nền pill CSS. Nhờ vậy khung 42-44
  // (chỉ có Nv.png) vẫn có nền dù đang chọn kiểu "nền động".
  // style: 'anim' (mặc định, giữ nguyên nếp cũ) | 'plate' | 'auto' (ngang→động, dọc→bảng).
  function plaqueCandidates(frame, isH, style) {
    const s = String(frame || '');
    if (!s || !/\.png$/i.test(s)) return [];
    const anim = frameUrl(s.replace(/\.png$/i, 'a.apng'));
    const plate = frameUrl(s.replace(/\.png$/i, 'v.png'));
    if (style === 'plate') return [plate, anim];
    if (style === 'auto') return isH ? [anim, plate] : [plate, anim];
    return [anim, plate];
  }
  const clampNum = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def; };
  // Màu nền bảng tên: hex → rgba (hơi trong để không che mất nét khung phía sau).
  function hexRgba(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return `rgba(24,18,38,${a})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function onAvErr(img) {
    const n = (img._err = (img._err || 0) + 1);
    if (n >= 3 || !/\/avatar\?/.test(img.src)) { img.onerror = null; img.src = '/logo.png'; return; }
    img.src = img.src + (img.src.includes('?') ? '&' : '?') + 'r=' + n; // thử lại: proxy tự fetch/cache
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
    avWrap.appendChild(avImg);
    avWrap.appendChild(frame);
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
    // Ảnh lỗi (bộ khung thiếu bản đó) → thử ứng viên kế; hết ứng viên mới quay lại nền pill CSS.
    plaqueImg.onerror = () => {
      const node = nodes.get(c.id);
      const next = node && node.plaqueAlt.shift();
      text.classList.remove('has-plaque-img');
      text.style.aspectRatio = '';
      if (next) plaqueImg.src = next;
    };
    // Bảng tên RIÊNG (khi tách khỏi nền tiêu đề): viên thuốc nằm ở mép dưới avatar, đè lên khung.
    const nameTag = document.createElement('span');
    nameTag.className = 'mvp-nametag';
    nameTag.style.display = 'none';
    inner.appendChild(avWrap);
    inner.appendChild(text);
    inner.appendChild(nameTag);
    root.appendChild(inner);
    stage.appendChild(root);
    const node = { root, inner, avImg, frame, text, textLabel, plaqueImg, avWrap, nameTag, sig: '', avSrc: '', frameSrc: '', plaqueSrc: '', plaqueAlt: [], contentSig: '', tagText: null };
    nodes.set(c.id, node);
    return node;
  }

  function apply(node, c) {
    const { root, inner, avImg, frame, text, textLabel, plaqueImg, avWrap, nameTag } = node;
    const avSize = c.avatarSize;
    const frameW = Math.round(avSize * (c.frameScale / 100));
    const hasFrame = !!c.frame;

    // Vị trí / biến đổi trên sân khấu
    root.style.left = c.overlay.x + 'px';
    root.style.top = c.overlay.y + 'px';
    root.style.transform = `scale(${c.overlay.scale}) rotate(${c.overlay.rot}deg)`;
    const isH = c.layout === 'horizontal';
    root.classList.toggle('is-horizontal', isH);          // nền bên phải, thọc vào giữa avatar
    root.classList.toggle('is-vertical', !isH);           // nền nằm dưới avatar (gộp cả 'attached' cũ)

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

    // Nội dung TRÊN nền tiêu đề: tên Creator (dòng trên) + danh hiệu (dòng dưới) — cùng nằm trên nền.
    // Tên Creator: 'plaque' = nằm CHUNG trên nền tiêu đề (nếp cũ) | 'split' = bảng tên RIÊNG ở mép dưới avatar.
    const split = c.namePlace !== 'plaque';   // mặc định = TÁCH riêng
    const nameLine = c.showName && c.name ? String(c.name) : '';
    const plaqueName = split ? '' : nameLine;   // tách rồi thì nền tiêu đề chỉ còn danh hiệu
    const tagName = split ? nameLine : '';
    const titleLine = c.showText !== false && c.text ? String(c.text) : '';
    const hasContent = !!(plaqueName || titleLine);
    const contentSig = nameLine + '' + titleLine + '' + (c.nameSize || 40) + '' + c.fontSize;
    if (node.contentSig !== contentSig) {
      node.contentSig = contentSig;
      textLabel.innerHTML = '';
      if (plaqueName) { const s = document.createElement('span'); s.className = 'mvp-line mvp-nm'; s.textContent = plaqueName; s.style.fontSize = (c.nameSize || 40) + 'px'; textLabel.appendChild(s); }
      if (titleLine) { const s = document.createElement('span'); s.className = 'mvp-line mvp-ti'; s.textContent = titleLine; s.style.fontSize = c.fontSize + 'px'; textLabel.appendChild(s); }
    }
    text.style.display = hasContent ? 'block' : 'none';
    text.style.color = c.color;

    // Bảng tên RIÊNG: tâm dọc đặt đúng MÉP DƯỚI avatar (nửa cỡ avatar tính từ tâm) + lệch tay X/Y.
    if (tagName) {
      if (node.tagText !== tagName) { node.tagText = tagName; nameTag.textContent = tagName; }
      const plain = c.nameStyle === 'plain';
      nameTag.style.display = '';
      nameTag.classList.toggle('is-plain', plain);
      nameTag.style.fontSize = (c.nameSize || 40) + 'px';
      nameTag.style.color = c.nameColor || c.color;
      nameTag.style.background = plain ? '' : hexRgba(c.nameBg, .9);
      nameTag.style.maxWidth = Math.max(120, Math.round(frameW * 1.1)) + 'px';
      nameTag.style.setProperty('--mvp-nanchor', Math.round(avSize / 2) + 'px');
      nameTag.style.setProperty('--mvp-nx', Math.round(clampNum(c.nameX, -400, 400, 0)) + 'px');
      nameTag.style.setProperty('--mvp-ny', Math.round(clampNum(c.nameY, -400, 400, 0)) + 'px');
    } else {
      nameTag.style.display = 'none';
      node.tagText = null;
    }

    // Nền tiêu đề động: cỡ (% theo khung) + lệch nền X/Y (px) + lệch chữ trong nền (%). Thọc mặc định theo bố cục.
    // TÁCH tên (bố cục dọc): nền đo từ TÂM avatar xuống — nửa avatar + lệch tên + nửa bảng tên + nameGap
    // (bảng tên cao ≈ nameSize×1.7: line-height 1.25 + padding .28em + viền .17em) → khoảng cách tới TÊN
    // luôn như nhau dù khung PNG cao thấp khác nhau.
    const bannerScale = clampNum(c.bannerScale, 40, 220, 100);
    const bannerW = Math.round(frameW * bannerScale / 100);
    const gap = Math.round(clampNum(c.nameGap, -200, 400, 10));
    const tuck = isH ? Math.round(avSize * 0.34) : Math.round(avSize * 0.12);
    const splitV = !!tagName && !isH;
    root.classList.toggle('is-split', splitV);
    if (splitV) {
      const below = avSize / 2 + clampNum(c.nameY, -400, 400, 0) + (c.nameSize || 40) * 0.85 + gap;
      text.style.setProperty('--mvp-nbelow', Math.round(below) + 'px');
    }
    text.style.setProperty('--mvp-banner-w', bannerW + 'px');
    text.style.setProperty('--mvp-tuck', tuck + 'px');
    text.style.setProperty('--mvp-bx', Math.round(clampNum(c.bannerX, -600, 600, 0)) + 'px');
    text.style.setProperty('--mvp-by', Math.round(clampNum(c.bannerY, -600, 600, 0)) + 'px');
    text.style.setProperty('--mvp-tx', Math.round(clampNum(c.textX, -50, 50, 0)) + '%');
    text.style.setProperty('--mvp-ty', Math.round(clampNum(c.textY, -50, 50, 0)) + '%');

    // Nền tiêu đề bằng ẢNH: có khung + có nội dung là luôn dùng. Thứ tự ưu tiên theo plaqueStyle
    // (+ bố cục khi 'auto'); ảnh lỗi thì onerror tự rơi sang bản kia, hết thì về nền pill CSS.
    const usePlaque = hasFrame && hasContent;
    const cands = usePlaque ? plaqueCandidates(c.frame, isH, c.plaqueStyle) : [];
    const plaqueSrc = cands[0] || '';
    const plaqueKey = plaqueSrc + '|' + cands.length;
    if (plaqueKey !== node.plaqueSrc) {
      node.plaqueSrc = plaqueKey;
      node.plaqueAlt = cands.slice(1);
      if (plaqueSrc) {
        plaqueImg.src = plaqueSrc; // onload gắn has-plaque-img; onerror thử ứng viên kế / nền pill
      } else {
        plaqueImg.removeAttribute('src');
        text.classList.remove('has-plaque-img');
        text.style.aspectRatio = '';
      }
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
