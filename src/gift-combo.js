'use strict';
// Đếm số quà MỚI của mỗi nhịp combo TikTok — tách riêng khỏi main.js để CHẠY TEST ĐƯỢC
// (scripts/test-gift-combo.js replay các chuỗi gói tin thật, không cần Electron/LIVE).
//
// Combo (giftType 1): TikTok gửi NHIỀU nhịp cho CÙNG một lượt tặng rồi một gói chốt repeatEnd.
// Hàm trả về SỐ QUÀ MỚI của nhịp hiện tại (delta) để cộng NGAY — KHÔNG chờ gói chốt. Nhờ vậy
// KHÔNG mất quà khi gói chốt đến muộn hoặc rớt mạng ("tặng 2 quà chỉ nhận 1").
//
// Nguồn sự thật là `counted` = TỔNG số quà của lượt tặng này đã được cộng, nhờ đó đúng với CẢ HAI
// kiểu chuỗi mà TikTok/connector gửi (payload v2 thiếu giftType nên KHÔNG được dựa vào nó để đoán):
//   • Kiểu TÍCH LUỸ: repeatCount = 1,2,3…N rồi gói chốt lặp lại N   → mỗi nhịp cộng phần chênh.
//   • Kiểu TỪNG NHỊP: repeatCount luôn = 1 (N nhịp) rồi gói chốt N  → mỗi nhịp cộng 1, gói chốt cộng 0.
//   • Trả 0 = nhịp này đã cộng ở lần trước rồi → engine phải bỏ qua (return).
// LƯU Ý: engine dùng hàm này PHẢI được gọi trên MỌI nhịp quà (không gate theo shouldProcess).
//
// ⚠️ BẪY ĐÃ TRẢ GIÁ — lỗi "tặng 200 hoa hồng thành 400" (2026-08-25):
// bản cũ làm `map.delete(key)` NGAY khi thấy gói chốt. Lượt tặng vừa đóng bị quên sạch, nên BẤT KỲ
// gói nào của chính lượt đó về sau gói chốt đều bị coi là "lượt tặng mới" và cộng lại TOÀN BỘ tổng.
// Ba tình huống có thật, cả ba đều cho ĐÚNG gấp đôi:
//   1. Gói chốt được phát lại với msgId KHÁC → bộ chặn msgId ở tiktok-client.js không bắt được.
//   2. Một nhịp thường về MUỘN hơn gói chốt (protobuf giao theo lô, không bảo đảm thứ tự).
//   3. Gói chốt xuất hiện ở hai lô liên tiếp.
// Nay GIỮ LẠI "bia mộ" (`closed`) thay vì xoá: trong CLOSED_WINDOW_MS, mọi gói trông như thuộc lượt
// vừa đóng (repeat ≤ tổng đã chốt) đều trả 0. Quá cửa sổ đó mới coi là lượt tặng mới.
//
// ⚠️ BẪY ĐÃ TRẢ GIÁ #2 — lỗi "tặng 8 quà lẻ rồi combo x100 chỉ được 100" (2026-08-26):
// nhánh "chuỗi chạy tiếp sau gói chốt" chỉ cộng PHẦN CHÊNH (repeat − counted) mà KHÔNG xét đã cách
// nhau bao lâu. Nên một LƯỢT TẶNG MỚI có repeatCount lớn hơn tổng lượt cũ (lượt cũ chốt ở 8, lượt
// mới vào theo lô rc=10) bị coi là chuỗi cũ chạy tiếp → cộng 2 thay vì 10, nuốt ĐÚNG BẰNG tổng
// lượt trước. Khán giả thấy "điểm lúc đầu tự biến mất". Nay chặn hai lớp:
//   1. comboGroupId (WebcastGiftMessage.groupId) — TikTok cấp mã riêng cho MỖI lượt combo, mọi nhịp
//      cùng lượt mang cùng mã. Mã khác mã đang giữ = CHẮC CHẮN lượt mới → cộng đủ. Nguồn sự thật,
//      không phải suy đoán theo con số.
//   2. Không có mã (payload cũ/thiếu) thì rơi về thời gian: chỉ coi là "chạy tiếp" khi gói tới NGAY
//      SÁT gói chốt (≤ CLOSED_WINDOW_MS = cùng lô hoặc lô kế). Xa hơn = lượt mới, cộng ĐỦ — cùng
//      hướng đánh đổi đã chọn ở nhánh gói-chốt-phát-lại: thà tính thừa hiếm gặp còn hơn nuốt quà.

// ⚠️ BẪY ĐÃ TRẢ GIÁ #3 — lỗi "Giữ/Đổi: lên combo GIÂY CUỐI là thanh tự động ×2 điểm" (2026-08-26):
// engine nào cũng từng gọi `this._comboRepeats.clear()` trong start()/stop()/reset(). Combo lên ở giây
// cuối LUÔN còn nhịp + gói chốt bay tới SAU khi trận đã chốt (TikTok/connector trễ vài giây — xem
// memory gift-latency-not-app). MC bấm BẮT ĐẦU vòng mới ngay lúc đó → bộ nhớ combo bị xoá sạch → nhịp
// còn lại của CHÍNH lượt combo cũ rơi vào nhánh "lượt tặng mới" và cộng ĐỦ lần thứ hai ⇒ đúng gấp đôi.
// (Riêng gói chốt trễ là nặng nhất: `p(50, repeatEnd)` một mình cộng thêm nguyên 50.)
// ⇒ QUY TẮC: bộ nhớ combo là thuộc tính của LUỒNG GÓI TIN, KHÔNG phải của trận. TUYỆT ĐỐI KHÔNG
// clear() nó khi bắt đầu/dừng/reset — map tự hết hạn bằng COMBO_TTL_MS + prune(). Giữ lại map chính
// là thứ hấp thụ đuôi combo cũ (trả 0 / chỉ cộng phần chênh) thay vì đếm lại từ đầu.
// Kịch bản đối chứng: scripts/test-kcduo-lastsec.js (replay thẳng vào KcDuoEngine thật).

