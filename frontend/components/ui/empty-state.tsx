import * as React from "react";
import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  iconClassName?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  iconClassName,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-12 px-6 space-y-4",
        className
      )}
    >
      <div
        className={cn(
          "p-4 rounded-2xl border border-border bg-muted/30",
          iconClassName
        )}
      >
        <Icon className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
      </div>

      <div className="space-y-1.5 max-w-xs">
        <h3 className="font-display font-semibold text-sm text-foreground tracking-tight">
          {title}
        </h3>
        {description && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
