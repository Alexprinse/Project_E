"use client";

import React, { useState } from "react";
import {
  ShieldAlert,
  Loader2,
  BookOpen,
  X,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  HelpCircle,
  FileText,
  AlertCircle,
  Wrench,
  Tag,
  Clock,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { useStreamingRca } from "@/hooks/use-streaming-rca";
import { Citation, FailureNode } from "@/lib/api";

interface RcaSections {
  rootCause: string;
  contributingFactors: string;
  affectedEquipment: string;
  relatedRegulations: string;
  recommendedAction: string;
}

function parseRcaReport(text: string, isAnalyzing: boolean): RcaSections {
  const sections: RcaSections = {
    rootCause: "",
    contributingFactors: "",
    affectedEquipment: "",
    relatedRegulations: "",
    recommendedAction: "",
  };

  if (!text) {
    const placeholder = isAnalyzing ? "Generating..." : "Awaiting selection...";
    return { rootCause: placeholder, contributingFactors: placeholder, affectedEquipment: placeholder, relatedRegulations: placeholder, recommendedAction: placeholder };
  }

  const lines = text.split("\n");
  let currentSection: keyof RcaSections | null = null;

  for (const line of lines) {
    const lowerLine = line.toLowerCase().trim();
    if (lowerLine.startsWith("### root cause") || lowerLine === "root cause:") {
      currentSection = "rootCause"; continue;
    } else if (lowerLine.startsWith("### contributing factors") || lowerLine === "contributing factors:") {
      currentSection = "contributingFactors"; continue;
    } else if (lowerLine.startsWith("### affected equipment") || lowerLine === "affected equipment:") {
      currentSection = "affectedEquipment"; continue;
    } else if (lowerLine.startsWith("### related regulations") || lowerLine === "related regulations:") {
      currentSection = "relatedRegulations"; continue;
    } else if (lowerLine.startsWith("### recommended action") || lowerLine === "recommended action:") {
      currentSection = "recommendedAction"; continue;
    }
    if (currentSection) sections[currentSection] += line + "\n";
  }

  for (const k of Object.keys(sections) as Array<keyof RcaSections>) {
    sections[k] = sections[k].trim();
    if (!sections[k]) sections[k] = isAnalyzing ? "Generating..." : "No data for this section.";
  }
  return sections;
}

function parseLineWithCitations(line: string, citations: Citation[]): React.ReactNode[] {
  const parts = line.split("**");
  return parts.map((part, pIdx) => {
    const isBold = pIdx % 2 === 1;
    const citationRegex = /\[((?:DOC-[a-zA-Z0-9_-]+)(?:\s*,\s*DOC-[a-zA-Z0-9_-]+)*)\]/gi;
    const segments: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = citationRegex.exec(part)) !== null) {
      const matchIndex = match.index;
      const matchContent = match[1];

      if (matchIndex > lastIndex) {
        segments.push(part.substring(lastIndex, matchIndex));
      }

      const docIds = matchContent.split(",").map(id => id.trim());
      docIds.forEach((docId, subIdx) => {
        if (subIdx > 0) {
          segments.push(", ");
        }

        const citation = citations.find(c => c.document_id.toLowerCase() === docId.toLowerCase());
        if (citation) {
          segments.push(
            <span
              key={docId + "-" + matchIndex + "-" + subIdx}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary font-mono text-[10px] font-semibold hover:bg-primary/20 cursor-pointer transition-colors"
              title={citation.snippet}
            >
              {citation.document_name}
            </span>
          );
        } else {
          segments.push(
            <span
              key={docId + "-" + matchIndex + "-" + subIdx}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground font-mono text-[10px]"
            >
              {docId}
            </span>
          );
        }
      });

      lastIndex = citationRegex.lastIndex;
    }

    if (lastIndex < part.length) {
      segments.push(part.substring(lastIndex));
    }

    if (isBold) {
      return (
        <strong key={pIdx} className="font-semibold text-foreground">
          {segments}
        </strong>
      );
    }
    return <React.Fragment key={pIdx}>{segments}</React.Fragment>;
  });
}

function FormattedContent({ content, citations }: { content: string; citations: Citation[] }) {
  if (!content) return null;
  const lines = content.split("\n");
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-foreground/90">
      {lines.map((line, idx) => {
        let trimmed = line.trim();
        const isBullet = trimmed.startsWith("* ") || trimmed.startsWith("- ");
        if (isBullet) trimmed = trimmed.substring(2);

        const rendered = parseLineWithCitations(trimmed, citations);

        if (isBullet) {
          return (
            <div key={idx} className="flex items-start gap-2.5 pl-1">
              <span className="text-primary mt-1.5 shrink-0 text-xs">▸</span>
              <span>{rendered}</span>
            </div>
          );
        }
        return <p key={idx} className="min-h-[1.2em]">{rendered}</p>;
      })}
    </div>
  );
}

