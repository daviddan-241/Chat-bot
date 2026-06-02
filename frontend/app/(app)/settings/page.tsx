"use client";
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Sparkles, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useAuthStore } from "@/stores/auth-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { preferencesApi } from "@/lib/api";
import { initials } from "@/lib/utils";

export default function SettingsAccountPage() {
  const { user, logout } = useAuthStore();
  const { current } = useWorkspaceStore();
  const qc = useQueryClient();
  const { push } = useToast();

  const { data: prefs, isLoading } = useQuery({
    queryKey: ["preferences"],
    queryFn: preferencesApi.get,
  });

  const [model, setModel] = useState("");
  const [system, setSystem] = useState("");
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    if (!prefs) return;
    setModel(prefs.default_model ?? "");
    setSystem(prefs.default_system_prompt ?? "");
    setTheme(prefs.theme ?? "dark");
  }, [prefs]);

  const save = useMutation({
    mutationFn: () =>
      preferencesApi.update({
        theme,
        default_model: model || null,
        default_system_prompt: system || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["preferences"] });
      push({ kind: "success", message: "Preferences saved" });
    },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto w-full space-y-4">
      <section className="glass rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 grid place-items-center text-sm font-semibold text-white shrink-0">
            {initials(user?.full_name, user?.email)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink truncate">{user?.full_name || "—"}</div>
            <div className="text-xs text-ink-muted truncate">{user?.email}</div>
          </div>
          <Button variant="outline" onClick={() => logout()}>
            <LogOut size={14} /> Sign out
          </Button>
        </div>
      </section>

      <section className="glass rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-accent-glow" />
          <h3 className="text-sm font-semibold">Current workspace</h3>
        </div>
        <div className="text-xs text-ink-muted space-y-0.5">
          <div><span className="text-ink-faint">Name:</span> {current?.name}</div>
          <div><span className="text-ink-faint">Slug:</span> <span className="font-mono">{current?.slug}</span></div>
          <div><span className="text-ink-faint">ID:</span> <span className="font-mono text-[10px]">{current?.id}</span></div>
        </div>
      </section>

      <section className="glass rounded-2xl p-5">
        <h3 className="text-sm font-semibold mb-3">Preferences</h3>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-ink-muted">Default model</label>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-4o-mini"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-ink-muted">Default system prompt</label>
              <Textarea
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                rows={4}
                placeholder="You are a helpful AI assistant..."
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-ink-muted">Theme</label>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-ink"
              >
                <option value="dark">Dark</option>
                <option value="midnight">Midnight</option>
              </select>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? <Spinner size={13} /> : <Save size={13} />} Save
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="glass rounded-2xl p-5">
        <h3 className="text-sm font-semibold mb-2">About Nova</h3>
        <p className="text-xs text-ink-muted leading-relaxed">
          Streaming chat, versioned artifacts, project files & GitHub sync, deployments
          to Vercel/Railway, encrypted env vars, semantic memory, and a full mobile UX.
        </p>
        <div className="text-[10px] text-ink-faint mt-3">v1.1.0</div>
      </section>
    </div>
  );
}
