"use server";

import { loadPermissionPreview, requestPermissionCode, revokePermission, submitPermission } from "@/lib/guardian/permission.server";

export async function getGuardianPermission(input: { token?: string; receipt?: string }) { return loadPermissionPreview(input); }
export async function requestGuardianPermissionCode(input: { token: string; email: string }) { return requestPermissionCode(input); }
export async function submitGuardianPermission(input: unknown) { return submitPermission(input); }
export async function revokeGuardianPermission(receipt: string) { return revokePermission(receipt); }
