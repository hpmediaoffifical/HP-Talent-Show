# Link overlay chạy được trên TikTok LIVE Studio (hostname loopback + tự cài hosts)

> Tài liệu handoff để áp dụng cho **HP NPC LIVE** và các app overlay tương tự.
> Mục tiêu: link overlay localhost dán được vào **TikTok LIVE Studio** mà vẫn 100% cục bộ, không cert, không phụ thuộc domain/DNS ngoài.

---

## 1. Vấn đề

TikTok LIVE Studio (ô **"Liên kết"** của Browser/Web source) có bộ **kiểm tra định dạng URL**:

- ❌ **Từ chối** URL dạng IP trần: `http://127.0.0.1:18286/...` → báo *"Hãy nhập URL chính xác"*.
- ✅ **Chấp nhận** URL có **hostname**: kể cả `http` (không cần https) và cổng lạ như `:18286`.

> OBS thì **không kén** — nhận cả `127.0.0.1` lẫn hostname. Vấn đề chỉ ở TikTok Studio.

Đã test thực tế: TikTok Studio **không bắt buộc https/cert**, nó chỉ ghét **IP trần / localhost**. Chỉ cần đổi sang **hostname** là qua.

---

## 2. Giải pháp (tóm tắt)

1. Dùng một **hostname bịa** (ví dụ `hpstudio.obs`) map về `127.0.0.1` bằng **file hosts của Windows**:
   ```
   127.0.0.1 hpstudio.obs
   ```
2. Server overlay **vẫn bind `127.0.0.1`** và **chỉ nhận request loopback** (không đổi bảo mật). Trình duyệt/OBS/TikTok Studio tự phân giải `hpstudio.obs → 127.0.0.1` ngay trên máy.
3. Chỉ **đổi chuỗi URL sinh ra cho người dùng copy** từ `127.0.0.1` sang `hpstudio.obs`. Không đụng phần bind/serve.
4. App **tự kiểm tra & tự ghi dòng hosts mỗi lần mở** (nâng quyền UAC). Bao trùm: cài mới, sau cập nhật, và cả khi antivirus/gỡ cài xoá mất.

**Ưu điểm:** 100% loopback → độ trễ 0, không cert, không DNS/domain ngoài → miễn nhiễm DDoS/bảo trì/mất mạng.

**Vì sao KHÔNG dùng domain thật (vd `local.hp.media A→127.0.0.1`):** vẫn phụ thuộc DNS zone bên ngoài; hosts file thì tự chứa 100%, chạy cả khi offline.

**Vì sao KHÔNG dùng installer NSIS ghi hosts:** bản cài per-user (`perMachine:false`) không có quyền admin → không ghi được. App-side self-heal chạy mỗi lần mở → chắc và tự sửa khi bị xoá.

---

## 3. Chọn hostname

- **Phải có dấu chấm** (để qua validator URL của TikTok). `hpstudio.obs` OK; single-label như `hpstudio` có thể bị từ chối.
- **Tránh đuôi `.local`** — Windows đẩy sang mDNS/Bonjour, dễ trục trặc.
- Nên cố định 1 tên riêng cho mỗi app để không đụng nhau (vd `hpstudio.obs`, `hpnpc.obs`…).

---

## 4. Các thành phần cần implement

Ví dụ đường dẫn theo app HP GROUP LIVE (Electron). Áp tương tự cho app khác.

### 4.1. Module tự cài hosts — `src/hosts-setup.js`

```js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOSTS_PATH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
const OVERLAY_HOSTNAME = 'hpstudio.obs'; // ĐỔI theo app

function readHostsSafe() { try { return fs.readFileSync(HOSTS_PATH, 'utf8'); } catch { return ''; } }

// Có dòng ACTIVE map 127.0.0.1 -> hostname chưa (bỏ qua dòng comment '#')?
function hasOverlayHostEntry() {
  const re = /^[ \t]*127\.0\.0\.1[ \t]+(?:[^#\r\n]*[ \t])?hpstudio\.obs(?:[ \t]|$)/im;
  return re.test(readHostsSafe());
}

// Ghi dòng hosts qua PowerShell tự nâng quyền (UAC). Idempotent. Trả Promise<boolean>.
function ensureOverlayHostEntry() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    if (hasOverlayHostEntry()) return resolve(true); // đã có → không bật UAC
    const inner = '$p = "$env:SystemRoot\\System32\\drivers\\etc\\hosts"; '
      + 'if (-not (Select-String -Path $p -Pattern "hpstudio\\.obs" -Quiet)) { '
      + 'Add-Content -Path $p -Value "127.0.0.1 hpstudio.obs" -Encoding ASCII }';
    const b64 = Buffer.from(inner, 'utf16le').toString('base64'); // -EncodedCommand cần UTF-16LE base64
    const cmd = `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @('-NoProfile','-EncodedCommand','${b64}')`;
    try {
      const ps = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], { windowsHide: true });
      ps.on('exit', () => resolve(hasOverlayHostEntry()));
      ps.on('error', () => resolve(false)); // user bấm "No" ở UAC
    } catch { resolve(false); }
  });
}

module.exports = { HOSTS_PATH, OVERLAY_HOSTNAME, hasOverlayHostEntry, ensureOverlayHostEntry };
```

