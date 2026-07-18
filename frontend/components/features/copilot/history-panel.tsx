"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  History as HistoryIcon,
  ChevronDown,
  ChevronRight,
  Trash2,
  Loader2,
  RefreshCw,
  MessageSquare,
  ShieldAlert,
  BarChart2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfidenceBadge, CitationList } from "@/components/features/copilot/citation-confidence";
import { api, HistoryEntry } from "@/lib/api";

/* Read-only audit trail of past Copilot/RCA query-answer exchanges, rendered inline within
 * the Copilot page (desktop side panel + mobile bottom sheet). Selecting an entry only
 * populates the composer input - no answer/context is carried over, this is not
 * conversational memory. See backend HistoryRepository for the isolation guarantees. */

const TYPE_META: Record<string, { label: string; icon: React.ElementType }> = {
  copilot: { label: "Copilot", icon: MessageSquare },
  rca: { label: "RCA", icon: ShieldAlert },
  "keyword-comparison": { label: "Compare", icon: BarChart2 },
};

function formatTimestamp(ms: number | null): string {
  if (!ms) return "Unknown time";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function EntryTypeBadge({ queryType }: { queryType: string }) {
  const meta = TYPE_META[queryType] || { label: queryType, icon: MessageSquare };
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className="gap-1">
      <Icon className="h-2.5 w-2.5" />
      {meta.label}
    </Badge>
  );
}

export interface HistoryPanelProps {
  /** Populate the Copilot composer with this query text - does not auto-submit. */
  onSelectQuery: (queryText: string) => void;
}

export function HistoryPanel({ onSelectQuery }: HistoryPanelProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getHistory(50);
      setEntries(data.entries);
    } catch (e) {
      console.error("Failed to load query history", e);
      setError("Could not reach the audit history log.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleToggleExpand = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setExpandedId((current) => (current === id ? null : id));
  };

  const handleDelete = async (e: React.MouseEvent, entry: HistoryEntry) => {
    e.stopPropagation();
    if (!window.confirm(`Delete this history entry?\n\n"${entry.query_text}"`)) return;
    setDeletingId(entry.id);
    try {
      await api.deleteHistoryEntry(entry.id);
      setEntries((prev) => prev.filter((it) => it.id !== entry.id));
      if (expandedId === entry.id) setExpandedId(null);
    } catch (e) {
      console.error("Failed to delete history entry", e);
      alert("Delete failed: " + (e as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    if (entries.length === 0) return;
    if (!window.confirm(`Delete all ${entries.length} history entries? This cannot be undone.`)) return;
    setClearing(true);
    try {
      await api.clearHistory();
      setEntries([]);
      setExpandedId(null);
    } catch (e) {
      console.error("Failed to clear history", e);
      alert("Clear failed: " + (e as Error).message);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="shrink-0 p-5 pb-4 space-y-1 border-b border-border">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-sm text-foreground">Query History</h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={fetchHistory} disabled={loading} title="Refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          Read-only audit trail — click an entry to re-ask it. No context carries over.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleClearAll}
          disabled={loading || clearing || entries.length === 0}
          className="w-full gap-1.5 mt-2"
        >
          {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Clear All {entries.length > 0 ? `(${entries.length})` : ""}
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto scroll-touch p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-xs font-mono text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>Loading history...</span>
          </div>
        ) : error ? (
          <EmptyState icon={HistoryIcon} title="History unavailable" description={error} className="py-8" />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={HistoryIcon}
            title="No queries logged yet"
            description="Past Copilot and RCA answers will appear here."
            className="py-8"
          />
        ) : (
          entries.map((entry) => {
            const isExpanded = expandedId === entry.id;
            return (
              <div key={entry.id} className="rounded-lg border border-border bg-muted/5 overflow-hidden">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectQuery(entry.query_text)}
                  onKeyDown={(e) => e.key === "Enter" && onSelectQuery(entry.query_text)}
                  title="Click to re-ask this query"
                  className="w-full text-left p-3 flex items-start gap-2 hover:bg-accent/40 transition-colors duration-150 cursor-pointer tap-target"
                >
                  <button
                    onClick={(e) => handleToggleExpand(e, entry.id)}
                    className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground"
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[9px] font-mono text-muted-foreground">
                        {formatTimestamp(entry.created_at)}
                      </span>
                      <EntryTypeBadge queryType={entry.query_type} />
                      <ConfidenceBadge confidence={entry.confidence} />
                    </div>
                    <p className={`text-xs text-foreground/90 ${isExpanded ? "" : "truncate"}`}>
                      {entry.query_text}
                    </p>
                  </div>

                  <button
                    onClick={(e) => handleDelete(e, entry)}
                    title="Delete entry"
                    className="shrink-0 h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    {deletingId === entry.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-border p-3 space-y-3 bg-muted/10">
                    <div className="space-y-1">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                        Answer
                      </span>
                      <p className="text-xs text-foreground/90 whitespace-pre-line leading-relaxed">
                        {entry.answer_text}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                          Citations
                        </span>
                        {entry.citations.length > 0 && <Badge variant="info">{entry.citations.length}</Badge>}
                      </div>
                      <CitationList citations={entry.citations} />
                    </div>
                    {entry.execution_time_sec !== null && (
                      <p className="text-[9px] font-mono text-muted-foreground/60 border-t border-border pt-2">
                        Answered in {entry.execution_time_sec.toFixed(2)}s
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
