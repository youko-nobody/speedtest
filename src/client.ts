import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { NormalizedClientConfig, NormalizedTarget, TrafficStats } from "./types.js";
import { TargetScheduler } from "./scheduler.js";
import { RateLimiter } from "./utils/rate_limiter.js";
import { formatBytes, formatRate, sleep } from "./utils/units.js";

const CLIENT_NAME = "vps-traffic-burner";

export class TrafficClient {
  readonly stats: TrafficStats = {
    startedAt: Date.now(),
    downloadedBytes: 0,
    uploadedBytes: 0,
    downloadRequests: 0,
    uploadRequests: 0,
    failedRequests: 0,
    skippedRequests: 0,
    activeRequests: 0
  };

  private readonly scheduler: TargetScheduler;
  private readonly limiter: RateLimiter;
  private readonly abortController = new AbortController();
  private stopReason = "";

  constructor(private readonly config: NormalizedClientConfig) {
    this.scheduler = new TargetScheduler(config.targets, config.schedule);
    this.limiter = new RateLimiter(config.rateLimitBytesPerSec);
  }

  async run(): Promise<TrafficStats> {
    await this.probeTargets();
    const logger = this.startLogger();
    const timer = this.config.maxDurationMs
      ? setTimeout(() => this.stop(`duration reached: ${this.config.maxDurationMs}ms`), this.config.maxDurationMs)
      : undefined;

    process.once("SIGINT", () => this.stop("SIGINT"));
    process.once("SIGTERM", () => this.stop("SIGTERM"));

    const workers = Array.from({ length: this.config.concurrency }, (_, index) => this.worker(index + 1));
    await Promise.all(workers);
    if (timer) clearTimeout(timer);
    clearInterval(logger);
    this.stats.finishedAt = Date.now();
    this.printSummary();
    return this.stats;
  }

  stop(reason: string): void {
    if (this.stopReason) return;
    this.stopReason = reason;
    this.abortController.abort();
  }

  private async worker(workerId: number): Promise<void> {
    while (!this.shouldStop()) {
      const target = this.scheduler.next();
      const direction = this.pickDirection(target);
      if (!direction) {
        this.stats.skippedRequests += 1;
        await this.waitBetweenRequests();
        continue;
      }

      try {
        this.stats.activeRequests += 1;
        if (direction === "download") {
          await this.download(target, workerId);
        } else {
          await this.upload(target, workerId);
        }
      } catch (error) {
        if (!this.shouldStop()) {
          this.stats.failedRequests += 1;
          this.stats.lastError = error instanceof Error ? error.message : String(error);
          console.error(`[worker ${workerId}] ${target.name}: ${this.stats.lastError}`);
        }
      } finally {
        this.stats.activeRequests -= 1;
      }

      await this.waitBetweenRequests();
    }
  }

