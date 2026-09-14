import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { API_URL, assertDemoAuthSettings, assertLocalEnvironment, assertLoopbackBindings, LABEL, localSocket, nameOf, PROJECT, ROOT } from "./common.mjs";
import { replacementConfig } from "./rebind-loopback.mjs";

const environment = {
  WORKFARE_DEMO_ENABLED: "true", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true", WORKFARE_DEMO_MODE: "local",
  WORKFARE_DEMO_PROJECT_REF: PROJECT, WORKFARE_DEMO_LOCAL_URL: API_URL, NEXT_PUBLIC_SUPABASE_URL: API_URL, SUPABASE_URL: API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-public-key", SUPABASE_SERVICE_ROLE_KEY: "fixture-server-key",
  WORKFARE_DEMO_RATE_SECRET: "fixture-rate-secret-of-sufficient-length", WORKFARE_DEMO_TRUST_CLOUDFLARE: "false",
};
function container() {
  return {
    Id: "fixture-container", Name: `/${nameOf("db")}`, State: { Running: true },
    Config: { Image: "fixture-postgres", Env: ["FIXTURE_KEY=private-fixture"], Labels: { [LABEL]: PROJECT } },
    HostConfig: { NetworkMode: "fixture-demo-network", RestartPolicy: { Name: "unless-stopped" },
      Binds: ["fixture-volume:/var/lib/postgresql/data"], PortBindings: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55322" }] } },
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55322" }] },
      Networks: { "fixture-demo-network": { Aliases: ["db"], IPAddress: "172.20.0.2" } } },
    Mounts: [{ Type: "volume", Name: "fixture-volume", Destination: "/var/lib/postgresql/data", RW: true }],
  };
}

test("only a local Docker Unix socket is accepted", () => {
  assert.equal(localSocket("unix:///var/run/docker.sock"), "/var/run/docker.sock");
  for (const endpoint of ["tcp://127.0.0.1:2375", "ssh://remote.example", "https://remote.example", "unix://relative.sock", undefined]) {
    assert.throws(() => localSocket(endpoint));
  }
});
test("local environment cannot silently target another database or deployment", () => {
  assert.doesNotThrow(() => assertLocalEnvironment(environment));
  for (const key of ["WORKFARE_DEMO_ENABLED", "NEXT_PUBLIC_WORKFARE_DEMO_ENABLED", "WORKFARE_DEMO_MODE", "WORKFARE_DEMO_PROJECT_REF", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "WORKFARE_DEMO_LOCAL_URL"]) {
    assert.throws(() => assertLocalEnvironment({ ...environment, [key]: "wrong-target" }));
  }
  assert.throws(() => assertLocalEnvironment({ ...environment, WORKFARE_DEMO_RATE_SECRET: "short" }));
  assert.throws(() => assertLocalEnvironment({ ...environment, WORKFARE_DEMO_TRUST_CLOUDFLARE: "true" }));
});
test("actual Docker ports must be loopback, exact and complete", () => {
  assert.doesNotThrow(() => assertLoopbackBindings(container(), "db"));
  for (const ip of ["", "0.0.0.0", "::", "192.0.2.1"]) {
    const item = container();
    item.NetworkSettings.Ports["5432/tcp"][0].HostIp = ip;
    assert.throws(() => assertLoopbackBindings(item, "db"));
  }
  const wrongPort = container();
  wrongPort.NetworkSettings.Ports["5432/tcp"][0].HostPort = "54322";
  assert.throws(() => assertLoopbackBindings(wrongPort, "db"));
  const missing = container();
  missing.NetworkSettings.Ports = {};
  assert.throws(() => assertLoopbackBindings(missing, "db"));
});
test("foreign containers and network namespaces are refused", () => {
  const foreignLabel = container();
  foreignLabel.Config.Labels[LABEL] = "another-project";
  assert.throws(() => replacementConfig(foreignLabel, "db"));
  const foreignName = container();
  foreignName.Name = "/production-db";
  assert.throws(() => replacementConfig(foreignName, "db"));
  for (const mode of ["host", "none", "container:other"]) {
    const item = container(); item.HostConfig.NetworkMode = mode;
    assert.throws(() => replacementConfig(item, "db"));
  }
});
test("recreation preserves existing volumes, config and aliases without mutating inspection data", () => {
  const item = container();
  item.HostConfig.PortBindings["5432/tcp"][0].HostIp = "0.0.0.0";
  const before = structuredClone(item);
  const replacement = replacementConfig(item, "db");
  assert.deepEqual(item, before);
  assert.deepEqual(replacement.Env, item.Config.Env);
  assert.equal(replacement.HostConfig.PortBindings["5432/tcp"][0].HostIp, "127.0.0.1");
  assert.deepEqual(replacement.HostConfig.RestartPolicy, item.HostConfig.RestartPolicy);
  assert.deepEqual(replacement.HostConfig.Mounts, [{ Type: "volume", Source: "fixture-volume", Target: "/var/lib/postgresql/data", ReadOnly: false }]);
  assert.deepEqual(replacement.NetworkingConfig.EndpointsConfig, { "fixture-demo-network": { Aliases: ["db"] } });
  assert.equal(replacement.HostConfig.Binds, undefined);
});
test("recreation refuses extra exposed ports instead of silently allowing them", () => {
  const item = container();
  item.HostConfig.PortBindings["9999/tcp"] = [{ HostIp: "0.0.0.0", HostPort: "9999" }];
  assert.throws(() => replacementConfig(item, "db"));
});
test("package commands point only to the local dedicated wrappers", async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["demo:setup"], "node scripts/demo/setup.mjs");
  assert.equal(pkg.scripts["demo:dev"], "node scripts/demo/dev.mjs");
  assert.equal(pkg.scripts["demo:cleanup"], "node scripts/demo/cleanup.mjs");
});

test("running Auth must block signup and permit demo OTP login", () => {
  const item = container();
  item.Name = `/${nameOf("auth")}`;
  item.Config.Env = ["GOTRUE_DISABLE_SIGNUP=true", "GOTRUE_EXTERNAL_EMAIL_ENABLED=true"];
  assert.doesNotThrow(() => assertDemoAuthSettings(item));
  for (const name of ["GOTRUE_DISABLE_SIGNUP", "GOTRUE_EXTERNAL_EMAIL_ENABLED"]) {
    for (const value of ["false", "", "TRUE"]) {
      const altered = structuredClone(item);
      altered.Config.Env = altered.Config.Env.filter((entry) => !entry.startsWith(`${name}=`));
      altered.Config.Env.push(`${name}=${value}`);
      assert.throws(() => assertDemoAuthSettings(altered));
    }
  }
});
