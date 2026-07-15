import * as React from "react";
import { cn } from "@/lib/utils";

/* ── Card Root ── */
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  glass?: boolean;
  hover?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, elevated, glass, hover, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground transition-all duration-200",
        elevated && "shadow-[var(--shadow-card)]",
        glass && "glass",
        hover && "hover:border-border/80 hover:shadow-[var(--shadow-card)] hover:-translate-y-0.5",
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

/* ── Card Header ── */
const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center gap-2.5 border-b border-border px-5 py-3.5 bg-muted/30",
      className
    )}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

/* ── Card Title (used inside CardHeader) ── */
const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "font-display font-semibold text-[11px] tracking-wider uppercase text-muted-foreground",
      className
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

/* ── Card Body ── */
const CardBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("p-5", className)}
    {...props}
  />
));
CardBody.displayName = "CardBody";

/* ── Card Footer ── */
const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center border-t border-border px-5 py-3.5",
      className
    )}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardTitle, CardBody, CardFooter };
