// Robust SSE cho overlay OBS — tự hồi phục khi stream localhost rớt/kẹt "half-open".
// Vấn đề: khi app bận (lúc KẾT NỐI TikTok), OBS/CEF có thể để kết nối SSE chết ngầm
// mà EventSource không báo lỗi → overlay đứng hình / biến mất, phải Ctrl+R.
// Cách xử lý: watchdog (server heartbeat ~5s, quá ~12s không nhận gì ⇒ dựng lại) + onerror +
// kiểm tra khi source hiện lại (visibility/online). Nhờ vậy overlay TỰ lên lại, không cần đụng OBS.
(function () {
  window.connectSSE = function connectSSE(path, eventName, onData, opts) {
    opts = opts || {};
    const STALE = opts.staleMs || 12000; // ~2 nhịp heartbeat lỡ ⇒ coi như kẹt
    let es = null, lastAt = Date.now(), lastPayload = '', closed = false, reconnecting = false;
    // Phiên bản app lúc trang được tải. Khi server phát __ver KHÁC (sau khi cập nhật app) ⇒ tự reload
    // MỘT LẦN để lấy CSS/JS mới (server trả no-store nên reload = bản mới), KHỎI bấm Refresh/Reset trong OBS.
    // Giữ ở scope ngoài open() để sống qua các lần reconnect ⇒ chỉ reload khi ĐỔI version, không phải mỗi reconnect.
    let loadedVer = null;

    function bump() { lastAt = Date.now(); }
    function open() {
      reconnecting = false;
      try { es && es.close(); } catch (_) {}
      try { es = new EventSource(path); }
      catch (_) { return schedule(1500); }
      es.addEventListener('open', bump);
      es.addEventListener('__ver', function (e) {
        bump();
        const v = String(e.data || '');
        if (!v) return;                       // server không gửi version ⇒ tính năng tắt, không đụng gì
        if (loadedVer === null) { loadedVer = v; return; } // lần đầu = phiên bản đang chạy
        if (v !== loadedVer) { loadedVer = v; try { location.reload(); } catch (_) {} }
      });
      es.addEventListener(eventName, function (e) {
        bump();
        const payload = e.data || '{}';
        // Heartbeat gửi lại state cũ để giữ kết nối. Không dựng lại toàn bộ overlay
        // (đặc biệt là ảnh avatar) khi dữ liệu thực tế không đổi.
        if (payload === lastPayload) return;
        lastPayload = payload;
        try { onData(JSON.parse(payload)); } catch (_) {}
      });
      es.onerror = function () {
        // readyState CLOSED(2) = EventSource bỏ cuộc ⇒ tự dựng lại;
        // CONNECTING(0) = nó đang tự thử lại, cứ để yên.
        if (es && es.readyState === 2) reconnect(800);
      };
    }
    function reconnect(wait) {
      if (closed || reconnecting) return;
      reconnecting = true;
      try { es && es.close(); } catch (_) {}
      es = null;
      schedule(wait || 500);
    }
    function schedule(wait) {
      setTimeout(function () { if (!closed) { bump(); open(); } }, wait);
    }

    setInterval(function () {
      if (!closed && Date.now() - lastAt > STALE) reconnect(200);
    }, 3000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && Date.now() - lastAt > STALE) reconnect(200);
    });
    window.addEventListener('online', function () { reconnect(200); });

    open();
    return { close: function () { closed = true; try { es && es.close(); } catch (_) {} } };
  };
})();
