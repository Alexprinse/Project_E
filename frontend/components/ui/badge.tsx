import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "outline";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  default:
    "bg-muted/60 text-muted-foreground border-border",
  success:
    "bg-teal-success/10 text-teal-success border-teal-success/20",
  warning:
    "bg-amber-warning/10 text-amber-warning border-amber-warning/20",
  danger:
    "bg-destructive/10 text-destructive border-destructive/20",
  info:
    "bg-primary/10 text-primary border-primary/20",
  outline:
    "bg-transparent text-muted-foreground border-border",
};

const dotStyles: Record<BadgeVariant, string> = {
  default: "bg-muted-foreground",
  success: "bg-teal-success status-dot-online",
  warning: "bg-amber-warning",
  danger: "bg-destructive",
  info: "bg-primary",
  outline: "bg-muted-foreground",
};

export function Badge({
  variant = "default",
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5",
        "font-mono text-[10px] font-semibold uppercase tracking-wider",
        "transition-colors duration-150",
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotStyles[variant])}
        />
      )}
      {children}
    </span>
  );
}
