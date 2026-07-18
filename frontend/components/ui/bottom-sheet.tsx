"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxHeight?: string;
  /** Bottom offset — e.g. to sit above a tab bar */
  bottomOffset?: string;
  className?: string;
}

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  maxHeight = "70vh",
  bottomOffset,
  className,
}: BottomSheetProps) {
  if (!open) return null;

  const bottomStyle = bottomOffset
    ? bottomOffset
    : "calc(0px + env(safe-area-inset-bottom, 0px))";

  return (
    <>
      {/* Backdrop - must hide in lockstep with the sheet panel below (same className),
          otherwise it stays full-screen on breakpoints where the sheet itself is hidden
          (e.g. "lg:hidden" sheets left a dimming overlay covering desktop with nothing
          visibly attached to it). */}
      <div
        onClick={onClose}
        className={cn("fixed inset-0 z-40 bg-slate-950/70 sheet-backdrop", className)}
      />

      {/* Sheet */}
      <div
        className={cn(
          "fixed left-0 right-0 z-50 bg-card border-t border-border rounded-t-2xl",
          "bottom-sheet flex flex-col",
          className
        )}
        style={{
          bottom: bottomStyle,
          maxHeight,
        }}
      >
        {/* Drag handle */}
        <div className="shrink-0 flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>

        {/* Header */}
        {title && (
          <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border">
            <span className="font-display font-semibold text-sm text-foreground">
              {title}
            </span>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors tap-target min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto scroll-touch pb-[calc(16px+56px+env(safe-area-inset-bottom,0px))] md:pb-6">
          {children}
        </div>
      </div>
    </>
  );
}
