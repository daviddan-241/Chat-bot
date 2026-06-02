import { create } from "zustand";
import type { Workspace } from "@/lib/types";

interface WorkspaceState {
  current: Workspace | null;
  setCurrent: (w: Workspace | null) => void;
}

const STORAGE_KEY = "aiw_current_ws";

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  current: null,
  setCurrent: (w) => {
    if (typeof window !== "undefined") {
      if (w) localStorage.setItem(STORAGE_KEY, w.id);
      else localStorage.removeItem(STORAGE_KEY);
    }
    set({ current: w });
  },
}));

export function getStoredWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}
