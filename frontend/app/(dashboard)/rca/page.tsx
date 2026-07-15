"use client";

import React, { useState, useEffect } from "react";
import {
  ShieldAlert,
  Loader2,
  BookOpen,
  X,
  Clock,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  HelpCircle,
  FileText,
  AlertCircle,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
    return {
      rootCause: placeholder,
      contributingFactors: placeholder,
      affectedEquipment: placeholder,
      relatedRegulations: placeholder,
      recommendedAction: placeholder,
    };
  }

  const lines = text.split("\n");
  let currentSection: keyof RcaSections | null = null;

  for (const line of lines) {
    const lowerLine = line.toLowerCase().trim();

    if (lowerLine.startsWith("### root cause") || lowerLine === "root cause:") {
      currentSection = "rootCause";
      continue;
    } else if (
      lowerLine.startsWith("### contributing factors") ||
      lowerLine === "contributing factors:"
    ) {
      currentSection = "contributingFactors";
      continue;
    } else if (
      lowerLine.startsWith("### affected equipment") ||
      lowerLine === "affected equipment:"
    ) {
      currentSection = "affectedEquipment";
      continue;
    } else if (
      lowerLine.startsWith("### related regulations") ||
      lowerLine === "related regulations:"
    ) {
      currentSection = "relatedRegulations";
      continue;
    } else if (
      lowerLine.startsWith("### recommended action") ||
      lowerLine === "recommended action:"
    ) {
      currentSection = "recommendedAction";
      continue;
    }

    if (currentSection) {
      sections[currentSection] += line + "\n";
    }
  }

  // Clean and set fallback states
  for (const k of Object.keys(sections) as Array<keyof RcaSections>) {
    sections[k] = sections[k].trim();
    if (!sections[k]) {
      sections[k] = isAnalyzing ? "Generating..." : "No data generated for this section.";
    }
  }

  return sections;
}

