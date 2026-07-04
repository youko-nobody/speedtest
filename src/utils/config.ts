import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type {
  ClientConfig,
  NormalizedClientConfig,
  NormalizedServerConfig,
  NormalizedTarget,
  ServerConfig,
  TargetMode
} from "../types.js";
import { parseBytes, parseDurationMs, parseRate } from "./units.js";

const DEFAULT_DOWNLOAD_PATH = "/download";
const DEFAULT_UPLOAD_PATH = "/upload";
const DEFAULT_PROBE_PATH = "/probe";

export function loadConfigFile<T>(filePath: string): T {
  const fullPath = path.resolve(filePath);
  const raw = fs.readFileSync(fullPath, "utf8");
  if (fullPath.endsWith(".json")) {
    return JSON.parse(raw) as T;
  }
  return YAML.parse(raw) as T;
}

export function normalizeClientConfig(config: ClientConfig): NormalizedClientConfig {
  if (!config || !Array.isArray(config.targets) || config.targets.length === 0) {
    throw new Error("Client config must include at least one target");
  }

  const schedule = config.schedule ?? "round-robin";
  if (schedule !== "round-robin" && schedule !== "random") {
    throw new Error("schedule must be round-robin or random");
  }

  const targets = config.targets.map((target, index) => normalizeTarget(target, index));
  const concurrency = positiveInt(config.concurrency ?? 1, "concurrency");
  const uploadChunkBytes = parseBytes(config.uploadChunkBytes ?? "64kb", "uploadChunkBytes") ?? 64 * 1024;
  const uploadRequestBytes = parseBytes(config.uploadRequestBytes ?? "256mb", "uploadRequestBytes") ?? 256 * 1024 ** 2;

  const normalized: NormalizedClientConfig = {
    schedule,
    concurrency,
    intervalMs: nonNegativeInt(config.intervalMs ?? 0, "intervalMs"),
    jitterMs: nonNegativeInt(config.jitterMs ?? 0, "jitterMs"),
    requestTimeoutMs: positiveInt(config.requestTimeoutMs ?? 120_000, "requestTimeoutMs"),
    maxBytes: parseBytes(config.maxBytes, "maxBytes"),
    maxDownloadBytes: parseBytes(config.maxDownloadBytes, "maxDownloadBytes"),
    maxUploadBytes: parseBytes(config.maxUploadBytes, "maxUploadBytes"),
    maxDurationMs: parseDurationMs(config.maxDuration, "maxDuration"),
    rateLimitBytesPerSec: parseRate(config.rateLimit, "rateLimit"),
    uploadChunkBytes,
    uploadRequestBytes,
    logEveryMs: positiveInt(config.logEveryMs ?? 5000, "logEveryMs"),
    targets
  };
  validatePublicTargetsHaveLimits(normalized);
  return normalized;
}

export function normalizeServerConfig(config: ServerConfig = {}): NormalizedServerConfig {
  return {
    host: config.host ?? "0.0.0.0",
    port: config.port === 0 ? 0 : positiveInt(config.port ?? 8080, "port"),
    token: config.token,
    chunkBytes: parseBytes(config.chunkBytes ?? "1mb", "chunkBytes") ?? 1024 ** 2,
    maxUploadBytes: parseBytes(config.maxUploadBytes ?? "20gb", "maxUploadBytes") ?? 20 * 1024 ** 3,
    readTimeoutMs: positiveInt(config.readTimeoutMs ?? 120_000, "readTimeoutMs")
  };
}

function normalizeTarget(target: ClientConfig["targets"][number], index: number): NormalizedTarget {
  if (!target?.url) {
    throw new Error(`target[${index}].url is required`);
  }

  const baseUrl = new URL(target.url);
  const token = target.token;
  const headers = target.headers ?? {};
  const downloadOnly = Boolean(target.downloadOnly);
  const selfHosted = !downloadOnly && Boolean(token || target.uploadPath || target.downloadPath || target.probePath);
  const defaultMode: TargetMode = downloadOnly ? "download" : selfHosted ? "both" : "download";
  const mode = target.mode ?? defaultMode;
  if (!["download", "upload", "both"].includes(mode)) {
    throw new Error(`target[${index}].mode must be download, upload, or both`);
  }
  if ((mode === "upload" || mode === "both") && downloadOnly) {
    throw new Error(`target[${index}] is downloadOnly but mode requests upload`);
  }

  const name = target.name ?? baseUrl.host;
  const downloadPath = target.downloadPath ?? (selfHosted ? DEFAULT_DOWNLOAD_PATH : "");
  const uploadPath = target.uploadPath ?? (selfHosted ? DEFAULT_UPLOAD_PATH : undefined);
  const probePath = target.probePath ?? (selfHosted ? DEFAULT_PROBE_PATH : undefined);

  return {
    name,
    baseUrl,
    mode,
    weight: positiveInt(target.weight ?? 1, `target[${index}].weight`),
    token,
    downloadUrl: resolveUrl(baseUrl, downloadPath),
    uploadUrl: uploadPath ? resolveUrl(baseUrl, uploadPath) : undefined,
    probeUrl: probePath ? resolveUrl(baseUrl, probePath) : undefined,
    headers,
    downloadOnly,
    selfHosted
  };
}

function resolveUrl(baseUrl: URL, suffix: string): URL {
  if (!suffix) return new URL(baseUrl.toString());
  if (/^https?:\/\//i.test(suffix)) return new URL(suffix);
  if (baseUrl.pathname !== "/" && baseUrl.pathname !== "") {
    return new URL(suffix.replace(/^\//, ""), ensureTrailingSlash(baseUrl));
  }
  return new URL(suffix, baseUrl);
}

function ensureTrailingSlash(url: URL): URL {
  const copy = new URL(url.toString());
  if (!copy.pathname.endsWith("/")) copy.pathname += "/";
  return copy;
}

function positiveInt(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function nonNegativeInt(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function validatePublicTargetsHaveLimits(config: NormalizedClientConfig): void {
  const hasPublicDownloadTarget = config.targets.some((target) => target.downloadOnly);
  if (!hasPublicDownloadTarget) return;
  if (config.maxBytes !== undefined || config.maxDownloadBytes !== undefined || config.maxDurationMs !== undefined) return;

  throw new Error(
    "downloadOnly public targets require maxBytes, maxDownloadBytes, or maxDuration to avoid unbounded automated downloads"
  );
}
