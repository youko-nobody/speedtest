import assert from "node:assert/strict";
import test from "node:test";
import { TargetScheduler } from "../src/scheduler.js";
import { normalizeClientConfig } from "../src/utils/config.js";

test("round-robin scheduler respects weights", () => {
  const config = normalizeClientConfig({
    schedule: "round-robin",
    maxDuration: "1m",
    targets: [
      { name: "a", url: "https://a.example/file", downloadOnly: true, weight: 2 },
      { name: "b", url: "https://b.example/file", downloadOnly: true, weight: 1 }
    ]
  });
  const scheduler = new TargetScheduler(config.targets, config.schedule);
  assert.deepEqual(
    [scheduler.next().name, scheduler.next().name, scheduler.next().name, scheduler.next().name],
    ["a", "a", "b", "a"]
  );
});
