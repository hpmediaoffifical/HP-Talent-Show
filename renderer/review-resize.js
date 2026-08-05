// review-resize.js — Tay kéo góc DƯỚI-PHẢI để phóng to / thu nhỏ TOÀN BỘ overlay.
// CHỈ chạy trong cửa sổ Review (review=1). KHÔNG đụng tới output OBS, KHÔNG lưu vào config app:
// chỉ scale cục bộ bản xem trước bằng CSS `zoom` trên 1 lớp bọc root, nhớ mức zoom qua localStorage theo overlay.
// Dùng `zoom` (đổi layout thật) thay `transform:scale` vì vùng kéo cửa sổ (-webkit-app-region) bám layout,
// không theo transform → transform để lại dải "ma" ăn chuột dưới/phải khi thu nhỏ. Render() chỉ đổi innerHTML
// + CSS var (không đụng wrapper) nên mức zoom sống sót qua re-render; grip là phần tử fixed riêng, không bị scale.
(function () {
  if (new URLSearchParams(location.search).get('review') !== '1') return;

  // Mỗi trang chỉ có 1 trong các root này.
  const ROOT_IDS = ['pkDuoRoot', 'kcRoot', 'pkfxRoot', 'pkGroupRoot', 'rankingRoot', 'scoreRoot', 'stickerRoot', 'mvpStage', 'lwStage', 'cfRoot', 'cfxRoot', 'gmRoot', 'mtRoot', 'dvStage', 'feedRoot'];
  const MIN = 0.3, MAX = 2, BASE = 320; // kéo chéo ~320px ≈ ±100% zoom

  function init() {
    let root = null;
    for (const id of ROOT_IDS) { const el = document.getElementById(id); if (el) { root = el; break; } }
    if (!root) return;

    // Bọc root trong 1 lớp phóng/thu bằng CSS `zoom` (đổi LAYOUT thật) — KHÔNG dùng transform:scale.
    // Lý do: vùng kéo cửa sổ (-webkit-app-region) bám theo layout, KHÔNG theo transform → transform để lại
    // 1 dải "ma" ăn chuột phía dưới/bên phải khi thu nhỏ. Zoom đổi layout nên vùng kéo khớp đúng nội dung.
    // Root vẫn giữ zoom nội bộ (--pk-scale…) vì zoom lồng nhau nhân lại; render() không đụng tới wrapper.
    const wrap = document.createElement('div');
    wrap.className = 'review-zoom';
    root.parentNode.insertBefore(wrap, root);
    wrap.appendChild(root);

    const key = 'reviewZoom:' + root.id + (new URLSearchParams(location.search).get('grid') === '1' ? ':grid' : '');

    const savedZoom = parseFloat(localStorage.getItem(key));
    let zoom = savedZoom;
    if (!Number.isFinite(zoom)) zoom = 1;
    zoom = Math.max(MIN, Math.min(MAX, zoom));
    let needsInitialFit = !Number.isFinite(savedZoom);

    const grip = document.createElement('div');
    grip.className = 'review-grip';
    grip.title = 'Kéo để thu nhỏ / phóng to overlay • nhấp đúp để về 100%';
    grip.innerHTML = '<span class="review-grip-badge"></span>'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 9 9 21M21 15 15 21M21 21 21 21" /></svg>';
    document.body.appendChild(grip);
    const badge = grip.querySelector('.review-grip-badge');

    let fitFrame = 0, sentWidth = 0, sentHeight = 0;
    function fitWindowToContent() {
      if (!window.api?.review?.fitContent || fitFrame) return;
      fitFrame = requestAnimationFrame(() => {
        fitFrame = 0;
        const r = root.getBoundingClientRect();
        const width = Math.ceil(r.width), height = Math.ceil(r.height);
        if (width < 40 || height < 40) return;
        // Lần đầu mở, các overlay cấu hình lớn (như BXH 205%) phải vừa trong
        // khung Review trước khi cửa sổ tự ôm nội dung. Không áp dụng lại khi
        // người dùng đã chọn mức zoom riêng cho overlay này.
        if (needsInitialFit && root.children.length) {
          needsInitialFit = false;
          const fit = Math.min(1, (window.innerWidth - 8) / width, (window.innerHeight - 8) / height);
          if (fit < 0.999) {
            zoom = Math.max(MIN, Math.min(MAX, zoom * fit));
            wrap.style.zoom = zoom.toFixed(4);
            placeGrip();
            fitWindowToContent();
            return;
          }
        }
        // PK Đôi FX tự fit stage vào toàn bộ cửa sổ, nên không được dùng stage
        // đó để phóng cửa sổ lên 1080x1920. Các overlay khác báo kích thước thật.
        if (Math.abs(width - window.innerWidth) <= 1 && Math.abs(height - window.innerHeight) <= 1) return;
        if (Math.abs(width - sentWidth) <= 1 && Math.abs(height - sentHeight) <= 1) return;
        sentWidth = width;
        sentHeight = height;
        window.api.review.fitContent(width, height).catch(() => {});
      });
    }

    function apply() {
      // zoom đổi kích thước layout thật → nội dung + vùng kéo cửa sổ (-webkit-app-region) cùng thu/phóng,
      // không còn dải "ma" ăn chuột. Neo top-left tự nhiên vì wrapper là khối max-content ở đầu dòng.
      wrap.style.zoom = zoom.toFixed(4);
      placeGrip();
      fitWindowToContent();
    }

    function placeGrip() {
      const r = root.getBoundingClientRect();
      const G = grip.offsetWidth || 26;
      const vw = window.innerWidth, vh = window.innerHeight;
      let x = Math.min(r.right, vw) - G - 2;
      let y = Math.min(r.bottom, vh) - G - 2;
      x = Math.max(2, Math.min(x, vw - G - 2));
      y = Math.max(2, Math.min(y, vh - G - 2));
      grip.style.left = x + 'px';
      grip.style.top = y + 'px';
    }

    let dragging = false, sx = 0, sy = 0, z0 = 1;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      dragging = true; sx = e.clientX; sy = e.clientY; z0 = zoom;
      try { grip.setPointerCapture(e.pointerId); } catch {}
      grip.classList.add('dragging');
      badge.textContent = Math.round(zoom * 100) + '%';
    });
    grip.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const d = ((e.clientX - sx) + (e.clientY - sy)) / 2;
      zoom = Math.max(MIN, Math.min(MAX, z0 + d / BASE));
      badge.textContent = Math.round(zoom * 100) + '%';
      apply();
    });
    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      try { grip.releasePointerCapture(e.pointerId); } catch {}
      grip.classList.remove('dragging');
      try { localStorage.setItem(key, zoom.toFixed(4)); } catch {}
    }
    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);
    grip.addEventListener('dblclick', (e) => {
      e.preventDefault(); e.stopPropagation();
      zoom = 1; apply();
      try { localStorage.setItem(key, '1'); } catch {}
    });

    // Overlay dựng lại innerHTML mỗi lần có state → kích thước root đổi → dời grip bám theo góc.
    try { new ResizeObserver(() => { placeGrip(); fitWindowToContent(); }).observe(root); } catch {}
    window.addEventListener('resize', () => { placeGrip(); fitWindowToContent(); });

    apply();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
