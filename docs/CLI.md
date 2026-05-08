# rpow CLI — Hướng dẫn chạy từ terminal

> Bạn có thể đăng nhập, đào, gửi, xem balance & ledger hoàn toàn từ terminal — không cần trình duyệt. CLI dùng chung API và session với web (`rpow2.com`).

## 1. Yêu cầu

| | |
|---|---|
| Node.js | ≥ 22 (`nvm install 22.20.0` nếu chưa có) |
| Hệ điều hành | macOS / Linux / WSL (Windows native chưa test, nên hoạt động) |
| Server | Mặc định trỏ tới `https://api.rpow2.com`. Có thể đổi qua biến `RPOW_API` |

## 2. Cài đặt

### Cách A — chạy trong monorepo (dev / lập trình viên)

```bash
git clone https://github.com/<bạn>/rpow.git
cd rpow
npm install
npm run build --workspace @rpow/shared
npm run build --workspace @rpow/cli
npm install                              # chạy lại để npm tạo symlink ./node_modules/.bin/rpow

# Test cài đặt thành công
./node_modules/.bin/rpow help
```

> Tại sao phải `npm install` 2 lần: lần đầu workspace chưa có `dist/index.js` nên npm bỏ qua bước symlink bin. Sau khi build xong, lần install thứ hai mới tạo `node_modules/.bin/rpow`.

Nếu thấy gõ đường dẫn dài bất tiện, thêm shortcut vào shell:

```bash
# ~/.zshrc hoặc ~/.bashrc
alias rpow="$HOME/đường-dẫn-tới-rpow/node_modules/.bin/rpow"
```

### Cách B — cài global (sau khi đã publish lên npm)

```bash
npm i -g @rpow/cli
rpow help
```

Hiện tại package chưa publish public, dùng cách A trước.

## 3. Cấu hình

CLI tuân theo XDG Base Directory:

| File | Mặc định | Mục đích |
|---|---|---|
| Config | `~/.config/rpow/config.json` | `{ "apiBaseUrl": "..." }` |
| Session | `~/.config/rpow/session` | Chuỗi cookie token (mode 0600) |

Override `apiBaseUrl` bằng 1 trong 3 cách (ưu tiên giảm dần):

1. Biến môi trường `RPOW_API` cho lần chạy đó:
   ```bash
   RPOW_API=http://localhost:8080 rpow ledger
   ```
2. Sửa file `~/.config/rpow/config.json`:
   ```json
   { "apiBaseUrl": "http://localhost:8080" }
   ```
3. Để mặc định `https://api.rpow2.com` (production).

Đổi vị trí thư mục config bằng `XDG_CONFIG_HOME` (hữu dụng cho đa-account, xem mục 7).

## 4. Workflow nhanh — 60 giây đầu tiên

```bash
# 1. Test xem có với tới server không (lệnh public, không cần login)
rpow ledger

# 2. Yêu cầu magic link
rpow login bạn@example.com
# → Server gửi email. Mở email, COPY toàn bộ URL "/auth/verify?token=..."
# → Dán URL vào dấu nhắc của CLI, Enter

# 3. Kiểm tra đăng nhập
rpow me

# 4. Đào 1 token thử (mặc định dùng cpus-2 worker, ví dụ M1 Pro 10c → 8 process)
rpow mine

# 5. Đào liên tục (Ctrl-C để dừng)
rpow mine --forever

# 5b. Đo hashrate trước khi mine (không tốn challenge, không gọi API)
rpow bench --seconds 10

# 6. Gửi 1 RPOW cho ai đó
rpow send alice@x.com 1

# 7. Xem 100 dòng activity gần nhất
rpow activity
```

## 5. Tham chiếu từng lệnh

### `rpow help`

In banner + danh sách lệnh + đường dẫn config dir đang dùng.

### `rpow login <email>`

