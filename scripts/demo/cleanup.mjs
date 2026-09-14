import { API_URL, dockerConnection, fail, loadDemoEnvironment, verifyProject } from "./common.mjs";

async function cleanup() {
  await loadDemoEnvironment();
  await verifyProject(await dockerConnection());
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${API_URL}/rest/v1/rpc/demo_cleanup_expired_sessions`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_limit: 100 }), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Local expired-demo cleanup failed (${response.status}); response details were suppressed.`);
  const result = await response.json().catch(() => { throw new Error("Local demo cleanup returned unreadable metadata."); });
  if (result.requires_auth_cleanup || !Number.isSafeInteger(result.deleted_sessions) || !Number.isSafeInteger(result.deleted_users)) {
    throw new Error("Unexpected local demo cleanup result; review the installed service API.");
  }
  console.log(`Removed ${result.deleted_sessions} expired demo visits and ${result.deleted_users} associated demo accounts. Active visits were retained.`);
}
cleanup().catch(fail);
