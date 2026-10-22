import type { PointerEvent } from "react";

// Update the highlight directly; pointer movement never causes a React render.
export function followGlassPointer(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse" || !(event.target instanceof Element)) return;
    const surface = event.target.closest<HTMLElement>(".app-glass-control");
    if (!surface || !event.currentTarget.contains(surface)) return;
    const rect = surface.getBoundingClientRect();
    surface.style.setProperty("--glass-x", `${event.clientX - rect.left}px`);
    surface.style.setProperty("--glass-y", `${event.clientY - rect.top}px`);
}
