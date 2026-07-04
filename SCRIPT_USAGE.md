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

## Start In Background

```bash
URLS="https://speedtest.ams1.nl.leaseweb.net/1000mb.bin https://proof.ovh.net/files/1Gb.dat" CONCURRENCY=4 INTERVAL=60 JITTER=10 MAX_BYTES=20G ./traffic.sh start
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
  --urls "https://speedtest.ams1.nl.leaseweb.net/1000mb.bin https://proof.ovh.net/files/1Gb.dat" \
  --schedule random \
  --concurrency 4 \
  --interval 60 \
  --jitter 10 \
  --max-bytes 20G \
  --rate-limit 20M
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
