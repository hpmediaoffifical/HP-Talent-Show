// Tự cài dòng hosts "127.0.0.1 hpstudio.obs" để link overlay chạy được trên TikTok LIVE Studio.
// Vì sao cần: TikTok Studio từ chối URL IP trần (http://127.0.0.1:port) nhưng chấp nhận hostname;
// hostname này map về 127.0.0.1 ngay trên máy qua hosts file → 100% cục bộ, không phụ thuộc DNS/domain ngoài.
//
// GHI hosts CẦN QUYỀN ADMIN. App chạy per-user (không admin) nên ta nâng quyền qua PowerShell (UAC) CHỈ KHI THIẾU.
// Chạy mỗi lần mở app = tự khắc phục cho: máy MỚI cài, sau khi CẬP NHẬT, và cả khi antivirus/gỡ cài xoá mất dòng.
// ĐỌC hosts thì KHÔNG cần admin → luôn kiểm tra trước, chỉ bật UAC khi thật sự thiếu.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOSTS_PATH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
const OVERLAY_HOSTNAME = 'hpstudio.obs';

function readHostsSafe() {
  try { return fs.readFileSync(HOSTS_PATH, 'utf8'); } catch { return ''; }
}

// Đã có dòng ACTIVE map 127.0.0.1 -> hpstudio.obs chưa (bỏ qua dòng comment "#")?
function hasOverlayHostEntry() {
  const txt = readHostsSafe();
  // Dòng bắt đầu (sau khoảng trắng) bằng 127.0.0.1 và có token hpstudio.obs, không nằm sau dấu #.
  const re = /^[ \t]*127\.0\.0\.1[ \t]+(?:[^#\r\n]*[ \t])?hpstudio\.obs(?:[ \t]|$)/im;
  return re.test(txt);
}

// Ghi dòng hosts qua PowerShell tự nâng quyền (UAC). Idempotent (kiểm tra lại trong script elevated).
// Trả Promise<boolean> = dòng hosts có mặt sau khi thao tác (true nếu đã sẵn có hoặc ghi thành công).
function ensureOverlayHostEntry() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    if (hasOverlayHostEntry()) return resolve(true);
    // Script chạy Ở TIẾN TRÌNH ĐƯỢC NÂNG QUYỀN: chỉ thêm nếu chưa có (an toàn khi chạy lại).
    const inner = '$p = "$env:SystemRoot\\System32\\drivers\\etc\\hosts"; '
      + 'if (-not (Select-String -Path $p -Pattern "hpstudio\\.obs" -Quiet)) { '
      + 'Add-Content -Path $p -Value "127.0.0.1 hpstudio.obs" -Encoding ASCII }';
    const b64 = Buffer.from(inner, 'utf16le').toString('base64'); // -EncodedCommand nhận UTF-16LE base64
    // Tiến trình ngoài (không admin) chỉ để gọi Start-Process -Verb RunAs → bật UAC 1 lần.
    const cmd = `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @('-NoProfile','-EncodedCommand','${b64}')`;
    try {
      const ps = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], { windowsHide: true });
      const done = () => resolve(hasOverlayHostEntry());
      ps.on('exit', done);
      ps.on('error', () => resolve(false)); // user bấm "No" ở UAC → reject → coi như thất bại
    } catch { resolve(false); }
  });
}

module.exports = { HOSTS_PATH, OVERLAY_HOSTNAME, hasOverlayHostEntry, ensureOverlayHostEntry };
