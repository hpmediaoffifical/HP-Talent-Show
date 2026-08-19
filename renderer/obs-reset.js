// OBS WebSocket v5 — RESET (refresh cache) các Browser Source trỏ tới overlay localhost của app.
// Chỉ đụng đúng những Browser Source có URL chứa host:port overlay của app (127.0.0.1 / localhost),
// KHÔNG động tới scene/collection hay bất kỳ thông số nào khác của OBS, và KHÔNG đụng dữ liệu app.
//
// Dùng WebSocket có sẵn của Chromium (renderer). Xác thực (nếu OBS bật) tính ở main qua window.api.obs.authString.
(function () {
  const OP = { HELLO: 0, IDENTIFY: 1, IDENTIFIED: 2, REQUEST: 6, REQUEST_RESPONSE: 7 };

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // Mở kết nối + handshake tới khi Identified. Resolve => WebSocket đã sẵn sàng gửi request.
  function connect(port, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(`ws://127.0.0.1:${port}`); }
      catch (e) { return reject(e); }
      const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('OBS WebSocket timeout')); }, timeoutMs);
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Không kết nối được OBS WebSocket (ws://127.0.0.1:' + port + ')'));
      };
      ws.onmessage = async (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.op === OP.HELLO) {
          const d = { rpcVersion: 1, eventSubscriptions: 0 };
          const authInfo = msg.d && msg.d.authentication;
          if (authInfo) {
            try { d.authentication = await window.api.obs.authString(authInfo.salt, authInfo.challenge); }
            catch (e) { clearTimeout(timer); try { ws.close(); } catch {} return reject(e); }
          }
          try { ws.send(JSON.stringify({ op: OP.IDENTIFY, d })); }
          catch (e) { clearTimeout(timer); reject(e); }
        } else if (msg.op === OP.IDENTIFIED) {
          clearTimeout(timer);
          ws.onmessage = null; ws.onerror = null;
          resolve(ws);
        }
      };
    });
  }

  // Gửi 1 request và chờ đúng response theo requestId.
  function request(ws, requestType, requestData, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const requestId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const timer = setTimeout(() => { cleanup(); reject(new Error('OBS request timeout: ' + requestType)); }, timeoutMs);
      function onMsg(ev) {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.op === OP.REQUEST_RESPONSE && msg.d && msg.d.requestId === requestId) {
          cleanup();
          const st = msg.d.requestStatus || {};
          if (st.result) resolve(msg.d.responseData || {});
          else reject(new Error(st.comment || ('OBS request failed: ' + requestType)));
        }
      }
      function cleanup() { clearTimeout(timer); ws.removeEventListener('message', onMsg); }
      ws.addEventListener('message', onMsg);
      try { ws.send(JSON.stringify({ op: OP.REQUEST, d: { requestType, requestId, requestData: requestData || {} } })); }
      catch (e) { cleanup(); reject(e); }
    });
  }

  // Thử kết nối lần lượt vài cổng phổ biến (cổng người dùng đặt trước, rồi 4455/4456).
  // Giúp "chạy được ngay" khi cổng OBS khác mặc định mà không cần chỉnh tay.
  async function connectAny(port) {
    const candidates = [...new Set([Number(port) || 4455, 4455, 4456].filter(p => p > 0 && p < 65536))];
    let lastErr = null;
    for (const p of candidates) {
      try { return await connect(p); }
      catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Không kết nối được OBS WebSocket');
  }

  // Reset (refresh cache trang) tất cả Browser Source trỏ tới overlay localhost của app.
  // opts: { port (OBS WS port), overlayPort (port server overlay của app) }
  async function resetOverlays({ port, overlayPort }) {
    const ws = await connectAny(port);
    try {
      const { inputs } = await request(ws, 'GetInputList', { inputKind: 'browser_source' });
      // Overlay của app trải trên DẢI cổng overlayPort..overlayPort+PORT_SPAN-1 (mỗi LOẠI overlay 1
      // cổng riêng để né trần 6 kết nối/host của CEF — xem obs-overlay-server.portOffsets).
      // ⚠ Dải này phải RỘNG HƠN portCount của server: trước đây cứng +7 (18282..18289) nên MỌI overlay
      // thêm sau Vòng quay (Menu Quà 18290, Bộ ba 18291, Thẻ bài 18292-93, Nhạc Dance 18294-96,
      // Tương tác 18297, Giữ/Đổi 18298, Táp tim 18299, FX PK Nhóm 18300…) KHÔNG hề được reset →
      // OBS mở trước app (bật máy) thì trang chết hẳn, phải xoá nguồn rồi thêm lại bằng tay.
      const base = Number(overlayPort) || 18282;
      const PORT_SPAN = 32; // dư chỗ cho các overlay sẽ thêm sau, khỏi phải sửa lại chỗ này
      const targets = [];
      for (const inp of (inputs || [])) {
        const name = inp.inputName;
        let inputSettings;
        try { inputSettings = (await request(ws, 'GetInputSettings', { inputName: name })).inputSettings || {}; }
        catch { continue; }
        const url = String(inputSettings.url || '');
        // Chấp nhận cả hostname chế độ TikTok Studio (hpstudio.obs → map hosts về 127.0.0.1):
        // link copy ở chế độ đó KHÔNG chứa 127.0.0.1 nên trước đây cũng bị bỏ qua khi reset.
        const m = url.match(/^https?:\/\/(?:127\.0\.0\.1|localhost|hpstudio\.obs):(\d+)\b/i);
        if (!m) continue;
        const pnum = Number(m[1]);
        if (pnum < base || pnum >= base + PORT_SPAN) continue;
        targets.push(name);
      }
      // Bấm nút "Refresh cache of current page" của Browser Source → reload sạch trang overlay.
      // OBS/CEF đôi khi không vẽ lại sau 1 lần refresh (phải bấm lần 2 mới hiện) → refresh 2 nhịp
      // để reset xong overlay tự hiển thị ngay, không cần thao tác tay lần nữa.
      const press = (name) => request(ws, 'PressInputPropertiesButton', { inputName: name, propertyName: 'refreshnocache' }).catch(() => {});
      for (const name of targets) await press(name);
      if (targets.length) {
        await delay(500);
        for (const name of targets) await press(name);
      }
      return { ok: true, matched: targets.length, total: (inputs || []).length };
    } finally {
      try { ws.close(); } catch {}
    }
  }

  window.ObsReset = { resetOverlays };
})();
