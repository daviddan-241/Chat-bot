"use client";
import * as React from "react";
import { Sidebar } from "./sidebar";
import { MobileNav } from "./mobile-nav";
import { BottomPanel } from "@/components/bottom-panel/bottom-panel";
import { ArtifactPanel } from "@/components/artifact/artifact-panel";
import { CommandPalette } from "@/components/command-palette";
import { GlobalHotkeys } from "@/components/global-hotkeys";
import { useIsMobile, useIsTablet } from "@/hooks/use-media-query";
import { useUIStore } from "@/stores/ui-store";
import { useArtifactStore } from "@/stores/artifact-store";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { useSwipeNav } from "@/hooks/use-swipe-nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const { sidebarCollapsed, mobileView } = useUIStore();
  const { open: artifactOpen, active, draft } = useArtifactStore();
  const showArtifact = !!(artifactOpen && (active || draft));
  const swipeHandlers = useSwipeNav();

  // Mobile-only layout: switchable views
  if (isMobile) {
    return (
      <div className="flex flex-col h-[100dvh] overflow-hidden bg-bg">
        <GlobalHotkeys />
        <CommandPalette />
        <div className="flex-1 min-h-0 relative" {...swipeHandlers}>
          <AnimatePresence initial={false} mode="wait">
            {mobileView === "sidebar" && (
              <motion.div
                key="sidebar"
                initial={{ x: -32, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -32, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="absolute inset-0"
              >
                <Sidebar mobile />
              </motion.div>
            )}
            {mobileView === "chat" && (
              <motion.div
                key="chat"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="absolute inset-0 flex flex-col"
              >
                {children}
              </motion.div>
            )}
            {mobileView === "artifact" && (
              <motion.div
                key="artifact"
                initial={{ x: 32, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 32, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="absolute inset-0"
              >
                <ArtifactPanel mobile />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <MobileNav hasArtifact={showArtifact} />
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-bg">
      <GlobalHotkeys />
      <CommandPalette />
      <aside
        className={cn(
          "shrink-0 transition-all duration-200 ease-out",
          sidebarCollapsed ? "w-[60px]" : "w-[260px]",
        )}
      >
        <Sidebar />
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 min-h-0 flex">
          <section className={cn("flex-1 min-w-0 flex flex-col", showArtifact && isTablet && "hidden")}>
            {children}
          </section>
          {showArtifact && (
            <aside
              className={cn(
                "shrink-0 border-l hairline transition-[width] duration-200 ease-out",
                isTablet ? "w-full" : "w-[42%] min-w-[420px] max-w-[720px]",
              )}
            >
              <ArtifactPanel />
            </aside>
          )}
        </div>
        <BottomPanel />
      </main>
    </div>
  );
}
