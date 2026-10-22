"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import styles from "./Settings.module.css";

export function PasswordResetButton({ email }: { email: string | null }) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handlePasswordReset = async () => {
    if (!email) return;

    setLoading(true);
    await supabaseBrowser.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
    });
    setLoading(false);
    setSent(true);
  };

  return (
    <button
      type="button"
      aria-busy={loading}
      onClick={handlePasswordReset}
      disabled={loading || sent || !email}
      className={styles.primaryButton}
    >
      {sent ? "E-Mail gesendet" : loading ? "Wird gesendet …" : "Passwortlink senden"}
    </button>
  );
}
