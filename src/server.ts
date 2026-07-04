import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { NormalizedServerConfig } from "./types.js";
import { formatBytes } from "./utils/units.js";

const SERVER_NAME = "vps-traffic-burner";

export function createTrafficServer(config: NormalizedServerConfig): http.Server {
  return http.createServer(async (req, res) => {
    try {
      await routeRequest(req, res, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        writeJson(res, 500, { error: message });
      } else {
        res.destroy(error instanceof Error ? error : undefined);
      }
    }
  });
}

export async function runServer(config: NormalizedServerConfig): Promise<void> {
  const server = createTrafficServer(config);
  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, resolve);
  });
  console.log(`traffic server listening on http://${config.host}:${config.port}`);
  console.log(`download: /download, upload: /upload, probe: /probe`);
  if (config.token) {
    console.log("token auth: enabled");
  } else {
    console.log("token auth: disabled");
  }
}

async function routeRequest(req: IncomingMessage, res: ServerResponse, config: NormalizedServerConfig): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/probe") {
    if (!isAuthorized(req, config)) return unauthorized(res);
    return writeJson(res, 200, {
      ok: true,
      server: SERVER_NAME,
      version: "1",
      endpoints: {
        download: "/download?bytes=1gb",
        upload: "/upload"
      },
      maxUploadBytes: config.maxUploadBytes,
      chunkBytes: config.chunkBytes
    });
  }

  if (url.pathname === "/download") {
    if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(res);
    if (!isAuthorized(req, config)) return unauthorized(res);
    return streamDownload(req, res, url, config);
  }

  if (url.pathname === "/upload") {
    if (req.method !== "POST" && req.method !== "PUT") return methodNotAllowed(res);
    if (!isAuthorized(req, config)) return unauthorized(res);
    return consumeUpload(req, res, config);
  }

  writeJson(res, 404, { error: "not found" });
}

function streamDownload(req: IncomingMessage, res: ServerResponse, url: URL, config: NormalizedServerConfig): void {
  const requestedBytes = parseDownloadBytes(url.searchParams.get("bytes"));
  const totalBytes = requestedBytes ?? Number.POSITIVE_INFINITY;
  const chunk = randomBytes(config.chunkBytes);
  let sent = 0;

  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "cache-control": "no-store",
    "x-traffic-server": SERVER_NAME,
    ...(Number.isFinite(totalBytes) ? { "content-length": String(totalBytes) } : {})
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  function writeMore(): void {
    while (sent < totalBytes) {
      const remaining = totalBytes - sent;
      const next = remaining >= chunk.length ? chunk : chunk.subarray(0, remaining);
      sent += next.length;
      if (!res.write(next)) {
        res.once("drain", writeMore);
        return;
      }
    }
    res.end();
  }

  writeMore();
}

async function consumeUpload(req: IncomingMessage, res: ServerResponse, config: NormalizedServerConfig): Promise<void> {
  let received = 0;
  let timedOut = false;
  req.setTimeout(config.readTimeoutMs, () => {
    timedOut = true;
    req.destroy(new Error("upload read timeout"));
  });

  try {
    for await (const chunk of req) {
      received += Buffer.byteLength(chunk as Buffer);
      if (received > config.maxUploadBytes) {
        writeJson(res, 413, {
          error: `upload too large; max is ${formatBytes(config.maxUploadBytes)}`,
          received
        });
        req.destroy();
        return;
      }
    }
  } catch (error) {
    if (timedOut) {
      writeJson(res, 408, { error: "upload read timeout", received });
      return;
    }
    throw error;
  }

  writeJson(res, 200, { ok: true, received });
}

function parseDownloadBytes(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("download bytes must be a non-negative number");
  }
  return Math.floor(parsed);
}

function isAuthorized(req: IncomingMessage, config: NormalizedServerConfig): boolean {
  if (!config.token) return true;
  const header = req.headers.authorization;
  const bearer = `Bearer ${config.token}`;
  const tokenHeader = req.headers["x-traffic-token"];
  return header === bearer || tokenHeader === config.token;
}

function unauthorized(res: ServerResponse): void {
  writeJson(res, 401, { error: "unauthorized" });
}

function methodNotAllowed(res: ServerResponse): void {
  writeJson(res, 405, { error: "method not allowed" });
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(`${JSON.stringify(body)}\n`);
}
