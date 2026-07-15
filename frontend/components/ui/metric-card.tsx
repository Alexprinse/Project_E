import * as React from "react";
import { cn } from "@/lib/utils";
import { type LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";

type MetricVariant = "default" | "success" | "warning" | "danger" | "info";

interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: "up" | "down" | "flat";
  trendLabel?: string;
  variant?: MetricVariant;
  className?: string;
  loading?: boolean;
  badge?: React.ReactNode;
  delay?: number;
}

const variantIconColors: Record<MetricVariant, string> = {
  default: "text-primary bg-primary/10",
  success: "text-teal-success bg-teal-success/10",
  warning: "text-amber-warning bg-amber-warning/10",
  danger: "text-destructive bg-destructive/10",
  info: "text-primary bg-primary/10",
};

const trendColors = {
  up: "text-teal-success",
  down: "text-destructive",
  flat: "text-muted-foreground",
};

const TrendIcon = { up: TrendingUp, down: TrendingDown, flat: Minus };

export function MetricCard({
  icon: Icon,
  label,
  value,
  subtitle,
  trend,
  trendLabel,
  variant = "default",
  className,
  loading = false,
  badge,
  delay = 0,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        "animate-fade-in-up rounded-lg border border-border bg-card p-5",
        "hover:border-border/80 hover:shadow-[var(--shadow-card)] hover:-translate-y-0.5",
        "transition-all duration-200 group",
        className
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {loading ? (
        <div className="space-y-3">
          <div className="skeleton-shimmer h-8 w-8 rounded-lg" />
          <div className="skeleton-shimmer h-7 w-16 rounded" />
          <div className="skeleton-shimmer h-3 w-28 rounded" />
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between mb-3">
            <div className={cn("p-2 rounded-lg", variantIconColors[variant])}>
              <Icon className="h-4 w-4" strokeWidth={1.8} />
            </div>
            {badge}
          </div>

          <div className="font-mono text-2xl md:text-3xl font-bold text-foreground tracking-tight mb-1">
            {value}
          </div>

          <div className="font-display text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            {label}
          </div>

          {subtitle && (
            <p className="text-[10px] text-muted-foreground/70 leading-snug">
              {subtitle}
            </p>
          )}

          {trend && trendLabel && (
            <div className={cn("flex items-center gap-1 mt-2 text-[10px] font-mono", trendColors[trend])}>
              {React.createElement(TrendIcon[trend], { className: "h-3 w-3" })}
              <span>{trendLabel}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
