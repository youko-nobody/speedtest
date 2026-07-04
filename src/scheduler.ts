import type { NormalizedTarget, ScheduleMode } from "./types.js";

export class TargetScheduler {
  private readonly weightedTargets: NormalizedTarget[];
  private cursor = 0;

  constructor(
    private readonly targets: NormalizedTarget[],
    private readonly mode: ScheduleMode
  ) {
    this.weightedTargets = targets.flatMap((target) => Array.from({ length: target.weight }, () => target));
  }

  next(): NormalizedTarget {
    if (this.weightedTargets.length === 0) {
      throw new Error("No targets available");
    }

    if (this.mode === "random") {
      return this.weightedTargets[Math.floor(Math.random() * this.weightedTargets.length)]!;
    }

    const target = this.weightedTargets[this.cursor % this.weightedTargets.length]!;
    this.cursor += 1;
    return target;
  }

  list(): NormalizedTarget[] {
    return this.targets;
  }
}
