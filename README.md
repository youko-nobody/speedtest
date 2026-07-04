# VPS Traffic Burner

一个用于**授权场景**的 VPS 流量消耗/带宽压测工具。主入口是零安装 Bash 脚本 [traffic.sh](traffic.sh)：上传到 GitHub 后，VPS 上拉下来就能后台跑，另一个命令一键停。

## 一键随机跑 1 分钟

下面这一行会下载脚本，并在接下来的 5 分钟内随机抽取其中 1 分钟，随机抽取 1 个官方测速链接，然后只持续跑这个链接 60 秒：

```bash
curl -fsSL https://raw.githubusercontent.com/youko-nobody/speedtest/main/traffic.sh -o traffic.sh && chmod +x traffic.sh && ./traffic.sh random-minute --preset official --window-seconds 300 --run-seconds 60
```

查看状态、日志、停止：

```bash
./traffic.sh status
./traffic.sh tail
./traffic.sh stop
```

它可以把你之前这种单链接循环：

```bash
nohup sh -c 'while true; do wget -O /dev/null http://ipv4.download.thinkbroadband.com/1GB.zip; sleep 60; done' >/root/traffic.log 2>&1 &
```

这种写法只适合你确认允许自动化下载的端点。注意：ThinkBroadband 当前公开说明不允许脚本/自动化下载，所以项目示例不再把它作为默认目标。

升级后可以：

- 多链接轮询或随机调度
- 多并发下载
- 对你自己提供的上传接口跑上行
- 总流量、下载流量、上传流量、时长、速率限制
- 后台启动、停止、状态、日志和 PID 文件
- 不需要 Node/npm/Python/Go

请只对你自己的 VPS、你有权使用的对象存储/CDN、或明确公开给测速使用的文件端点运行。公开测速文件建议只用于下载，不要对第三方站点做上传请求。

## 一行拉取脚本

把 `YOUR_GITHUB_USER/YOUR_REPO` 换成你上传后的仓库地址：

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_GITHUB_USER/YOUR_REPO/main/traffic.sh -o traffic.sh && chmod +x traffic.sh
```

没有 `curl` 的机器：

```bash
wget -O traffic.sh https://raw.githubusercontent.com/YOUR_GITHUB_USER/YOUR_REPO/main/traffic.sh && chmod +x traffic.sh
```

## 一行持续启动

```bash
./traffic.sh start --preset official --schedule random --concurrency 4 --interval 60 --jitter 10 --max-bytes 20G
```

或者用参数写法：

```bash
./traffic.sh start \
  --preset official \
  --schedule random \
  --concurrency 4 \
  --interval 60 \
  --jitter 10 \
  --max-bytes 20G
```

查看和停止：

```bash
./traffic.sh status
./traffic.sh tail
./traffic.sh stop
```

查看内置官方测速链接池：

```bash
./traffic.sh links
```

默认状态目录是 `~/.traffic-burner/`，日志在 `~/.traffic-burner/traffic.log`，PID 在 `~/.traffic-burner/traffic.pid`。

## 上行和下行一起跑

公开测速文件只适合下行。上行请填你自己控制的 HTTP POST 接口，例如你自己的 Nginx、应用接口、对象存储预签名上传地址，或者项目里的 Node 服务端。

```bash
URLS="https://your-domain.example/file.bin" \
UPLOAD_URLS="https://your-domain.example/upload" \
MODE=both \
CONCURRENCY=2 \
UPLOAD_CONCURRENCY=2 \
UPLOAD_CHUNK=64M \
MAX_BYTES=50G \
./traffic.sh start
```

## 常用脚本配置

| 变量/参数 | 说明 |
| --- | --- |
| `URLS` / `--urls` | 下载链接，多个用空格、逗号或换行分隔 |
| `URLS_FILE` / `--urls-file` | 从文本文件读取下载链接，支持 `#` 注释 |
| `PRESET` / `--preset` | `none` 或 `official`，`official` 是内置官方测速链接池 |
| `UPLOAD_URLS` / `--upload-urls` | 上传接口，多个用空格、逗号或换行分隔 |
| `MODE` / `--mode` | `auto`、`download`、`upload`、`both` |
| `SCHEDULE` / `--schedule` | `round-robin` 或 `random` |
| `CONCURRENCY` / `--concurrency` | 下载并发数 |
| `UPLOAD_CONCURRENCY` / `--upload-concurrency` | 上传并发数 |
| `INTERVAL` / `--interval` | 每轮请求后的等待秒数 |
| `JITTER` / `--jitter` | 每轮请求后的随机额外秒数 |
| `MAX_BYTES` / `--max-bytes` | 总流量上限，例如 `20G` |
| `MAX_SECONDS` / `--max-seconds` | 运行秒数上限 |
| `RANDOM_WINDOW_SECONDS` / `--window-seconds` | `random-minute` 的随机窗口，默认 `300` |
| `RANDOM_RUN_SECONDS` / `--run-seconds` | `random-minute` 的单次运行时长，默认 `60` |
| `RATE_LIMIT` / `--rate-limit` | 单 worker 限速，例如 `20M` |
| `UPLOAD_CHUNK` / `--upload-chunk` | 每次上传的请求体大小，例如 `64M` |
| `LOG_FILE` / `--log` | 日志路径 |
| `PID_FILE` / `--pid` | PID 路径 |

