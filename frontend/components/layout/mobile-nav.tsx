"use client";
import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { MessageSquare, Menu, FileCode2, Bot, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui-store";

function haptic() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try { (navigator as Navigator & { vibrate: (p: number) => boolean }).vibrate(8); } catch {}
  }
}

export function MobileNav({ hasArtifact }: { hasArtifact: boolean }) {
  const { mobileView, setMobileView } = useUIStore();
  const router = useRouter();
  const pathname = usePathname();

  type Item =
    | { kind: "view"; value: typeof mobileView; icon: React.ReactNode; label: string; badge?: boolean }
    | { kind: "route"; href: string; icon: React.ReactNode; label: string; match: (p: string) => boolean };

  const items: Item[] = [
    { kind: "view", value: "sidebar", icon: <Menu size={20} />, label: "Menu" },
    { kind: "view", value: "chat", icon: <MessageSquare size={20} />, label: "Chat" },
    { kind: "route", href: "/agents", icon: <Bot size={20} />, label: "Agents", match: (p) => p.startsWith("/agents") },
    { kind: "route", href: "/files", icon: <FolderOpen size={20} />, label: "Files", match: (p) => p.startsWith("/files") || p.startsWith("/projects") },
    { kind: "view", value: "artifact", icon: <FileCode2 size={20} />, label: "Artifact", badge: hasArtifact },
  ];

  return (
    <nav className="shrink-0 border-t hairline bg-bg-soft/85 backdrop-blur-xl backdrop-saturate-150 safe-bottom">
      <div className="flex">
        {items.map((it) => {
          const active = it.kind === "view"
            ? mobileView === it.value && (pathname.startsWith("/chat") || pathname === "/")
            : it.match(pathname);
          return (
            <button
              key={it.kind === "view" ? `v-${it.value}` : `r-${it.href}`}
              onClick={() => {
                haptic();
                if (it.kind === "view") {
                  if (!pathname.startsWith("/chat") && pathname !== "/") router.push("/chat");
                  setMobileView(it.value);
                } else {
                  router.push(it.href);
                  setMobileView("chat");
                }
              }}
              className={cn(
                "relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition active:scale-[0.94]",
                active ? "text-ink" : "text-ink-faint",
              )}
            >
              <div className="relative">
                {it.icon}
                {it.kind === "view" && it.badge && (
                  <span className="absolute -top-0.5 -right-1.5 h-2 w-2 rounded-full bg-accent animate-pulse-glow" />
                )}
              </div>
              <span className="text-[10px] font-medium">{it.label}</span>
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-7 h-[2px] rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
