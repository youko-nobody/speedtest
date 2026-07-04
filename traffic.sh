#!/usr/bin/env bash
set -uo pipefail

APP_NAME="traffic-burner"
VERSION="1.0.0"

PID_FILE_ENV="${PID_FILE:-}"
LOG_FILE_ENV="${LOG_FILE:-}"
CONFIG_FILE_ENV="${CONFIG_FILE:-}"
COUNTER_FILE_ENV="${COUNTER_FILE:-}"
LOCK_DIR_ENV="${LOCK_DIR:-}"

STATE_DIR="${STATE_DIR:-${HOME:-/tmp}/.traffic-burner}"
PID_FILE="${PID_FILE:-$STATE_DIR/traffic.pid}"
LOG_FILE="${LOG_FILE:-$STATE_DIR/traffic.log}"
CONFIG_FILE="${CONFIG_FILE:-$STATE_DIR/config.env}"
COUNTER_FILE="${COUNTER_FILE:-$STATE_DIR/bytes.count}"
LOCK_DIR="${LOCK_DIR:-$STATE_DIR/lock}"
PID_FILE_ARG=0
LOG_FILE_ARG=0
CONFIG_FILE_ARG=0
COUNTER_FILE_ARG=0
LOCK_DIR_ARG=0

URLS="${URLS:-}"
URLS_FILE="${URLS_FILE:-}"
UPLOAD_URLS="${UPLOAD_URLS:-}"
PRESET="${PRESET:-none}"
MODE="${MODE:-auto}"
SCHEDULE="${SCHEDULE:-round-robin}"
CONCURRENCY="${CONCURRENCY:-2}"
UPLOAD_CONCURRENCY="${UPLOAD_CONCURRENCY:-1}"
INTERVAL="${INTERVAL:-60}"
JITTER="${JITTER:-0}"
MAX_BYTES="${MAX_BYTES:-}"
MAX_SECONDS="${MAX_SECONDS:-}"
SELECT_EVERY_SECONDS="${SELECT_EVERY_SECONDS:-0}"
RATE_LIMIT="${RATE_LIMIT:-}"
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-0}"
UPLOAD_CHUNK="${UPLOAD_CHUNK:-64M}"
UPLOAD_RANDOM="${UPLOAD_RANDOM:-0}"
USER_AGENT="${USER_AGENT:-traffic-burner/1.0}"
RETRIES="${RETRIES:-1}"
ERROR_SLEEP="${ERROR_SLEEP:-5}"
RANDOM_WINDOW_SECONDS="${RANDOM_WINDOW_SECONDS:-300}"
RANDOM_RUN_SECONDS="${RANDOM_RUN_SECONDS:-60}"
RANDOM_START_DELAY="${RANDOM_START_DELAY:-0}"

usage() {
  cat <<'EOF'
traffic.sh - zero-install VPS traffic runner

Usage:
  ./traffic.sh start [options]
  ./traffic.sh random-minute [options]
  ./traffic.sh stop
  ./traffic.sh status
  ./traffic.sh tail
  ./traffic.sh links
  ./traffic.sh run
  ./traffic.sh once [options]

Common start examples:
  URLS="https://speedtest.ams1.nl.leaseweb.net/1000mb.bin https://proof.ovh.net/files/1Gb.dat" \
    CONCURRENCY=4 INTERVAL=60 ./traffic.sh start

  ./traffic.sh start \
    --preset official \
    --schedule random \
    --concurrency 4 \
    --interval 60 \
    --max-bytes 20G

  UPLOAD_URLS="https://your-domain.example/upload" MODE=both ./traffic.sh start --urls "https://your-domain.example/file.bin"

Commands:
  start       Save config and run in background.
  random-minute
              In the next 5 minutes, randomly choose one 60-second slot,
              then randomly choose one download URL and keep running only
              that URL for the whole slot.
  stop        Stop the background process and all workers.
  status      Show PID, log path, and transferred byte counter.
  tail        Follow the log file.
  links       Print the built-in official speed-test URL pool.
  run         Internal foreground runner used by start.
  once        Run in foreground until stopped or limits are reached.

Options and env:
  --urls VALUE              Download URLs, separated by spaces, commas, or newlines. Env: URLS
  --urls-file FILE          Read download URLs from a file. Env: URLS_FILE
  --preset VALUE            none or official. Env: PRESET
  --upload-urls VALUE       Upload endpoints for POST body traffic. Env: UPLOAD_URLS
  --mode VALUE              auto, download, upload, both. Env: MODE
  --schedule VALUE          round-robin or random. Env: SCHEDULE
  --concurrency N           Download workers. Env: CONCURRENCY
  --upload-concurrency N    Upload workers. Env: UPLOAD_CONCURRENCY
  --interval SECONDS        Sleep after each request. Env: INTERVAL
  --jitter SECONDS          Extra random sleep after each request. Env: JITTER
  --max-bytes SIZE          Stop after approximate total bytes, e.g. 20G. Env: MAX_BYTES
  --max-seconds SECONDS     Stop after runtime seconds. Env: MAX_SECONDS
  --select-every SECONDS    Re-randomize one download URL every N seconds.
                            During each slot, only the selected URL is used.
                            Env: SELECT_EVERY_SECONDS
  --window-seconds SECONDS  Random-minute window, default 300. Env: RANDOM_WINDOW_SECONDS
  --run-seconds SECONDS     Random-minute run length, default 60. Env: RANDOM_RUN_SECONDS
  --rate-limit RATE         Per-worker curl/wget limit, e.g. 20M. Env: RATE_LIMIT
  --timeout SECONDS         Per-request timeout, 0 means no hard timeout. Env: REQUEST_TIMEOUT
  --upload-chunk SIZE       Bytes per upload request, e.g. 64M. Env: UPLOAD_CHUNK
  --upload-random 0|1       Use /dev/urandom instead of /dev/zero. Env: UPLOAD_RANDOM
  --error-sleep SECONDS     Sleep after a failed request. Env: ERROR_SLEEP
  --log FILE                Log file path. Env: LOG_FILE
  --pid FILE                PID file path. Env: PID_FILE

Notes:
  Public speed-test file URLs should be used for download only.
  Upload traffic requires endpoints you control and permit to receive POST bodies.
EOF
}

log() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

script_path() {
  local src="$0"
  if [ -L "$src" ]; then
    src="$(readlink "$src")"
  fi
  case "$src" in
    /*) printf '%s\n' "$src" ;;
    *) printf '%s/%s\n' "$(pwd -P)" "$src" ;;
  esac
}

normalize_list() {
  printf '%s\n' "$1" | tr ',\n\t' '   '
}

builtin_official_urls() {
  cat <<'EOF'
# Leaseweb official speed-test locations
https://speedtest.ams1.nl.leaseweb.net/1000mb.bin
https://speedtest.ams2.nl.leaseweb.net/1000mb.bin
https://speedtest.fra1.de.leaseweb.net/1000mb.bin
https://speedtest.lon1.uk.leaseweb.net/1000mb.bin
https://speedtest.lon12.uk.leaseweb.net/1000mb.bin
https://speedtest.lax12.us.leaseweb.net/1000mb.bin
https://speedtest.wdc2.us.leaseweb.net/1000mb.bin
https://speedtest.sfo12.us.leaseweb.net/1000mb.bin
https://speedtest.sea11.us.leaseweb.net/1000mb.bin
https://speedtest.mia11.us.leaseweb.net/1000mb.bin
https://speedtest.phx1.us.leaseweb.net/1000mb.bin
https://speedtest.dal13.us.leaseweb.net/1000mb.bin
https://speedtest.nyc1.us.leaseweb.net/1000mb.bin
https://speedtest.chi11.us.leaseweb.net/1000mb.bin
https://speedtest.sin1.sg.leaseweb.net/1000mb.bin
https://speedtest.syd12.au.leaseweb.net/1000mb.bin
https://speedtest.hkg12.hk.leaseweb.net/1000mb.bin
https://speedtest.tyo11.jp.leaseweb.net/1000mb.bin
https://speedtest.mtl2.ca.leaseweb.net/1000mb.bin

# OVHcloud proof speed-test files
https://proof.ovh.net/files/1Gb.dat
https://proof.ovh.net/files/10Gb.dat

# Hetzner regional speed-test files
https://hel1-speed.hetzner.com/1GB.bin
https://fsn1-speed.hetzner.com/1GB.bin
https://nbg1-speed.hetzner.com/1GB.bin

# Scaleway net-test files. Respect their published 40 GB/day/IP script limit.
https://scaleway.testdebit.info/100M.iso
https://scaleway.testdebit.info/10G.iso

# Artfiles official speed-test files
https://speed.af.de/files/100MB.bin
https://speed.af.de/files/1GB.bin

# Hostiserver official speed-test files
https://us.speedtest.hostiserver.com/100MB
https://us.speedtest.hostiserver.com/500MB
https://eu.speedtest.hostiserver.com/100MB
https://eu.speedtest.hostiserver.com/500MB

# SpeedyPage official looking-glass test files
https://lon.lg.speedypage.com/1GB.test
https://ash.lg.speedypage.com/1GB.test
https://la.lg.speedypage.com/1GB.test
https://ams.lg.speedypage.com/1GB.test
https://sg.lg.speedypage.com/1GB.test
https://tyo.lg.speedypage.com/1GB.test
https://syd.lg.speedypage.com/1GB.test

# MilkyWan official speed-test files
http://speedtest.milkywan.fr/files/100M.iso
http://speedtest.milkywan.fr/files/1G.iso
http://speedtest.milkywan.fr/files/10G.iso

# VelociHOST official speed-test files
https://mirror.mia.velocihost.net/speedtest/50MB.bin
https://mirror.mia.velocihost.net/speedtest/500MB.bin
https://mirror.mia.velocihost.net/speedtest/1000MB.bin

# BITel official speed-test files
https://speedtest.bitel.io/Testdateien/100MB
https://speedtest.bitel.io/Testdateien/500MB
https://speedtest.bitel.io/Testdateien/1000MB
https://speedtest.bitel.io/Testdateien/5GB

# Serverius official speed-test files
http://speedtest1.serverius.net/files/1000mb.bin
http://speedtest1.serverius.net/files/2000mb.bin
http://speedtest2.serverius.net/files/1000mb.bin
http://speedtest3.serverius.net/files/1000mb.bin

# BelWue speed-test files listed by IP-Toolbox
http://speedtest.belwue.net/100M
http://speedtest.belwue.net/1G
http://speedtest.belwue.net/10G
EOF
}

strip_url_text() {
  sed '1s/^\xEF\xBB\xBF//' | sed -E '/^[[:space:]]*#/d; s/[[:space:]]+#.*$//' | tr ',\t' '  ' | awk 'NF { print }'
}

parse_size() {
  local raw="${1:-}"
  local value unit
  raw="${raw// /}"
  raw="${raw^^}"
  raw="${raw%B}"
  [ -n "$raw" ] || return 1

  case "$raw" in
    *K) unit=1024; value="${raw%K}" ;;
    *M) unit=$((1024 * 1024)); value="${raw%M}" ;;
    *G) unit=$((1024 * 1024 * 1024)); value="${raw%G}" ;;
    *T) unit=$((1024 * 1024 * 1024 * 1024)); value="${raw%T}" ;;
    *) unit=1; value="$raw" ;;
  esac

  [[ "$value" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$((value * unit))"
}

human_bytes() {
  local bytes="${1:-0}"
  if have awk; then
    awk -v b="$bytes" 'BEGIN {
      split("B KiB MiB GiB TiB", u, " ");
      i=1;
      while (b >= 1024 && i < 5) { b /= 1024; i++ }
      if (i == 1) printf "%d %s", b, u[i]; else printf "%.2f %s", b, u[i]
    }'
  else
    printf '%s B' "$bytes"
  fi
}

save_config() {
  mkdir -p "$STATE_DIR"
  : > "$CONFIG_FILE"
  local var
  for var in \
    STATE_DIR PID_FILE LOG_FILE CONFIG_FILE COUNTER_FILE LOCK_DIR \
    URLS URLS_FILE PRESET UPLOAD_URLS MODE SCHEDULE CONCURRENCY UPLOAD_CONCURRENCY \
    INTERVAL JITTER MAX_BYTES MAX_SECONDS SELECT_EVERY_SECONDS RATE_LIMIT REQUEST_TIMEOUT \
    UPLOAD_CHUNK UPLOAD_RANDOM USER_AGENT RETRIES ERROR_SLEEP \
    RANDOM_WINDOW_SECONDS RANDOM_RUN_SECONDS RANDOM_START_DELAY
  do
    printf '%s=%q\n' "$var" "${!var:-}" >> "$CONFIG_FILE"
  done
}

load_config() {
  [ -f "$CONFIG_FILE" ] || die "config not found: $CONFIG_FILE"
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
}

is_running() {
  local pid="${1:-}"
  [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1
}

current_pid() {
  [ -f "$PID_FILE" ] && tr -d '[:space:]' < "$PID_FILE"
}

with_lock() {
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    sleep 0.05
  done
  "$@"
  local status=$?
  rmdir "$LOCK_DIR" 2>/dev/null || true
  return "$status"
}

counter_init() {
  mkdir -p "$STATE_DIR"
  local value=""
  [ -f "$COUNTER_FILE" ] && value="$(tr -dc '0-9' < "$COUNTER_FILE" 2>/dev/null || true)"
  if [ -z "$value" ]; then
    printf '0\n' > "$COUNTER_FILE"
  fi
}

counter_read() {
  local value=""
  [ -f "$COUNTER_FILE" ] && value="$(tr -dc '0-9' < "$COUNTER_FILE" 2>/dev/null || true)"
  if [ -n "$value" ]; then
    printf '%s' "$value"
  else
    printf '0'
  fi
}

counter_add_unlocked() {
  local add="${1:-0}"
  local old new
  old="$(counter_read)"
  new="$((old + add))"
  printf '%s\n' "$new" > "$COUNTER_FILE"
}

counter_add() {
  with_lock counter_add_unlocked "$1"
}

max_bytes_value() {
  [ -n "$MAX_BYTES" ] || return 1
  parse_size "$MAX_BYTES"
}

remaining_bytes() {
  local max used
  max="$(max_bytes_value)" || return 1
  used="$(counter_read)"
  if [ "$used" -ge "$max" ]; then
    printf '0\n'
  else
    printf '%s\n' "$((max - used))"
  fi
}

limit_reached() {
  local max used
  max="$(max_bytes_value)" || return 1
  used="$(counter_read)"
  [ "$used" -ge "$max" ]
}

split_urls() {
  local input="$1"
  local array_name="$2"
  local item
  eval "$array_name=()"
  local had_noglob=0
  case "$-" in *f*) had_noglob=1 ;; esac
  set -f
  # shellcheck disable=SC2206
  local parts=( $(normalize_list "$input") )
  [ "$had_noglob" -eq 1 ] || set +f
  for item in "${parts[@]}"; do
    [ -n "$item" ] && eval "$array_name+=(\"\$item\")"
  done
}

build_download_urls_text() {
  case "$PRESET" in
    none|"") ;;
    official) builtin_official_urls | strip_url_text ;;
    *) die "unknown PRESET: $PRESET" ;;
  esac

  if [ -n "$URLS_FILE" ]; then
    [ -f "$URLS_FILE" ] || die "URLS_FILE not found: $URLS_FILE"
    strip_url_text < "$URLS_FILE"
  fi

  if [ -n "$URLS" ]; then
    printf '%s\n' "$URLS"
  fi
}

pick_url() {
  local array_name="$1"
  local worker="$2"
  local iter="$3"
  local count index
  eval "count=\${#$array_name[@]}"
  [ "$count" -gt 0 ] || return 1

  if [ "$SCHEDULE" = "random" ]; then
    index=$((RANDOM % count))
  else
    index=$(((worker + iter) % count))
  fi
  eval "printf '%s\n' \"\${$array_name[$index]}\""
}

pick_random_url() {
  local array_name="$1"
  local count index
  eval "count=\${#$array_name[@]}"
  [ "$count" -gt 0 ] || return 1
  index=$((RANDOM % count))
  eval "printf '%s\n' \"\${$array_name[$index]}\""
}

select_every_url() {
  local array_name="$1"
  local now current_slot lock file old_slot old_url new_url
  now="$(date +%s)"
  current_slot=$((now / SELECT_EVERY_SECONDS))
  lock="$STATE_DIR/select-every.lock"
  file="$STATE_DIR/select-every.current"

  while ! mkdir "$lock" 2>/dev/null; do
    sleep 0.05
  done

  old_slot="$(sed -n '1p' "$file" 2>/dev/null || true)"
  old_url="$(sed -n '2p' "$file" 2>/dev/null || true)"
  if [ "$old_slot" = "$current_slot" ] && [ -n "$old_url" ]; then
    rmdir "$lock" 2>/dev/null || true
    printf '%s\n' "$old_url"
    return 0
  fi

  new_url="$(pick_random_url "$array_name")" || {
    rmdir "$lock" 2>/dev/null || true
    return 1
  }
  printf '%s\n%s\n' "$current_slot" "$new_url" > "$file"
  rmdir "$lock" 2>/dev/null || true
  log "select-every slot=$current_slot seconds=$SELECT_EVERY_SECONDS url=$new_url" >&2
  printf '%s\n' "$new_url"
}

sleep_between() {
  local extra=0
  if [ "${JITTER:-0}" -gt 0 ] 2>/dev/null; then
    extra=$((RANDOM % (JITTER + 1)))
  fi
  sleep "$((INTERVAL + extra))"
}

sleep_after_error() {
  local seconds="${ERROR_SLEEP:-5}"
  [[ "$seconds" =~ ^[0-9]+$ ]] || seconds=5
  if [ "$seconds" -eq 0 ] && { [ "${SELECT_EVERY_SECONDS:-0}" -gt 0 ] 2>/dev/null || [ -n "${STOP_AT:-}" ]; }; then
    seconds=1
  fi
  [ "$seconds" -gt 0 ] && sleep "$seconds"
}

time_reached() {
  [ -n "${STOP_AT:-}" ] && [ "$(date +%s)" -ge "$STOP_AT" ]
}

positive_min() {
  local min="" value
  for value in "$@"; do
    if [[ "$value" =~ ^[0-9]+$ ]] && [ "$value" -gt 0 ]; then
      if [ -z "$min" ] || [ "$value" -lt "$min" ]; then
        min="$value"
      fi
    fi
  done
  [ -n "$min" ] && printf '%s\n' "$min"
}

slot_remaining_seconds() {
  local now remaining stop_remaining select_remaining current_slot next_slot
  now="$(date +%s)"

  if [ -n "${STOP_AT:-}" ]; then
    stop_remaining=$((STOP_AT - now))
  else
    stop_remaining=""
  fi

  if [ "${SELECT_EVERY_SECONDS:-0}" -gt 0 ] 2>/dev/null; then
    current_slot=$((now / SELECT_EVERY_SECONDS))
    next_slot=$(((current_slot + 1) * SELECT_EVERY_SECONDS))
    select_remaining=$((next_slot - now))
  else
    select_remaining=""
  fi

  remaining="$(positive_min "${REQUEST_TIMEOUT:-0}" "$stop_remaining" "$select_remaining")"
  [ -n "$remaining" ] && printf '%s\n' "$remaining"
}

curl_download() {
  local url="$1"
  local remaining="${2:-}"
  local timeout_args=()
  local rate_args=()
  local retry_args=()
  local output status bytes tmp err pipe_status effective_timeout

  effective_timeout="$(slot_remaining_seconds || true)"
  [ -n "$effective_timeout" ] && timeout_args=(--max-time "$effective_timeout")
  [ -n "$RATE_LIMIT" ] && rate_args=(--limit-rate "$RATE_LIMIT")
  if [ -z "$effective_timeout" ] && [ "${RETRIES:-0}" -gt 0 ] 2>/dev/null; then
    retry_args=(--retry "$RETRIES" --retry-delay 2)
  fi

  if [ -n "$remaining" ] && [ "$remaining" -gt 0 ]; then
    tmp="$STATE_DIR/.curl-bytes.$$.$RANDOM"
    err="$STATE_DIR/.curl-error.$$.$RANDOM"
    set +o pipefail
    curl -L -sS -A "$USER_AGENT" "${retry_args[@]}" "${timeout_args[@]}" "${rate_args[@]}" "$url" 2> "$err" \
      | head -c "$remaining" \
      | wc -c > "$tmp"
    pipe_status="${PIPESTATUS[0]}"
    set -o pipefail
    bytes="$(tr -dc '0-9' < "$tmp" 2>/dev/null || printf '0')"
    rm -f "$tmp"
    if [ "$pipe_status" -ne 0 ] && [ "$pipe_status" -ne 23 ]; then
      if [ "$bytes" -gt 0 ]; then
        counter_add "$bytes"
        log "download partial tool=curl status=$pipe_status bytes=$bytes total=$(counter_read) url=$url"
      fi
      log "download failed tool=curl url=$url status=$pipe_status"
      [ -s "$err" ] && sed 's/^/[curl] /' "$err" >> "$LOG_FILE"
      rm -f "$err"
      return 1
    fi
    rm -f "$err"
    counter_add "$bytes"
    log "download ok bytes=$bytes total=$(counter_read) url=$url"
    return 0
  fi

  err="$STATE_DIR/.curl-error.$$.$RANDOM"
  output="$(curl -L -sS -A "$USER_AGENT" "${retry_args[@]}" "${timeout_args[@]}" "${rate_args[@]}" -o /dev/null -w '%{http_code} %{size_download}' "$url" 2> "$err")"
  status=$?
  bytes="$(printf '%s\n' "$output" | awk '{print $NF}')"
  [[ "$bytes" =~ ^[0-9]+$ ]] || bytes=0
  if [ "$status" -ne 0 ]; then
    if [ "$bytes" -gt 0 ]; then
      counter_add "$bytes"
      log "download partial tool=curl status=$status bytes=$bytes total=$(counter_read) url=$url"
      rm -f "$err"
      return 0
    fi
    log "download failed tool=curl url=$url error=$output"
    [ -s "$err" ] && sed 's/^/[curl] /' "$err" >> "$LOG_FILE"
    rm -f "$err"
    return 1
  fi
  rm -f "$err"
  counter_add "$bytes"
  log "download ok bytes=$bytes total=$(counter_read) url=$url"
}

wget_download() {
  local url="$1"
  local remaining="${2:-}"
  local timeout_args=()
  local rate_args=()
  local tries_args=()
  local tmp err pipe_status bytes

  local effective_timeout
  effective_timeout="$(slot_remaining_seconds || true)"
  [ -n "$effective_timeout" ] && timeout_args=(--timeout="$effective_timeout")
  [ -n "$RATE_LIMIT" ] && rate_args=(--limit-rate="$RATE_LIMIT")
  if [ -z "$effective_timeout" ] && [ "${RETRIES:-0}" -gt 0 ] 2>/dev/null; then
    tries_args=(--tries="$((RETRIES + 1))")
  fi

  if [ -n "$remaining" ] && [ "$remaining" -gt 0 ]; then
    tmp="$STATE_DIR/.wget-bytes.$$.$RANDOM"
    err="$STATE_DIR/.wget-error.$$.$RANDOM"
    set +o pipefail
    wget -q -U "$USER_AGENT" "${tries_args[@]}" "${timeout_args[@]}" "${rate_args[@]}" -O - "$url" 2> "$err" \
      | head -c "$remaining" \
      | wc -c > "$tmp"
    pipe_status="${PIPESTATUS[0]}"
    set -o pipefail
    bytes="$(tr -dc '0-9' < "$tmp" 2>/dev/null || printf '0')"
    rm -f "$tmp"
    if [ "$pipe_status" -ne 0 ] && [ "$pipe_status" -ne 141 ]; then
      log "download failed tool=wget url=$url status=$pipe_status"
      [ -s "$err" ] && sed 's/^/[wget] /' "$err" >> "$LOG_FILE"
      rm -f "$err"
      return 1
    fi
    rm -f "$err"
    counter_add "$bytes"
    log "download ok bytes=$bytes total=$(counter_read) url=$url"
    return 0
  fi

  if wget -q -U "$USER_AGENT" "${tries_args[@]}" "${timeout_args[@]}" "${rate_args[@]}" -O /dev/null "$url"; then
    log "download ok bytes=unknown total=$(counter_read) url=$url"
  else
    log "download failed tool=wget url=$url"
    return 1
  fi
}

do_download() {
  local url="$1"
  local remaining=""
  if max_bytes_value >/dev/null 2>&1; then
    remaining="$(remaining_bytes)"
    [ "$remaining" -gt 0 ] || return 2
  fi

  if have curl; then
    curl_download "$url" "$remaining"
  elif have wget; then
    wget_download "$url" "$remaining"
  else
    die "curl or wget is required for downloads"
  fi
}

curl_upload() {
  local url="$1"
  local bytes="$2"
  local timeout_args=()
  local rate_args=()
  local src="/dev/zero"
  local output status sent

  [ "$UPLOAD_RANDOM" = "1" ] && src="/dev/urandom"
  [ "${REQUEST_TIMEOUT:-0}" -gt 0 ] 2>/dev/null && timeout_args=(--max-time "$REQUEST_TIMEOUT")
  [ -n "$RATE_LIMIT" ] && rate_args=(--limit-rate "$RATE_LIMIT")

  output="$(head -c "$bytes" "$src" | curl -L -sS -A "$USER_AGENT" "${timeout_args[@]}" "${rate_args[@]}" -o /dev/null -w '%{http_code} %{size_upload}' -X POST --data-binary @- "$url" 2>&1)"
  status=$?
  sent="$(printf '%s\n' "$output" | awk '{print $NF}')"
  [[ "$sent" =~ ^[0-9]+$ ]] || sent=0
  if [ "$status" -ne 0 ]; then
    if [ "$sent" -gt 0 ]; then
      counter_add "$sent"
    fi
    log "upload failed url=$url error=$output"
    return 1
  fi

  [ "$sent" -gt 0 ] || sent="$bytes"
  counter_add "$sent"
  log "upload ok bytes=$sent total=$(counter_read) url=$url"
}

do_upload() {
  local url="$1"
  local chunk bytes
  have curl || die "curl is required for uploads"
  chunk="$(parse_size "$UPLOAD_CHUNK")" || die "invalid UPLOAD_CHUNK: $UPLOAD_CHUNK"
  bytes="$chunk"

  if max_bytes_value >/dev/null 2>&1; then
    local remaining
    remaining="$(remaining_bytes)"
    [ "$remaining" -gt 0 ] || return 2
    [ "$remaining" -lt "$bytes" ] && bytes="$remaining"
  fi

  [ "$bytes" -gt 0 ] || return 2
  curl_upload "$url" "$bytes"
}

download_worker() {
  local worker="$1"
  local iter=0
  local url result
  while true; do
    limit_reached >/dev/null 2>&1 && break
    if time_reached; then
      break
    fi
    if [ "${SELECT_EVERY_SECONDS:-0}" -gt 0 ] 2>/dev/null; then
      url="$(select_every_url DOWNLOAD_TARGETS)" || break
    else
      url="$(pick_url DOWNLOAD_TARGETS "$worker" "$iter")" || break
    fi
    do_download "$url"
    result=$?
    [ "$result" -eq 2 ] && break
    time_reached && break
    [ "$result" -ne 0 ] && sleep_after_error
    iter=$((iter + 1))
    sleep_between
  done
  log "download worker $worker stopped"
}

upload_worker() {
  local worker="$1"
  local iter=0
  local url result
  while true; do
    limit_reached >/dev/null 2>&1 && break
    if time_reached; then
      break
    fi
    url="$(pick_url UPLOAD_TARGETS "$worker" "$iter")" || break
    do_upload "$url"
    result=$?
    [ "$result" -eq 2 ] && break
    time_reached && break
    [ "$result" -ne 0 ] && sleep_after_error
    iter=$((iter + 1))
    sleep_between
  done
  log "upload worker $worker stopped"
}

stop_children() {
  trap - TERM INT
  log "stopping workers"
  jobs -pr | xargs -r kill 2>/dev/null || true
  wait 2>/dev/null || true
  log "runner stopped total=$(counter_read)"
  exit 0
}

validate_config() {
  [ "$MODE" = "auto" ] || [ "$MODE" = "download" ] || [ "$MODE" = "upload" ] || [ "$MODE" = "both" ] || die "MODE must be auto, download, upload, or both"
  [ "$PRESET" = "none" ] || [ "$PRESET" = "official" ] || [ -z "$PRESET" ] || die "PRESET must be none or official"
  [ "$SCHEDULE" = "round-robin" ] || [ "$SCHEDULE" = "random" ] || die "SCHEDULE must be round-robin or random"
  [[ "$CONCURRENCY" =~ ^[0-9]+$ ]] && [ "$CONCURRENCY" -gt 0 ] || die "CONCURRENCY must be a positive integer"
  [[ "$UPLOAD_CONCURRENCY" =~ ^[0-9]+$ ]] && [ "$UPLOAD_CONCURRENCY" -gt 0 ] || die "UPLOAD_CONCURRENCY must be a positive integer"
  [[ "$INTERVAL" =~ ^[0-9]+$ ]] || die "INTERVAL must be seconds"
  [[ "$JITTER" =~ ^[0-9]+$ ]] || die "JITTER must be seconds"
  [[ "$ERROR_SLEEP" =~ ^[0-9]+$ ]] || die "ERROR_SLEEP must be seconds"
  [[ "$SELECT_EVERY_SECONDS" =~ ^[0-9]+$ ]] || die "SELECT_EVERY_SECONDS must be seconds"
  [ -z "$MAX_BYTES" ] || parse_size "$MAX_BYTES" >/dev/null || die "invalid MAX_BYTES: $MAX_BYTES"
  [ -z "$UPLOAD_CHUNK" ] || parse_size "$UPLOAD_CHUNK" >/dev/null || die "invalid UPLOAD_CHUNK: $UPLOAD_CHUNK"
}

runner() {
  validate_config
  counter_init
  rm -f "$STATE_DIR/select-every.current"
  split_urls "$(build_download_urls_text)" DOWNLOAD_TARGETS
  split_urls "$UPLOAD_URLS" UPLOAD_TARGETS

  local run_download=0
  local run_upload=0
  case "$MODE" in
    auto)
      [ "${#DOWNLOAD_TARGETS[@]}" -gt 0 ] && run_download=1
      [ "${#UPLOAD_TARGETS[@]}" -gt 0 ] && run_upload=1
      ;;
    download) run_download=1 ;;
    upload) run_upload=1 ;;
    both) run_download=1; run_upload=1 ;;
  esac

  [ "$run_download" -eq 0 ] || [ "${#DOWNLOAD_TARGETS[@]}" -gt 0 ] || die "download mode requires URLS"
  [ "$run_upload" -eq 0 ] || [ "${#UPLOAD_TARGETS[@]}" -gt 0 ] || die "upload mode requires UPLOAD_URLS"

  STOP_AT=""
  if [ -n "$MAX_SECONDS" ]; then
    [[ "$MAX_SECONDS" =~ ^[0-9]+$ ]] || die "MAX_SECONDS must be seconds"
    STOP_AT="$(($(date +%s) + MAX_SECONDS))"
  fi

  trap stop_children TERM INT
  log "$APP_NAME $VERSION started mode=$MODE schedule=$SCHEDULE down_workers=$CONCURRENCY up_workers=$UPLOAD_CONCURRENCY max_bytes=${MAX_BYTES:-none} max_seconds=${MAX_SECONDS:-none}"
  log "log=$LOG_FILE pid=$PID_FILE counter=$COUNTER_FILE"

  local i
  if [ "$run_download" -eq 1 ]; then
    for ((i = 0; i < CONCURRENCY; i++)); do
      download_worker "$i" &
    done
  fi
  if [ "$run_upload" -eq 1 ]; then
    for ((i = 0; i < UPLOAD_CONCURRENCY; i++)); do
      upload_worker "$i" &
    done
  fi

  wait
  log "all workers stopped total=$(counter_read)"
}

start_cmd() {
  mkdir -p "$STATE_DIR"
  local pid
  pid="$(current_pid)"
  if is_running "$pid"; then
    die "already running with PID $pid; use ./traffic.sh stop"
  fi

  save_config
  printf '0\n' > "$COUNTER_FILE"
  local script
  script="$(script_path)"
  nohup "$script" run >> "$LOG_FILE" 2>&1 &
  pid="$!"
  printf '%s\n' "$pid" > "$PID_FILE"
  printf 'started %s pid=%s\nlog=%s\npid_file=%s\n' "$APP_NAME" "$pid" "$LOG_FILE" "$PID_FILE"
}

random_minute_cmd() {
  mkdir -p "$STATE_DIR"
  local pid slots slot
  pid="$(current_pid)"
  if is_running "$pid"; then
    die "already running with PID $pid; use ./traffic.sh stop"
  fi

  [[ "$RANDOM_WINDOW_SECONDS" =~ ^[0-9]+$ ]] && [ "$RANDOM_WINDOW_SECONDS" -gt 0 ] || die "RANDOM_WINDOW_SECONDS must be positive seconds"
  [[ "$RANDOM_RUN_SECONDS" =~ ^[0-9]+$ ]] && [ "$RANDOM_RUN_SECONDS" -gt 0 ] || die "RANDOM_RUN_SECONDS must be positive seconds"

  if [ -z "$URLS" ] && [ -z "$URLS_FILE" ] && { [ -z "$PRESET" ] || [ "$PRESET" = "none" ]; }; then
    PRESET="official"
  fi

  slots=$((RANDOM_WINDOW_SECONDS / RANDOM_RUN_SECONDS))
  [ "$slots" -gt 0 ] || slots=1
  slot=$((RANDOM % slots))
  RANDOM_START_DELAY=$((slot * RANDOM_RUN_SECONDS))

  save_config
  printf '0\n' > "$COUNTER_FILE"
  local script
  script="$(script_path)"
  nohup "$script" random-run >> "$LOG_FILE" 2>&1 &
  pid="$!"
  printf '%s\n' "$pid" > "$PID_FILE"
  printf 'scheduled random-minute pid=%s delay=%ss run=%ss\nlog=%s\npid_file=%s\n' "$pid" "$RANDOM_START_DELAY" "$RANDOM_RUN_SECONDS" "$LOG_FILE" "$PID_FILE"
}

random_window_runner() {
  local delay="${RANDOM_START_DELAY:-0}"
  local selected count index

  trap 'log "random-minute stopped before run"; exit 0' TERM INT
  log "random-minute scheduled delay=${delay}s run=${RANDOM_RUN_SECONDS}s preset=${PRESET:-none} urls_file=${URLS_FILE:-none}"
  [ "$delay" -gt 0 ] && sleep "$delay"

  validate_config
  split_urls "$(build_download_urls_text)" RANDOM_TARGETS
  eval "count=\${#RANDOM_TARGETS[@]}"
  [ "$count" -gt 0 ] || die "random-minute requires at least one download URL"
  index=$((RANDOM % count))
  eval "selected=\"\${RANDOM_TARGETS[$index]}\""

  log "random-minute selected url=$selected"
  URLS="$selected"
  URLS_FILE=""
  PRESET="none"
  UPLOAD_URLS=""
  MODE="download"
  SCHEDULE="round-robin"
  CONCURRENCY=1
  UPLOAD_CONCURRENCY=1
  MAX_SECONDS="$RANDOM_RUN_SECONDS"
  SELECT_EVERY_SECONDS=0
  INTERVAL=0
  JITTER=0
  if [ -z "$REQUEST_TIMEOUT" ] || [ "$REQUEST_TIMEOUT" = "0" ] || [ "$REQUEST_TIMEOUT" -gt "$RANDOM_RUN_SECONDS" ] 2>/dev/null; then
    REQUEST_TIMEOUT="$RANDOM_RUN_SECONDS"
  fi

  trap stop_children TERM INT
  runner
}

stop_cmd() {
  local pid
  pid="$(current_pid)"
  if ! is_running "$pid"; then
    rm -f "$PID_FILE"
    printf 'not running\n'
    return 0
  fi

  kill "$pid" 2>/dev/null || true
  local i
  for i in {1..20}; do
    if ! is_running "$pid"; then
      rm -f "$PID_FILE"
      printf 'stopped pid=%s\n' "$pid"
      return 0
    fi
    sleep 0.2
  done

  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  printf 'force stopped pid=%s\n' "$pid"
}

status_cmd() {
  local pid total
  pid="$(current_pid)"
  total="$(counter_read)"
  if is_running "$pid"; then
    printf 'running pid=%s total=%s (%s)\nlog=%s\npid_file=%s\n' "$pid" "$total" "$(human_bytes "$total")" "$LOG_FILE" "$PID_FILE"
  else
    printf 'stopped total=%s (%s)\nlog=%s\npid_file=%s\n' "$total" "$(human_bytes "$total")" "$LOG_FILE" "$PID_FILE"
  fi
}

tail_cmd() {
  mkdir -p "$STATE_DIR"
  touch "$LOG_FILE"
  tail -f "$LOG_FILE"
}

links_cmd() {
  builtin_official_urls
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --urls) URLS="${2:-}"; shift 2 ;;
      --urls-file) URLS_FILE="${2:-}"; shift 2 ;;
      --preset) PRESET="${2:-}"; shift 2 ;;
      --upload-urls) UPLOAD_URLS="${2:-}"; shift 2 ;;
      --mode) MODE="${2:-}"; shift 2 ;;
      --schedule) SCHEDULE="${2:-}"; shift 2 ;;
      --concurrency) CONCURRENCY="${2:-}"; shift 2 ;;
      --upload-concurrency) UPLOAD_CONCURRENCY="${2:-}"; shift 2 ;;
      --interval) INTERVAL="${2:-}"; shift 2 ;;
      --jitter) JITTER="${2:-}"; shift 2 ;;
      --max-bytes) MAX_BYTES="${2:-}"; shift 2 ;;
      --max-seconds) MAX_SECONDS="${2:-}"; shift 2 ;;
      --select-every) SELECT_EVERY_SECONDS="${2:-}"; shift 2 ;;
      --window-seconds) RANDOM_WINDOW_SECONDS="${2:-}"; shift 2 ;;
      --run-seconds) RANDOM_RUN_SECONDS="${2:-}"; shift 2 ;;
      --rate-limit) RATE_LIMIT="${2:-}"; shift 2 ;;
      --timeout) REQUEST_TIMEOUT="${2:-}"; shift 2 ;;
      --upload-chunk) UPLOAD_CHUNK="${2:-}"; shift 2 ;;
      --upload-random) UPLOAD_RANDOM="${2:-}"; shift 2 ;;
      --error-sleep) ERROR_SLEEP="${2:-}"; shift 2 ;;
      --log) LOG_FILE="${2:-}"; LOG_FILE_ARG=1; shift 2 ;;
      --pid) PID_FILE="${2:-}"; PID_FILE_ARG=1; shift 2 ;;
      --config-file) CONFIG_FILE="${2:-}"; CONFIG_FILE_ARG=1; shift 2 ;;
      --counter-file) COUNTER_FILE="${2:-}"; COUNTER_FILE_ARG=1; shift 2 ;;
      --lock-dir) LOCK_DIR="${2:-}"; LOCK_DIR_ARG=1; shift 2 ;;
      --state-dir) STATE_DIR="${2:-}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      --version) printf '%s\n' "$VERSION"; exit 0 ;;
      *) die "unknown option: $1" ;;
    esac
  done

  if [ -z "$PID_FILE_ENV" ] && [ "$PID_FILE_ARG" -eq 0 ]; then PID_FILE="$STATE_DIR/traffic.pid"; fi
  if [ -z "$LOG_FILE_ENV" ] && [ "$LOG_FILE_ARG" -eq 0 ]; then LOG_FILE="$STATE_DIR/traffic.log"; fi
  if [ -z "$CONFIG_FILE_ENV" ] && [ "$CONFIG_FILE_ARG" -eq 0 ]; then CONFIG_FILE="$STATE_DIR/config.env"; fi
  if [ -z "$COUNTER_FILE_ENV" ] && [ "$COUNTER_FILE_ARG" -eq 0 ]; then COUNTER_FILE="$STATE_DIR/bytes.count"; fi
  if [ -z "$LOCK_DIR_ENV" ] && [ "$LOCK_DIR_ARG" -eq 0 ]; then LOCK_DIR="$STATE_DIR/lock"; fi
}

main() {
  local cmd="${1:-help}"
  [ "$#" -gt 0 ] && shift || true
  parse_args "$@"

  case "$cmd" in
    start) start_cmd ;;
    random-minute) random_minute_cmd ;;
    stop) stop_cmd ;;
    status) status_cmd ;;
    tail) tail_cmd ;;
    links) links_cmd ;;
    run) load_config; runner ;;
    random-run) load_config; random_window_runner ;;
    once) runner ;;
    help|-h|--help) usage ;;
    version|--version) printf '%s\n' "$VERSION" ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
