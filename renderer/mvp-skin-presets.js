// Mặc định chuẩn theo TỪNG SKIN cho tab Vinh danh (mỗi nền Na.apng hình dạng khác nhau → vị trí chữ khác).
// Chỉ ghi những skin/bố cục KHÁC mặc định chung (vertical 77/…/31/21, horizontal 159/8/…/42/42).
// Thẻ mới hoặc skin lần đầu dùng sẽ lấy số ở đây. Cập nhật: chạy lại script trích từ config.bySkin rồi thay file.
// Mỗi mục: <số skin>: { vertical?:{7 field}, horizontal?:{7 field} }
window.MVP_SKIN_PRESETS = {
   4: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: 4, fontSize: 31, nameSize: 21 }, horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 5, fontSize: 42, nameSize: 42 } },
   8: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: 6, fontSize: 31, nameSize: 23 }, horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 8, fontSize: 44, nameSize: 42 } },
   9: { horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 1, textY: 6, fontSize: 34, nameSize: 42 } },
  10: { horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 4, fontSize: 42, nameSize: 42 } },
  11: { horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 2, fontSize: 42, nameSize: 42 } },
  13: { horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 2, textY: 5, fontSize: 41, nameSize: 42 } },
  14: { horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 5, textY: 4, fontSize: 42, nameSize: 42 } },
  15: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: -5, fontSize: 31, nameSize: 21 }, horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 3, textY: -5, fontSize: 42, nameSize: 42 } },
  16: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: 3, fontSize: 31, nameSize: 21 }, horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 5, fontSize: 42, nameSize: 42 } },
  18: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: 4, fontSize: 31, nameSize: 21 }, horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 5, fontSize: 42, nameSize: 42 } },
  19: { horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 1, fontSize: 42, nameSize: 42 } },
  20: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: 4, fontSize: 31, nameSize: 21 }, horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 5, fontSize: 42, nameSize: 42 } },
  21: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: 4, fontSize: 31, nameSize: 21 }, horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 9, fontSize: 42, nameSize: 42 } },
  22: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: 2, fontSize: 31, nameSize: 21 }, horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 7, fontSize: 42, nameSize: 42 } },
  23: { horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: -5, fontSize: 42, nameSize: 42 } },
  24: { horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 5, fontSize: 42, nameSize: 42 } },
  25: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: -6, fontSize: 31, nameSize: 21 }, horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: -1, fontSize: 42, nameSize: 42 } },
  28: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: -1, fontSize: 31, nameSize: 21 } },
  29: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: 4, fontSize: 31, nameSize: 21 }, horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 5, fontSize: 42, nameSize: 42 } },
  30: { horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 3, fontSize: 42, nameSize: 42 } },
  31: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: -7, fontSize: 31, nameSize: 21 }, horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: -7, fontSize: 42, nameSize: 42 } },
  35: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: 7, fontSize: 31, nameSize: 21 }, horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 5, fontSize: 42, nameSize: 42 } },
  36: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: 5, fontSize: 31, nameSize: 21 }, horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 6, fontSize: 42, nameSize: 42 } },
  37: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: -2, fontSize: 31, nameSize: 21 } },
  38: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: 9, fontSize: 31, nameSize: 21 }, horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 14, fontSize: 42, nameSize: 42 } },
  39: { horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 1, fontSize: 42, nameSize: 42 } },
  40: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 0, textY: 0, fontSize: 22, nameSize: 21 } },
  41: { vertical: { bannerScale: 77, bannerX: 0, bannerY: 0, textX: 1, textY: 2, fontSize: 12, nameSize: 19 }, horizontal: { bannerScale: 159, bannerX: 8, bannerY: 0, textX: 7, textY: 2, fontSize: 42, nameSize: 42 } },
};
