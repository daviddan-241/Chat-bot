import { create } from "zustand";
import type { User } from "@/lib/types";
import { auth, authApi } from "@/lib/api";

interface AuthState {
  user: User | null;
  initialized: boolean;
  loading: boolean;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, full_name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  initialized: false,
  loading: false,
  bootstrap: async () => {
    if (!auth.access) {
      set({ initialized: true, user: null });
      return;
    }
    try {
      const u = await authApi.me();
      set({ user: u, initialized: true });
    } catch {
      auth.clear();
      set({ user: null, initialized: true });
    }
  },
  login: async (email, password) => {
    set({ loading: true });
    try {
      const t = await authApi.login(email, password);
      auth.set(t);
      set({ user: t.user });
    } finally {
      set({ loading: false });
    }
  },
  register: async (email, password, full_name) => {
    set({ loading: true });
    try {
      const t = await authApi.register(email, password, full_name);
      auth.set(t);
      set({ user: t.user });
    } finally {
      set({ loading: false });
    }
  },
  logout: async () => {
    await authApi.logout();
    set({ user: null });
    if (typeof window !== "undefined") window.location.href = "/login";
  },
}));
