# traffic.sh Quick Usage

This is the zero-install script version. Upload this repository to GitHub, then run these commands on your VPS.

## Download The Script

Replace `YOUR_GITHUB_USER/YOUR_REPO` with your repository:

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_GITHUB_USER/YOUR_REPO/main/traffic.sh -o traffic.sh && chmod +x traffic.sh
```

If the VPS does not have curl:

```bash
wget -O traffic.sh https://raw.githubusercontent.com/YOUR_GITHUB_USER/YOUR_REPO/main/traffic.sh && chmod +x traffic.sh
```

## One-Line Random Minute

Download the script and schedule one random 60-second run within the next 5 minutes. It randomly selects one official speed-test URL, then keeps running only that URL for the full 60 seconds:

```bash
curl -fsSL https://raw.githubusercontent.com/youko-nobody/speedtest/main/traffic.sh -o traffic.sh && chmod +x traffic.sh && ./traffic.sh random-minute --preset official --window-seconds 300 --run-seconds 60
```

Check the scheduled job:

```bash
./traffic.sh status
./traffic.sh tail
./traffic.sh stop
```

One-line stop command:

```bash
curl -fsSL https://raw.githubusercontent.com/youko-nobody/speedtest/main/traffic.sh -o traffic.sh && chmod +x traffic.sh && ./traffic.sh stop
```

## One-Line Reselect Every Minute

Run in the background and randomly select one official speed-test URL every 60 seconds. During each 60-second slot, only that selected URL is used:

```bash
curl -fsSL https://raw.githubusercontent.com/youko-nobody/speedtest/main/traffic.sh -o traffic.sh && chmod +x traffic.sh && ./traffic.sh start --preset official --select-every 60 --concurrency 4 --interval 0
```

If an old process is already running on the VPS, update the script, stop the old process, and restart in one line:

```bash
curl -fsSL https://raw.githubusercontent.com/youko-nobody/speedtest/main/traffic.sh -o traffic.sh && chmod +x traffic.sh && ./traffic.sh stop && ./traffic.sh start --preset official --select-every 60 --concurrency 4 --interval 0
```

`status=28` or `Connection timed out` means the selected speed-test endpoint did not respond in time; it does not mean the runner stopped. The script temporarily skips URLs after repeated zero-byte failures. Defaults: 2 failures, 30-minute cooldown.

## Start In Background

```bash
./traffic.sh start --preset official --schedule random --concurrency 4 --interval 60 --jitter 10 --max-bytes 20G
```

## Check, Watch, Stop

```bash
./traffic.sh status
./traffic.sh tail
./traffic.sh stop
```

## More Options

```bash
./traffic.sh start \
  --preset official \
  --schedule random \
  --concurrency 4 \
  --interval 60 \
  --jitter 10 \
  --max-bytes 20G \
  --rate-limit 20M
```

Print the built-in official link pool:

```bash
./traffic.sh links
```

Run your own URL file:

```bash
./traffic.sh start --urls-file examples/user-provided-urls.txt --schedule random --concurrency 4 --interval 60 --max-bytes 20G
```

Merge your uncommented URL file into the official random pool:

```bash
./traffic.sh start --preset official --urls-file examples/user-provided-urls.txt --select-every 60 --concurrency 4 --interval 0
```

Use only your own URL file:

```bash
./traffic.sh start --urls-file examples/user-provided-urls.txt --select-every 60 --concurrency 4 --interval 0
```

Use the merged pool with random-minute mode:

```bash
./traffic.sh random-minute --preset official --urls-file examples/user-provided-urls.txt --window-seconds 300 --run-seconds 60
```

## Upload And Download

Only use upload URLs that you control.

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

Default files:

```text
~/.traffic-burner/traffic.log
~/.traffic-burner/traffic.pid
~/.traffic-burner/bytes.count
```
