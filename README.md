# HP Talent Show

Phần mềm desktop tổ chức **Talent Show TikTok**: kết nối LIVE qua `@username`, chấm điểm bằng quà real-time, hỗ trợ **PK Đôi**, **Bảng Xếp Hạng**, **Tính Điểm**, và phát **overlay OBS** qua link localhost.

> Hậu duệ ý tưởng của HP Action - BIGO LIVE / BIGO Action — nhưng dành riêng cho TikTok Talent Show.

## Tính năng

- **🔗 Kết nối TikTok LIVE** — chỉ cần nhập `@username` host đang LIVE (không cần OAuth, dùng `tiktok-live-connector`).
- **👤 Hồ sơ Creator** — Avatar tự lấy từ TikTok, TikTok ID, Nickname, gán vào Nhóm, **icon quà mặc định** (để chấm điểm BXH theo creator).
- **👥 Nhóm thi đấu** — tạo nhóm có màu riêng, gán creator vào nhóm.
- **⚔️ PK Đôi** — 2 đội đối đầu trong khoảng thời gian, quà nào → cộng điểm cho đội đó:
  - Chế độ **Cố định**: quà chỉ định trước cho mỗi đội.
  - Chế độ **Chọn phe**: ai tặng quà trước thì được "gắn phe" — quà tiếp theo của họ chấm cho phe đã gắn.
  - Tính điểm theo 💎 diamond hoặc số lượng quà.
  - Timer chuẩn bị + chạy + delay; trạng thái idle/prestart/running/finished.
- **👑 Bảng Xếp Hạng** — xếp theo **Creator** (dùng default-gift-icon) hoặc theo **Nhóm**.
- **🎯 Tính Điểm** — đếm tổng diamond/quà cộng dồn, có thanh progress đến mục tiêu.
- **🪟 Overlay OBS** — 3 link Browser Source riêng cho PK / BXH / Score, dùng SSE để update real-time.

## Stack

- Electron 33 (vanilla JS, không build tool)
- `tiktok-live-connector` 2.1.x — kết nối Webcast service của TikTok (reverse-engineering)
- HTTP/SSE server nội bộ trên `127.0.0.1` cho overlay

## Cài & chạy dev

```powershell
cd "F:\PHAT TRIEN GAME\HP Talent Show"
npm install
npm start
```

Tùy chọn dev mode (mở DevTools):

```powershell
npm run dev
```

## Build installer

```powershell
npm run dist
```

Output: `release\HP-Talent-Show-Setup-<ver>.exe`

## Hướng dẫn dùng nhanh

1. Mở app → tab **Cài đặt**, nhập **Eulerstream Sign API Key** nếu hay disconnect (đăng ký tại https://eulerstream.com).
2. Tab **Hồ sơ Creator** → nhập TikTok ID → bấm **🔄 Lấy avatar** → đặt **quà mặc định** (tên/ID/icon URL).
3. Tab **Nhóm** → tạo các nhóm (vd: ĐỘI HỒNG, ĐỘI XANH), gán màu, đặt quà mặc định nhóm.
4. Quay lại tab **Hồ sơ Creator** → gán creator vào nhóm.
5. Tab **Kết nối LIVE** → nhập `@username` host đang LIVE → **Kết nối**.
6. Quà real-time sẽ chấm điểm cho:
   - **BXH Creator**: nếu match với `defaultGiftName`/`defaultGiftId` của creator.
   - **BXH Nhóm**: nếu mode = group, gộp theo nhóm.
   - **PK Đôi**: nếu match danh sách quà của team A hoặc team B.
   - **Score**: cộng tất cả (nếu enabled).
7. Tab **Overlay OBS** → copy link → thêm Browser Source trong OBS:
   - **PK Đôi**: 1080 × 400
   - **BXH**: 420 × 640
   - **Score**: 360 × 200

## Cấu trúc thư mục

```
HP Talent Show/
├─ src/
│  ├─ main.js                 # Electron main + IPC + engines (PkDuo, Ranking, Score)
│  ├─ preload.js              # ContextBridge api
│  ├─ tiktok-client.js        # TikTok LIVE wrapper (qua tiktok-live-connector)
│  └─ obs-overlay-server.js   # Localhost SSE + static for overlays
├─ renderer/
│  ├─ index.html, app.js, style.css
│  ├─ pk-duo-overlay.{html,js,css}
│  ├─ ranking-overlay.{html,js,css}
│  ├─ score-overlay.{html,js,css}
│  └─ overlay-common.css
├─ logo/
│  ├─ hp-logo.ico
│  └─ hp-logo.png
├─ config/                    # Dev mode: ở đây; Production: ở %APPDATA%/HP Talent Show/config
│  ├─ settings.json
│  ├─ creators.json
│  └─ groups.json
└─ package.json
```

## Hạn chế đã biết

- `tiktok-live-connector` là thư viện reverse-engineering — TikTok có thể thay đổi internal WebSocket bất cứ lúc nào. Khi disconnect, cập nhật lib hoặc dùng Eulerstream sign key.
- TikTok LIVE chỉ có 1 host — BXH theo creator chỉ có ý nghĩa khi mỗi creator có **quà đại diện** khác nhau (host xướng "Hãy tặng <quà X> cho creator A", "<quà Y> cho creator B"...).
- Avatar được proxy qua localhost (`/avatar?url=...`) để tránh CORS trong OBS Browser Source — chỉ chấp nhận host TikTok CDN.

## Bản quyền

© HP Media. Sử dụng cho mục đích nội bộ Talent Show.
