# HƯỚNG DẪN LIVE — NUÔI RỒNG ONLINE (bản V1.1)

Live tương tác TikTok: cả phòng cùng nuôi 1 con rồng chính (5 cấp tiến hóa),
ai follow / tặng quà thì nhận 1 rồng riêng gắn tên mình. Cấp rồng được
**lưu lại qua các phiên** — tắt live, mai mở lại rồng vẫn ở cấp cũ.

**Đường sự kiện chính:** extension Chrome **Nuôi Rồng Relay** (thư mục
`extension/` trong app) quét trang phòng live TikTok đang mở trong Chrome
rồi gửi comment / follow / quà / like về server ở **cổng 3001**.
**Không dùng dịch vụ ký bên thứ ba** trong bất kỳ đường nào.

---

## Phần 1 — Chạy server trên máy Mac

1. Mở **Terminal**.
2. Vào thư mục app:

   ```
   cd ~/workspace/nuoi-rong-live/app
   ```

   (Nếu anh chép thư mục app sang chỗ khác thì `cd` vào đúng chỗ đó.)
3. Cài thư viện (chỉ làm **lần đầu**):

   ```
   npm install
   ```

4. Chạy server:

   ```
   npm start
   ```

   Thấy dòng `🐉 NUÔI RỒNG ONLINE chạy tại http://localhost:3001` là được.
   **Giữ nguyên cửa sổ Terminal này** trong suốt buổi live (đóng là tắt server).

## Phần 2 — Mở sân khấu và trang quản trị

- **Sân khấu** (cái người xem thấy): http://localhost:3001
- **Quản trị**: http://localhost:3001/admin

Vừa mở server lên là xem được ngay ở **chế độ DEMO** — sự kiện giả
(tim, comment, follow, quà) tự chảy vào để rồng lớn dần, đúng như một
buổi live thật. Dùng DEMO để tập dượt và kiểm tra hiệu ứng. Khi live
thật thì chuyển sang chế độ **RELAY (extension)** ở trang quản trị.

Trên trang sân khấu có nút nhỏ **"🔇 Bấm để bật tiếng"** ở đáy — bấm 1 lần
để trình duyệt cho phép đọc TTS (đọc tên người follow, quà lớn, lúc tiến
hóa). Không bấm thì hình vẫn chạy bình thường, chỉ không có tiếng đọc.

## Phần 3 — Đưa sân khấu vào TikTok LIVE Studio

