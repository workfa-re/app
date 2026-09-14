import { pathToFileURL } from "node:url";
import { assertLoopbackBindings, assertOwnedContainer, dockerConnection, fail, nameOf, PUBLISHERS } from "./common.mjs";

/** Only change bindings; keep image/config, volumes, restart policy and aliases. */
export function replacementConfig(item, service) {
  assertOwnedContainer(item, service);
  if (!PUBLISHERS[service]) throw new Error("Only the three demo publishers may be rebound.");
  const config = structuredClone(item.Config);
  const host = structuredClone(item.HostConfig);
  for (const bindings of Object.values(host.PortBindings ?? {})) {
    for (const binding of bindings ?? []) binding.HostIp = "127.0.0.1";
  }
  assertLoopbackBindings({ ...item, HostConfig: host }, service, { running: false });
  delete host.Binds;
  delete host.VolumesFrom;
  host.Mounts = (item.Mounts ?? []).map((mount) => {
    if (!["volume", "bind"].includes(mount.Type)) throw new Error("Unsupported demo mount; automatic recreation refused.");
    const source = mount.Type === "volume" ? mount.Name : mount.Source;
    if (!source || !mount.Destination) throw new Error("Incomplete demo volume metadata.");
    return { Type: mount.Type, Source: source, Target: mount.Destination, ReadOnly: !mount.RW };
  });
  return { ...config, HostConfig: host, NetworkingConfig: { EndpointsConfig: Object.fromEntries(
    Object.entries(item.NetworkSettings.Networks ?? {}).map(([name, endpoint]) => [name,
      Object.fromEntries(["Aliases", "DriverOpts", "IPAMConfig"].filter((key) => endpoint[key] != null).map((key) => [key, endpoint[key]])),
    ]),
  ) } };
}

async function waitUntilHealthy(docker, id, service) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const item = await docker.inspect(id);
    assertLoopbackBindings(item, service);
    if (!item.State.Health || item.State.Health.Status === "healthy") return;
    if (item.State.Health.Status === "unhealthy") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Recreated demo service ${service} did not become healthy.`);
}

export async function rebind() {
  const docker = await dockerConnection();
  const plans = [];
  for (const service of Object.keys(PUBLISHERS)) {
    const item = await docker.inspect(nameOf(service));
    assertOwnedContainer(item, service);
    const body = replacementConfig(item, service);
    if (await docker.inspect(`${nameOf(service)}-rebind-backup`)) throw new Error("An earlier demo rebind backup exists; review it before retrying.");
    plans.push({ service, item, body });
  }
  for (const { service, item, body } of plans) {
    try { assertLoopbackBindings(item, service); continue; } catch { /* Repair only this owned publisher. */ }
    let replacement;
    let renamed = false;
    await docker.api("POST", `/containers/${item.Id}/stop?t=15`);
    try {
      await docker.api("POST", `/containers/${item.Id}/rename?name=${nameOf(service)}-rebind-backup`);
      renamed = true;
      replacement = await docker.api("POST", `/containers/create?name=${nameOf(service)}`, body);
      await docker.api("POST", `/containers/${replacement.Id}/start`);
      await waitUntilHealthy(docker, replacement.Id, service);
      // Never remove volumes: the replacement uses the exact existing mounts.
      await docker.api("DELETE", `/containers/${item.Id}`);
      console.log(`Demo ${service}: loopback binding verified.`);
    } catch {
      if (replacement) await docker.api("DELETE", `/containers/${replacement.Id}?force=true`, undefined, [204, 404]).catch(() => undefined);
      if (renamed) await docker.api("POST", `/containers/${item.Id}/rename?name=${nameOf(service)}`).catch(() => undefined);
      // Keep the original stopped: rollback must not reopen a broad host binding.
      throw new Error(`Demo ${service} repair failed. Existing volumes were retained; the original container remains stopped for review.`);
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) rebind().catch(fail);