  private async probeTargets(): Promise<void> {
    const selfHosted = this.config.targets.filter((target) => target.selfHosted && target.probeUrl);
    for (const target of selfHosted) {
      const response = await fetch(target.probeUrl!, {
        headers: this.headersFor(target),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs)
      });
      if (!response.ok) {
        throw new Error(`Probe failed for ${target.name}: HTTP ${response.status}`);
      }
      const body = (await response.json()) as { server?: string };
      if (body.server !== CLIENT_NAME) {
        throw new Error(`Probe rejected for ${target.name}: not a ${CLIENT_NAME} server`);
      }
    }
  }

  private pickDirection(target: NormalizedTarget): "download" | "upload" | undefined {
    const canDownload = (target.mode === "download" || target.mode === "both") && !this.downloadLimitReached();
    const canUpload = (target.mode === "upload" || target.mode === "both") && Boolean(target.uploadUrl) && !this.uploadLimitReached();

    if (target.mode === "download") return canDownload ? "download" : undefined;
    if (target.mode === "upload") return canUpload ? "upload" : undefined;
    if (canDownload && canUpload) return Math.random() < 0.5 ? "download" : "upload";
    if (canDownload) return "download";
    if (canUpload) return "upload";
    return undefined;
  }

  private async download(target: NormalizedTarget, workerId: number): Promise<void> {
    const remaining = this.remainingDownloadBytes();
    const url = new URL(target.downloadUrl.toString());
    if (target.selfHosted && remaining !== undefined) {
      url.searchParams.set("bytes", String(Math.max(0, remaining)));
    }

    const response = await fetch(url, {
      headers: this.headersFor(target),
      signal: AbortSignal.any([this.abortController.signal, AbortSignal.timeout(this.config.requestTimeoutMs)])
    });

    if (!response.ok || !response.body) {
      throw new Error(`download HTTP ${response.status}`);
    }

    this.stats.downloadRequests += 1;
    const reader = response.body.getReader();
    let cancelBody = false;
    while (!this.shouldStop()) {
      const { done, value } = await reader.read();
      if (done) break;
      const allowed = this.acceptDownloadBytes(value.byteLength);
      if (allowed <= 0) {
        this.stop("download limit reached");
        cancelBody = true;
        break;
      }
      await this.limiter.take(allowed);
      this.stats.downloadedBytes += allowed;
      if (allowed < value.byteLength) {
        this.stop("download limit reached");
        cancelBody = true;
        break;
      }
    }
    if (cancelBody) {
      await reader.cancel("download limit reached");
    } else {
      reader.releaseLock();
    }

    if (workerId === 1 && this.downloadLimitReached()) {
      this.stop("download limit reached");
    }
  }

  private async upload(target: NormalizedTarget, workerId: number): Promise<void> {
    if (!target.uploadUrl) return;
    const requestBytes = Math.min(this.config.uploadRequestBytes, this.remainingUploadBytes() ?? this.config.uploadRequestBytes);
    if (requestBytes <= 0) {
      this.stop("upload limit reached");
      return;
    }

    const body = this.createUploadStream(requestBytes);
    const response = await fetch(target.uploadUrl, {
      method: "POST",
      headers: {
        ...this.headersFor(target),
        "content-type": "application/octet-stream",
        "content-length": String(requestBytes)
      },
      body,
      duplex: "half",
      signal: AbortSignal.any([this.abortController.signal, AbortSignal.timeout(this.config.requestTimeoutMs)])
    } as RequestInit & { duplex: "half" });

    if (!response.ok) {
      throw new Error(`upload HTTP ${response.status}`);
    }
    this.stats.uploadRequests += 1;
    if (workerId === 1 && this.uploadLimitReached()) {
      this.stop("upload limit reached");
    }
  }

  private createUploadStream(totalBytes: number): Readable {
    let sent = 0;
    const client = this;
    return new Readable({
      read(this: Readable) {
        void (async () => {
          if (client.shouldStop() || sent >= totalBytes) {
            this.push(null);
            return;
          }
          const remainingLimit = client.remainingUploadBytes();
          const remainingRequest = totalBytes - sent;
          const nextSize = Math.min(client.config.uploadChunkBytes, remainingRequest, remainingLimit ?? remainingRequest);
          if (nextSize <= 0) {
            client.stop("upload limit reached");
            this.push(null);
            return;
          }
          await client.limiter.take(nextSize);
          client.stats.uploadedBytes += nextSize;
          sent += nextSize;
          this.push(randomBytes(nextSize));
        })().catch((error) => this.destroy(error instanceof Error ? error : new Error(String(error))));
      }
    });
  }

  private headersFor(target: NormalizedTarget): Record<string, string> {
    return {
      "user-agent": `${CLIENT_NAME}/1.0`,
      ...target.headers,
      ...(target.token ? { authorization: `Bearer ${target.token}`, "x-traffic-token": target.token } : {})
    };
  }

  private async waitBetweenRequests(): Promise<void> {
    const jitter = this.config.jitterMs > 0 ? Math.floor(Math.random() * this.config.jitterMs) : 0;
    const waitMs = this.config.intervalMs + jitter;
    if (waitMs > 0 && !this.shouldStop()) {
      await sleep(waitMs);
    }
  }

  private startLogger(): NodeJS.Timeout {
    this.printStatus();
    return setInterval(() => this.printStatus(), this.config.logEveryMs);
  }

  private printStatus(): void {
    const elapsedSec = Math.max(1, (Date.now() - this.stats.startedAt) / 1000);
    const total = this.stats.downloadedBytes + this.stats.uploadedBytes;
    console.log(
      [
        new Date().toISOString(),
        `down=${formatBytes(this.stats.downloadedBytes)}`,
        `up=${formatBytes(this.stats.uploadedBytes)}`,
        `total=${formatBytes(total)}`,
        `avg=${formatRate(total / elapsedSec)}`,
        `active=${this.stats.activeRequests}`,
        `ok=${this.stats.downloadRequests + this.stats.uploadRequests}`,
        `fail=${this.stats.failedRequests}`
      ].join(" ")
    );
  }

  private printSummary(): void {
    const elapsedMs = (this.stats.finishedAt ?? Date.now()) - this.stats.startedAt;
    const total = this.stats.downloadedBytes + this.stats.uploadedBytes;
    console.log("");
    console.log(`finished: ${this.stopReason || "all limits reached"}`);
    console.log(`elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
    console.log(`downloaded: ${formatBytes(this.stats.downloadedBytes)}`);
    console.log(`uploaded: ${formatBytes(this.stats.uploadedBytes)}`);
    console.log(`total: ${formatBytes(total)}`);
    console.log(`average: ${formatRate(total / Math.max(1, elapsedMs / 1000))}`);
    if (this.stats.lastError) console.log(`last error: ${this.stats.lastError}`);
  }

  private shouldStop(): boolean {
    if (this.abortController.signal.aborted) return true;
    if (this.totalLimitReached() || (this.downloadLimitReached() && this.uploadLimitReached())) {
      this.stop("traffic limit reached");
      return true;
    }
    return false;
  }

  private totalLimitReached(): boolean {
    return this.config.maxBytes !== undefined && this.stats.downloadedBytes + this.stats.uploadedBytes >= this.config.maxBytes;
  }

  private downloadLimitReached(): boolean {
    if (this.config.maxDownloadBytes === undefined && this.config.maxBytes === undefined) return false;
    return (this.remainingDownloadBytes() ?? 1) <= 0;
  }

  private uploadLimitReached(): boolean {
    if (this.config.maxUploadBytes === undefined && this.config.maxBytes === undefined) return false;
    return (this.remainingUploadBytes() ?? 1) <= 0;
  }

  private remainingDownloadBytes(): number | undefined {
    const limits = [
      this.config.maxDownloadBytes === undefined ? undefined : this.config.maxDownloadBytes - this.stats.downloadedBytes,
      this.config.maxBytes === undefined
        ? undefined
        : this.config.maxBytes - this.stats.downloadedBytes - this.stats.uploadedBytes
    ].filter((value): value is number => value !== undefined);
    if (limits.length === 0) return undefined;
    return Math.max(0, Math.min(...limits));
  }

  private remainingUploadBytes(): number | undefined {
    const limits = [
      this.config.maxUploadBytes === undefined ? undefined : this.config.maxUploadBytes - this.stats.uploadedBytes,
      this.config.maxBytes === undefined
        ? undefined
        : this.config.maxBytes - this.stats.downloadedBytes - this.stats.uploadedBytes
    ].filter((value): value is number => value !== undefined);
    if (limits.length === 0) return undefined;
    return Math.max(0, Math.min(...limits));
  }

  private acceptDownloadBytes(size: number): number {
    const remaining = this.remainingDownloadBytes();
    if (remaining === undefined) return size;
    return Math.max(0, Math.min(size, remaining));
  }
}

export async function runClient(config: NormalizedClientConfig): Promise<TrafficStats> {
  return new TrafficClient(config).run();
}
