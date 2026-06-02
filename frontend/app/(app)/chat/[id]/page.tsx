"use client";
import { use } from "react";
import { ChatView } from "@/components/chat/chat-view";

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ChatView chatId={id} />;
}