1. Mở **TikTok LIVE Studio** trên Mac, đăng nhập nick sẽ live.
2. Chọn bố cục **Màn hình dọc (9:16)**.
3. Thêm nguồn: **Link / Trình duyệt (Browser source)** → dán địa chỉ
   `http://localhost:3001` → kích thước **1080 × 1920** → OK.
   (Nếu bản LIVE Studio của anh chỉ có "Bắt cửa sổ": mở sẵn Chrome ở
   http://localhost:3001 rồi chọn nguồn Bắt cửa sổ Chrome đó.)
4. Kéo nguồn cho **kín khung dọc**. Toàn bộ chữ/bảng của sân khấu đã nằm
   trong **vùng an toàn** (tránh dải tên kênh/mắt xem ở trên, bình luận
   chạy góc trái dưới, cột nút quà bên phải và ô nhập bình luận ở đáy)
   nên người xem thấy đầy đủ.
5. Bấm **Phát LIVE** trong LIVE Studio như bình thường.

## Phần 4 — Cài extension Nuôi Rồng Relay (đường sự kiện THẬT)

Extension nằm sẵn trong thư mục `extension/` của app
(gồm `manifest.json` + `content.js`). Cài 1 lần:

1. Mở **Google Chrome** → gõ vào thanh địa chỉ: `chrome://extensions`
2. Bật **Developer mode** (công tắc ở góc trên bên phải).
3. Bấm **Load unpacked** → chọn thư mục **extension** trong app
   (`~/workspace/nuoi-rong-live/app/extension`) → Open.
4. Thấy thẻ **"Nuôi Rồng Relay — TikTok Live"** xuất hiện và đang bật
   (Enabled) là xong.

Mỗi buổi live:

5. Bắt đầu phát live bằng LIVE Studio (Phần 3).
6. Trong **Chrome** (đúng trình duyệt vừa cài extension), mở **trang
   phòng live TikTok của anh** (trang xem live của chính kênh) và
   **giữ tab đó mở** suốt buổi — extension quét comment/quà từ tab này.
7. Nhìn góc trên-trái tab: hiện huy hiệu **"🐉 Nuôi Rồng Relay"**;
   khi có sự kiện chảy về, huy hiệu đổi thành
   **"Đã nhận N sự kiện 🟢"** = ĐÃ NỐI. Đồng thời ở trang quản trị,
   dòng **"📡 RELAY (extension)"** sẽ hiện "đã nhận sự kiện" kèm giờ
   của sự kiện gần nhất.
8. Ở trang quản trị, bấm nút chế độ **RELAY (extension)** để tắt dòng
   sự kiện DEMO giả, chỉ nhận sự kiện thật từ extension.

Lưu ý về độ tin cậy của extension (nói thẳng):

- **Comment / follow / share**: bắt từ dòng chữ trong khung chat của
  tab live — đáng tin, có chống gửi trùng.
- **Quà**: extension cố đọc tên quà + số lượng/kim cương từ dòng quà;
  quà nào không đọc được giá thì tính mặc định **10 kim cương** như bản
  mẫu (có log trong Console của tab). Vì vậy điểm quà có thể lệch so
  với giá trị thật của một số quà lạ.
- **Like**: TikTok không đưa sự kiện tim vào khung chat, nên extension
  đọc **bộ đếm tim trên trang** mỗi 1,5 giây và gửi phần tăng thêm —
  đây là cơ chế *best-effort*: số hiển thị bị TikTok rút gọn
  (ví dụ "1,2 N") nên EXP tim chỉ gần đúng; nếu TikTok đổi giao diện
  không tìm thấy bộ đếm, extension chỉ log cảnh báo và bỏ qua tim,
  các sự kiện khác vẫn chạy.

## Phần 5 — Luật chơi (để giới thiệu với người xem)

| Hành động của người xem | Kết quả |
|---|---|
| Thả tim | +1 EXP / tim cho rồng chính |
| Comment thường | +5 EXP |
| Comment có chữ **“ăn”** | +10 EXP + hiệu ứng cho ăn |
| Chia sẻ live | +20 EXP |
| **Follow** | +50 EXP + nhận **1 rồng riêng** (hệ Lửa / Nước / Hoa ngẫu nhiên) gắn tên mình |
| **Tặng quà** | +10 EXP / xu + nhận rồng riêng; quà **≥ 99 xu** → rồng riêng hệ hiếm **Băng Đêm** + rồng chính **PHUN LỬA** ăn mừng |

- Ngưỡng lên cấp (EXP tính trong cấp): Cấp 1→2: **1.000** • 2→3: **3.000** •
  3→4: **8.000** • 4→5: **20.000**. Lên cấp 2 là khoảnh khắc **NỞ** từ trứng.
- **Giờ vàng**: mỗi 30 phút tự bật 60 giây **nhân đôi EXP** (admin cũng
  bấm bật tay được ở trang quản trị).
- **Bảng Vàng**: điểm = EXP mỗi người đóng góp trong ngày, top 3 hiện
  trên sân khấu, top 10 ở trang quản trị. Sang ngày mới tự làm mới.
- Hàng rồng riêng trên sân khấu hiện tối đa 10 con mới nhất (thừa thì
  gom thành vòng “+N”).

## Phần 6 — Các nút ở trang quản trị

- **Chế độ**: **DEMO** (sự kiện giả tự chạy) / **RELAY (extension)**
  (chỉ sự kiện thật từ extension) / **THỦ CÔNG** (chỉ nút mô phỏng +
  /test-event).
- **📡 RELAY (extension)**: hiện "đang chờ sự kiện" hay "đã nhận sự
  kiện" + giờ + tổng số sự kiện theo loại — dùng để biết extension
  còn sống không.
- **Mô phỏng sự kiện**: Thả tim ×100, Comment “ăn”, Follow mới, Quà nhỏ
  10 xu, Quà lớn 299 xu (kèm phun lửa), Giờ vàng, Phun lửa ngay —
  dùng để test hiệu ứng hoặc "cứu nguy" lúc phòng vắng.
- **⏸ Tạm dừng / ▶ Tiếp tục**: đóng băng nhận EXP (sự kiện đến sẽ bị bỏ qua).
- **🔊 TTS sân khấu BẬT/TẮT**: tắt/mở giọng đọc trên trang sân khấu.
- **🧹 Reset phiên**: xoá điểm Bảng Vàng hôm nay + toàn bộ rồng riêng.
  **Cấp rồng chính giữ nguyên.**
- **🥚 Reset cấp rồng**: đưa rồng về cấp 1 và xoá tổng EXP đã lưu —
  có hộp hỏi xác nhận, chỉ bấm khi thật sự muốn nuôi lại từ đầu.

## Phần 7 — Mục thử nghiệm tiktok-live-connector (TẮT mặc định)

Trong trang quản trị còn mục **"Thử nghiệm — tiktok-live-connector
(cần SIGN_SERVER_URL)"**. Đây là đường phụ để thử nghiệm, **không phải
đường chạy live chính** và **mặc định tắt**:

- Server chỉ nạp module này khi khởi động có biến môi trường
  `SIGN_SERVER_URL` trỏ tới **sign server tự host** của anh, ví dụ:

  ```
  SIGN_SERVER_URL=http://localhost:8080 npm start
  ```

- Không có `SIGN_SERVER_URL` thì bấm Kết nối ở mục này chỉ nhận được
  thông báo đang tắt — server không gọi ra bất kỳ dịch vụ ký bên
  ngoài nào. Đường live thật luôn là extension relay ở Phần 4.

## Phần 8 — Dữ liệu được lưu ở đâu

Trong thư mục `app/data/`:

- `state.json` — cấp + EXP của rồng chính. **Đây là "sinh mạng" của
  rồng**: đừng xoá file này trừ khi muốn nuôi lại từ trứng. Sao lưu
  file này là sao lưu được con rồng.
- `scores-YYYY-MM-DD.json` — Bảng Vàng từng ngày.

## Phần 9 — Sự cố hay gặp

- **Mở localhost:3001 không được**: kiểm tra Terminal còn chạy
  `npm start` không; cổng 3001 có bị app khác chiếm không.
- **Sân khấu đứng hình**: F5 tải lại trang sân khấu; chấm tròn góc
  trên-phải sân khấu phải xanh lá (đã nối WebSocket vào server).
- **Không có tiếng đọc**: bấm nút "Bấm để bật tiếng" trên sân khấu 1 lần,
  kiểm tra công tắc TTS ở admin đang BẬT, và loa của Chrome không bị tắt
  (tab không bị mute).
- **Extension không gửi sự kiện**: kiểm tra lần lượt — (1) server đang
  chạy ở cổng 3001; (2) tab phòng live mở trong **đúng Chrome** đã cài
  extension và còn mở; (3) huy hiệu "Nuôi Rồng Relay" có hiện trên tab
  không (không hiện = extension chưa nạp vào tab, hãy F5 tab);
  (4) trang quản trị đang ở chế độ **RELAY** và dòng 📡 có cập nhật giờ
  sự kiện gần nhất không; (5) mở Console của tab live (F12) xem log
  `[Nuôi Rồng Relay]` để biết nó đang gửi hay lỗi ở đâu.

---

## Kiểm thử nhanh bằng lệnh (không cần TikTok)

Khi server đang chạy, mở Terminal khác — gửi đúng định dạng extension:

```
curl -X POST http://localhost:3001/api/relay/chat   -H 'Content-Type: application/json' -d '{"player":{"uniqueId":"user_kiemthu","nickname":"KiemThu","avatarUrl":""},"comment":"ăn"}'
curl -X POST http://localhost:3001/api/relay/follow -H 'Content-Type: application/json' -d '{"player":{"uniqueId":"user_kiemthu","nickname":"KiemThu","avatarUrl":""}}'
curl -X POST http://localhost:3001/api/relay/gift   -H 'Content-Type: application/json' -d '{"player":{"uniqueId":"user_kiemthu","nickname":"KiemThu","avatarUrl":""},"giftName":"Sư tử","diamonds":299}'
curl -X POST http://localhost:3001/test-event -H 'Content-Type: application/json' -d '{"type":"gift","user":"KiemThu","coins":299,"giftName":"Sư tử"}'
curl http://localhost:3001/api/status
```

Sự kiện sẽ hiện ngay trên sân khấu (comment "ăn" → cho ăn; follow → có
rồng riêng; quà 299 → rồng Băng Đêm + phun lửa). `/test-event` và
`/admin` chỉ mở được từ chính máy host (localhost) để tránh bị nghịch
khi đi qua tunnel; riêng `/api/relay/*` mở cho extension gọi từ trang
tiktok.com (có CORS) nhưng vẫn chỉ tới được khi truy cập localhost.
