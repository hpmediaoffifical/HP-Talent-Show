'use strict';
/**
 * HP KEY - Sinh van tay may (HWID), zero-dependency. Ket qua: sha256 hex 64 ky tu,
 * co dinh tren cung 1 may (bat buoc 64 hex - server yeu cau).
 */
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

function run(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 })
      .toString().trim();
  } catch (_) { return ''; }
}

// Van tay co "chat luong" hay khong: tren Windows phai lay duoc it nhat 1 trong 3
// thong so phan cung. May dang LIVE (OBS + game) rat de lam PowerShell qua han 8s
// => cac phan tu rong bi parts.filter(Boolean) loai bo => chuoi ghep khac di =>
// HWID khac => server tuong may moi => "thu hoi" oan. Co co nay de KHONG luu de
// va KHONG tin van tay kem chat luong.
let lastQualityOk = false;

function hwParts() {
  const parts = [];
  if (process.platform === 'win32') {
    const ps = (q) => {
      const cmd = `powershell -NoProfile -NonInteractive -Command "${q}"`;
      // Thu lai 1 lan: qua han do may ban nhat thoi khong duoc phep lam doi HWID.
      return run(cmd) || run(cmd);
    };
    const cim = [
      ps('(Get-CimInstance Win32_ComputerSystemProduct).UUID'),
      ps('(Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId'),
      ps('(Get-CimInstance Win32_BaseBoard | Select-Object -First 1).SerialNumber'),
    ];
    lastQualityOk = cim.some(Boolean);
    parts.push(...cim);
  } else if (process.platform === 'darwin') {
    parts.push(run("ioreg -rd1 -c IOPlatformExpertDevice | awk -F'\"' '/IOPlatformUUID/{print $4}'"));
  } else {
    parts.push(run('cat /etc/machine-id 2>/dev/null'));
    parts.push(run('cat /sys/class/dmi/id/product_uuid 2>/dev/null'));
    lastQualityOk = parts.some(Boolean);
  }
  if (process.platform === 'darwin') lastQualityOk = parts.some(Boolean);
  const macs = [];
  const ni = os.networkInterfaces();
  for (const name of Object.keys(ni)) {
    for (const a of ni[name] || []) {
      if (!a.internal && a.mac && a.mac !== '00:00:00:00:00:00') macs.push(a.mac);
    }
  }
  macs.sort();
  parts.push(macs[0] || '');
  parts.push(os.hostname());
  return parts.filter(Boolean).join('|');
}

const HEX64 = /^[0-9a-f]{64}$/;

let cached = null;
/**
 * HWID DONG BANG: tinh 1 lan roi luu co dinh (file + registry, xem store.js).
 * Cac lan sau doc lai ban da luu => cam VPN / USB wifi / dock / doi ten may KHONG
 * con lam doi van tay. May cu giu dung HWID dang dang ky tren server (lan chay dau
 * cua ban nay chup lai chinh gia tri hien hanh) nen khong anh huong user cu.
 */
function getHWID() {
  if (cached) return cached;
  let store = null;
  try { store = require('./store'); } catch (_) {}

  try {
    const saved = store && store.readHwid();
    if (saved && HEX64.test(saved)) { cached = saved; return cached; }
  } catch (_) {}

  const raw = hwParts() || ('fallback|' + os.hostname() + '|' + os.arch());
  cached = crypto.createHash('sha256').update(raw).digest('hex');
  // Chi dong bang khi lay duoc van tay phan cung that. Neu WMI/PowerShell hong thi
  // day la van tay "kem" - dung tam cho lan nay, tuyet doi khong ghi de ban da luu.
  if (lastQualityOk && store) { try { store.writeHwid(cached); } catch (_) {} }
  return cached;
}

module.exports = { getHWID };
