"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Database, MessageSquare, Network } from "lucide-react";

const TABS = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    href: "/ingestion",
    label: "Ingest",
    icon: Database,
    exact: false,
  },
  {
    href: "/copilot",
    label: "Copilot",
    icon: MessageSquare,
    exact: false,
  },
  {
    href: "/graph-explorer",
    label: "Graph",
    icon: Network,
    exact: false,
  },
];

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    /* Visible only below lg breakpoint */
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bottom-tab-bar
                 bg-card/95 backdrop-blur-md border-t border-border
                 flex items-stretch"
      aria-label="Main navigation"
    >
      {TABS.map(({ href, label, icon: Icon, exact }) => {
        const isActive = exact ? pathname === href : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            className={`
              flex-1 flex flex-col items-center justify-center gap-1
              min-h-[56px] py-2 px-1 no-zoom tap-target
              transition-colors duration-150
              ${isActive
                ? "text-primary"
                : "text-muted-foreground hover:text-slate-300"
              }
            `}
            aria-current={isActive ? "page" : undefined}
          >
            {/* Active indicator dot above icon */}
            <span
              className={`
                h-0.5 w-5 rounded-full mb-0.5 transition-all duration-200
                ${isActive ? "bg-primary" : "bg-transparent"}
              `}
            />
            <Icon
              className={`h-5 w-5 transition-all duration-150 ${
                isActive ? "scale-110" : "scale-100"
              }`}
              strokeWidth={isActive ? 2.2 : 1.8}
            />
            <span
              className={`
                text-[9px] font-display font-semibold tracking-widest uppercase
                transition-colors duration-150
                ${isActive ? "text-primary" : "text-muted-foreground"}
              `}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
