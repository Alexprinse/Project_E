import * as React from "react";
import { cn } from "@/lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  height?: string | number;
  width?: string | number;
  rounded?: boolean;
}

export function Skeleton({ className, height, width, rounded, style, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "skeleton-shimmer",
        rounded ? "rounded-full" : "rounded-md",
        className
      )}
      style={{
        height: height,
        width: width,
        ...style,
      }}
      {...props}
    />
  );
}

export function SkeletonCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-card p-5 space-y-3", className)}
      {...props}
    >
      <Skeleton height={10} width="60%" />
      <Skeleton height={32} width="40%" />
      <Skeleton height={8} width="80%" />
    </div>
  );
}