1. POST `/auth/request` để server gửi magic link tới email.
2. Hiển thị dấu nhắc `> paste verify URL or token:`
3. Bạn copy URL từ email (hoặc chỉ phần token sau `?token=`) và dán vào.
4. CLI gọi `/auth/verify`, đọc cookie `rpow_session`, lưu vào `~/.config/rpow/session` mode 0600.

**Tip cho dev local**: khi server chạy với `RPOW_TEST_INBOX=true`, magic link sẽ in luôn ra console của server thay vì gửi email. Hoặc lấy nhanh bằng:

```bash
curl -s "http://localhost:8080/test/last-link/$(printf 'bạn@example.com' | jq -sRr @uri)?json=1"
# {"link":"http://localhost:8080/auth/verify?token=..."}
```

Lỗi thường gặp:
- `RATE_LIMITED (retry in ~30s)` — gọi `login` 2 lần quá gần nhau cho cùng email. Đợi 30s.
- `BAD_REQUEST: invalid or expired link` — token đã được dùng (1 lần duy nhất) hoặc quá 15 phút.

### `rpow me`

```text
+-- WALLET ----------------------------------------------------+
  EMAIL    : bạn@example.com
  BALANCE  : 0042 RPOW
  MINTED   : 0042
  SENT     : 0010
  RECEIVED : 0010
+-------------------------------------------------------------+
```

Yêu cầu session hợp lệ. Nếu hết hạn (mặc định 30 ngày), CLI sẽ báo `session expired. run: rpow login <email>`.

### `rpow mine [flags]`

| Flag | Ý nghĩa |
|---|---|
| `--count N` / `-n N` | Đào đúng N token rồi dừng. Mặc định: 1. |
| `--forever` / `-f` | Đào không giới hạn cho đến khi Ctrl-C hoặc `SUPPLY_EXHAUSTED`. |
| `--workers N` / `-w N` | Số process đào song song. Mặc định: `cpus().length - 2` (ví dụ M1 Pro 10c → 8). Đặt `1` để chạy single-thread. |

Output mẫu (dạng live, dùng `\r` để cập nhật tại chỗ):

```text
[ workers=8 (multi-core) ]
[ challenge 8f3a2cb1... target 25 bits ]
  mining  hashes=12,847,360  rate=10.20 MH/s  elapsed=00:00:01
+ MINTED  token=8f3a2c01-...   (#1)
[ challenge 1de4fa90... target 25 bits ]
  mining  hashes=8,323,072    rate=10.15 MH/s  elapsed=00:00:01
+ MINTED  token=1de4fa11-...   (#2)
```

**Cách hoạt động của multi-core**: CLI fork N process Node con, mỗi process đào shard riêng của nonce-space (chia theo high-32-bit, không bao giờ trùng input). Process đầu tiên tìm được solution → main thread terminate phần còn lại và submit lên server. Dùng `child_process.fork` thay vì `worker_threads` vì macOS deprioritize compute trong worker thread.

**Khi nào nên giảm `--workers`**:
- Đang chạy app khác cần CPU (build, video call, render)
- Laptop pin sắp hết — mỗi worker tốn 4–5W
- Nóng máy / quạt ồn — laptop 14" thermal throttle sau ~5 phút full-load

**Khi nào nên tăng**: nếu máy có > 10 core và `rpow bench --workers 12` cho thấy rate vẫn tăng đáng kể.

### `rpow bench [flags]`

Đo hashrate offline, không gọi API, không tốn challenge. Hữu ích để:
- So sánh nhiều cấu hình `--workers` trên máy bạn để tìm sweet spot
- Smoke-test sau khi đổi code/Node version
- Benchmark giữa các máy

| Flag | Ý nghĩa |
|---|---|
| `--workers N` / `-w N` | Số process song song. Mặc định: `cpus().length - 2`. |
| `--seconds S` / `-s S` | Thời lượng bench tính bằng giây. Mặc định: `10`. |
| `--bits B` / `-b B` | Difficulty mục tiêu. Mặc định: `64` (không bao giờ trúng → đo rate thuần). |

