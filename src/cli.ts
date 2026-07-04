#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runClient } from "./client.js";
import { runServer } from "./server.js";
import type { ClientConfig, ServerConfig, TargetConfig } from "./types.js";
import { loadConfigFile, normalizeClientConfig, normalizeServerConfig } from "./utils/config.js";

const __filename = fileURLToPath(import.meta.url);
const program = new Command();

program
  .name("tb")
  .description("Authorized VPS traffic generator: multi-target download/upload client and self-hosted server.")
  .version("1.0.0");

program
  .command("client")
  .description("Run traffic client in the foreground.")
  .option("-c, --config <file>", "YAML/JSON config file")
  .option("-u, --url <url...>", "download URL(s), repeat for multiple targets")
  .option("--target <url...>", "alias for --url")
  .option("--self-hosted <url...>", "self-hosted tb-server base URL(s), supports upload and download")
  .option("--token <token>", "token for self-hosted target(s)")
  .option("--mode <mode>", "download, upload, or both for self-hosted targets")
  .option("--schedule <mode>", "round-robin or random")
  .option("--concurrency <n>", "number of workers", parseInteger)
  .option("--interval <ms>", "delay between requests in milliseconds", parseInteger)
  .option("--jitter <ms>", "extra random delay in milliseconds", parseInteger)
  .option("--timeout <ms>", "per-request timeout in milliseconds", parseInteger)
  .option("--max <bytes>", "total traffic limit, e.g. 20gb")
  .option("--max-down <bytes>", "download traffic limit")
  .option("--max-up <bytes>", "upload traffic limit")
  .option("--duration <duration>", "max runtime, e.g. 2h")
  .option("--rate <rate>", "global rate limit, e.g. 50mb/s")
  .option("--upload-request <bytes>", "bytes per upload request, e.g. 512mb")
  .option("--log-every <ms>", "status log interval", parseInteger)
  .action(async (options) => {
    const config = buildClientConfig(options);
    await runClient(normalizeClientConfig(config));
  });

program
  .command("server")
  .description("Run self-hosted traffic endpoint in the foreground.")
  .option("-c, --config <file>", "YAML/JSON server config file")
  .option("--host <host>", "listen host")
  .option("-p, --port <port>", "listen port", parseInteger)
  .option("--token <token>", "bearer token")
  .option("--chunk <bytes>", "download chunk size, e.g. 1mb")
  .option("--max-upload <bytes>", "max bytes per upload request")
  .action(async (options) => {
    const config = buildServerConfig(options);
    await runServer(normalizeServerConfig(config));
  });

program
  .command("start")
  .description("Start client or server in the background with a PID file.")
  .argument("<kind>", "client or server")
  .option("-c, --config <file>", "YAML/JSON config file")
  .option("--pid <file>", "PID file path", "traffic-burner.pid")
  .option("--log <file>", "log file path", "traffic-burner.log")
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action((kind, options, command) => {
    if (kind !== "client" && kind !== "server") {
      throw new Error("kind must be client or server");
    }
    const unknown = command.args.slice(1);
    startBackground(kind, options, unknown);
  });

program
  .command("stop")
  .description("Stop a background process started by tb start.")
  .option("--pid <file>", "PID file path", "traffic-burner.pid")
  .action((options) => stopBackground(options.pid));

program
  .command("status")
  .description("Show whether a PID file process is running.")
  .option("--pid <file>", "PID file path", "traffic-burner.pid")
  .action((options) => showStatus(options.pid));

program
  .command("examples")
  .description("Print example YAML configs.")
  .argument("[kind]", "client, server, or all", "all")
  .action((kind) => printExamples(kind));

function buildClientConfig(options: Record<string, unknown>): ClientConfig {
  const fromFile = options.config ? loadConfigFile<ClientConfig>(String(options.config)) : {};
  const targets: TargetConfig[] = [...((fromFile as ClientConfig).targets ?? [])];

  const urls = uniqueStrings([...(arrayOption(options.url)), ...(arrayOption(options.target))]);
  for (const url of urls) {
    targets.push({ url, mode: "download", downloadOnly: true });
  }

  for (const url of arrayOption(options.selfHosted)) {
    targets.push({
      url,
      token: stringOption(options.token),
      mode: (stringOption(options.mode) as TargetConfig["mode"]) ?? "both"
    });
  }

  return {
    ...(fromFile as ClientConfig),
    targets,
    schedule: stringOption(options.schedule) as ClientConfig["schedule"] ?? (fromFile as ClientConfig).schedule,
    concurrency: numberOption(options.concurrency) ?? (fromFile as ClientConfig).concurrency,
    intervalMs: numberOption(options.interval) ?? (fromFile as ClientConfig).intervalMs,
    jitterMs: numberOption(options.jitter) ?? (fromFile as ClientConfig).jitterMs,
    requestTimeoutMs: numberOption(options.timeout) ?? (fromFile as ClientConfig).requestTimeoutMs,
    maxBytes: stringOption(options.max) ?? (fromFile as ClientConfig).maxBytes,
    maxDownloadBytes: stringOption(options.maxDown) ?? (fromFile as ClientConfig).maxDownloadBytes,
    maxUploadBytes: stringOption(options.maxUp) ?? (fromFile as ClientConfig).maxUploadBytes,
    maxDuration: stringOption(options.duration) ?? (fromFile as ClientConfig).maxDuration,
    rateLimit: stringOption(options.rate) ?? (fromFile as ClientConfig).rateLimit,
    uploadRequestBytes: stringOption(options.uploadRequest) ?? (fromFile as ClientConfig).uploadRequestBytes,
    logEveryMs: numberOption(options.logEvery) ?? (fromFile as ClientConfig).logEveryMs
  };
}

