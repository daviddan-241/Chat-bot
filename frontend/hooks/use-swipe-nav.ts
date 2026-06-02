"use client";
import * as React from "react";
import { useUIStore } from "@/stores/ui-store";
import { useArtifactStore } from "@/stores/artifact-store";

/**
 * Mobile-only horizontal swipe between the three views:
 * sidebar  <-->  chat  <-->  artifact
 */
export function useSwipeNav() {
  const { mobileView, setMobileView } = useUIStore();
  const { active, draft } = useArtifactStore();
  const start = React.useRef<{ x: number; y: number; t: number } | null>(null);

  const order = React.useMemo<("sidebar" | "chat" | "artifact")[]>(() => {
    return active || draft ? ["sidebar", "chat", "artifact"] : ["sidebar", "chat"];
  }, [active, draft]);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (!start.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    const dt = Date.now() - start.current.t;
    start.current = null;
    if (dt > 600) return;
    if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx)) return;

    const idx = order.indexOf(mobileView as typeof order[number]);
    if (idx < 0) return;
    if (dx < 0 && idx < order.length - 1) setMobileView(order[idx + 1]);
    else if (dx > 0 && idx > 0) setMobileView(order[idx - 1]);
  }

  return { onTouchStart, onTouchEnd };
}
