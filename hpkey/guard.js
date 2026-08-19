'use strict';
/**
 * HP KEY - LOP BAO VE chong "thu hoi oan" (app-level, khong sua core.js).
 *
 * VAN DE that: core.verifyKey() coi MOI phan hoi khong phai {ok:true} la bi thu hoi,
 * ke ca khi body rong / khong phai JSON (apiCall nuot loi JSON.parse thanh body:{}).
 * => hpvn.media loi 502/503, trang bao tri HTML, Cloudflare chan, wifi khach san
 * bat dang nhap (tra HTML kem HTTP 200)... deu bien thanh error='revoked' va app
 * TU DONG giua luc dang LIVE. Hop thoai bao "(revoked)" chinh la chuoi fallback do.
 *
 * CACH LAM: phan loai loi.
 *   HARD - server noi RO rang bang ma da biet -> moi tinh la thu hoi that.
 *   SOFT - moi thu con lai (mat mang, body rong/HTML, 5xx, sai chu ky token, ma la)
 *          -> KHONG BAO GIO dong app, chi canh bao; van chay bang han offline da luu.
 * Va: phai HARD lien tiep du so lan (mac dinh 3) moi dong app.
 */
const core = require('./core');
const cfg = require('./config');

// Chi nhung ma NAY moi la "server that su tu choi key".
const HARD_CODES = new Set([
  'key_blocked',          // admin bam khoa key
  'device_revoked',       // admin thu hoi may nay
  'key_expired',          // het han
  'invalid_key',          // key khong ton tai
  'device_limit_reached', // vuot so may cho phep
]);

// Ma tuy loi nhung TUYET DOI khong duoc dong app:
//  revoked/activate_failed -> fallback khi body rong => hau nhu luon la loi server.
//  bad_token               -> lech HWID / lech gio may => loi phia client, khong phai bi cam.
//  not_configured          -> ban build thieu secret => dong app cung vo ich.
function classify(r) {
  if (!r) return { kind: 'soft', code: 'no_result' };
  if (r.ok) return { kind: 'ok', code: '' };
  const code = String(r.error || 'unknown');
  if (r._offline || code === 'no_network') return { kind: 'soft', code };
  return { kind: HARD_CODES.has(code) ? 'hard' : 'soft', code };
}

// core.errVi() chi co chu cho ma HARD; ma SOFT roi vao "Loi kich hoat: <ma>" kho hieu.
const SOFT_VI = {
  revoked: 'hệ thống bản quyền trả về dữ liệu trống (server bận/bảo trì)',
  activate_failed: 'hệ thống bản quyền trả về dữ liệu trống (server bận/bảo trì)',
  no_result: 'hệ thống bản quyền không phản hồi',
  bad_token: 'chữ ký phản hồi chưa khớp (mạng bị chèn hoặc giờ máy lệch)',
  no_network: 'không kết nối được hệ thống bản quyền',
};
function msgVi(kind, code) {
  if (kind === 'ok') return '';
  if (kind === 'hard') return core.errVi(code);
  if (SOFT_VI[code]) return SOFT_VI[code];
  if (code.indexOf('exception:') === 0) return 'lỗi khi gọi hệ thống bản quyền';
  return 'hệ thống bản quyền báo lỗi lạ (' + code + ')';
}

/** Kiem tra 1 lan + phan loai. Khong bao gio nem loi. */
async function verifyOnce(key) {
  let r;
  try { r = await core.verifyKey(key); }
  catch (e) { r = { ok: false, error: 'exception:' + (e && e.message || e) }; }
  const c = classify(r);
  return { ...c, raw: r, message: msgVi(c.kind, c.code) };
}

/**
 * Watcher an toan.
 *  opts.onRevoked(code)  - CHI goi khi da HARD lien tiep >= hardStrikes lan.
 *  opts.onWarn(info)     - loi mo ho: {code, message, softStreak} - chi de hien canh bao.
 *  opts.onOk(payload)    - moi lan check thanh cong (de cap nhat checkedAt).
 * Tra ve { stop, state }.
 */
function startWatch(opts) {
  const getKey = opts.getKey;
  const onRevoked = opts.onRevoked || (() => {});
  const onWarn = opts.onWarn || (() => {});
  const onOk = opts.onOk || (() => {});
  const intervalSec = Math.max(15, Number(opts.intervalSec || cfg.RECHECK_SECONDS || 60));
  const hardStrikes = Math.max(1, Number(opts.hardStrikes || 3));

  const state = { hardStreak: 0, softStreak: 0, lastOkAt: 0, lastCode: '', stopped: false };
  let timer = null;

  const arm = (sec) => {
    if (state.stopped) return;
    timer = setTimeout(tick, sec * 1000);
    if (timer.unref) timer.unref();
  };

  async function tick() {
    timer = null;
    if (state.stopped) return;
    const key = (typeof getKey === 'function' ? getKey() : getKey) || '';
    if (!key) return arm(intervalSec);

    const r = await verifyOnce(key);
    if (state.stopped) return;
    state.lastCode = r.code;

    if (r.kind === 'ok') {
      state.hardStreak = 0; state.softStreak = 0; state.lastOkAt = Date.now();
      try { onOk(r.raw.payload); } catch (_) {}
      return arm(intervalSec);
    }

    if (r.kind === 'soft') {
      state.hardStreak = 0;                  // loi mo ho xoa luon chuoi hard dang dem
      state.softStreak++;
      // Canh bao thua thot: lan thu 2 roi cu 10 lan mot (khoi lam phien luc dang LIVE).
      if (state.softStreak === 2 || state.softStreak % 10 === 0) {
        try { onWarn({ code: r.code, message: r.message, softStreak: state.softStreak }); } catch (_) {}
      }
      return arm(intervalSec);
    }

    // HARD: xac nhan lai NHANH (8s) thay vi cho het chu ky, du 3 lan moi ket luan.
    state.softStreak = 0;
    state.hardStreak++;
    if (state.hardStreak >= hardStrikes) {
      state.stopped = true;
      try { onRevoked(r.code, r.message); } catch (_) {}
      return;
    }
    try { onWarn({ code: r.code, message: r.message, hardStreak: state.hardStreak, confirming: true }); } catch (_) {}
    return arm(8);
  }

  arm(intervalSec);
  return {
    state,
    stop() { state.stopped = true; if (timer) clearTimeout(timer); timer = null; },
  };
}

module.exports = { startWatch, verifyOnce, classify, HARD_CODES };
