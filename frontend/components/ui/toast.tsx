"use client";
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, XCircle, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "info" | "success" | "error" | "warning";
interface Toast { id: string; kind: ToastKind; message: string; title?: string; }

interface Ctx { push: (t: Omit<Toast, "id">) => void; }
const ToastCtx = React.createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((s) => [...s, { ...t, id }]);
    setTimeout(() => setToasts((s) => s.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className={cn(
                "glass pointer-events-auto flex items-start gap-3 rounded-xl px-3.5 py-3 min-w-[260px] max-w-sm shadow-2xl",
              )}
            >
              <ToastIcon kind={t.kind} />
              <div className="flex-1">
                {t.title && <div className="text-sm font-medium text-ink">{t.title}</div>}
                <div className="text-xs text-ink-muted">{t.message}</div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

function ToastIcon({ kind }: { kind: ToastKind }) {
  const map = {
    info: <Info size={16} className="text-accent-glow mt-0.5" />,
    success: <CheckCircle2 size={16} className="text-success mt-0.5" />,
    error: <XCircle size={16} className="text-danger mt-0.5" />,
    warning: <AlertTriangle size={16} className="text-warning mt-0.5" />,
  };
  return map[kind];
}

export function useToast() {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
