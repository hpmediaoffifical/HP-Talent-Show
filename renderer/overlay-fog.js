// overlay-fog.js — LỚP SƯƠNG MÙ / KHÓI 3D che thanh máu + số điểm ở 10 GIÂY CUỐI (kịch tính, lộ khi hết giờ).
// Dùng CHUNG cho 4 tính năng: 🎯 Tính điểm · ⚔️ PK Đôi · 🔁 Giữ/Đổi · 🧩 PK Nhóm.
// Trả về CHUỖI HTML để overlay chèn vào lớp bọc thanh máu (bar wrapper). Overlay thêm class `fog-on` lên
// board để CSS ẩn con số bên dưới; ĐỒNG HỒ đếm lùi nằm NGOÀI thanh nên vẫn hiện.
//
// Khối khói có CHIỀU SÂU: nền xám khói (không phẳng trắng) + nhiều khối SÁNG (trắng bồng) và TỐI (than xám =
// bóng) trôi ĐAN NHAU nhiều tốc độ (parallax) → cuộn 3D. OBS-safe: chỉ nền rgba + transform (không blur
// xuyên lớp, không color-mix, không filter động). Overlay dựng lại innerHTML mỗi nhịp SSE → mọi khối trôi
// ĐỒNG BỘ theo ĐỒNG HỒ CHUNG bằng animation-delay ÂM (3 chu kỳ → 3 biến --fd1/2/3) nên liền mạch, không giật.
(function () {
  const P1 = 14000, P2 = 22000, P3 = 9000; // 3 tầng tốc độ: khối vừa · mây lớn chậm · vệt mảnh nhanh
  // opts.label = chú thích nét thanh chìm giữa vùng khói (vd "SƯƠNG MÙ") — nói cho người xem biết ĐANG
  // giấu điểm có chủ đích (không phải lỗi). Bỏ trống = không chữ.
  function veilHtml(opts) {
    opts = opts || {};
    const now = Date.now();
    const d = (p) => (-(now % p) / 1000).toFixed(3);
    // Số khối cố định theo class (vị trí/cỡ/pha đặt trong CSS) → không random để khỏi giật khi dựng lại.
    let blobs = '';
    for (let i = 0; i < 6; i++) blobs += `<i class="fog-puff light l${i}"></i>`;
    for (let i = 0; i < 5; i++) blobs += `<i class="fog-puff dark d${i}"></i>`;
    for (let i = 0; i < 3; i++) blobs += `<i class="fog-streak s${i}"></i>`;
    const label = opts.label
      ? `<span class="fog-label">${String(opts.label).replace(/[<>&]/g, '')}</span>`
      : '';
    return `<div class="fog-veil" aria-hidden="true" style="--fd1:${d(P1)}s;--fd2:${d(P2)}s;--fd3:${d(P3)}s">`
      + `<span class="fog-base"></span>${blobs}<span class="fog-vignette"></span>${label}`
      + `</div>`;
  }
  window.OverlayFog = { veilHtml, P1, P2, P3 };
})();
