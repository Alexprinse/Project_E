import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant =
  | "default"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "primary-glow"
  | "link";

type ButtonSize = "default" | "sm" | "lg" | "icon" | "icon-sm";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-primary text-primary-foreground border-primary hover:bg-primary/90 shadow-sm",
  destructive:
    "bg-destructive text-destructive-foreground border-destructive hover:bg-destructive/90",
  outline:
    "border-border bg-transparent text-foreground hover:bg-accent hover:border-border/80",
  secondary:
    "bg-secondary text-secondary-foreground border-border hover:bg-accent",
  ghost:
    "border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
  "primary-glow":
    "bg-primary text-primary-foreground border-primary hover:bg-primary/90 shadow-[var(--glow-primary)]",
  link:
    "border-transparent bg-transparent text-primary underline-offset-4 hover:underline p-0 h-auto",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-9 px-4 py-2 text-[11px]",
  sm:      "h-8 px-3 py-1.5 text-[10px]",
  lg:      "h-11 px-6 py-2.5 text-[12px]",
  icon:    "h-9 w-9 p-0",
  "icon-sm": "h-8 w-8 p-0",
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          // Base
          "inline-flex items-center justify-center gap-2 whitespace-nowrap",
          "font-display font-semibold uppercase tracking-wider",
          "rounded-lg border transition-all duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-40",
          "tap-target active:scale-[0.97]",
          // Variant
          variantClasses[variant],
          // Size
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button };
