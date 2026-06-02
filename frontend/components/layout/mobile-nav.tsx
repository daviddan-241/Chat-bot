"use client";
import { MessageSquare, Menu, FileCode2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui-store";

export function MobileNav({ hasArtifact }: { hasArtifact: boolean }) {
  const { mobileView, setMobileView } = useUIStore();
  const Tab = ({
    value, icon, label, badge,
  }: { value: typeof mobileView; icon: React.ReactNode; label: string; badge?: boolean }) => (
    <button
      onClick={() => setMobileView(value)}
      className={cn(
        "relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition",
        mobileView === value ? "text-ink" : "text-ink-faint",
      )}
    >
      <div className="relative">
        {icon}
        {badge && (
          <span className="absolute -top-1 -right-1.5 h-2 w-2 rounded-full bg-accent animate-pulse-glow" />
        )}
      </div>
      <span className="text-[10px] font-medium">{label}</span>
      {mobileView === value && (
        <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full bg-accent" />
      )}
    </button>
  );

  return (
    <nav className="shrink-0 border-t hairline bg-bg-soft/80 backdrop-blur-md safe-bottom">
      <div className="flex">
        <Tab value="sidebar" icon={<Menu size={18} />} label="Menu" />
        <Tab value="chat" icon={<MessageSquare size={18} />} label="Chat" />
        <Tab value="artifact" icon={<FileCode2 size={18} />} label="Artifact" badge={hasArtifact} />
      </div>
    </nav>
  );
}
