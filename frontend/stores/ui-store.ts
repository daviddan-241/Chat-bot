import { create } from "zustand";

export type MobileView = "chat" | "artifact" | "sidebar";

interface UIState {
  sidebarCollapsed: boolean;
  bottomPanelOpen: boolean;
  bottomPanelHeight: number;
  mobileView: MobileView;

  toggleSidebar: () => void;
  setSidebar: (v: boolean) => void;
  toggleBottomPanel: () => void;
  setBottomPanelHeight: (n: number) => void;
  setMobileView: (v: MobileView) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  bottomPanelOpen: false,
  bottomPanelHeight: 240,
  mobileView: "chat",
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebar: (v) => set({ sidebarCollapsed: v }),
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  setBottomPanelHeight: (n) => set({ bottomPanelHeight: Math.max(140, Math.min(560, n)) }),
  setMobileView: (v) => set({ mobileView: v }),
}));