const SECTION_CONFIG = [
  {
    key: "rootCause" as keyof RcaSections,
    label: "Root Cause Analysis",
    icon: ShieldAlert,
    iconColor: "text-destructive",
    iconBg: "bg-destructive/10",
  },
  {
    key: "contributingFactors" as keyof RcaSections,
    label: "Contributing Factors",
    icon: Wrench,
    iconColor: "text-primary",
    iconBg: "bg-primary/10",
  },
  {
    key: "affectedEquipment" as keyof RcaSections,
    label: "Affected Equipment",
    icon: Tag,
    iconColor: "text-teal-success",
    iconBg: "bg-teal-success/10",
  },
  {
    key: "relatedRegulations" as keyof RcaSections,
    label: "Related Regulations & Standards",
    icon: ShieldCheck,
    iconColor: "text-amber-warning",
    iconBg: "bg-amber-warning/10",
  },
  {
    key: "recommendedAction" as keyof RcaSections,
    label: "Recommended Actions",
    icon: FileText,
    iconColor: "text-primary",
    iconBg: "bg-primary/10",
  },
];

function severityVariant(sev?: string): "danger" | "warning" | "default" {
  if (!sev) return "default";
  return sev.toLowerCase() === "critical" ? "danger" : "warning";
}

export default function RcaPage() {
  const {
    failures,
    loadingFailures,
    loadingAnalysis,
    status,
    rcaReport,
    citations,
    confidence,
    executionTime,
    error,
    runAnalysis,
  } = useStreamingRca();

  const [selectedFailure, setSelectedFailure] = useState<FailureNode | null>(null);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [showFailureList, setShowFailureList] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    rootCause: true,
    contributingFactors: false,
    affectedEquipment: false,
    relatedRegulations: false,
    recommendedAction: false,
  });

  const toggleSection = (sec: keyof RcaSections) => {
    setExpandedSections((prev) => ({ ...prev, [sec]: !prev[sec] }));
  };

  const handleSelectFailure = (fail: FailureNode) => {
    setSelectedFailure(fail);
    runAnalysis(fail.id);
    if (window.innerWidth < 1024) {
      setShowFailureList(false);
      setExpandedSections({ rootCause: true, contributingFactors: true, affectedEquipment: false, relatedRegulations: false, recommendedAction: false });
    }
  };

  const parsed = parseRcaReport(rcaReport, loadingAnalysis);

  return (
    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden h-full no-zoom">

      {/* ── Left: Failure Selector ── */}
      <div className="w-full lg:w-72 xl:w-80 border-b lg:border-b-0 lg:border-r border-border bg-card/50 flex flex-col shrink-0">

        {/* Selector header */}
        <div className="px-4 py-3.5 border-b border-border bg-muted/20 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-lg bg-amber-warning/10 shrink-0">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-warning" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display font-bold text-xs uppercase tracking-wider text-foreground truncate">
                Failure Events
              </h2>
              <p className="text-[9px] font-mono text-muted-foreground hidden lg:block">
                {failures.length} events in graph
              </p>
            </div>
          </div>
          {/* Mobile toggle */}
          <button
            type="button"
            onClick={() => setShowFailureList(!showFailureList)}
            className="lg:hidden flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border bg-muted/10 text-[9px] font-mono uppercase text-muted-foreground tap-target min-h-[32px]"
          >
            {showFailureList ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {showFailureList ? "Hide" : "Show"}
          </button>
        </div>

        {/* Failure list */}
        <div className={`flex-1 overflow-y-auto scroll-touch p-3 space-y-2 max-h-[200px] lg:max-h-none ${showFailureList ? "block" : "hidden lg:block"}`}>
          {loadingFailures ? (
            <div className="flex items-center justify-center py-10 gap-2 text-xs font-mono text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>Loading failure graph...</span>
            </div>
          ) : failures.length === 0 ? (
            <EmptyState
              icon={HelpCircle}
              title="No failures found"
              description="No Failure nodes exist in the graph database."
              className="py-8"
            />
          ) : (
            failures.map((fail) => {
              const isSelected = selectedFailure?.id === fail.id;
              return (
                <button
                  key={fail.id}
                  onClick={() => handleSelectFailure(fail)}
                  className={`w-full text-left rounded-lg border p-3 transition-all duration-150 flex flex-col gap-1.5 min-h-[60px] tap-target
                              ${isSelected
                                ? "bg-primary/8 border-primary/40"
                                : "bg-muted/5 border-border hover:border-border/80 hover:bg-muted/10"
                              }`}
                >
                  <div className="flex items-center justify-between w-full gap-2">
                    <span className="font-mono text-[10px] font-bold text-primary truncate flex-1">
                      {fail.id}
                    </span>
                    {fail.severity && (
                      <Badge variant={severityVariant(fail.severity)} className="shrink-0 text-[8px]">
                        {fail.severity}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-foreground/70 truncate w-full">
                    {fail.description || "No description provided."}
                  </p>
                  {fail.date && (
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground font-mono">
                      <Clock className="h-2.5 w-2.5" />
                      {fail.date}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right: Analysis Board ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-background">

        {/* Board header */}
        <div className="shrink-0 px-5 py-3.5 border-b border-border bg-card/40 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display font-bold text-sm text-foreground uppercase tracking-wider">
              RCA Analysis Board
            </h1>
            {selectedFailure && (
              <p className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
                Active: <span className="text-primary font-bold">{selectedFailure.id}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {executionTime !== null && (
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground border border-border px-2.5 py-1.5 rounded-lg bg-muted/10">
                <Clock className="h-3 w-3 text-primary" />
                {executionTime.toFixed(2)}s
              </div>
            )}
            {confidence && (
              <Badge
                variant={confidence === "high" ? "success" : confidence === "medium" ? "info" : "warning"}
                dot
              >
                {confidence === "high" ? <ShieldCheck className="h-3 w-3 mr-0.5" /> : confidence === "medium" ? <Sparkles className="h-3 w-3 mr-0.5" /> : <AlertTriangle className="h-3 w-3 mr-0.5" />}
                {confidence} confidence
              </Badge>
            )}
          </div>
        </div>

        {/* Board content */}
        <div className="flex-1 overflow-y-auto scroll-touch p-4 md:p-6 space-y-4">

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2.5 p-4 rounded-lg border border-destructive/20 bg-destructive/5 text-destructive text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold uppercase tracking-wide text-[10px] mb-0.5">Analysis Error</p>
                <p>{error}</p>
              </div>
            </div>
          )}

          {/* Status */}
          {status && (
            <div className="flex items-center gap-2.5 p-3 rounded-lg border border-border bg-muted/10 text-[11px] font-mono text-muted-foreground animate-pulse">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
              {status}
            </div>
          )}

          {/* No selection */}
          {!selectedFailure ? (
            <div className="h-full flex items-center justify-center">
              <EmptyState
                icon={Wrench}
                title="No failure selected"
                description="Select a failure event from the log to trigger graph traversal and synthesize the root cause analysis."
              />
            </div>
          ) : (
            <div className="space-y-3 max-w-4xl">
              {SECTION_CONFIG.map(({ key, label, icon: Icon, iconColor, iconBg }) => {
                const isExpanded = expandedSections[key];
                return (
                  <Card key={key} className="overflow-hidden">
                    <button
                      onClick={() => toggleSection(key)}
                      className="w-full flex items-center gap-3 px-5 py-3.5 bg-muted/20 border-b border-border
                                 hover:bg-muted/30 transition-colors tap-target min-h-[52px] text-left"
                    >
                      <div className={`p-1.5 rounded-lg shrink-0 ${iconBg}`}>
                        <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
                      </div>
                      <span className="font-display font-semibold text-xs uppercase tracking-wider text-foreground flex-1 truncate">
                        {label}
                      </span>
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      }
                    </button>
                    {isExpanded && (
                      <CardBody className="py-4">
                        <FormattedContent content={parsed[key]} citations={citations} />
                      </CardBody>
                    )}
                  </Card>
                );
              })}

              {/* Citations */}
              {citations.length > 0 && (
                <div className="pt-2">
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      Evidence Citations
                    </span>
                    <Badge variant="info">{citations.length}</Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {citations.map((cite, idx) => (
                      <button
                        key={idx}
                        onClick={() => setActiveCitation(cite)}
                        className="text-left p-3.5 rounded-lg border border-border bg-card
                                   hover:border-primary/30 hover:bg-primary/5 transition-all duration-150
                                   space-y-1.5 tap-target min-h-[60px]"
                      >
                        <div className="flex items-center gap-1.5 text-[10px] font-mono text-foreground/80">
                          <BookOpen className="h-3 w-3 text-primary shrink-0" />
                          <span className="truncate font-semibold">{cite.document_name}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
                          &ldquo;{cite.snippet}&rdquo;
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Citation Detail Modal ── */}
      {activeCitation && (
        <div className="absolute inset-0 bg-slate-950/75 z-50 flex items-end md:items-center justify-center p-0 md:p-6">
          <div className="w-full md:max-w-lg bg-card border border-border rounded-t-2xl md:rounded-xl shadow-[var(--shadow-elevated)] p-5 md:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <BookOpen className="h-4 w-4 text-primary" />
                </div>
                <h3 className="font-display font-bold text-sm text-foreground">Source Reference</h3>
              </div>
              <button
                onClick={() => setActiveCitation(null)}
                className="h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div className="font-mono text-[10px] text-muted-foreground">
                <div>Document: <span className="text-foreground">{activeCitation.document_name}</span></div>
                <div className="text-muted-foreground/60 mt-0.5">ID: {activeCitation.document_id}</div>
              </div>
              <div className="p-3 rounded-lg border border-border bg-muted/20 font-mono text-[11px] text-foreground/80 leading-relaxed">
                &ldquo;{activeCitation.snippet}&rdquo;
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <Button variant="outline" size="sm" onClick={() => setActiveCitation(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
