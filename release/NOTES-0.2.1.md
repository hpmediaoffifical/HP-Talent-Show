## 🎬 SCENE OBS + 🎨 Hiển thị + 🖼️ Avatar — bản đè 0.2.1

Gộp các vá sau 0.2.0, đè lên 0.2.1 cũ vì chưa máy nào cập nhật (theo yêu cầu).

**Mới / Sửa:**
- **SCENE OBS** (`CÀI ĐẶT → SCENE OBS`): `ws` cho main process + tự nối lại khi đổi cổng 4455→4456; menu trái không còn đẩy SCENE (chỉ OBS đổi mới đổi overlay); thẻ Scene gọn (`▼ Hiện`/`▲ Ẩn` ở mục mẹ) + tag màu tóm tắt `🎯 Tính điểm (4/4)`.
- **Hiển thị — Chữ trắng phản nền sáng:** Toggle `CÀI ĐẶT → SCENE OBS → 🎨 Hiển thị` (mặc định **tắt**, ép tắt kể cả cập nhật đến khi tự bật). Bật → `html.white-text` trên mọi overlay qua SSE `__white` (`overlay-common.css` + `overlay-sse.js`), `Amy/Harley/0` đen → trắng có bóng.
- **Tính điểm KÊU GỌI:** Nền xám `sc-tab` rút gọn `max-width:86%→68%`, `top:-1px`, `padding:5px 18px 7px` khít viền không lòi; `Nội dung Tên` đổi tên và đưa ra ngoài thành bar full-width ngay dưới 3 cột `①②③` (`sc-content-bar-outside`) dễ nhập; chữ dài chạy `marquee` vô hạn (`scTabMarquee`, `is-marquee`) thay `...`.
- **Avatar:** `primeStoredAvatars` tự phát hiện `x-expires` hết hạn hoặc `hp-logo` và gọi `fetchTikTokProfileWithBrowser` tuần tự (900ms) để làm mới, lưu `avatarCacheKey` + `avatarFetchedAt`, đồng bộ `syncBattleAvatarReferences` (`src/main.js:349`).
- **Bundle font + OBS bridge + live-runtime:** `Be Vietnam Pro` local, `currentProgramSceneName` fallback, `live-runtime.json` cho `MissionTrio/CardFlip`, `tt:gift` gom 40ms.

**Đã kiểm chứng:** `npm test` 21/21 + 7/7 giây cuối vẫn đạt; `CAM1 PK ĐÔI` ↔ `CAM2 PK NHÓM` → `score`/`scoretimer` đúng Scene; `TÔI LÀ AI GIỮA...` chạy mượt trong nền gọn.
