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
    const h = CANVAS[ratio] || CANVAS['3:4'];
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
    inner.appendChild(avWrap);
    inner.appendChild(text);
    root.appendChild(inner);
    stage.appendChild(root);
    const node = { root, inner, avImg, frame, text, name, avWrap, sig: '', avSrc: '', frameSrc: '' };
    nodes.set(c.id, node);
    return node;
  }

  function apply(node, c) {
    const { root, inner, avImg, frame, text, name, avWrap } = node;
    const avSize = c.avatarSize;
    const frameW = Math.round(avSize * (c.frameScale / 100));
    const hasFrame = !!c.frame;

    // Vị trí / biến đổi trên sân khấu
    root.style.left = c.overlay.x + 'px';
    root.style.top = c.overlay.y + 'px';
    root.style.transform = `scale(${c.overlay.scale}) rotate(${c.overlay.rot}deg)`;
    root.classList.toggle('is-vertical', c.layout === 'vertical');

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

    // Chữ vinh danh
    text.textContent = c.text || '';
    text.style.display = c.text ? 'block' : 'none';
    text.style.fontSize = c.fontSize + 'px';
    text.style.color = c.color;
    text.className = 'mvp-text style-' + c.textStyle;
    text.style.background = c.text ? textBackground(c) : 'transparent';
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
      inner.classList.remove('anim-popBounce', 'anim-zoomFade', 'anim-slideRight', 'anim-slideUp');
      if (c.entryAnim && c.entryAnim !== 'none') {
        // reflow để replay animation
        void inner.offsetWidth;
        inner.classList.add('anim-' + c.entryAnim);
      }
    }
  }

  function render(state) {
    applyCanvas(state && state.canvas);
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
  }

  applyCanvas('3:4');
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