function FormattedContent({ content }: { content: string }) {
  if (!content) return null;
  const lines = content.split("\n");
  return (
    <div className="space-y-2 font-sans text-xs leading-relaxed text-slate-200">
      {lines.map((line, idx) => {
        let trimmed = line.trim();
        const isBullet = trimmed.startsWith("* ") || trimmed.startsWith("- ");
        if (isBullet) trimmed = trimmed.substring(2);

        const parts = trimmed.split("**");
        const renderedText = parts.map((part, pIdx) => {
          if (pIdx % 2 === 1)
            return (
              <strong key={pIdx} className="font-bold text-slate-100">
                {part}
              </strong>
            );
          return part;
        });

        if (isBullet) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-2 my-1">
              <span className="text-primary mt-1 text-[10px] shrink-0">•</span>
              <span>{renderedText}</span>
            </div>
          );
        }
        return (
          <p key={idx} className="min-h-[1em]">
            {renderedText}
          </p>
        );
      })}
    </div>
  );
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

  // Mobile list visibility toggle
  const [showFailureList, setShowFailureList] = useState(true);

  // Mobile collapsible sections
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    rootCause: true,
    contributingFactors: false,
    affectedEquipment: false,
    relatedRegulations: false,
    recommendedAction: false,
  });

  const toggleSection = (sec: keyof RcaSections) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sec]: !prev[sec],
    }));
  };

  const handleSelectFailure = (fail: FailureNode) => {
    setSelectedFailure(fail);
    runAnalysis(fail.id);
    // On mobile, collapse list and auto-expand rootCause
    if (window.innerWidth < 1024) {
      setShowFailureList(false);
      setExpandedSections({
        rootCause: true,
        contributingFactors: true,
        affectedEquipment: false,
        relatedRegulations: false,
        recommendedAction: false,
      });
    }
  };

  const parsed = parseRcaReport(rcaReport, loadingAnalysis);

  return (
    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden h-full no-zoom relative">
      {/* ── Left Sidebar / Failures Selector ── */}
      <div className="w-full lg:w-80 border-r border-border bg-card/45 flex flex-col shrink-0">
        <div className="p-4 border-b border-border bg-muted/20 shrink-0 flex items-center justify-between lg:block">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-warning shrink-0" />
              <h2 className="font-display font-bold text-xs uppercase tracking-wider text-slate-200 truncate">
                Failure Events Log
              </h2>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 hidden lg:block">
              Select a plant failure event to initiate Root Cause Analysis.
            </p>
          </div>
          {/* Mobile list collapse toggle */}
          <button
            type="button"
            onClick={() => setShowFailureList(!showFailureList)}
            className="lg:hidden px-3 py-1.5 border border-border rounded text-[9px] font-mono uppercase bg-muted/10 text-slate-300 tap-target min-h-[32px] flex items-center justify-center active:bg-muted/30"
          >
            {showFailureList ? "Hide List" : "Show List"}
          </button>
        </div>

        {/* Failures List */}
        <div className={`flex-1 overflow-y-auto scroll-touch p-3 space-y-2 max-h-[220px] lg:max-h-none ${
          showFailureList ? "block" : "hidden lg:block"
        }`}>
          {loadingFailures ? (
            <div className="flex items-center justify-center p-8 gap-2 text-xs font-mono text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>READING GRAPH FAILURES...</span>
            </div>
          ) : failures.length === 0 ? (
            <div className="text-[10px] text-muted-foreground italic font-mono p-4 border border-border/40 border-dashed rounded text-center">
              [NO FAILURE NODES FOUND]
            </div>
          ) : (
            failures.map((fail) => {
              const isSelected = selectedFailure?.id === fail.id;
              return (
                <button
                  key={fail.id}
                  onClick={() => handleSelectFailure(fail)}
                  className={`w-full text-left p-3 border rounded transition-all duration-150 flex flex-col gap-1.5 min-h-[56px] tap-target active:bg-muted/30 ${
                    isSelected
                      ? "bg-muted/40 border-primary"
                      : "bg-muted/10 border-border hover:border-slate-500"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-mono text-[10px] font-bold text-primary truncate max-w-[150px]">
                      {fail.id}
                    </span>
                    {fail.severity && (
                      <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border uppercase shrink-0 font-semibold ${
                        fail.severity.toLowerCase() === "critical"
                          ? "bg-destructive/10 text-destructive border-destructive/20"
                          : "bg-amber-warning/10 text-amber-warning border-amber-warning/20"
                      }`}>
                        {fail.severity}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-300 truncate w-full">
                    {fail.description || "No description provided."}
                  </p>
                  {fail.date && (
                    <div className="text-[9px] text-muted-foreground font-mono mt-0.5">
                      DATE: {fail.date}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right Content Area / Structured Report ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-background">
        {/* Header Toolbar */}
        <div className="shrink-0 p-4 border-b border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display font-bold text-sm uppercase tracking-wider text-slate-200">
              RCA Analysis Board
            </h1>
            {selectedFailure && (
              <p className="text-[10px] font-mono text-muted-foreground truncate mt-0.5">
                ACTIVE FAIL ID: <span className="text-primary font-bold">{selectedFailure.id}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {executionTime !== null && (
              <div className="text-[10px] font-mono text-muted-foreground border border-border px-2 py-1 rounded bg-muted/10">
                TIME: {executionTime.toFixed(2)}s
              </div>
            )}
            {confidence && (
              <div className="flex items-center gap-1.5 border border-border px-2.5 py-1 rounded bg-muted/10">
                {confidence === "high" && <ShieldCheck className="h-3.5 w-3.5 text-teal-success" />}
                {confidence === "medium" && <Sparkles className="h-3.5 w-3.5 text-primary" />}
                {confidence === "low" && <AlertTriangle className="h-3.5 w-3.5 text-amber-warning" />}
                <span className="text-[9px] font-mono font-bold uppercase text-slate-200">
                  {confidence} CONF
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Main structured panels container */}
        <div className="flex-1 overflow-y-auto scroll-touch p-4 md:p-6 space-y-5">
          {error && (
            <div className="p-3 border border-destructive/20 bg-destructive/5 text-destructive rounded flex items-start gap-2.5 text-xs font-mono">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block uppercase">ANALYSIS ERROR</span>
                <span>{error}</span>
              </div>
            </div>
          )}

          {status && (
            <div className="flex items-center gap-2.5 text-[10px] font-mono text-muted-foreground animate-pulse p-3 border border-border bg-muted/10 rounded">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>{status}</span>
            </div>
          )}

          {!selectedFailure ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-sm mx-auto space-y-4">
              <div className="p-4 bg-muted/20 rounded-full border border-border">
                <Wrench className="h-6 w-6 text-slate-400" />
              </div>
              <h3 className="font-display font-medium text-slate-200 text-xs uppercase tracking-wider">
                RCA System Offline
              </h3>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Select one of the failures from the log history to extract connected subgraphs and synthesize the incident root cause.
              </p>
            </div>
          ) : (
            <div className="space-y-4 max-w-4xl">
              {/* Section 1: Root Cause */}
              <div className="panel-card rounded overflow-hidden">
                <div
                  onClick={() => toggleSection("rootCause")}
                  className="panel-card-header bg-muted/20 flex items-center justify-between cursor-pointer min-h-[44px] tap-target"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ShieldAlert className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate">1. Root Cause Analysis</span>
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground shrink-0 pl-2">
                    {expandedSections.rootCause ? "[COLLAPSE]" : "[EXPAND]"}
                  </span>
                </div>
                <div className={`p-4 md:p-5 ${expandedSections.rootCause ? "block" : "hidden"}`}>
                  <FormattedContent content={parsed.rootCause} />
                </div>
              </div>

              {/* Section 2: Contributing Factors */}
              <div className="panel-card rounded overflow-hidden">
                <div
                  onClick={() => toggleSection("contributingFactors")}
                  className="panel-card-header bg-muted/20 flex items-center justify-between cursor-pointer min-h-[44px] tap-target"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Wrench className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate">2. Contributing Factors</span>
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground shrink-0 pl-2">
                    {expandedSections.contributingFactors ? "[COLLAPSE]" : "[EXPAND]"}
                  </span>
                </div>
                <div className={`p-4 md:p-5 ${expandedSections.contributingFactors ? "block" : "hidden"}`}>
                  <FormattedContent content={parsed.contributingFactors} />
                </div>
              </div>

              {/* Section 3: Affected Equipment */}
              <div className="panel-card rounded overflow-hidden">
                <div
                  onClick={() => toggleSection("affectedEquipment")}
                  className="panel-card-header bg-muted/20 flex items-center justify-between cursor-pointer min-h-[44px] tap-target"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate">3. Affected Equipment</span>
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground shrink-0 pl-2">
                    {expandedSections.affectedEquipment ? "[COLLAPSE]" : "[EXPAND]"}
                  </span>
                </div>
                <div className={`p-4 md:p-5 ${expandedSections.affectedEquipment ? "block" : "hidden"}`}>
                  <FormattedContent content={parsed.affectedEquipment} />
                </div>
              </div>

              {/* Section 4: Related Regulations */}
              <div className="panel-card rounded overflow-hidden">
                <div
                  onClick={() => toggleSection("relatedRegulations")}
                  className="panel-card-header bg-muted/20 flex items-center justify-between cursor-pointer min-h-[44px] tap-target"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate">4. Related Safety Regulations &amp; Standards</span>
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground shrink-0 pl-2">
                    {expandedSections.relatedRegulations ? "[COLLAPSE]" : "[EXPAND]"}
                  </span>
                </div>
                <div className={`p-4 md:p-5 ${expandedSections.relatedRegulations ? "block" : "hidden"}`}>
                  <FormattedContent content={parsed.relatedRegulations} />
                </div>
              </div>

              {/* Section 5: Recommended Action */}
              <div className="panel-card rounded overflow-hidden">
                <div
                  onClick={() => toggleSection("recommendedAction")}
                  className="panel-card-header bg-muted/20 flex items-center justify-between cursor-pointer min-h-[44px] tap-target"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate">5. Recommended Actions &amp; Corrective Guidance</span>
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground shrink-0 pl-2">
                    {expandedSections.recommendedAction ? "[COLLAPSE]" : "[EXPAND]"}
                  </span>
                </div>
                <div className={`p-4 md:p-5 ${expandedSections.recommendedAction ? "block" : "hidden"}`}>
                  <FormattedContent content={parsed.recommendedAction} />
                </div>
              </div>

              {/* Citations section if present */}
              {citations.length > 0 && (
                <div className="border-t border-border pt-6 mt-6">
                  <h4 className="text-[10px] font-display font-semibold uppercase text-slate-400 tracking-wider mb-3">
                    Verified Citations Source
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {citations.map((cite, idx) => (
                      <div
                        key={idx}
                        onClick={() => setActiveCitation(cite)}
                        className="p-3 border border-border bg-muted/15 rounded text-left cursor-pointer transition-all duration-150 space-y-1.5 hover:border-slate-500 tap-target min-h-[44px]"
                      >
                        <div className="flex items-center gap-1.5 text-[9px] font-mono text-slate-200">
                          <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="truncate">{cite.document_name}</span>
                        </div>
                        <p className="text-[9px] text-muted-foreground truncate leading-relaxed">
                          &ldquo;{cite.snippet}&rdquo;
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Citation Detail dialog/modal */}
      {activeCitation && (
        <div className="absolute inset-0 bg-slate-950/70 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="w-full md:max-w-md bg-card border border-border md:rounded p-5 md:p-6 shadow-2xl space-y-4 rounded-t-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                <h3 className="font-display font-bold text-xs uppercase text-slate-200 tracking-wider">
                  Source Reference
                </h3>
              </div>
              <button
                onClick={() => setActiveCitation(null)}
                className="text-muted-foreground hover:text-slate-100 transition-colors tap-target min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            
            <div className="space-y-3 text-xs leading-relaxed">
              <div className="font-mono text-[10px] text-muted-foreground">
                Document ID: {activeCitation.document_id}
                <span className="block mt-0.5">Asset: {activeCitation.document_name}</span>
              </div>
              <div className="p-3 border border-border bg-muted/10 rounded font-mono text-[11px] text-slate-300">
                &ldquo;{activeCitation.snippet}&rdquo;
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveCitation(null)}
                className="font-display text-[10px] uppercase tracking-wider min-h-[44px] tap-target"
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
