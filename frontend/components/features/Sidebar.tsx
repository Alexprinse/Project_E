"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Radio,
  LayoutDashboard,
  Database,
  MessageSquare,
  Network,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  sublabel?: string;
  icon: React.ElementType;
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    sublabel: "Control Room",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    href: "/ingestion",
    label: "Ingestion",
    sublabel: "Pipeline",
    icon: Database,
  },
  {
    href: "/copilot",
    label: "AI Copilot",
    sublabel: "Hybrid QA",
    icon: MessageSquare,
  },
  {
    href: "/graph-explorer",
    label: "Graph Explorer",
    sublabel: "P&ID Network",
    icon: Network,
  },
  {
    href: "/rca",
    label: "RCA Assistant",
    sublabel: "Failure Analysis",
    icon: ShieldAlert,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col border-r border-border bg-card shrink-0",
        "transition-all duration-300 ease-in-out select-none",
        collapsed ? "w-[60px]" : "w-60"
      )}
    >
      {/* ── Logo ── */}
      <div
        className={cn(
          "border-b border-border bg-muted/20 flex items-center shrink-0",
          collapsed ? "p-4 justify-center" : "px-5 py-4"
        )}
      >
        {collapsed ? (
          <Radio className="h-5 w-5 text-primary animate-pulse" />
        ) : (
          <Link href="/" className="flex items-center gap-3 min-w-0">
            <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20 shrink-0">
              <Radio className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="font-display font-bold text-sm tracking-widest text-foreground uppercase truncate">
                Marg
              </div>
              <div className="text-[9px] font-mono text-muted-foreground tracking-widest uppercase">
                Knowledge Intelligence
              </div>
            </div>
          </Link>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className={cn("flex-1 py-3", collapsed ? "px-2" : "px-3")} aria-label="Main">
        {/* Section label */}
        {!collapsed && (
          <div className="px-3 pb-2">
            <span className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-widest">
              Navigation
            </span>
          </div>
        )}

        <div className="space-y-0.5">
          {NAV_ITEMS.map(({ href, label, sublabel, icon: Icon, exact }) => {
            const isActive = exact ? pathname === href : pathname.startsWith(href);

            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={cn(
                  "flex items-center rounded-lg transition-all duration-150 group relative",
                  collapsed
                    ? "justify-center p-3"
                    : "gap-3 px-3 py-2.5",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                {/* Active bar */}
                {isActive && !collapsed && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
                )}

                <Icon
                  className={cn(
                    "shrink-0 transition-colors duration-150",
                    collapsed ? "h-5 w-5" : "h-4 w-4",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground group-hover:text-foreground"
                  )}
                  strokeWidth={isActive ? 2.2 : 1.8}
                />

                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "text-xs font-display font-semibold tracking-wide truncate",
                        isActive ? "text-primary" : "text-foreground/80 group-hover:text-foreground"
                      )}
                    >
                      {label}
                    </div>
                    {sublabel && (
                      <div className="text-[9px] font-mono text-muted-foreground/60 truncate">
                        {sublabel}
                      </div>
                    )}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* ── System Info Footer ── */}
      <div className={cn("border-t border-border bg-muted/10 shrink-0", collapsed ? "p-3" : "p-4")}>
        {collapsed ? (
          <div className="flex justify-center">
            <span className="status-dot status-dot-online" />
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
              <Cpu className="h-3 w-3 shrink-0 text-primary/60" />
              <span className="truncate">Gemini 2.5 Pro</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
              <Zap className="h-3 w-3 shrink-0 text-primary/60" />
              <span className="truncate">Neo4j AuraDB</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1 pt-2 border-t border-border/60">
              <span className="status-dot status-dot-online" />
              <span className="text-[9px] font-mono text-teal-success uppercase tracking-widest">
                Overseer Online
              </span>
            </div>
          </div>
        )}

        {/* ── Collapse toggle ── */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            "mt-3 w-full flex items-center justify-center gap-1.5 rounded-md border border-border",
            "py-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground",
            "hover:bg-accent hover:text-foreground transition-all duration-150 tap-target"
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <>
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