**Cơ chế nâng quyền:** tiến trình PowerShell ngoài (medium integrity) chỉ để gọi `Start-Process -Verb RunAs`, tiến trình con mới là elevated và ghi hosts. `-EncodedCommand` (base64 UTF-16LE) để né mọi rắc rối quoting.

### 4.2. Server overlay — biến `linkHost` + setter

Trong class server (nơi sinh URL cho người dùng copy):

```js
const TIKTOK_STUDIO_HOST = 'hpstudio.obs';

// trong constructor:
this.linkHost = '127.0.0.1'; // mặc định OBS (loopback thuần)

// getter URL: dùng this.linkHost thay cho '127.0.0.1'
getScoreUrl() { return `http://${this.linkHost}:${port}/score?token=${token}`; }
// ... áp cho MỌI getter overlay

// setter
setLinkMode(tiktok) { this.linkHost = tiktok ? TIKTOK_STUDIO_HOST : '127.0.0.1'; return this.linkHost; }
isTikTokLinkMode() { return this.linkHost === TIKTOK_STUDIO_HOST; }
```

> ⚠️ KHÔNG đổi phần `server.listen(port, '127.0.0.1')` và chốt chặn chỉ-nhận-loopback. Chỉ đổi chuỗi URL.

### 4.3. Main process — áp chế độ + IPC + tự cài lúc khởi động

```js
const hostsSetup = require('./hosts-setup');

// Sau overlayServer.start():
overlayServer.setLinkMode(settings.overlayTikTokLinks !== false); // MẶC ĐỊNH BẬT (chỉ tắt nếu user chủ động)
if (overlayServer.isTikTokLinkMode() && !hostsSetup.hasOverlayHostEntry()) ensureOverlayHostsAndNotify(true);

let _hostsFixInFlight = false;
async function ensureOverlayHostsAndNotify(autoFix) {
  let present = hostsSetup.hasOverlayHostEntry();
  if (!present && autoFix && !_hostsFixInFlight) {
    _hostsFixInFlight = true;
    try { present = await hostsSetup.ensureOverlayHostEntry(); } finally { _hostsFixInFlight = false; }
  }
  const tiktok = !!overlayServer?.isTikTokLinkMode();
  broadcast('hosts:status', { present, needed: tiktok && !present, hostname: hostsSetup.OVERLAY_HOSTNAME });
  return present;
}

// IPC:
ipcMain.handle('overlay:getLinkMode', () => overlayServer?.isTikTokLinkMode() || false);
ipcMain.handle('overlay:setLinkMode', (_e, on) => {
  settings.overlayTikTokLinks = !!on; saveSettings();
  overlayServer?.setLinkMode(!!on);
  ensureOverlayHostsAndNotify(!!on); // bật TikTok mà thiếu hosts → tự cài
  return !!on;
});
ipcMain.handle('hosts:status', () => ({
  present: hostsSetup.hasOverlayHostEntry(),
  needed: !!overlayServer?.isTikTokLinkMode() && !hostsSetup.hasOverlayHostEntry(),
  hostname: hostsSetup.OVERLAY_HOSTNAME,
}));
ipcMain.handle('hosts:fix', async () => ({ present: await ensureOverlayHostsAndNotify(true), hostname: hostsSetup.OVERLAY_HOSTNAME }));
```

### 4.4. Preload — expose API + allow event

```js
overlay: {
  getLinkMode: () => ipcRenderer.invoke('overlay:getLinkMode'),
  setLinkMode: (on) => ipcRenderer.invoke('overlay:setLinkMode', on),
},
hosts: {
  status: () => ipcRenderer.invoke('hosts:status'),
  fix: () => ipcRenderer.invoke('hosts:fix'),
},
// nhớ thêm 'hosts:status' vào allowlist của hàm on(channel, handler)
```

### 4.5. Renderer — công tắc + banner + nút "Sửa nhanh"

HTML (đặt ở khu link overlay):
```html
<label class="switch-row"><input id="ovlTikTokLinks" type="checkbox" /><span></span>
  <b>Link cho TikTok LIVE Studio</b></label>
<p class="sub">TẮT = link OBS (127.0.0.1). BẬT = đổi mọi nút copy sang http://hpstudio.obs:…</p>
<div id="ovlHostsBanner" hidden>
  ⚠️ Máy chưa có dòng <code>127.0.0.1 hpstudio.obs</code> — link TikTok sẽ không chạy.
  <button id="ovlHostsFix" type="button">🔧 Sửa nhanh</button>
