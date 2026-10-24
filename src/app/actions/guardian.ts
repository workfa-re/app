"use server";

import type { FamilyInvitationDirection } from "@/lib/guardian/types";
import { supabaseServer } from "@/lib/supabaseServer";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function createGuardianInvitation() {
    const { issueFamilyInvitation } = await import("@/lib/guardian/service.server");
    return issueFamilyInvitation("child_to_guardian");
}

export async function createFamilyInvitation(direction: FamilyInvitationDirection) {
    const { issueFamilyInvitation } = await import("@/lib/guardian/service.server");
    return issueFamilyInvitation(direction);
}

export type LinkedAccount = {
    id: string;
    full_name: string | null;
    email: string | null;
    linked_at: string | null;
};

type LinkedAccountsResult = { ok: true; accounts: LinkedAccount[] } | { ok: false; error: string };

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nullableText(value: unknown) {
    return typeof value === "string" ? value.trim() || null : null;
}

function normalizeLinkedAccounts(rows: unknown, counterpartColumn: "guardian_id" | "child_id", currentUserId: string): LinkedAccount[] {
    const accounts = new Map<string, LinkedAccount>();
    for (const value of Array.isArray(rows) ? rows : []) {
        const row = record(value);
        const id = nullableText(row?.[counterpartColumn]);
        if (!row || !id || id === currentUserId || accounts.has(id)) continue;
        const joined = Array.isArray(row.linked_profile)
            ? row.linked_profile.map(record).find(profile => profile?.id === id)
            : record(row.linked_profile);
        if (!joined || joined.id !== id) continue;
        accounts.set(id, {
            id,
            full_name: nullableText(joined.full_name),
            email: nullableText(joined.email),
            linked_at: nullableText(row.created_at),
        });
    }
    return [...accounts.values()];
}

async function getLinkedAccounts(direction: "guardians" | "wards"): Promise<LinkedAccountsResult> {
    const loadError = direction === "guardians"
        ? "Elternfreigaben konnten gerade nicht geladen werden. Bitte versuche es erneut."
        : "Verknüpfte Kinder konnten gerade nicht geladen werden. Bitte versuche es erneut.";
    try {
        const supabase = await supabaseServer();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) return { ok: false, error: "Deine Sitzung konnte nicht geprüft werden. Bitte lade die Seite neu." };
        if (!user) return { ok: false, error: "Nicht authentifiziert" };

        const ownerColumn = direction === "guardians" ? "child_id" : "guardian_id";
        const counterpartColumn = direction === "guardians" ? "guardian_id" : "child_id";
        const selection = direction === "guardians"
            ? "guardian_id, created_at, linked_profile:profiles!guardian_relationships_guardian_id_fkey(id, full_name, email)"
            : "child_id, created_at, linked_profile:profiles!guardian_relationships_child_id_fkey(id, full_name, email)";
        // Cross-profile fields remain server-only. The authenticated identity,
        // never a caller-provided ID, scopes the active relationship query.
        const { data, error } = await getSupabaseAdminClient()
            .from("guardian_relationships")
            .select(selection)
            .eq(ownerColumn, user.id)
            .eq("status", "active")
            .order("created_at", { ascending: false })
            .order(counterpartColumn, { ascending: true });
        if (error) {
            console.error("Linked account lookup failed:", error.code);
            return { ok: false, error: loadError };
        }
        return { ok: true, accounts: normalizeLinkedAccounts(data, counterpartColumn, user.id) };
    } catch {
        console.error("Linked account lookup unavailable.");
        return { ok: false, error: loadError };
    }
}

export async function getGuardians() {
    const result = await getLinkedAccounts("guardians");
    return result.ok ? { guardians: result.accounts } : { error: result.error };
}

export async function getWards() {
    const result = await getLinkedAccounts("wards");
    return result.ok ? { wards: result.accounts } : { error: result.error };
}
