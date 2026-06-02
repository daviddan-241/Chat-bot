import { create } from "zustand";
import type { Artifact } from "@/lib/types";

interface ArtifactState {
  active: Artifact | null;
  open: boolean;
  /** in-flight streaming artifact preview (before backend persistence completes) */
  draft: { type: Artifact["type"]; language: string | null; content: string; title?: string } | null;

  setActive: (a: Artifact | null) => void;
  setOpen: (open: boolean) => void;
  setDraft: (d: ArtifactState["draft"]) => void;
  /** Optimistically patch the active artifact (used after PATCH /artifacts/:id) */
  patchActive: (changes: Partial<Artifact>) => void;
}

export const useArtifactStore = create<ArtifactState>((set) => ({
  active: null,
  open: false,
  draft: null,
  setActive: (a) => set({ active: a, open: a ? true : false, draft: null }),
  setOpen: (open) => set({ open }),
  setDraft: (d) => set({ draft: d, open: d ? true : undefined }),
  patchActive: (changes) =>
    set((s) => ({ active: s.active ? { ...s.active, ...changes } : s.active })),
}));