```bash
$ rpow bench --workers 8 --seconds 8
+ rpow bench
  cpu      : Apple M1 Pro  (10 logical cores)
  workers  : 8  (multi-core)
  seconds  : 8
  bits     : 64 (unhittable in window — pure rate test)

+ result
  hashes   : 81,461,248
  elapsed  : 00:00:08
  rate     : 10.18 MH/s
```

Map scaling curve cho máy bạn:

```bash
for n in 1 2 4 6 8 10; do rpow bench --workers $n --seconds 6 | grep rate; done
```

**Ctrl-C 2 giai đoạn**:
- Lần 1: `^C  finishing current attempt cleanly...` — đào nốt batch hiện tại rồi dừng sạch (challenge chưa nộp sẽ tự hết hạn sau 5 phút).
- Lần 2: kill ngay (exit 130).

Các trạng thái server có thể trả về:
- `SUPPLY_EXHAUSTED` (HTTP 410) — đã đạt cap 21M, CLI in `+ SUPPLY EXHAUSTED — 21M cap reached` và dừng.
- `CHALLENGE_EXPIRED` (HTTP 410) — challenge quá 5 phút, CLI tự xin challenge mới và đào tiếp.
- 401 — session hết hạn, CLI báo lỗi.

### `rpow send <recipient_email> <amount>`

- `amount` phải là số nguyên dương ≤ balance.
- CLI tự sinh `idempotency_key = crypto.randomUUID()` cho mỗi lần gọi (gọi lại cùng lệnh **sẽ** tạo transfer mới — idempotency chỉ áp dụng khi bạn gửi cùng key).
- Nếu recipient đã có account: token được invalidate ở sender + mint lại cho recipient ngay lập tức.
- Nếu recipient chưa có: tạo `pending_transfer`, server gửi email "claim link" (TTL 30 ngày). CLI in:
  ```text
  + pending claim 5 RPOW -> alice@x.com
    alice@x.com has no rpow2 account yet — invited via email
    tokens reserved for 30 days; transfer_id=...
  ```

Lỗi:
- `INSUFFICIENT_BALANCE` — không đủ token.
- `BAD_REQUEST` — recipient trùng sender, email sai format, v.v.

### `rpow activity`

Bảng 100 dòng gần nhất:

```text
+-- ACTIVITY (latest 100) -------------------------------------+
  2026-05-08 04:12:08  MINT       +1
  2026-05-08 04:11:55  SEND       -3   alice@x.com
  2026-05-07 22:01:33  RECEIVE    +2   bob@y.com
+-------------------------------------------------------------+
```

### `rpow ledger`

Lệnh public, **không cần login**. In tổng cung, độ khó hiện tại, milestone tiếp theo, trạng thái cap:

```text
+-- PUBLIC LEDGER ---------------------------------------------+
  TOTAL MINTED        : 18,402
  TOTAL TRANSFERRED   : 1,205
  CIRCULATING SUPPLY  : 18,310
  CURRENT DIFFICULTY  : 25 trailing zero bits
  USER COUNT          : 142

  MAX SUPPLY          : 21,000,000
  EPOCH               : 0
  NEXT MILESTONE      : 1,000,000  (981,598 to go)
  NEXT DIFFICULTY     : 26 bits
+-------------------------------------------------------------+
```

### `rpow logout`

Gọi `POST /auth/logout` (best-effort) và xoá file `~/.config/rpow/session`.

## 6. Use case nâng cao

### 6.1 Đào 24/7 trên VPS với `tmux`

```bash
ssh you@vps
tmux new -s rpow
rpow mine --forever
# Ctrl-b d để detach (mining vẫn chạy)
# tmux attach -t rpow để xem lại
```

Hoặc dùng `nohup`:

```bash
nohup rpow mine --forever > ~/rpow.log 2>&1 &
tail -f ~/rpow.log
```

### 6.2 Systemd service (đào trên server Linux)

Tạo `/etc/systemd/system/rpow-miner.service`:

