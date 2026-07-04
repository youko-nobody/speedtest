import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClientConfig, normalizeServerConfig } from "../src/utils/config.js";

test("normalizes public download-only target", () => {
  const config = normalizeClientConfig({
    maxBytes: "1gb",
    targets: [{ url: "https://example.com/1GB.bin", downloadOnly: true }]
  });
  assert.equal(config.targets[0]!.mode, "download");
  assert.equal(config.targets[0]!.downloadUrl.toString(), "https://example.com/1GB.bin");
  assert.equal(config.targets[0]!.uploadUrl, undefined);
  assert.equal(config.targets[0]!.selfHosted, false);
});

test("normalizes self-hosted target endpoints", () => {
  const config = normalizeClientConfig({
    targets: [{ url: "http://127.0.0.1:8080", token: "secret" }]
  });
  const target = config.targets[0]!;
  assert.equal(target.mode, "both");
  assert.equal(target.downloadUrl.toString(), "http://127.0.0.1:8080/download");
  assert.equal(target.uploadUrl?.toString(), "http://127.0.0.1:8080/upload");
  assert.equal(target.probeUrl?.toString(), "http://127.0.0.1:8080/probe");
  assert.equal(target.selfHosted, true);
});

test("rejects upload mode for download-only target", () => {
  assert.throws(
    () => normalizeClientConfig({ targets: [{ url: "https://example.com/file", downloadOnly: true, mode: "both" }] }),
    /downloadOnly/
  );
});

test("rejects public download-only target without a limit", () => {
  assert.throws(
    () => normalizeClientConfig({ targets: [{ url: "https://example.com/file", downloadOnly: true }] }),
    /require maxBytes/
  );
});

test("normalizes server defaults", () => {
  const config = normalizeServerConfig({});
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8080);
  assert.equal(config.chunkBytes, 1024 ** 2);
});
