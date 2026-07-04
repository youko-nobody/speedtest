export type ScheduleMode = "round-robin" | "random";
export type TargetMode = "download" | "upload" | "both";

export interface TargetConfig {
  name?: string;
  url: string;
  mode?: TargetMode;
  weight?: number;
  token?: string;
  downloadPath?: string;
  uploadPath?: string;
  probePath?: string;
  downloadOnly?: boolean;
  headers?: Record<string, string>;
}

export interface ClientConfig {
  schedule?: ScheduleMode;
  concurrency?: number;
  intervalMs?: number;
  jitterMs?: number;
  requestTimeoutMs?: number;
  maxBytes?: string | number;
  maxDownloadBytes?: string | number;
  maxUploadBytes?: string | number;
  maxDuration?: string | number;
  rateLimit?: string | number;
  uploadChunkBytes?: string | number;
  uploadRequestBytes?: string | number;
  logEveryMs?: number;
  targets: TargetConfig[];
}

export interface ServerConfig {
  host?: string;
  port?: number;
  token?: string;
  chunkBytes?: string | number;
  maxUploadBytes?: string | number;
  readTimeoutMs?: number;
}

export interface NormalizedTarget {
  name: string;
  baseUrl: URL;
  mode: TargetMode;
  weight: number;
  token?: string;
  downloadUrl: URL;
  uploadUrl?: URL;
  probeUrl?: URL;
  headers: Record<string, string>;
  downloadOnly: boolean;
  selfHosted: boolean;
}

export interface NormalizedClientConfig {
  schedule: ScheduleMode;
  concurrency: number;
  intervalMs: number;
  jitterMs: number;
  requestTimeoutMs: number;
  maxBytes?: number;
  maxDownloadBytes?: number;
  maxUploadBytes?: number;
  maxDurationMs?: number;
  rateLimitBytesPerSec?: number;
  uploadChunkBytes: number;
  uploadRequestBytes: number;
  logEveryMs: number;
  targets: NormalizedTarget[];
}

export interface NormalizedServerConfig {
  host: string;
  port: number;
  token?: string;
  chunkBytes: number;
  maxUploadBytes: number;
  readTimeoutMs: number;
}

export interface TrafficStats {
  startedAt: number;
  finishedAt?: number;
  downloadedBytes: number;
  uploadedBytes: number;
  downloadRequests: number;
  uploadRequests: number;
  failedRequests: number;
  skippedRequests: number;
  activeRequests: number;
  lastError?: string;
}
