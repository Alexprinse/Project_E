"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Send,
  Terminal,
  AlertTriangle,
  ShieldCheck,
  ArrowRight,
  Loader2,
  Sparkles,
  BookOpen,
  X,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStreamingChat } from "@/hooks/use-streaming-chat";
import { Citation } from "@/lib/api";
import { env } from "@/lib/env";

/* ─── Markdown-aware message renderer ─── */
function FormattedMessage({ content }: { content: string }) {
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

/* ─── Citation / Grounding Panel content (reused in sidebar + bottom sheet) ─── */
function CitationPanelContent({
  confidence,
  citations,
  onCitationClick,
}: {
  confidence: string | null;
  citations: Citation[];
  onCitationClick: (c: Citation) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-semibold text-xs text-slate-300 uppercase tracking-wider">
          Verification &amp; Grounding
        </h2>
        <p className="text-[10px] text-muted-foreground mt-1 leading-normal">
          Inspect database citations and confidence scoring metrics for the current turn.
        </p>
      </div>

      {/* Confidence Score */}
      {confidence && (
        <div className="space-y-2 border-t border-border pt-4">
          <h4 className="text-[10px] font-display font-semibold uppercase text-slate-400 tracking-wider">
            Confidence Scoring
          </h4>
          <div className="flex items-center gap-2 p-3 border border-border/80 bg-muted/10 rounded">
            {confidence === "high" && (
              <>
                <ShieldCheck className="h-4 w-4 text-teal-success shrink-0" />
                <div>
                  <span className="text-[10px] font-mono font-bold text-teal-success uppercase block">
                    HIGH CONFIDENCE
                  </span>
                  <span className="text-[9px] text-muted-foreground leading-none">
                    Grounding context fully matches search constraints.
                  </span>
                </div>
              </>
            )}
            {confidence === "medium" && (
              <>
                <Sparkles className="h-4 w-4 text-primary shrink-0" />
                <div>
                  <span className="text-[10px] font-mono font-bold text-primary uppercase block">
                    MEDIUM CONFIDENCE
                  </span>
                  <span className="text-[9px] text-muted-foreground leading-none">
                    Fuzzy matches merged with partial graph elements.
                  </span>
                </div>
              </>
            )}
            {confidence === "low" && (
              <>
                <AlertTriangle className="h-4 w-4 text-amber-warning shrink-0" />
                <div>
                  <span className="text-[10px] font-mono font-bold text-amber-warning uppercase block">
                    LOW CONFIDENCE
                  </span>
                  <span className="text-[9px] text-muted-foreground leading-none">
                    Context missing or query categorized out-of-scope.
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Citations */}
      <div className="space-y-3 border-t border-border pt-4">
        <h4 className="text-[10px] font-display font-semibold uppercase text-slate-400 tracking-wider">
          Citations Strip
        </h4>
        {citations.length === 0 ? (
          <div className="text-[10px] text-muted-foreground italic font-mono p-2 border border-border/40 border-dashed rounded text-center">
            [NO CITATIONS DETECTED IN RESPONSE]
          </div>
        ) : (
          <div className="space-y-2">
            {citations.map((cite, idx) => (
              <div
                key={idx}
                onClick={() => onCitationClick(cite)}
                className="p-3 border border-border bg-muted/15 rounded cursor-pointer transition-all duration-150 space-y-1.5 tap-target min-h-[44px] active:bg-muted/40 hover:border-slate-500"
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
        )}
      </div>

      <div className="text-[9px] font-mono text-muted-foreground border-t border-border pt-4">
        Citations represent primary source nodes matching target properties.
      </div>
    </div>
  );
}

/* ─── Main Copilot Page ─── */
export default function CopilotPage() {
  const { messages, loading, status, citations, confidence, sendMessage, clearChat, executionTime } =
    useStreamingChat();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Active citation details modal state
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  // Mobile: sources bottom sheet visibility
  const [showSources, setShowSources] = useState(false);

  // Comparison mode states
  const [compareMode, setCompareMode] = useState(false);
  const [activeCompareTab, setActiveCompareTab] = useState<"keyword" | "copilot">("copilot");
  const [keywordResults, setKeywordResults] = useState<any[]>([]);
  const [keywordLoading, setKeywordLoading] = useState(false);
  const [keywordTime, setKeywordTime] = useState<number | null>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  // Close sources sheet when a new message arrives on mobile
  useEffect(() => {
    if (showSources && messages.length > 0) setShowSources(false);
  }, [messages.length, showSources]);

  const handleQuerySubmit = (query: string) => {
    if (!query.trim() || loading) return;
    sendMessage(query);

    if (compareMode) {
      setKeywordLoading(true);
      setKeywordResults([]);
      setKeywordTime(null);
      
      const fetchKeyword = async () => {
        try {
          const url = `${env.NEXT_PUBLIC_API_URL}/api/v1/search/keyword`;
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ query }),
          });
          if (response.ok) {
            const data = await response.json();
            setKeywordResults(data.results || []);
            setKeywordTime(data.execution_time_sec !== undefined && data.execution_time_sec !== null ? data.execution_time_sec : 0.0);
          } else {
            setKeywordTime(0.0);
          }
        } catch (err) {
          console.error("Keyword search failed", err);
          setKeywordTime(0.0);
        } finally {
          setKeywordLoading(false);
        }
      };
      fetchKeyword();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    handleQuerySubmit(input);
    setInput("");
  };

  return (
    <div className="flex-1 flex overflow-hidden h-full relative no-zoom">
      {/* ── Main chat column ── */}
      <div className="flex-1 flex flex-col h-full bg-background border-r border-border min-w-0">
        {/* Header toolbar */}
        <div className="shrink-0 p-3 md:p-4 border-b border-border bg-muted/20 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Terminal className="h-4 w-4 text-primary shrink-0" />
            <h1 className="font-display font-bold text-xs uppercase tracking-wider text-slate-200 truncate">
              {compareMode ? "Search Method Benchmarking" : "Copilot Hybrid QA"}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setCompareMode(!compareMode);
                clearChat();
                setKeywordResults([]);
                setKeywordTime(null);
              }}
              className={`text-[10px] uppercase font-display border px-2.5 py-1 rounded transition-colors min-h-[32px] tap-target ${
                compareMode
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-muted/10 text-muted-foreground hover:text-slate-200"
              }`}
            >
              {compareMode ? "Standard View" : "Compare with Keyword Search"}
            </button>

            {messages.length > 0 && (
              <button
                onClick={() => {
                  clearChat();
                  setKeywordResults([]);
                  setKeywordTime(null);
                }}
                className="text-[10px] uppercase font-display border border-border px-2 py-1 rounded bg-muted/10 text-muted-foreground hover:text-slate-200 transition-colors min-h-[32px] tap-target"
              >
                Clear
              </button>
            )}

            <div className="hidden md:flex text-[10px] font-mono text-muted-foreground uppercase border border-border/80 px-2 py-1 rounded">
              STATE: STANDBY
            </div>
          </div>
        </div>

        {/* ── Conversation Area ── */}
        <div className="flex-1 min-h-0 overflow-y-auto scroll-touch p-4 md:p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 md:p-8 max-w-sm mx-auto space-y-4">
              <div className="p-3 bg-muted/20 rounded-full border border-border">
                <Terminal className="h-6 w-6 text-slate-400" />
              </div>
              <h3 className="font-display font-medium text-slate-200 text-xs uppercase tracking-wider">
                Industrial Terminal QA
              </h3>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Query pump tolerances, maintenance specifications, or safety manual rules.
              </p>
              <div className="w-full space-y-2">
                <button
                  onClick={() => handleQuerySubmit("What is the discharge pressure target for Pump P-101?")}
                  className="w-full text-left text-[10px] font-mono p-3 border border-border bg-muted/10 rounded hover:border-slate-500 text-slate-300 flex justify-between items-center group min-h-[48px] tap-target active:bg-muted/30"
                >
                  <span>Discharge targets for P-101?</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                </button>
                <button
                  onClick={() => handleQuerySubmit("List failure records on heat exchanger HX-302")}
                  className="w-full text-left text-[10px] font-mono p-3 border border-border bg-muted/10 rounded hover:border-slate-500 text-slate-300 flex justify-between items-center group min-h-[48px] tap-target active:bg-muted/30"
                >
                  <span>Failure log on HX-302?</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                </button>
              </div>
            </div>
          ) : compareMode ? (
            <div className="space-y-4">
              {/* Benchmarking Delta Callout */}
              {(executionTime !== null || keywordTime !== null) && (
                <div className="p-3 md:p-4 border border-border bg-muted/5 rounded space-y-2">
                  <h4 className="text-[10px] font-display font-semibold uppercase text-slate-300 tracking-wider flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    Benchmarking Delta Analysis
                  </h4>
                  <p className="text-[10px] text-muted-foreground leading-normal font-sans">
                    {keywordTime !== null && executionTime !== null ? (
                      <>
                        Traditional keyword search returned <span className="font-mono text-slate-200 font-bold">{keywordResults.length} raw records</span> in{" "}
                        <span className="font-mono text-amber-warning font-bold">{keywordTime.toFixed(3)}s</span>. 
                        Copilot synthesized a contextual, verified answer in{" "}
                        <span className="font-mono text-teal-success font-bold">{executionTime.toFixed(2)}s</span> (saving human manual scanning of ~
                        <span className="font-mono text-slate-200 font-bold">
                          {keywordResults.reduce((acc, r) => acc + r.text.split(" ").length, 0).toLocaleString()} words
                        </span>).
                      </>
                    ) : (
                      "Waiting for queries to finish execution..."
                    )}
                  </p>
                </div>
              )}

              {/* Mobile active tab selector buttons for screens < lg */}
              <div className="flex lg:hidden border border-border rounded bg-muted/10 p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setActiveCompareTab("keyword")}
                  className={`flex-1 text-[9px] uppercase tracking-wider font-display py-2 rounded text-center transition-colors min-h-[36px] tap-target ${
                    activeCompareTab === "keyword"
                      ? "bg-primary text-slate-900 font-bold"
                      : "text-muted-foreground hover:text-slate-200"
                  }`}
                >
                  Method A: Keyword ({keywordResults.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCompareTab("copilot")}
                  className={`flex-1 text-[9px] uppercase tracking-wider font-display py-2 rounded text-center transition-colors min-h-[36px] tap-target ${
                    activeCompareTab === "copilot"
                      ? "bg-primary text-slate-900 font-bold"
                      : "text-muted-foreground hover:text-slate-200"
                  }`}
                >
                  Method B: Copilot
                </button>
              </div>

              {/* Grid split panels */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[450px]">
                {/* Left Panel: Traditional Keyword Search */}
                <div className={`flex flex-col border border-border bg-card/45 rounded overflow-hidden ${
                  activeCompareTab === "keyword" ? "flex" : "hidden lg:flex"
                }`}>
                  <div className="p-3 border-b border-border bg-muted/15 flex justify-between items-center">
                    <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-wider">
                      Method A: Traditional Keyword Search
                    </span>
                    {keywordTime !== null && (
                      <span className="text-[10px] font-mono bg-muted px-2 py-0.5 rounded text-amber-warning border border-border font-bold">
                        LATENCY: {keywordTime.toFixed(3)}s
                      </span>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto scroll-touch p-4 space-y-3 font-mono text-[11px]">
                    {keywordLoading ? (
                      <div className="h-full flex items-center justify-center gap-2 text-muted-foreground animate-pulse py-8">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span>Querying full-text indexes...</span>
                      </div>
                    ) : keywordResults.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-muted-foreground italic text-center p-8 border border-dashed border-border/40 rounded py-12">
                        [NO DIRECT INDEX MATCHES RETURNED]
                      </div>
                    ) : (
                      keywordResults.map((res, rIdx) => (
                        <div key={rIdx} className="p-3 border border-border bg-muted/10 rounded space-y-2">
                          <div className="flex justify-between items-center text-[9px] text-muted-foreground border-b border-border/45 pb-1">
                            <span>MATCH #{rIdx + 1}</span>
                            <span className="text-amber-warning font-bold">SCORE: {res.score.toFixed(3)}</span>
                          </div>
                          <p className="text-slate-200 leading-relaxed max-h-[120px] overflow-y-auto scroll-touch scrollbar-thin">
                            {res.text}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Right Panel: Copilot RAG Answer */}
                <div className={`flex flex-col border border-border bg-card rounded overflow-hidden ${
                  activeCompareTab === "copilot" ? "flex" : "hidden lg:flex"
                }`}>
                  <div className="p-3 border-b border-border bg-muted/20 flex justify-between items-center">
                    <span className="text-[10px] font-mono font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-primary shrink-0" />
                      Method B: Copilot Hybrid RAG
                    </span>
                    {executionTime !== null && (
                      <span className="text-[10px] font-mono bg-muted px-2 py-0.5 rounded text-teal-success border border-border font-bold">
                        LATENCY: {executionTime.toFixed(2)}s
                      </span>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.map((msg, idx) => {
                      const isUser = msg.role === "user";
                      return (
                        <div key={idx} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[90%] rounded p-3 text-xs leading-relaxed border ${
                            isUser ? "bg-muted/30 border-border text-slate-100 font-mono" : "bg-card border-border/80 text-slate-200"
                          }`}>
                            <div className="flex items-center gap-1.5 border-b border-border/40 pb-1 mb-2 text-[8px] font-mono text-muted-foreground uppercase tracking-wider">
                              <span>{isUser ? "OPERATOR QUERY" : "SYSTEM SYNTHESIZED RESPONSE"}</span>
                            </div>
                            {isUser ? <p className="whitespace-pre-wrap">{msg.content}</p> : <FormattedMessage content={msg.content} />}
                          </div>
                        </div>
                      );
                    })}
                    {status && (
                      <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground animate-pulse py-2">
                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                        <span>{status}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 md:space-y-6">
              {messages.map((msg, index) => {
                const isUser = msg.role === "user";
                // Only show Sources link on the last assistant message when citations exist
                const isLastAssistant =
                  !isUser &&
                  index === messages.length - 1 &&
                  citations.length > 0;
                return (
                  <div
                    key={index}
                    className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[88%] md:max-w-[80%] rounded p-3 md:p-4 text-xs leading-relaxed border ${
                        isUser
                          ? "bg-muted/30 border-border text-slate-100 font-mono"
                          : "bg-card border-border/80 text-slate-200"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 border-b border-border/40 pb-1.5 mb-2 text-[9px] font-mono text-muted-foreground uppercase tracking-wider">
                        <span>{isUser ? "OPERATOR QUERY" : "SYSTEM RESPONSE"}</span>
                      </div>
                      {isUser ? (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      ) : (
                        <FormattedMessage content={msg.content} />
                      )}

                      {/* Inline Sources link — only on the last LLM reply, only when citations exist */}
                      {isLastAssistant && (
                        <button
                          onClick={() => setShowSources(true)}
                          className="mt-3 pt-2.5 border-t border-border/40 w-full flex items-center gap-1.5 text-[9px] font-mono text-primary hover:text-primary/80 transition-colors tap-target"
                        >
                          <BookOpen className="h-3 w-3 shrink-0" />
                          <span className="tracking-wider uppercase">
                            Sources ({citations.length})
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {status && (
                <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground animate-pulse py-2">
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  <span>{status}</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── Input bar — pinned above bottom tab bar ──
            On mobile: sits at the bottom of the chat column, above the tab bar.
            The parent layout's mobile-content-padding handles the tab bar clearance.
            When keyboard opens, flex-col layout shrinks the chat area upward. */}
        <div className="shrink-0 p-3 md:p-4 border-t border-border bg-card">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter tag or engineering query..."
              disabled={loading}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="flex-1 bg-background border border-border rounded px-3 md:px-4 py-2.5 text-xs focus:outline-none focus:border-primary text-slate-200 font-mono min-h-[44px]"
            />
            <Button
              type="submit"
              size="sm"
              disabled={loading || !input.trim()}
              className="font-display text-[10px] tracking-wider uppercase flex items-center gap-1.5 px-3 md:px-4 min-h-[44px] min-w-[44px] tap-target"
            >
              <span className="hidden sm:inline">Transmit</span>
              <Send className="h-3 w-3" />
            </Button>
          </form>
        </div>
      </div>

      {/* ── Citation sidebar — desktop only (lg+) ── */}
      {!compareMode && (
        <div className="hidden lg:flex w-80 bg-card p-6 flex-col justify-between shrink-0 h-full overflow-y-auto scroll-touch">
          <CitationPanelContent
            confidence={confidence}
            citations={citations}
            onCitationClick={setActiveCitation}
          />
        </div>
      )}

      {/* ── Citation bottom sheet — mobile only, conditionally rendered ── */}
      {showSources && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setShowSources(false)}
            className="lg:hidden absolute inset-0 bg-slate-950/60 z-40 sheet-backdrop"
          />
          {/* Sheet — above the bottom tab bar */}
          <div
            className="lg:hidden absolute left-0 right-0 z-50 bg-card border-t border-border rounded-t-2xl bottom-sheet flex flex-col"
            style={{
              bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))",
              maxHeight: "65vh",
            }}
          >
            {/* Drag handle */}
            <div className="shrink-0 flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-border" />
            </div>
            {/* Sheet header */}
            <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border">
              <span className="font-display font-bold text-xs uppercase tracking-wider text-slate-200">
                Sources &amp; Grounding
              </span>
              <button
                onClick={() => setShowSources(false)}
                className="text-muted-foreground hover:text-slate-100 transition-colors tap-target min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Sheet content — flex-1 min-h-0 is the scrollable region */}
            <div className="flex-1 min-h-0 overflow-y-auto scroll-touch p-5">
              <CitationPanelContent
                confidence={confidence}
                citations={citations}
                onCitationClick={(cite) => {
                  setActiveCitation(cite);
                  setShowSources(false);
                }}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Citation detail modal ── */}
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