function buildServerConfig(options: Record<string, unknown>): ServerConfig {
  const fromFile = options.config ? loadConfigFile<ServerConfig>(String(options.config)) : {};
  return {
    ...(fromFile as ServerConfig),
    host: stringOption(options.host) ?? (fromFile as ServerConfig).host,
    port: numberOption(options.port) ?? (fromFile as ServerConfig).port,
    token: stringOption(options.token) ?? (fromFile as ServerConfig).token,
    chunkBytes: stringOption(options.chunk) ?? (fromFile as ServerConfig).chunkBytes,
    maxUploadBytes: stringOption(options.maxUpload) ?? (fromFile as ServerConfig).maxUploadBytes
  };
}

function startBackground(kind: string, options: Record<string, unknown>, unknownArgs: string[]): void {
  const pidPath = path.resolve(String(options.pid ?? "traffic-burner.pid"));
  const logPath = path.resolve(String(options.log ?? "traffic-burner.log"));
  if (fs.existsSync(pidPath)) {
    const oldPid = Number(fs.readFileSync(pidPath, "utf8").trim());
    if (oldPid && isProcessRunning(oldPid)) {
      throw new Error(`Already running with PID ${oldPid}; use tb stop --pid ${pidPath}`);
    }
  }

  const args = [__filename, kind];
  if (options.config) args.push("--config", String(options.config));
  args.push(...unknownArgs);

  const logFd = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true
  });
  fs.writeFileSync(pidPath, `${child.pid}\n`);
  child.unref();

  console.log(`started ${kind}: pid=${child.pid}`);
  console.log(`pid file: ${pidPath}`);
  console.log(`log file: ${logPath}`);
}

function stopBackground(pidFile: string): void {
  const pidPath = path.resolve(pidFile);
  if (!fs.existsSync(pidPath)) {
    console.log(`not running: pid file missing (${pidPath})`);
    return;
  }
  const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
  if (!pid || !isProcessRunning(pid)) {
    fs.rmSync(pidPath, { force: true });
    console.log("not running; removed stale pid file");
    return;
  }
  process.kill(pid, "SIGTERM");
  fs.rmSync(pidPath, { force: true });
  console.log(`stopped PID ${pid}`);
}

function showStatus(pidFile: string): void {
  const pidPath = path.resolve(pidFile);
  if (!fs.existsSync(pidPath)) {
    console.log("stopped");
    return;
  }
  const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
  console.log(pid && isProcessRunning(pid) ? `running: ${pid}` : `stale pid: ${pid || "unknown"}`);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function printExamples(kind: string): void {
  if (kind === "client" || kind === "all") {
    console.log(CLIENT_EXAMPLE.trim());
    console.log("");
  }
  if (kind === "server" || kind === "all") {
    console.log(SERVER_EXAMPLE.trim());
  }
  if (!["client", "server", "all"].includes(kind)) {
    throw new Error("kind must be client, server, or all");
  }
}

function parseInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Expected integer, got ${value}`);
  return parsed;
}

function arrayOption(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

function stringOption(value: unknown): string | undefined {
  return value === undefined ? undefined : String(value);
}

function numberOption(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

const CLIENT_EXAMPLE = `
# client.yaml
schedule: random
concurrency: 4
intervalMs: 1000
jitterMs: 2000
requestTimeoutMs: 120000
maxBytes: 20gb
rateLimit: 80mb/s
uploadRequestBytes: 512mb
logEveryMs: 5000
targets:
  # Public speed-test file. Use downloadOnly for public endpoints.
  - name: leaseweb-1000mb
    url: https://speedtest.ams1.nl.leaseweb.net/1000mb.bin
    mode: download
    downloadOnly: true
    weight: 2

  - name: ovh-1gb
    url: https://proof.ovh.net/files/1Gb.dat
    mode: download
    downloadOnly: true
    weight: 1

  # Your own VPS running: tb server --token CHANGE_ME
  - name: my-vps
    url: http://YOUR_VPS_IP:8080
    token: CHANGE_ME
    mode: both
    weight: 1
`;

const SERVER_EXAMPLE = `
# server.yaml
host: 0.0.0.0
port: 8080
token: CHANGE_ME
chunkBytes: 1mb
maxUploadBytes: 20gb
readTimeoutMs: 120000
`;

program.parseAsync().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
