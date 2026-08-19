'use strict';
/**
 * HP KEY adapter cho HP GROUP LIVE.
 * Thay backend Google Sheet bang HP KEY (hpvn.media). GIU NGUYEN shape
 * { ok, license:{...} } ma main.js/renderer dang dung => khong phai sua gate.
 */
const core = require('./core');

function fmtDmy(unix) {
  // parseLicenseDate ben main.js nhan dd/mm/yyyy. Vinh vien -> ngay xa.
  if (!unix) return '31/12/2099';
  const d = new Date(unix * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

async function validateLicenseKey(key, deviceId) {
  const r = await core.activate(key);
  if (!r.ok) {
    // _soft = loi KHONG chac chan (mat mang, server 5xx/HTML, sai chu ky token...).
    // main.js dua vao co nay de dung han ban quyen da luu thay vi bat kich hoat lai.
    const kind = require('./guard').classify(r).kind;
    return { ok: false, error: core.errVi(r.error), _code: r.error, _offline: !!r._offline, _soft: kind === 'soft' };
  }
  const p = r.payload;
  return {
    ok: true,
    license: {
      key: p.k,
      vip: p.r || 'ADMIN',           // role ADMIN/VIP/CREATOR
      allowedIds: Array.isArray(p.ids) ? p.ids : [], // VIP: chỉ kết nối các ID này (rỗng = không giới hạn)
      expiresAt: fmtDmy(p.exp),
      status: 'active',
      activatedAt: Date.now(),
      checkedAt: Date.now(),
      deviceId: deviceId || '',
    },
  };
}

module.exports = { validateLicenseKey };
