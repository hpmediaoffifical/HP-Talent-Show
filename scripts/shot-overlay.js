// Chụp ảnh overlay để TỰ KIỂM CHỨNG khi sửa giao diện (công cụ dev, app không dùng tới).
//
//   SHOT_URL=... SHOT_OUT=...png [SHOT_W SHOT_H SHOT_INJECT SHOT_BLOCK] \
//     node_modules/electron/dist/electron.exe scripts/shot-overlay.js
//
// SHOT_INJECT = file JS chạy trong trang trước khi chụp (bơm state giả rồi gọi render({...}));
//   giá trị trả về ghi vào scripts/shot.log cùng console của trang.
// SHOT_BLOCK  = danh sách mẫu URL (ngăn cách bằng dấu phẩy) bị CHẶN, vd "-events,/mvp-honor-state".
//
// 3 cái bẫy đã trả giá, ĐỪNG sửa lại:
//  1. Tham số phải đi qua BIẾN MÔI TRƯỜNG. Truyền thêm đối số dòng lệnh (nhất là đường dẫn .js/.png)
//     làm Electron hiểu nhầm và tiến trình chết IM LẶNG trước khi chạy dòng code đầu tiên.
//  2. show:true + backgroundThrottling:false. Cửa sổ ẩn bị Chromium bóp timer/transition → ảnh chụp
//     ra trạng thái CHƯA chạy animation (vd. vạch giữa còn đứng ở 50%), dễ tưởng là lỗi sản phẩm.
//  3. Stub window.EventSource trong file inject là KHÔNG ĐỦ: kết nối SSE đã mở từ lúc tải trang vẫn
//     bắn state THẬT của app đè lên state giả, ảnh chụp ra cấu hình đang lưu chứ không phải cái mình
//     muốn xem. Phải chặn bằng SHOT_BLOCK=-events (và /mvp-honor-state cho overlay VINH DANH).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const LOG = path.join(__dirname, 'shot.log');
const log = (...a) => { try { fs.appendFileSync(LOG, a.join(' ') + '\n'); } catch {} };
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const url = process.env.SHOT_URL, out = process.env.SHOT_OUT, inject = process.env.SHOT_INJECT || '';
  log('start', url, '->', out);
  const win = new BrowserWindow({ width: Number(process.env.SHOT_W || 540), height: Number(process.env.SHOT_H || 960), show: true, backgroundColor: '#101318', webPreferences: { backgroundThrottling: false } });
  const blocks = (process.env.SHOT_BLOCK || '').split(',').map(s => s.trim()).filter(Boolean);
  if (blocks.length) {
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) =>
      cb({ cancel: blocks.some(b => d.url.includes(b)) }));
    log('blocking', blocks.join(' '));
  }
  win.webContents.on('console-message', (...a) => log('[page]', a[2]));
  await win.loadURL(url);
  await new Promise(r => setTimeout(r, 900));
  if (inject) {
    try { log('[inject]', String(await win.webContents.executeJavaScript(fs.readFileSync(inject, 'utf8'), true))); }
    catch (e) { log('[inject-error]', e && e.message); }
    await new Promise(r => setTimeout(r, 1800));
  }
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  log('saved', out);
  app.exit(0);
});
