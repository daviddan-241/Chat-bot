"use client";
import { useRouter } from "next/navigation";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useCommandStore } from "@/stores/command-store";
import { useArtifactStore } from "@/stores/artifact-store";
import { useUIStore } from "@/stores/ui-store";

/** Global keyboard shortcuts available everywhere in the (app) shell. */
export function GlobalHotkeys() {
  const router = useRouter();
  const { toggle: toggleCommand } = useCommandStore();
  const { setOpen: setArtifactOpen, active, draft } = useArtifactStore();
  const { toggleSidebar, toggleBottomPanel } = useUIStore();

  useHotkeys([
    { combo: "mod+k", handler: () => toggleCommand(), allowInInput: true, description: "Command palette" },
    {
      combo: "mod+shift+p",
      handler: () => {
        if (active || draft) setArtifactOpen(true);
        else router.push("/artifacts");
      },
      allowInInput: true,
      description: "Open artifacts",
    },
    { combo: "mod+b", handler: () => toggleSidebar(), description: "Toggle sidebar" },
    { combo: "mod+j", handler: () => router.push("/chat"), description: "Go to chat" },
    { combo: "mod+/", handler: () => toggleBottomPanel(), description: "Toggle bottom panel" },
    { combo: "mod+,", handler: () => router.push("/settings"), description: "Open settings" },
  ]);

  return null;
}
