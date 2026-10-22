"use client";

import { useEffect, useRef } from "react";

/** Focus conversation tools, contain modal tools, and restore their trigger. */
export function useActivityDialogFocus<T extends HTMLElement>(open = true, modal = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
    )).filter((element) => element.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => (focusable()[0] ?? dialog).focus());
    const trap = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (event.key !== "Tab" || dialogs[dialogs.length - 1] !== dialog) return;
      const controls = focusable();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    if (modal) document.addEventListener("keydown", trap, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", trap, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, modal]);
  return ref;
}
