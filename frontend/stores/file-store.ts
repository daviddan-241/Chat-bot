import { create } from "zustand";
import type { ProjectFile } from "@/lib/types";

interface OpenTab {
  fileId: string;
  projectId: string;
  name: string;
  path: string;
  content: string;
  mime_type: string;
  dirty: boolean;
}

interface FileState {
  tabs: OpenTab[];
  activeId: string | null;
  openTab: (f: ProjectFile) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  markClean: (id: string) => void;
  replaceTab: (id: string, patch: Partial<OpenTab>) => void;
}

export const useFileStore = create<FileState>((set) => ({
  tabs: [],
  activeId: null,
  openTab: (f) =>
    set((s) => {
      const exists = s.tabs.find((t) => t.fileId === f.id);
      if (exists) return { activeId: f.id };
      return {
        tabs: [
          ...s.tabs,
          {
            fileId: f.id,
            projectId: f.project_id,
            name: f.name,
            path: f.path,
            content: f.content,
            mime_type: f.mime_type,
            dirty: false,
          },
        ],
        activeId: f.id,
      };
    }),
  closeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.fileId !== id);
      let activeId = s.activeId;
      if (activeId === id) activeId = tabs.length ? tabs[tabs.length - 1].fileId : null;
      return { tabs, activeId };
    }),
  setActive: (id) => set({ activeId: id }),
  updateContent: (id, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.fileId === id ? { ...t, content, dirty: true } : t)),
    })),
  markClean: (id) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.fileId === id ? { ...t, dirty: false } : t)) })),
  replaceTab: (id, patch) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.fileId === id ? { ...t, ...patch } : t)) })),
}));

export type { OpenTab };
