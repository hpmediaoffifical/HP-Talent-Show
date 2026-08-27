## 🎬 SCENE OBS — Tự ẩn/hiện overlay theo Scene (khắc phục dính overlay trên TikTok Studio)

TikTok Studio không có Scene như OBS, mọi Browser Source gắn cố định nên khi đổi cam trong OBS các overlay vẫn dính. Bản này thêm cầu nối WebSocket để đổi Scene OBS là overlay tự bật/tắt.

**Mới:**
- Menu riêng **CÀI ĐẶT → SCENE OBS** (logo OBS): gộp **Reset overlay OBS** (cổng/mật khẩu) và **SCENE OBS → Overlay**. Bật `Bật tự động ẩn/hiện theo Scene OBS` → `Tải danh sách Scene từ OBS` (qua `GetSceneList`) → tick overlay cho từng Scene.
- Logic **một Scene bật → các Scene còn lại tắt**: bấm Scene nào đã gán thì chỉ overlay đó hiện (áp dụng cho cả 24 nguồn, 4 kiểu `🎯 Tính điểm` chung/riêng đã gom nhóm).
- Giao diện gọn: thẻ Scene thu gọn mặc định (`▼ Hiện` / `▲ Ẩn` ở mục mẹ), tag màu tóm tắt `🎯 Tính điểm (4/4)` ngay header để nhận biết nhanh; nhóm có checkbox đầu dòng để bật chung cả 4 kiểu Tính điểm.
- Menu trái không còn làm nhảy Scene: khi SCENE OBS bật, bấm `TÍNH ĐIỂM / PK ĐÔI…` trong app không đẩy sang OBS nữa — chỉ bấm Scene trong OBS (hoặc nút `○/●` trong SCENE OBS) mới đổi.

**Sửa:**
- `ws` cho main process + tự nối lại khi đổi cổng 4455→4456; `Cài đặt máy chủ WebSocket` phải bấm `Đồng ý` mới nhận kết nối mới.
- Tách `SAO LƯU` chỉ còn xuất/nhập dữ liệu cho gọn.

**Đã kiểm chứng:** `npm test` 21/21 + 7/7 giây cuối vẫn đạt; `ws` 8.21.3; chuyển `CAM1 PK ĐÔI (pkduo/pkduofx)` ↔ `CAM2 PK NHÓM` → `score`/`scoretimer` chỉ hiện đúng Scene.
