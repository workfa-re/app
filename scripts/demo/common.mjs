import { spawn } from "node:child_process";
import { chmod, lstat, readFile } from "node:fs/promises";
import http from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PROJECT = "workfare-website-demo";
export const LABEL = "com.supabase.cli.project";
export const NETWORK = `supabase_network_${PROJECT}`;
export const RUNTIME = path.join(homedir(), ".cache", PROJECT);
export const ENV_FILE = path.join(ROOT, ".env.demo.local");
export const API_URL = "http://127.0.0.1:55321";
export const APP_URL = "http://127.0.0.1:3001";
export const CLI_VERSION = "2.109.1";
export const PUBLISHERS = { db: { "5432/tcp": "55322" }, kong: { "8000/tcp": "55321" }, inbucket: { "8025/tcp": "55324" } };
export const SERVICES = ["db", "auth", "rest", "realtime", "storage", "kong", "inbucket"];
export const nameOf = (service) => `supabase_${service}_${PROJECT}`;

/** Capture metadata and errors in memory; never echo command output containing keys. */
export function run(command, args, { input, env = process.env, label = "Local demo command" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let size = 0;
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on("error", () => reject(new Error(`${label} could not be started.`)));
    child.on("close", (code) => code === 0 && size <= 32 * 1024 * 1024
      ? resolve(Buffer.concat(chunks).toString("utf8"))
      : reject(new Error(`${label} failed; potentially sensitive tool output was suppressed.`)));
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

export function localSocket(endpoint) {
  if (typeof endpoint !== "string" || !endpoint.startsWith("unix:///")) {
    throw new Error("Demo setup requires a local Docker Unix socket; remote Docker contexts are refused.");
  }
  const socket = endpoint.slice("unix://".length);
  if (!path.isAbsolute(socket) || socket.includes("\0")) throw new Error("Invalid local Docker socket.");
  return socket;
}

export async function dockerConnection() {
  const endpoint = process.env.DOCKER_CONTEXT || !process.env.DOCKER_HOST
    ? JSON.parse((await run("docker", ["context", "inspect", ...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : []), "--format", "{{json .Endpoints.docker.Host}}"], { label: "Docker context inspection" })).trim())
    : process.env.DOCKER_HOST;
  const socketPath = localSocket(endpoint);
  const env = { ...process.env, DOCKER_HOST: endpoint };
  delete env.DOCKER_CONTEXT;
  const request = (method, resource, body, accepted = [200, 201, 204, 304]) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request({ socketPath, method, path: resource, timeout: 60_000,
      headers: data ? { "Content-Type": "application/json", "Content-Length": data.length } : {} }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        if (!accepted.includes(response.statusCode)) return reject(new Error(`Local Docker operation failed (${response.statusCode}).`));
        if (response.statusCode === 404) return resolve(null);
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null); }
        catch { reject(new Error("Local Docker returned unreadable metadata.")); }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => reject(new Error("Local Docker socket is unavailable.")));
    req.end(data);
  });
  const version = await request("GET", "/version");
  if (!/^1\.\d+$/.test(version?.ApiVersion ?? "")) throw new Error("Unsupported Docker API version.");
  const api = (method, resource, body, accepted) => request(method, `/v${version.ApiVersion}${resource}`, body, accepted);
  return { api, env, inspect: (name) => api("GET", `/containers/${encodeURIComponent(name)}/json`, undefined, [200, 404]) };
}

export function assertOwnedContainer(item, service) {
  if (!SERVICES.includes(service) || item?.Name !== `/${nameOf(service)}` || item?.Config?.Labels?.[LABEL] !== PROJECT) {
    throw new Error("Refusing a container outside the dedicated Workfare demo project.");
  }
  if (["host", "none"].includes(item.HostConfig?.NetworkMode) || item.HostConfig?.NetworkMode?.startsWith("container:")) {
    throw new Error("Demo containers must use their own bridge network.");
  }
}

export function assertLoopbackBindings(item, service, { running = true } = {}) {
  assertOwnedContainer(item, service);
  if (running && !item.State?.Running) throw new Error(`Demo service ${service} is not running.`);
  const expected = PUBLISHERS[service] ?? {};
  const actual = running ? item.NetworkSettings?.Ports : item.HostConfig?.PortBindings;
  const exposed = Object.entries(actual ?? {}).filter(([, bindings]) => bindings?.length);
  if (exposed.length !== Object.keys(expected).length) throw new Error(`Unexpected published ports on demo service ${service}.`);
  for (const [port, bindings] of exposed) {
    if (!expected[port] || bindings.some((binding) => binding.HostIp !== "127.0.0.1" || binding.HostPort !== expected[port])) {
      throw new Error(`Demo service ${service} has a non-loopback or unexpected port binding.`);
    }
  }
}