```ini
[Unit]
Description=rpow CLI miner
After=network.target

[Service]
Type=simple
User=you
Environment=HOME=/home/you
Environment=XDG_CONFIG_HOME=/home/you/.config
ExecStart=/usr/local/bin/rpow mine --forever --workers 6
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rpow-miner
journalctl -u rpow-miner -f
```

### 6.3 Đa tài khoản trên cùng máy

Mỗi account có thư mục config riêng:

```bash
# Account A
XDG_CONFIG_HOME=$HOME/.config-acc-a rpow login alice@x.com
XDG_CONFIG_HOME=$HOME/.config-acc-a rpow mine --forever --workers 4 &

# Account B
XDG_CONFIG_HOME=$HOME/.config-acc-b rpow login bob@x.com
XDG_CONFIG_HOME=$HOME/.config-acc-b rpow mine --forever --workers 4 &
```

Hoặc đặt alias cho gọn:

```bash
alias rpow-a='XDG_CONFIG_HOME=$HOME/.config-acc-a rpow'
alias rpow-b='XDG_CONFIG_HOME=$HOME/.config-acc-b rpow'

rpow-a me
rpow-b send alice@x.com 5
```

> **Lưu ý CPU**: mỗi `rpow mine` mặc định fork `cpus-2` worker. Nếu chạy 2 account cùng lúc, hai instance sẽ tranh CPU nhau và tổng hashrate KHÔNG tăng tuyến tính. Tốt hơn là chia: ví dụ 10 core → mỗi account `--workers 4`, chừa 2 core cho hệ thống.

### 6.4 Trỏ tới server local khi dev

**Cách nhanh nhất** — dùng helper script tự lo Postgres + sinh key + set env:

```bash
# Terminal A
npm run dev
```

Script `scripts/dev-server.sh` sẽ:
- Tự phát hiện Postgres (Homebrew local DB `rpow`, hoặc Docker on `:55432`); nếu không có sẽ in hướng dẫn cài.
- Build `@rpow/shared` lần đầu nếu chưa build.
- Sinh ephemeral `SESSION_SECRET` + Ed25519 keypair mỗi lần chạy (in-memory, không lưu).
- Bật `RPOW_TEST_INBOX=true` → magic link in ra console thay vì gửi email thật.
- `DIFFICULTY_BITS=8` để đào nhanh khi test.
- Khởi động Fastify ở `:8080` qua tsx watch (hot reload khi sửa source).

Trong terminal 2, dùng CLI:

```bash
export RPOW_API=http://localhost:8080
rpow ledger                # confirm kết nối
rpow login dev@local.test
# Magic link sẽ IN RA console của terminal 1; copy URL đó dán vào CLI
rpow mine --count 5        # difficulty 8-bit nên rất nhanh
rpow me
```

### 6.5 Pipeline với jq / awk

CLI hiện in dạng người-đọc, chưa có flag `--json`. Khi cần xử lý máy, gọi thẳng API:

```bash
SESSION=$(cat ~/.config/rpow/session)
curl -s -H "Cookie: rpow_session=$SESSION" $RPOW_API/me | jq .balance
```

Sau này có thể bổ sung flag `--json` cho mọi lệnh nếu bạn cần.

## 7. Troubleshooting

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| `rpow: command not found` | Chưa symlink hoặc shell không biết `node_modules/.bin/` | Chạy `npm install` lần 2 sau khi build, hoặc `alias rpow="$(pwd)/node_modules/.bin/rpow"` |
| `error: fetch failed` | Server không reachable | Kiểm tra `RPOW_API` đúng chưa, server có chạy không |
| `error: NO_COOKIE: server did not set rpow_session cookie` | Token đã được dùng/hết hạn lúc CLI gọi `/auth/verify` | Chạy lại `rpow login` để xin link mới |
| `error: not signed in. run: rpow login <email>` | File `~/.config/rpow/session` trống/rỗng | Đăng nhập lại |
| `error: session expired. run: rpow login <email>` | HMAC session đã quá 30 ngày | Đăng nhập lại |
| `error: RATE_LIMITED` khi `login` | Cooldown 30s/email hoặc 30 lần/giờ/email | Đợi `retry_after` giây |
| Mining đứng im không tiến | Đang chạy nhưng terminal không phải TTY (tee, redirect) | Mining vẫn chạy, chỉ là không in `\r` progress |

