"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Sparkles, Plus, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { chatsApi } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useUIStore } from "@/stores/ui-store";
import { useIsMobile } from "@/hooks/use-media-query";
import { useToast } from "@/components/ui/toast";

export default function ChatLanding() {
  const router = useRouter();
  const { current } = useWorkspaceStore();
  const { setMobileView } = useUIStore();
  const isMobile = useIsMobile();
  const { push } = useToast();

  const { data: chats, isLoading } = useQuery({
    queryKey: ["chats", current?.id],
    queryFn: () => chatsApi.list(current!.id),
    enabled: !!current,
  });

  const createChat = useMutation({
    mutationFn: async () => {
      const agents = await import("@/lib/api").then((m) => m.agentsApi.list());
      const def = agents.find((a) => a.is_default) || agents[0];
      return chatsApi.create({
        workspace_id: current!.id,
        title: "New chat",
        agent_id: def?.id,
      });
    },
    onSuccess: (chat) => router.replace(`/chat/${chat.id}`),
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });

  // Auto-route to most recent chat or auto-create one
  useEffect(() => {
    if (!current || isLoading) return;
    if (chats && chats.length > 0) router.replace(`/chat/${chats[0].id}`);
  }, [chats, current, isLoading, router]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 px-4 md:px-6 py-2.5 border-b hairline flex items-center gap-2">
        {isMobile && (
          <Button variant="ghost" size="icon-sm" onClick={() => setMobileView("sidebar")}>
            <Menu size={16} />
          </Button>
        )}
        <span className="text-sm font-medium text-ink-muted">Chat</span>
      </header>
      <div className="flex-1 grid place-items-center px-6">
        {isLoading ? (
          <Spinner />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-md"
          >
            <div className="inline-flex h-14 w-14 rounded-2xl bg-gradient-to-br from-accent to-fuchsia-500 items-center justify-center shadow-xl mb-4">
              <Sparkles size={22} className="text-white" />
            </div>
            <h1 className="text-xl font-semibold">Start a new conversation</h1>
            <p className="text-sm text-ink-muted mt-1">
              Nova streams responses, opens artifacts automatically, and keeps your workspace context.
            </p>
            <Button onClick={() => createChat.mutate()} disabled={createChat.isPending} className="mt-5">
              <Plus size={15} /> New chat
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