const COMBO_TTL_MS = 60000;    // im lặng quá lâu → nhịp sau là LƯỢT TẶNG MỚI, không nối vào lượt cũ
// Cửa sổ hấp thụ GÓI CHỐT PHÁT LẠI. Gói phát lại nằm cùng lô hoặc lô kế tiếp → dưới 1 giây; để
// 1.2s cho rộng tay. CỐ TÌNH ĐỂ NGẮN: nếu người xem tặng LẠI đúng quà đó với ĐÚNG số lượng đó
// trong cửa sổ này thì lượt mới bị nuốt, nên cửa sổ càng ngắn càng ít rủi ro tính THIẾU.
const CLOSED_WINDOW_MS = 1200;

function comboKey(ev) {
  return `${ev.uniqueId || ev.nickname || ev.avatar || 'anonymous'}:${ev.giftId || ev.giftName || 'gift'}`;
}

function comboDelta(map, ev, now = Date.now()) {
  const repeat = Math.max(1, Number(ev.repeatCount) || 1);
  const key = comboKey(ev);
  const group = String(ev.comboGroupId || '');
  const prev = map.get(key);
  const age = prev ? now - prev.at : Infinity;
  const open = (count) => {
    map.set(key, { last: repeat, counted: count, at: now, closed: !!ev.repeatEnd, group });
    prune(map, now);
  };

  // Lượt tặng MỚI: chưa có state, hoặc im lặng quá TTL.
  if (!prev || age > COMBO_TTL_MS) { open(repeat); return repeat; }

  // LƯỢT TẶNG MỚI CHẮC CHẮN: TikTok đổi mã lượt combo (groupId). Xét TRƯỚC mọi suy đoán theo con số
  // — cộng ĐỦ repeat, không nối vào lượt cũ. Chỉ tin khi CẢ HAI bên đều có mã (thiếu mã thì im lặng
  // rơi xuống các nhánh cũ, không được phép đoán bừa).
  if (group && prev.group && group !== prev.group) { open(repeat); return repeat; }

  // ----- Lượt tặng đã ĐÓNG (đã thấy gói chốt) -----
  if (prev.closed) {
    // Chuỗi vẫn chạy tiếp sau một gói chốt (TikTok có gửi kiểu này) → chỉ cộng PHẦN CHÊNH.
    // Chỉ đúng khi gói tới NGAY SÁT gói chốt; xa hơn là lượt tặng MỚI (xem BẪY #2 ở đầu file).
    if (repeat > prev.counted && age <= CLOSED_WINDOW_MS) { const d = repeat - prev.counted; open(repeat); return d; }
    // GÓI CHỐT PHÁT LẠI: đúng là gói chốt (repeatEnd) và lặp lại ĐÚNG tổng đã chốt, ngay sát nhau
    // → chắc chắn là bản sao, trả 0. Đây chính là lỗi "200 hoa hồng thành 400".
    // KHÔNG làm mới mốc thời gian: một tràng gói phát lại không được phép kéo dài cửa sổ vô hạn.
    if (ev.repeatEnd && repeat === prev.counted && age <= CLOSED_WINDOW_MS) return 0;
    // Còn lại (nhịp thường sau khi chuỗi đã chốt, hoặc quá cửa sổ) = LƯỢT TẶNG MỚI.
    // CỐ Ý cộng đủ chứ không nuốt: nhịp thường sau gói chốt KHÔNG phân biệt được với nhịp đầu của
    // combo kế tiếp, mà tính THIẾU quà của khán giả tệ hơn nhiều so với rủi ro tính thừa hiếm gặp.
    open(repeat);
    return repeat;
  }

  // ----- Lượt đang chạy -----
  // Bộ đếm TỤT (vd chuỗi cũ rớt gói chốt rồi người ta tặng lượt mới bắt đầu từ 1) → lượt MỚI.
  // Chỉ tin dấu hiệu này khi chuỗi CHƯA đóng; chuỗi đã đóng thì nhịp về muộn cũng "tụt" y hệt.
  if (repeat < prev.last) { open(repeat); return repeat; }
  let delta, counted;
  if (repeat > prev.counted) { delta = repeat - prev.counted; counted = repeat; } // chuỗi tích luỹ
  else if (ev.repeatEnd) { delta = 0; counted = prev.counted; }                    // gói chốt lặp lại tổng
  else { delta = repeat; counted = prev.counted + repeat; }                        // chuỗi từng nhịp rời
  map.set(key, { last: repeat, counted, at: now, closed: !!ev.repeatEnd, group: group || prev.group || '' });
  prune(map, now);
  return delta;
}

// Chuỗi không có gói chốt sẽ không bao giờ tự xoá → dọn định kỳ cho khỏi phình bộ nhớ.
function prune(map, now) {
  if (map.size <= 300) return;
  for (const [k, v] of map) if ((now - v.at) > COMBO_TTL_MS) map.delete(k);
}

module.exports = { comboDelta, comboKey, COMBO_TTL_MS, CLOSED_WINDOW_MS };
