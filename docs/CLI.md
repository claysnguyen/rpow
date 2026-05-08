# rpow CLI — Hướng dẫn cài đặt và đào

> CLI để đào RPOW token từ terminal. **Target chính: macOS** (Apple Silicon được tối ưu mạnh nhất). Linux hỗ trợ. Windows native không hỗ trợ — dùng WSL2 nếu trên Windows.

---

## Mục lục

1. [Quickstart (5 dòng cho dev)](#1-quickstart-5-dòng-cho-dev)
2. [Yêu cầu hệ thống](#2-yêu-cầu-hệ-thống)
3. [Cài đặt](#3-cài-đặt)
4. [Login và đào lần đầu](#4-login-và-đào-lần-đầu)
5. [Tham chiếu lệnh](#5-tham-chiếu-lệnh)
6. [Hashrate và difficulty](#6-hashrate-và-difficulty)
7. [Đào 24/7 và đa tài khoản](#7-đào-247-và-đa-tài-khoản)
8. [Troubleshooting](#8-troubleshooting)
9. [An toàn và lưu ý](#9-an-toàn-và-lưu-ý)

---

## 1. Quickstart (5 dòng cho dev)

Giả sử source code đã có sẵn ở `~/rpow`:

```bash
cd ~/rpow
npm install && npm run build --workspace @rpow/shared && npm run build --workspace @rpow/cli && npm install
npm run build:native -w @rpow/cli   # tùy chọn nhưng nên: ~25x speedup nếu có Rust
alias rpow="$(pwd)/node_modules/.bin/rpow"
rpow login bạn@example.com          # paste verify URL từ email vào prompt
rpow mine --forever                 # đào với cpus-2 worker mặc định
```

Chưa quen Node.js / chưa có source → đọc tiếp [phần 3](#3-cài-đặt).

---

## 2. Yêu cầu hệ thống

| Hạng mục | Yêu cầu | Ghi chú |
|---|---|---|
| **CPU** | Càng nhiều core càng tốt | M1 Pro 10c → ~10 MH/s; Intel i5 4c → ~2 MH/s |
| **RAM** | ≥ 2 GB free | Mỗi worker ~30 MB |
| **Đĩa cứng** | ~500 MB | Source + node_modules |
| **HĐH** | macOS (target chính), Linux | Windows: dùng WSL2; native không build trên Windows |
| **Node.js** | ≥ 22.x | Khuyến nghị `nvm install 22.20.0` |
| **Email** | hộp thư thật bạn check được | Server gửi magic link xác thực |
| **Internet** | Kết nối ra `api.rpow2.com` | ~5 KB/lần mint |

> Mining tốn điện. Laptop M1 chạy `mine --workers 8` ăn ~30W → mỗi giờ ~0.03 kWh ≈ 100 VND. PC/VPS x86 có thể ăn 80–150W tùy chip.

---

## 3. Cài đặt

### Bước 1: Cài Node.js 22

**macOS (qua Homebrew + nvm — khuyến nghị):**

```bash
# Cài Homebrew nếu chưa có
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Cài nvm
brew install nvm
mkdir -p ~/.nvm
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"' >> ~/.zshrc
source ~/.zshrc

# Cài Node 22
nvm install 22
nvm use 22
node --version  # nên in v22.x.x
```

**Linux (Ubuntu/Debian):**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs
node --version
```

**Cách khác:** [nodejs.org/download](https://nodejs.org/en/download) — chọn LTS 22.x.

### Bước 2: Lấy source code

Bạn sẽ nhận source qua một trong các kênh sau (do người chia sẻ cung cấp riêng):

- **File ZIP / tarball** → giải nén vào `~/rpow`:
  ```bash
  cd ~
  unzip rpow.zip          # hoặc: tar -xzf rpow.tar.gz
  cd rpow
  ```
- **Private git repo** → clone:
  ```bash
  cd ~
  git clone <REPO_URL> rpow
  cd rpow
  ```
- **Folder share trực tiếp** (Drive, AirDrop, USB) → copy vào `~/rpow`.

> Không có thì hỏi người đã chia sẻ doc này cho bạn.

### Bước 3: Build

```bash
cd ~/rpow
npm install                                   # cài deps cho monorepo
npm run build --workspace @rpow/shared        # build shared lib
npm run build --workspace @rpow/cli           # build CLI thành dist/index.js
npm install                                   # CHẠY LẠI để npm tạo symlink
```

**Tại sao chạy `npm install` 2 lần?** Lần 1 chưa có `apps/cli/dist/index.js` (file binary chưa build), nên npm bỏ qua bước tạo symlink `node_modules/.bin/rpow`. Sau khi build xong, lần 2 mới symlink được.

### Bước 3.5 (tùy chọn): Build native miner cho ~25x speedup

CLI có sẵn engine native bằng Rust dùng được hardware crypto của CPU (Apple SHA crypto extension trên Apple Silicon, SHA-NI trên Intel/AMD). Build xong, hashrate tăng ~25x trên M-series Mac, 5–10x trên x86_64.

**Yêu cầu**: Rust toolchain. Cài 1 dòng:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

**Build native module**:

```bash
npm run build:native --workspace @rpow/cli
```

Script tự build với `-C target-cpu=native` rồi đặt file `.node` đúng chỗ. Nếu thiếu Rust thì script chỉ in cảnh báo và bỏ qua → CLI vẫn chạy bình thường ở chế độ JS fallback.

**Verify**:

```bash
./node_modules/.bin/rpow bench --workers 1 --seconds 5
# Tìm dòng: backend  : native (Rust + HW SHA)
```

Nếu thấy `js (Node createHash)` → native không load được, đọc [Troubleshooting](#8-troubleshooting). Nếu thấy `native` → ăn full speed.

### Bước 4: Test cài đặt

```bash
./node_modules/.bin/rpow help
```

Nếu thấy banner và danh sách lệnh → cài đặt OK.

### Bước 5 (khuyến nghị): Tạo alias gọn

Gõ `./node_modules/.bin/rpow` mỗi lần phiền. Thêm vào `~/.zshrc` hoặc `~/.bashrc`:

```bash
alias rpow="$HOME/rpow/node_modules/.bin/rpow"
```

Mở terminal mới hoặc `source ~/.zshrc`. Từ đây mọi lệnh dùng `rpow ...` thay vì đường dẫn dài.

### Bước 6 (tùy chọn): Đo hashrate trước khi đào

```bash
rpow bench --seconds 10
```

Output kiểu:

```text
+ rpow bench
  cpu      : Apple M1 Pro  (10 logical cores)
  backend  : native (Rust + HW SHA)
  workers  : 8  (multi-core)
  ...
+ result
  rate     : 235.12 MH/s
```

Tham khảo Apple Silicon (đã build native):

| Máy | Hashrate native | Hashrate JS (fallback) | Thời gian/mint @ 25-bit |
|---|---|---|---|
| MacBook Air M1 (8c) | ~150 MH/s | ~6 MH/s | < 1s |
| MacBook Pro M1 Pro (10c) | ~250 MH/s | ~10 MH/s | < 1s |
| Mac mini M4 base (10c) | ~280 MH/s | ~13 MH/s | < 1s |
| MacBook Pro M3 Max (16c) | ~500 MH/s | ~20 MH/s | < 1s |

> Apple Silicon scale gần tuyến tính vì mọi P/E core đều có ARM SHA crypto extension. Linux x86_64 với SHA-NI cũng chạy native được nhưng kém hơn nhiều. Windows không hỗ trợ native — dùng WSL2 nếu cần.

---

## 4. Login và đào lần đầu

```bash
# 1. Xem ledger công khai (không cần login, để test kết nối)
rpow ledger
```

Nên thấy: tổng minted, supply hiện tại, độ khó, milestone tiếp theo.

```bash
# 2. Đăng ký / đăng nhập
rpow login bạn@example.com
```

Server sẽ gửi 1 email tới hộp thư bạn nhập. Mở email → copy **toàn bộ URL** (kiểu `https://api.rpow2.com/auth/verify?token=...`) → dán vào dấu nhắc của CLI:

```
> paste verify URL or token: https://api.rpow2.com/auth/verify?token=Ab3...xyz
```

Enter. Nếu thành công, CLI in `+ logged in as bạn@example.com`. Session lưu ở `~/.config/rpow/session` (mode 0600).

> **Lỡ mất dấu nhắc?** Email vẫn còn, dùng:
> ```bash
> rpow login --url 'https://api.rpow2.com/auth/verify?token=...'
> ```

```bash
# 3. Xem ví (nên là 0 lúc đầu)
rpow me
```

```bash
# 4. Đào thử 1 token
rpow mine
```

Output:

```text
[ workers=8 (multi-core) ]
[ challenge 8f3a2cb1... target 25 bits ]
  mining  hashes=12,800,000  rate=10.18 MH/s  elapsed=00:00:01
+ MINTED  token=8f3a2c01-...   (#1)
done. minted 1 token(s).
```

Mỗi token = 1 RPOW (giá trị nguyên, không chia nhỏ).

```bash
# 5. Đào liên tục cho đến khi Ctrl-C
rpow mine --forever

# 6. Xem 100 dòng activity gần nhất
rpow activity

# 7. Đăng xuất (xoá session local)
rpow logout
```

---

## 5. Tham chiếu lệnh

### `rpow help`

In banner, danh sách lệnh, đường dẫn config dir đang dùng.

### `rpow login <email>` / `rpow login --url <verify_url>`

| Chế độ | Lệnh | Khi nào dùng |
|---|---|---|
| Tương tác | `rpow login bạn@x.com` | Server gửi link, bạn paste vào prompt |
| Phi tương tác | `rpow login --url 'https://...auth/verify?token=...'` | Đã có link, hoặc prompt timeout |

Magic link có hạn 15 phút, dùng được 1 lần. Session sau khi login có hạn 30 ngày.

### `rpow me`

In ví: email, balance, đã mint, đã gửi, đã nhận.

### `rpow mine [flags]`

| Flag | Ý nghĩa |
|---|---|
| `--count N` / `-n N` | Đào đúng N token rồi dừng (mặc định: 1) |
| `--forever` / `-f` | Đào không giới hạn cho đến Ctrl-C hoặc `SUPPLY_EXHAUSTED` |
| `--workers N` / `-w N` | Số process đào song song (mặc định: `cpus().length - 2`) |

**Ctrl-C 2 giai đoạn:**
- Lần 1: đào nốt batch hiện tại rồi dừng sạch.
- Lần 2: kill ngay (exit 130).

**Đào song song hoạt động thế nào:** CLI fork N child process Node, mỗi process đào shard riêng của không gian nonce (chia theo high-32-bit, không bao giờ trùng). Process đầu tiên tìm thấy → main thread terminate phần còn lại và submit lên server. Trên macOS dùng `child_process.fork` thay `worker_threads` để tránh scheduler deprioritize compute (8 worker_threads = 4.1 MH/s vs 8 fork = 10.2 MH/s trên M1 Pro).

### `rpow bench [flags]`

Benchmark hashrate offline — không gọi API, không tốn challenge.

| Flag | Ý nghĩa | Mặc định |
|---|---|---|
| `--workers N` | Số process song song | `cpus-2` |
| `--seconds S` | Thời lượng đo | `10` |
| `--bits B` | Difficulty target (cao → không bao giờ trúng → đo rate thuần) | `64` |

Map scaling curve cho máy bạn:

```bash
for n in 1 2 4 6 8 10; do rpow bench --workers $n --seconds 6 | grep rate; done
```

### `rpow send <recipient_email> <amount>`

Gửi N token cho người khác. `amount` là số nguyên dương ≤ balance.

- Nếu recipient đã có account: token bị "burn" ở sender, mint mới ở recipient ngay.
- Nếu chưa có: tạo *pending transfer*, server email link claim. Recipient có 30 ngày để click link và tự đăng ký.

### `rpow activity`

100 dòng gần nhất (mint, send, receive).

### `rpow ledger`

Public, **không cần login**. Tổng cung, độ khó, milestone tiếp theo.

### `rpow logout`

Best-effort gọi server invalidate session, sau đó xoá `~/.config/rpow/session`.

---

## 6. Hashrate và difficulty

### Hashrate là gì?

**1 hash = 1 lần tính SHA-256 của (challenge + nonce).** MH/s = mega-hashes/s = triệu hash/s. Cao càng nhanh tìm ra solution.

Hashrate phụ thuộc:
- **Số core CPU** — quan trọng nhất, scale gần như tuyến tính qua `--workers`.
- **Tốc độ từng core** — Apple Silicon nhanh hơn Intel cùng đời.
- **Nhiệt** — laptop full-load 5–10 phút sẽ thermal throttle, hashrate giảm 10–20%.
- **Background apps** — Chrome 50 tab, Docker… ăn cores.

### Difficulty bits

Server đặt độ khó theo schedule: 25 bit hiện tại, mỗi 1 triệu token tăng 1 bit. Mỗi bit thêm = thời gian đào **gấp đôi**.

| Bit | Hash trung bình | Thời gian @ 10 MH/s |
|---|---|---|
| 22 | 4.2M | 0.4s |
| 25 | 33.5M | 3.3s |
| 28 | 268M | 27s |
| 30 | 1.07B | 1m47s |

### "Đôi khi mất 1s, đôi khi mất 30s — bug à?"

Không. Đào PoW có *random luck*. Số hash cần thiết theo phân phối hình học: trung bình `2^N` hash, nhưng từng lần cụ thể có thể cao hơn hoặc thấp hơn rất nhiều. Trung bình theo thời gian dài → đúng `2^N`. Đừng panic khi 1 challenge mất 5× thời gian dự kiến.

### `RATE_LIMITED` đôi lúc?

Server giới hạn:
- 30s cooldown giữa 2 magic link cho 1 email.
- ~30 challenge/phút/IP.
- 100 mint/phút/user.

CLI có sẵn **exponential backoff retry** (1s → 2s → 4s → ...). Nó tự đợi và thử lại — bạn không cần làm gì.

---

## 7. Đào 24/7 và đa tài khoản

### 7.1 Đào liên tục với `tmux` (laptop / VPS)

```bash
ssh you@your-vps                        # nếu trên VPS
tmux new -s rpow
rpow mine --forever --workers 6
# Ctrl-b d  để detach (mining vẫn chạy)
# tmux attach -t rpow  để xem lại
```

Hoặc `nohup` (không cần tmux):

```bash
nohup rpow mine --forever > ~/rpow.log 2>&1 &
tail -f ~/rpow.log
```

### 7.2 Daemon trên Linux (systemd)

`/etc/systemd/system/rpow-miner.service`:

```ini
[Unit]
Description=rpow CLI miner
After=network.target

[Service]
Type=simple
User=you
Environment=HOME=/home/you
Environment=XDG_CONFIG_HOME=/home/you/.config
ExecStart=/home/you/rpow/node_modules/.bin/rpow mine --forever --workers 6
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

### 7.3 Đa tài khoản trên cùng máy

Mỗi account 1 thư mục config riêng:

```bash
XDG_CONFIG_HOME=$HOME/.config-acc-a rpow login alice@x.com
XDG_CONFIG_HOME=$HOME/.config-acc-a rpow mine --forever --workers 4 &

XDG_CONFIG_HOME=$HOME/.config-acc-b rpow login bob@x.com
XDG_CONFIG_HOME=$HOME/.config-acc-b rpow mine --forever --workers 4 &
```

Tiện hơn với alias:

```bash
alias rpow-a='XDG_CONFIG_HOME=$HOME/.config-acc-a rpow'
alias rpow-b='XDG_CONFIG_HOME=$HOME/.config-acc-b rpow'

rpow-a me
rpow-b send alice@x.com 5
```

> **Lưu ý CPU:** 2 instance `mine` mặc định mỗi instance lấy `cpus-2` worker → tổng vượt số core, tranh nhau, hashrate KHÔNG cộng tuyến tính. Tốt hơn: chia thủ công (10 core → mỗi instance `--workers 4`, chừa 2 core cho hệ thống).

---

## 8. Troubleshooting

### Cài đặt

| Triệu chứng | Xử lý |
|---|---|
| `npm error Missing script: "build"` ở `~` | `cd ~/rpow` rồi thử lại |
| `node: command not found` | Quay lại [bước 1](#bước-1-cài-nodejs-22) |
| `bash: rpow: command not found` | Chạy `npm install` lần 2 sau khi build, hoặc `source ~/.zshrc` để apply alias |
| `Login incorrect` | Đã gõ `login user@x.com` không có `rpow` đứng trước → kích hoạt lệnh `login` của macOS. Gõ `rpow login user@x.com` |
| `tsc: command not found` | Chạy `npm install` ở root repo |

### Đăng nhập

| Triệu chứng | Xử lý |
|---|---|
| Không nhận được email | Check spam. Nếu vẫn không có sau 5 phút → sai email hoặc server gửi email gặp sự cố. Đợi 30s rồi thử lại |
| `error: NO_COOKIE: server did not set rpow_session cookie` | Token đã được dùng / quá 15 phút. Chạy lại `rpow login` |
| `error: session expired` | Quá 30 ngày từ lần login. Login lại |
| Lỡ mất prompt nhưng còn email | `rpow login --url 'URL_TỪ_EMAIL'` |

### Mining

| Triệu chứng | Xử lý |
|---|---|
| `error: fetch failed` | Mất mạng hoặc server tạm down. CLI tự retry với exponential backoff — đợi 1–2 phút |
| `RATE_LIMITED` lặp lại | Đang chạy quá nhiều account/instance trên cùng IP. Giảm bớt |
| Hashrate thấp bất thường | Có app khác ăn CPU. Check `top` / Activity Monitor |
| Mining đứng im không tiến | Đang chạy nhưng terminal không phải TTY (do `tee`/redirect). Mining VẪN chạy, chỉ là không in `\r` progress |
| `INVALID_SOLUTION` | Bug nghiêm trọng — báo cáo issue kèm `challenge_id` |
| `SUPPLY_EXHAUSTED` | Đã đạt cap 21M. Hết — không ai đào được nữa |

### Native miner

| Triệu chứng | Xử lý |
|---|---|
| `bench` hiện `backend: js` dù đã chạy `build:native` | Check `apps/cli/native/rpow_miner_native.darwin-arm64.node` (hoặc `linux-x64`) có tồn tại không. Nếu không → `npm run build:native -w @rpow/cli` lại |
| `[build-native] cargo not found` | Cài Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh && source $HOME/.cargo/env` |
| `cargo build failed` với lỗi compiler | Update Rust: `rustup update stable` (cần ≥ 1.88) |
| `[build-native] Windows is not a supported native target` | Native chỉ build trên macOS/Linux. Trên Windows dùng JS fallback hoặc WSL2 |

### Reset hoàn toàn

```bash
rpow logout
rm -rf ~/.config/rpow
```

Sau đó `rpow login ...` để bắt đầu lại.

---

## 9. An toàn và lưu ý

### Bảo mật session

- File `~/.config/rpow/session` mode `0600` — chỉ user của bạn đọc được. Đây là HMAC token tương đương cookie trình duyệt; **ai cầm được file = đăng nhập được vào ví của bạn**. Đừng commit, đừng upload, đừng gửi qua chat.
- **Magic link** dùng được **1 lần**, hạn **15 phút**. Vô tình paste vào nơi khác = "cháy".
- Nghi ngờ session bị lộ: `rpow logout && rm ~/.config/rpow/session && rpow login <email>` để xin session mới.

### Vận hành máy

- Mining trên CPU **rất ngốn điện và toả nhiệt**. Laptop nóng, quạt ồn là bình thường.
- Pin tụt rất nhanh khi chạy `--forever` (1–2 giờ là hết). Chỉ chạy khi cắm sạc.
- Khi đang code/họp Zoom/render: hạ `--workers 2` hoặc `--workers 4` để giữ máy mượt.

### Giới hạn

- Token RPOW không quy đổi USD/VND, không niêm yết sàn nào — đây là pet project.
- Server có thể tắt bất cứ lúc nào — đừng đổ nhiều công sức vào nếu không sẵn sàng mất.
- Database có thể reset (đã từng xảy ra trong giai đoạn dev).

---

Hết. Khi cần xem lại nhanh: `rpow help`.
