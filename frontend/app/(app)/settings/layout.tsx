"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, User as UserIcon, Workflow, Rocket, Brain, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui-store";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/settings", label: "Account", icon: UserIcon, exact: true },
  { href: "/settings/integrations", label: "Integrations", icon: Workflow },
  { href: "/settings/deployments", label: "Deployments", icon: Rocket },
  { href: "/settings/memory", label: "Memory", icon: Brain },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const { setMobileView } = useUIStore();

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 px-4 md:px-6 py-2.5 border-b hairline flex items-center gap-2">
        {isMobile && (
          <Button variant="ghost" size="icon-sm" onClick={() => setMobileView("sidebar")}>
            <Menu size={16} />
          </Button>
        )}
        <Settings size={14} className="text-ink-muted" />
        <span className="text-sm font-medium text-ink">Settings</span>
      </header>
      <div className="border-b hairline overflow-x-auto">
        <nav className="flex items-center gap-1 px-3 md:px-5 py-1.5 min-w-max">
          {tabs.map((t) => {
            const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
            const Icon = t.icon;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition",
                  active ? "bg-white/[0.07] text-ink" : "text-ink-muted hover:text-ink hover:bg-white/[0.04]",
                )}
              >
                <Icon size={12} /> {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
