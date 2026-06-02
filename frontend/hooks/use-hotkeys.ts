"use client";
import { useEffect } from "react";

export interface Hotkey {
  /** "mod+k", "mod+shift+p", "mod+enter", "esc". `mod` = ⌘ on mac, Ctrl elsewhere */
  combo: string;
  handler: (e: KeyboardEvent) => void;
  /** Allow hotkey while focus is inside an input/textarea/contenteditable */
  allowInInput?: boolean;
  description?: string;
}

function isInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function matches(combo: string, e: KeyboardEvent): boolean {
  const parts = combo.toLowerCase().split("+").map((p) => p.trim());
  const wantMod = parts.includes("mod") || parts.includes("cmd") || parts.includes("ctrl");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt") || parts.includes("option");
  const key = parts.filter((p) => !["mod", "cmd", "ctrl", "shift", "alt", "option"].includes(p))[0];
  if (!key) return false;
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const modPressed = isMac ? e.metaKey : e.ctrlKey;
  if (wantMod && !modPressed) return false;
  if (!wantMod && modPressed && key !== "esc") return false;
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;
  const pressed = (e.key || "").toLowerCase();
  if (key === "enter") return pressed === "enter";
  if (key === "esc" || key === "escape") return pressed === "escape";
  return pressed === key;
}

export function useHotkeys(hotkeys: Hotkey[]) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      for (const hk of hotkeys) {
        if (!matches(hk.combo, e)) continue;
        if (!hk.allowInInput && isInput(e.target)) continue;
        e.preventDefault();
        hk.handler(e);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hotkeys]);
}
