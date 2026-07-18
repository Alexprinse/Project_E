"use client";

import React from "react";
import { ShieldCheck, Sparkles, AlertTriangle, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Citation } from "@/lib/api";

/* ─── Confidence indicator ───
 * Shared between the Copilot chat panel and the History audit view - do not fork this,
 * both surfaces must render confidence identically. */
export function ConfidenceBadge({ confidence }: { confidence: string | null }) {
  if (!confidence) return null;
  const map = {
    high: { variant: "success" as const, icon: ShieldCheck, label: "High Confidence" },
    medium: { variant: "info" as const, icon: Sparkles, label: "Medium Confidence" },
    low: { variant: "warning" as const, icon: AlertTriangle, label: "Low Confidence" },
  };
  const entry = map[confidence as keyof typeof map];
  if (!entry) return null;
  const Icon = entry.icon;
  return (
    <Badge variant={entry.variant} dot className="gap-1.5">
      <Icon className="h-3 w-3" />
      {entry.label}
    </Badge>
  );
}

/* ─── Citation list ───
 * The reusable "source card" list used by the Copilot's citation sidebar and the History
 * entry detail view. `onCitationClick` is optional so History can render it read-only. */
export function CitationList({
  citations,
  onCitationClick,
}: {
  citations: Citation[];
  onCitationClick?: (c: Citation) => void;
}) {
  if (citations.length === 0) {
    return (
      <div className="py-6 text-center text-[11px] font-mono text-muted-foreground border border-dashed border-border rounded-lg">
        No citations detected
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {citations.map((cite, idx) => {
        const content = (
          <>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-foreground/80">
              <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="truncate font-semibold">{cite.document_name}</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
              &ldquo;{cite.snippet}&rdquo;
            </p>
          </>
        );
        const className =
          "w-full text-left p-3 rounded-lg border border-border bg-muted/10 " +
          "transition-all duration-150 tap-target min-h-[44px] space-y-1.5" +
          (onCitationClick ? " hover:bg-accent hover:border-border/80" : "");

        if (onCitationClick) {
          return (
            <button key={idx} onClick={() => onCitationClick(cite)} className={className}>
              {content}
            </button>
          );
        }
        return (
          <div key={idx} className={className}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
