import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createTrafficServer } from "../src/server.js";
import { normalizeServerConfig } from "../src/utils/config.js";

test("server probe and upload/download endpoints work", async (t) => {
  const server = createTrafficServer(
    normalizeServerConfig({
      host: "127.0.0.1",
      port: 0,
      token: "secret",
      chunkBytes: "1kb",
      maxUploadBytes: "1mb"
    })
  );

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${(address as AddressInfo).port}`;

  const probe = await fetch(`${base}/probe`, { headers: { authorization: "Bearer secret" } });
  assert.equal(probe.status, 200);
  const probeBody = (await probe.json()) as { server: string };
  assert.equal(probeBody.server, "vps-traffic-burner");

  const download = await fetch(`${base}/download?bytes=4096`, { headers: { authorization: "Bearer secret" } });
  assert.equal(download.status, 200);
  assert.equal((await download.arrayBuffer()).byteLength, 4096);

  const upload = await fetch(`${base}/upload`, {
    method: "POST",
    headers: { authorization: "Bearer secret" },
    body: Buffer.alloc(2048)
  });
  assert.equal(upload.status, 200);
  const uploadBody = (await upload.json()) as { received: number };
  assert.equal(uploadBody.received, 2048);
});
