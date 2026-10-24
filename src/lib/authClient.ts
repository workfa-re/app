"use client";

import { supabaseBrowser } from "./supabaseClient";

// Client-seitige Auth-Funktionen (nur für Client Components)
export const signUpWithEmail = async (email: string, password: string, data?: object, emailRedirectTo?: string) => {
  const { data: result, error } = await supabaseBrowser.auth.signUp({
    email,
    password,
    options: {
      data,
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
    },
  });
  return { data: result, error };
};

export const signInWithEmail = async (email: string, password: string) => {
  const { data, error } = await supabaseBrowser.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
};
