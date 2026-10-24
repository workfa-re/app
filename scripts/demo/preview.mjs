import { spawn } from "node:child_process";
import path from "node:path";
import { dockerConnection, fail, loadDemoEnvironment, ROOT, verifyProject } from "./common.mjs";

async function command(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), ...args], {
      cwd: ROOT, env: process.env, stdio: "inherit",
    });
    const interrupt = (signal) => child.kill(signal);
    const onInterrupt = () => interrupt("SIGINT");
    const onTerminate = () => interrupt("SIGTERM");
    process.on("SIGINT", onInterrupt); process.on("SIGTERM", onTerminate);
    child.on("error", () => reject(new Error("Local demo preview could not start.")));
    child.on("exit", (code) => {
      process.off("SIGINT", onInterrupt); process.off("SIGTERM", onTerminate);
      if (code === 0) resolve(); else reject(new Error("Local demo preview command did not complete."));
    });
  });
}

async function preview() {
  if (process.argv.slice(2).some(arg => arg !== "--build-only") || process.argv.length > 3) throw new Error("Unsupported local preview argument.");
  await loadDemoEnvironment();
  await verifyProject(await dockerConnection());
  await command(["build"]);
  if (!process.argv.includes("--build-only")) await command(["start", "--hostname", "127.0.0.1", "--port", "3001"]);
}
preview().catch(fail);
