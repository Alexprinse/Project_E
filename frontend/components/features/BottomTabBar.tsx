"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Database,
  MessageSquare,
  Network,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/",              label: "Home",    icon: LayoutDashboard, exact: true },
  { href: "/ingestion",     label: "Ingest",  icon: Database,        exact: false },
  { href: "/copilot",       label: "Copilot", icon: MessageSquare,   exact: false },
  { href: "/graph-explorer",label: "Graph",   icon: Network,         exact: false },
  { href: "/rca",           label: "RCA",     icon: ShieldAlert,     exact: false },
];

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav
      className={cn(
        "lg:hidden fixed bottom-0 left-0 right-0 z-50 bottom-tab-bar",
        "glass border-t border-border/60",
        "flex items-stretch"
      )}
      aria-label="Main navigation"
    >
      {TABS.map(({ href, label, icon: Icon, exact }) => {
        const isActive = exact ? pathname === href : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-0.5",
              "min-h-[56px] py-2 px-1 no-zoom tap-target",
              "relative transition-colors duration-150",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            {/* Active pill background */}
            {isActive && (
              <span
                className="absolute top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-primary/15 border border-primary/20"
                style={{ width: 40, height: 32 }}
              />
            )}

            <Icon
              className={cn(
                "relative z-10 transition-all duration-150",
                "h-[19px] w-[19px]",
                isActive ? "scale-110 text-primary" : "scale-100 text-muted-foreground"
              )}
              strokeWidth={isActive ? 2.2 : 1.7}
            />
            <span
              className={cn(
                "relative z-10 text-[9px] font-display font-bold tracking-widest uppercase",
                "transition-colors duration-150",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
