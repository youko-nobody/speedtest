import { sleep } from "./units.js";

export class RateLimiter {
  private available: number;
  private updatedAt: number;

  constructor(private readonly bytesPerSec?: number) {
    this.available = bytesPerSec ?? Number.POSITIVE_INFINITY;
    this.updatedAt = Date.now();
  }

  get enabled(): boolean {
    return Boolean(this.bytesPerSec && this.bytesPerSec > 0);
  }

  async take(bytes: number): Promise<void> {
    if (!this.enabled || bytes <= 0) return;
    const rate = this.bytesPerSec!;
    let remaining = bytes;

    while (remaining > 0) {
      this.refill(rate);
      const granted = Math.min(this.available, remaining);
      if (granted > 0) {
        this.available -= granted;
        remaining -= granted;
      }
      if (remaining <= 0) {
        break;
      }

      const missing = Math.min(remaining, rate) - this.available;
      const waitMs = Math.max(1, Math.ceil((missing / rate) * 1000));
      await sleep(Math.min(waitMs, 1000));
    }
  }

  private refill(rate: number): void {
    const now = Date.now();
    const elapsed = now - this.updatedAt;
    if (elapsed <= 0) return;
    this.updatedAt = now;
    this.available = Math.min(rate, this.available + (elapsed / 1000) * rate);
  }
}