## Node 完整版

仓库里也保留了 Node/TypeScript 完整版，适合需要自建 `/download`、`/upload` 服务端和更细统计的场景。

需要 Node.js 20.11 或更新版本。

```bash
npm install
npm run build
npm link
```

自建服务端：

```bash
tb server --host 0.0.0.0 --port 8080 --token CHANGE_ME
```

客户端上下行：

```bash
tb client --self-hosted http://VPS_A_IP:8080 --token CHANGE_ME --mode both --concurrency 4 --max 50gb --rate 100mb/s
```

服务端接口：

- `GET /probe`：客户端探测，确认是本项目服务端。
- `GET /download?bytes=1073741824`：生成指定字节数的下载流；不传 `bytes` 会持续流式下载。
- `POST /upload`：接收上传流并返回收到的字节数。

## 配置文件

生成示例：

```bash
tb examples
```

用配置运行：

```bash
tb client -c examples/client.yaml
tb server -c examples/server.yaml
```

客户端配置重点：

- `schedule`: `round-robin` 或 `random`
- `concurrency`: 并发 worker 数
- `intervalMs`: 每个 worker 每次请求后的固定等待
- `jitterMs`: 每次请求后的随机额外等待
- `maxBytes`: 总流量上限，例如 `20gb`
- `maxDownloadBytes`: 下载上限
- `maxUploadBytes`: 上传上限
- `maxDuration`: 运行时长，例如 `2h`
- `rateLimit`: 全局速率限制，例如 `80mb/s`
- `targets[].downloadOnly`: 公开测速文件设为 `true`

## Docker

构建：

```bash
docker build -t vps-traffic-burner .
```

跑服务端：

```bash
docker run -d --name traffic-server -p 8080:8080 \
  vps-traffic-burner server --host 0.0.0.0 --port 8080 --token CHANGE_ME
```

跑客户端：

```bash
docker run --rm vps-traffic-burner client \
  --self-hosted http://YOUR_VPS_IP:8080 \
  --token CHANGE_ME \
  --mode both \
  --max 10gb
```

## 查找公开测速下载链接

常见关键词：

```text
provider looking glass test file
provider speed test files
VPS looking glass 1GB test file
data center speedtest file
```

常见公开测试文件类型：

- `100MB.bin`
- `1GB.bin`
- `1GB.zip`
- `10GB.bin`

一些常见的官方测速文件目录：

- Leaseweb: `https://speedtest.ams1.nl.leaseweb.net/1000mb.bin`，也可按官方 KB 选择其它地区的 `speedtest.*.leaseweb.net`
- OVH: `https://proof.ovh.net/files/`
- Hetzner: `https://nbg1-speed.hetzner.com/`
- Scaleway: `https://scaleway.testdebit.info/`

Scaleway 的测试页提示脚本每天每 IP 不要超过 40GB；这类公共端点务必设置 `maxBytes`、`maxDownloadBytes` 或 `maxDuration`。

更详细的链接清单在 [docs/test-links.md](docs/test-links.md)。

项目还提供了 [examples/user-provided-urls.txt](examples/user-provided-urls.txt)，里面放了你提供的移动云盘、vivo、快手、拼多多、华为 CDN、Steam Akamai 链接。它们不是官方测速端点，所以默认都注释了；确认你有权限重复下载后，取消对应行前面的 `#`，然后这样跑：

```bash
./traffic.sh start --urls-file examples/user-provided-urls.txt --schedule random --concurrency 4 --interval 60 --max-bytes 20G
```

配置时请把这类外部链接写成 `downloadOnly: true`，例如：

```yaml
targets:
  - name: public-test-file
    url: https://example.net/1GB.bin
    mode: download
    downloadOnly: true
```

客户端会要求公共 `downloadOnly` 目标必须设置 `maxBytes`、`maxDownloadBytes` 或 `maxDuration`，避免无人看管地无限下载。

## 注意事项

- 跑流量前先确认 VPS 商家的 TOS、带宽策略和超额计费。
- 公开测速链接可能限速、换地址或删除，生产使用建议优先跑你自己的端点。
- `rateLimit` 是客户端全局限制，多个并发共享。
- `maxBytes` 是下载和上传合计上限。
- Windows 后台启动也可用 `tb start`，Linux 上也可以继续用 `nohup tb client ... > traffic.log 2>&1 &`。