export async function inspectProject(docker) {
  const filters = encodeURIComponent(JSON.stringify({ label: [`${LABEL}=${PROJECT}`] }));
  const listed = await docker.api("GET", `/containers/json?all=true&filters=${filters}`);
  const items = [];
  for (const entry of listed) {
    const item = await docker.inspect(entry.Id);
    const service = SERVICES.find((candidate) => item?.Name === `/${nameOf(candidate)}`);
    assertOwnedContainer(item, service);
    items.push({ service, item });
  }
  return items;
}

export function assertDemoAuthSettings(item) {
  assertOwnedContainer(item, "auth");
  for (const name of ["GOTRUE_DISABLE_SIGNUP", "GOTRUE_EXTERNAL_EMAIL_ENABLED"]) {
    const values = (item.Config.Env ?? []).filter((entry) => entry.startsWith(`${name}=`)).map((entry) => entry.slice(name.length + 1));
    if (values.length !== 1 || values[0] !== "true") throw new Error("Running demo Auth must disable public signup and enable email login; environment values were not printed.");
  }
}

export async function verifyProject(docker) {
  const items = await inspectProject(docker);
  for (const service of ["db", "auth", "rest", "realtime", "kong", "inbucket"]) {
    if (!items.some((entry) => entry.service === service)) throw new Error(`Demo service ${service} is missing; no database setup was attempted.`);
  }
  for (const { item, service } of items) {
    assertLoopbackBindings(item, service);
    if (service === "auth") assertDemoAuthSettings(item);
  }
  return items;
}

export async function cli(docker, args) {
  return run("npx", ["--yes", "--registry=https://registry.npmjs.org", `supabase@${CLI_VERSION}`, ...args, "--workdir", RUNTIME], { env: docker.env, label: "Pinned local Supabase CLI" });
}

export async function sql(docker, statement) {
  const item = await docker.inspect(nameOf("db"));
  assertLoopbackBindings(item, "db");
  return run("docker", ["exec", "-i", nameOf("db"), "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres"], {
    env: docker.env, input: statement, label: "Local demo database operation",
  });
}

export function assertLocalEnvironment(env) {
  if (env.WORKFARE_DEMO_ENABLED !== "true" || env.NEXT_PUBLIC_WORKFARE_DEMO_ENABLED !== "true"
    || env.WORKFARE_DEMO_MODE !== "local" || env.WORKFARE_DEMO_PROJECT_REF !== PROJECT
    || env.WORKFARE_DEMO_LOCAL_URL !== API_URL || env.NEXT_PUBLIC_SUPABASE_URL !== API_URL || env.SUPABASE_URL !== API_URL) {
    throw new Error("The demo environment must point exclusively to the fixed isolated local project.");
  }
  for (const name of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "WORKFARE_DEMO_RATE_SECRET"]) {
    if (!env[name] || /[\r\n]/.test(env[name])) throw new Error(`Missing or invalid ${name}; rerun demo:setup.`);
  }
  if (env.WORKFARE_DEMO_RATE_SECRET.length < 32) throw new Error("Demo rate-limit secret is too short.");
  if (env.WORKFARE_DEMO_TRUST_CLOUDFLARE === "true") throw new Error("Local demo must not trust forwarded Cloudflare client identities.");
}

export async function loadDemoEnvironment() {
  const file = await lstat(ENV_FILE);
  if (!file.isFile() || file.isSymbolicLink()) throw new Error("Demo environment must be a regular local file.");
  await chmod(ENV_FILE, 0o600);
  // An exported production variable must never override the explicit demo file.
  for (const name of Object.keys(process.env)) {
    if (/^(SUPABASE_|NEXT_PUBLIC_SUPABASE_|WORKFARE_DEMO_|NEXT_PUBLIC_WORKFARE_DEMO_)/.test(name)
      || ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_BASE_URL"].includes(name)) delete process.env[name];
  }
  process.loadEnvFile(ENV_FILE);
  assertLocalEnvironment(process.env);
}

export async function existingFile(filename) {
  try { return await readFile(filename, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
export function fail(error) {
  console.error(error instanceof Error ? error.message : "Local demo operation failed.");
  process.exitCode = 1;
}
