const BYTE_UNITS: Record<string, number> = {
  b: 1,
  byte: 1,
  bytes: 1,
  k: 1024,
  kb: 1024,
  kib: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
  tib: 1024 ** 4
};

const RATE_UNITS: Record<string, number> = {
  bps: 1,
  "b/s": 1,
  byteps: 1,
  bytesps: 1,
  "byte/s": 1,
  "bytes/s": 1,
  kbps: 1024,
  "kb/s": 1024,
  kbs: 1024,
  mbps: 1024 ** 2,
  "mb/s": 1024 ** 2,
  mbs: 1024 ** 2,
  gbps: 1024 ** 3,
  "gb/s": 1024 ** 3,
  gbs: 1024 ** 3
};

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1000,
  sec: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000
};

function parseNumberWithUnit(input: string | number | undefined, units: Record<string, number>, label: string): number | undefined {
  if (input === undefined || input === null || input === "") {
    return undefined;
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) throw new Error(`${label} must be a non-negative finite number`);
    return Math.floor(input);
  }

  const text = String(input).trim().toLowerCase().replace(/\s+/g, "");
  const match = text.match(/^(\d+(?:\.\d+)?)([a-z/]+)?$/);
  if (!match) {
    throw new Error(`Invalid ${label}: ${input}`);
  }
  const value = Number(match[1]);
  const unit = match[2] ?? Object.keys(units)[0];
  const multiplier = units[unit];
  if (!Number.isFinite(value) || value < 0 || multiplier === undefined) {
    throw new Error(`Invalid ${label}: ${input}`);
  }
  return Math.floor(value * multiplier);
}

export function parseBytes(input: string | number | undefined, label = "bytes"): number | undefined {
  return parseNumberWithUnit(input, BYTE_UNITS, label);
}

export function parseRate(input: string | number | undefined, label = "rate"): number | undefined {
  return parseNumberWithUnit(input, RATE_UNITS, label);
}

export function parseDurationMs(input: string | number | undefined, label = "duration"): number | undefined {
  return parseNumberWithUnit(input, DURATION_UNITS, label);
}

export function formatBytes(bytes: number): string {
  const abs = Math.abs(bytes);
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = abs;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const sign = bytes < 0 ? "-" : "";
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${sign}${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
