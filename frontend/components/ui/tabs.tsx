"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TabItem {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
  size?: "sm" | "md";
}

export function Tabs({ items, activeId, onChange, className, size = "md" }: TabsProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg border border-border bg-muted/20 p-1",
        className
      )}
      role="tablist"
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.id)}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1.5 rounded-md transition-all duration-150 font-display font-semibold uppercase tracking-wider tap-target",
              size === "sm" ? "text-[9px] py-1.5 px-2 min-h-[32px]" : "text-[10px] py-2 px-3 min-h-[36px]",
              isActive
                ? "bg-card text-foreground shadow-[var(--shadow-sm)] border border-border/60"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span>{item.label}</span>
            {item.count !== undefined && (
              <span
                className={cn(
                  "rounded px-1 py-0.5 text-[8px] font-mono",
                  isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
