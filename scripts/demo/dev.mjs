import { spawn } from "node:child_process";
import path from "node:path";
import { dockerConnection, fail, loadDemoEnvironment, ROOT, verifyProject } from "./common.mjs";

async function dev() {
  process.chdir(ROOT);
  await loadDemoEnvironment();
  await verifyProject(await dockerConnection());
  // Do not use node --env-file: Next propagates execArgv to workers via NODE_OPTIONS.
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3001"], {
    cwd: ROOT, env: process.env, stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("error", () => fail(new Error("The demo application could not be started.")));
  child.on("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1); });
}
dev().catch(fail);
