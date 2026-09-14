import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireDemoEnvironment } from "@/lib/demo/environment";
import { Database } from "@/lib/types/supabase";

let adminClient: SupabaseClient<Database> | null = null;

export function getSupabaseAdminClient(): SupabaseClient<Database> {
  if (process.env.WORKFARE_DEMO_ENABLED === "true") requireDemoEnvironment();
  if (adminClient) {
    return adminClient;
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase admin env vars. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  adminClient = createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    db: {
      schema: "public",
    },
  });

  return adminClient;
}