</div>
```

JS:
```js
function applyHostsStatus(st) {
  document.getElementById('ovlHostsBanner').hidden = !st?.needed;
}
function refreshHostsBanner() { window.api.hosts.status().then(applyHostsStatus); }

const t = document.getElementById('ovlTikTokLinks');
window.api.overlay.getLinkMode().then(on => { t.checked = !!on; refreshHostsBanner(); });
t.addEventListener('change', async () => {
  await window.api.overlay.setLinkMode(t.checked);
  await refreshOverlayUrls(); // cập nhật lại các nút copy
  refreshHostsBanner();
});
document.getElementById('ovlHostsFix').addEventListener('click', async () => {
  await window.api.hosts.fix(); refreshHostsBanner();
});
window.api.on('hosts:status', applyHostsStatus); // nhận trạng thái từ main lúc khởi động
```

> **Lưu ý gom URL:** nếu app có nhiều nút copy rải rác, hãy để **mọi nút lấy URL từ getter của server** (qua IPC) để 1 biến `linkHost` điều khiển tất cả. Nút "data-copy" giữ dataset thì gọi `refreshOverlayUrls()` sau khi đổi chế độ; nút lấy URL ngay lúc bấm thì tự đúng.

---

## 5. Hành vi tự cài hosts (self-heal)

- App **đọc** hosts mỗi lần mở (không cần admin). Nếu đang bật TikTok mà **thiếu** dòng → gọi `ensureOverlayHostEntry()` (nâng quyền ghi).
- **Idempotent:** đã có dòng → return ngay, KHÔNG bật UAC.
- Bao trùm: **cài mới** (lần đầu thêm), **sau cập nhật** (bản mới mở lên kiểm lại), **AV/gỡ cài xoá** (lần mở kế thêm lại).

### Về UAC (quan trọng)
- Máy **admin + UAC "Never notify"** → `Start-Process -Verb RunAs` nâng quyền **IM LẶNG, không popup** → tự đè hoàn toàn tự động. (Đây là cấu hình các máy LIVE thường dùng.)
- Máy **admin + UAC bật** → hiện **1 UAC** lần đầu, bấm "Yes" là xong vĩnh viễn.
- Máy **tài khoản standard (không admin)** → RunAs cần mật khẩu admin. Nếu không có → banner + nút "🔧 Sửa nhanh" để cài tay, hoặc admin thêm dòng hosts thủ công.

Không có cách nào ghi hosts mà không qua admin — đây là giới hạn của Windows.

---

## 6. Checklist nghiệm thu

- [ ] Dán `http://<hostname>:<port>/...` vào TikTok Studio → **không** báo "Hãy nhập URL chính xác", overlay hiện.
- [ ] `hasOverlayHostEntry()` trả `true` khi hosts có dòng, `false` khi không.
- [ ] Xoá dòng hosts → `ensureOverlayHostEntry()` tự thêm lại (before=false → after=true).
- [ ] Máy Never notify: thêm lại **không popup**.
- [ ] Server phục vụ `200` trên **cả** `127.0.0.1` và `<hostname>` (cùng cổng, cùng token).
- [ ] Tắt công tắc → nút copy về `127.0.0.1`; bật → về `<hostname>`.
- [ ] OBS cũ đã cấu hình `127.0.0.1` vẫn chạy (server nghe cả hai).

Lệnh test nhanh (PowerShell):
```powershell
# resolve + serve
ipconfig /flushdns
Invoke-WebRequest "http://hpstudio.obs:18286/score?token=<TOKEN>" -UseBasicParsing
```

---

## 7. Gotchas

- **Đừng** đổi `server.listen(port, '127.0.0.1')` — request tới hostname vẫn về loopback nên chốt `remoteAddress===127.0.0.1` vẫn pass.
- **CEF connection limit (6/host:port):** trình duyệt coi `127.0.0.1` và `hostname` là 2 host khác → mỗi cái có ngân sách 6 kết nối riêng (lợi nhẹ, không hại). Nếu app tách nhiều overlay theo cổng thì giữ nguyên logic đó.
- **Base64 cho -EncodedCommand** phải là **UTF-16LE** (`Buffer.from(str,'utf16le')`), không phải utf8.
- **Regex hosts** phải bỏ qua dòng comment (`#`) và match token `hostname` đứng riêng (tránh khớp nhầm chuỗi con).
- **Mặc định BẬT** nghĩa là mọi link copy ra là hostname → **bắt buộc** self-heal hosts chạy được, nếu không overlay trắng cả trên OBS. Cân nhắc: hoặc mặc định TẮT (an toàn hơn, OBS-first) hoặc BẬT + self-heal chắc chắn (như HP GROUP LIVE).
