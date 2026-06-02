import { create } from "zustand";

interface CommandState {
  open: boolean;
  query: string;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  setQuery: (q: string) => void;
}

export const useCommandStore = create<CommandState>((set) => ({
  open: false,
  query: "",
  setOpen: (v) => set({ open: v, query: v ? "" : "" }),
  toggle: () => set((s) => ({ open: !s.open, query: "" })),
  setQuery: (q) => set({ query: q }),
}));