Bật log thô của server (khi dev) để debug request:

```bash
# server tự log mọi request qua pino, xem ở terminal chạy server
```

Reset hoàn toàn về trạng thái sạch:

```bash
rpow logout
rm -rf ~/.config/rpow
```

## 8. Bảo mật & lưu ý

- File `~/.config/rpow/session` được set mode `0600` — chỉ user của bạn đọc được. Nó chứa HMAC token tương đương cookie trình duyệt; ai cầm được file là **đăng nhập được vào account của bạn**. Không commit vào git, không upload.
- Magic link chỉ dùng được 1 lần và có hạn 15 phút. Nếu bạn vô tình paste vào nơi khác, link đó coi như đã "cháy".
- Mining trên CPU rất "ngốn" — laptop sẽ nóng, quạt chạy mạnh. Khi cắm sạc thì OK; chạy bằng pin chỉ nên dùng `--count N` chứ đừng `--forever`.
- Mặc định `cpus-2` worker là tối ưu cho desktop / khi bạn không dùng máy. Khi đang code/họp, hạ xuống `--workers 2` hoặc `--workers 4` để giữ máy mượt.

## 9. Phiên đầy đủ minh hoạ (production)

```bash
$ rpow ledger
+-- PUBLIC LEDGER ---------------------------------------------+
  TOTAL MINTED        : 142
  TOTAL TRANSFERRED   : 8
  CIRCULATING SUPPLY  : 134
  CURRENT DIFFICULTY  : 25 trailing zero bits
  USER COUNT          : 6
  ...
+-------------------------------------------------------------+

$ rpow login bạn@example.com
+ magic link sent to bạn@example.com
  open the link in the email, then paste the FULL URL below
  (it looks like https://api.rpow2.com/auth/verify?token=...)

> paste verify URL or token: https://api.rpow2.com/auth/verify?token=Ab3...xyz

+ logged in as bạn@example.com
  session saved (~/.config/rpow/session, mode 0600)
  try: rpow me

$ rpow me
+-- WALLET ----------------------------------------------------+
  EMAIL    : bạn@example.com
  BALANCE  : 0000 RPOW
  MINTED   : 0000
  SENT     : 0000
  RECEIVED : 0000
+-------------------------------------------------------------+

$ rpow mine --count 3
[ workers=8 (multi-core) ]
[ challenge 8f3a2cb1... target 25 bits ]
  mining  hashes=12,800,000  rate=10.18 MH/s  elapsed=00:00:01
+ MINTED  token=8f3a2c01-...   (#1/3)
[ challenge 1de4fa90... target 25 bits ]
  mining  hashes=4,915,200   rate=10.21 MH/s  elapsed=00:00:00
+ MINTED  token=1de4fa11-...   (#2/3)
[ challenge a7be0142... target 25 bits ]
  mining  hashes=22,937,600  rate=10.15 MH/s  elapsed=00:00:02
+ MINTED  token=a7be01ff-...   (#3/3)
done. minted 3 token(s).

$ rpow send alice@x.com 1
+ SENT 1 RPOW -> alice@x.com
  transfer_id=3f7a2cd0-1234-...

$ rpow activity
+-- ACTIVITY (latest 100) -------------------------------------+
  2026-05-08 05:12:08  SEND       -1   alice@x.com
  2026-05-08 05:11:30  MINT       +1
  2026-05-08 05:11:08  MINT       +1
  2026-05-08 05:10:50  MINT       +1
+-------------------------------------------------------------+

$ rpow logout
+ logged out (local session removed)
```

Hết. Khi cần xem lại nhanh, gõ `rpow help`.
