import assert from "node:assert/strict";
import test from "node:test";
import { formatBytes, parseBytes, parseDurationMs, parseRate } from "../src/utils/units.js";

test("parseBytes supports common binary units", () => {
  assert.equal(parseBytes("1kb"), 1024);
  assert.equal(parseBytes("1.5mb"), 1.5 * 1024 * 1024);
  assert.equal(parseBytes("2gb"), 2 * 1024 ** 3);
});

test("parseRate supports bytes per second units", () => {
  assert.equal(parseRate("10mb/s"), 10 * 1024 ** 2);
  assert.equal(parseRate("2gbps"), 2 * 1024 ** 3);
});

test("parseDurationMs supports compact durations", () => {
  assert.equal(parseDurationMs("30s"), 30_000);
  assert.equal(parseDurationMs("2h"), 7_200_000);
});

test("formatBytes is stable for common sizes", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1024), "1.00 KiB");
  assert.equal(formatBytes(1024 ** 3), "1.00 GiB");
});
