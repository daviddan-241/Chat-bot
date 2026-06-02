"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { useWorkspaceStore, getStoredWorkspaceId } from "@/stores/workspace-store";
import { workspacesApi } from "@/lib/api";
import { Spinner } from "@/components/ui/spinner";
import { AppShell } from "@/components/layout/app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, initialized, bootstrap } = useAuthStore();
  const { current, setCurrent } = useWorkspaceStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!initialized) bootstrap();
  }, [initialized, bootstrap]);

  useEffect(() => {
    if (initialized && !user) router.replace("/login");
  }, [initialized, user, router]);

  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: workspacesApi.list,
    enabled: !!user,
  });

  useEffect(() => {
    if (!workspaces || current) return;
    const stored = getStoredWorkspaceId();
    const found = (stored && workspaces.find((w) => w.id === stored)) || workspaces[0] || null;
    if (found) setCurrent(found);
    setReady(true);
  }, [workspaces, current, setCurrent]);

  useEffect(() => {
    if (current) setReady(true);
  }, [current]);

  if (!initialized || !user || !ready) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size={28} />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
