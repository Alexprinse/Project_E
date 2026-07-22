"use client";

import Image from "next/image";
import React, { useState, useRef, useEffect } from "react";
import {
  Send,
  Terminal,
  ArrowRight,
  Loader2,
  Sparkles,
  BookOpen,
  History as HistoryIcon,
  X,
  Mic,
  Bot,
  User,
  BarChart2,
  Plus,
  ImageIcon,
  Camera,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { useStreamingChat } from "@/hooks/use-streaming-chat";
import { ConfidenceBadge, CitationList } from "@/components/features/copilot/citation-confidence";
import { HistoryPanel } from "@/components/features/copilot/history-panel";
import { EquipmentIdentificationCard } from "@/components/features/copilot/equipment-identification-card";
import { Citation } from "@/lib/api";
import { env } from "@/lib/env";

function parseLineWithCitations(line: string, citations: Citation[], onCitationClick?: (c: Citation) => void): React.ReactNode[] {
  const parts = line.split("**");
  return parts.map((part, pIdx) => {
    const isBold = pIdx % 2 === 1;
    const citationRegex = /\[((?:(?:DOC|CHUNK)-[a-zA-Z0-9_-]+)(?:\s*,\s*(?:DOC|CHUNK)-[a-zA-Z0-9_-]+)*)\]/gi;
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

        const isChunk = docId.toUpperCase().startsWith("CHUNK-");
        const citation = citations.find(c => {
            if (isChunk) {
                const rawId = docId.substring(6);
                return c.chunk_id === docId || c.chunk_id === rawId || (c.chunk_id && c.chunk_id.includes(rawId));
            }
            const cleanDocId = docId.toLowerCase().startsWith("doc-") ? docId.substring(4) : docId;
            return c.document_id.toLowerCase() === cleanDocId.toLowerCase();
        });

        if (citation) {
          segments.push(
            <span
              key={docId + "-" + matchIndex + "-" + subIdx}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary font-mono text-[10px] font-semibold hover:bg-primary/20 hover:border-primary/40 active:bg-primary/30 cursor-pointer transition-all"
              title={citation.snippet}
              onClick={() => onCitationClick?.(citation)}
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

/* ─── Markdown-aware renderer ─── */
function FormattedMessage({
  content,
  streaming,
  citations = [],
  onCitationClick,
}: {
  content: string;
  streaming?: boolean;
  citations?: Citation[];
  onCitationClick?: (c: Citation) => void;
}) {
  const lines = content.split("\n");
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-foreground/90">
      {lines.map((line, idx) => {
        let trimmed = line.trim();
        const isBullet = trimmed.startsWith("* ") || trimmed.startsWith("- ");
        if (isBullet) trimmed = trimmed.substring(2);

        const rendered = parseLineWithCitations(trimmed, citations, onCitationClick);

        if (isBullet) {
          return (
            <div key={idx} className="flex items-start gap-2.5 pl-1">
              <span className="text-primary mt-1.5 shrink-0 text-xs">▸</span>
              <span className="leading-relaxed">{rendered}</span>
            </div>
          );
        }
        return (
          <p key={idx} className={`min-h-[1.2em] ${idx === lines.length - 1 && streaming ? "streaming-cursor" : ""}`}>
            {rendered}
          </p>
        );
      })}
    </div>
  );
}

/* ─── Citation panel ─── */
function CitationPanel({
  confidence,
  citations,
  onCitationClick,
}: {
  confidence: string | null;
  citations: Citation[];
  onCitationClick: (c: Citation) => void;
}) {
  return (
    <div className="space-y-5 p-5">
      {/* Header */}
      <div>
        <h2 className="font-display font-semibold text-sm text-foreground">Sources & Grounding</h2>
        <p className="text-xs text-muted-foreground mt-1 leading-snug">
          Citation traceability and confidence scoring for the current response.
        </p>
      </div>

      {/* Confidence */}
      {confidence && (
        <div className="space-y-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Confidence</span>
          <div className="p-3 rounded-lg border border-border bg-muted/20 flex items-center gap-2.5">
            <ConfidenceBadge confidence={confidence} />
          </div>
        </div>
      )}

      {/* Citations */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Citations</span>
          {citations.length > 0 && (
            <Badge variant="info">{citations.length}</Badge>
          )}
        </div>
        <CitationList citations={citations} onCitationClick={onCitationClick} />
      </div>

      <p className="text-[9px] font-mono text-muted-foreground/60 border-t border-border pt-4">
        Citations represent primary source nodes matching target query constraints.
      </p>
    </div>
  );
}

const SUGGESTED_PROMPTS = [
  "Discharge pressure target for Pump P-101?",
  "Failure records on heat exchanger HX-302?",
  "Safety shutdown sequence for Column C-201?",
  "Instrumentation specs for valve 062-V1058?",
];

function useMicrophone(onTranscriptionResult: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = async () => {
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
        setDuration(0);

        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        audioChunksRef.current = [];
        
        // Stop all tracks to release mic
        stream.getTracks().forEach(track => track.stop());

        if (audioBlob.size > 0) {
          setIsTranscribing(true);
          try {
            const formData = new FormData();
            formData.append("file", audioBlob, "recording.webm");

            const res = await fetch(`${env.NEXT_PUBLIC_API_URL}/api/v1/copilot/transcribe`, {
              method: "POST",
              body: formData,
            });

            if (!res.ok) throw new Error("Transcription failed");
            const data = await res.json();
            
            if (data.text) {
              onTranscriptionResult(data.text);
            } else {
              setErrorMsg("Transcription returned empty. Please try speaking clearly.");
            }
          } catch (err) {
            console.error("Transcription error:", err);
            setErrorMsg("Failed to transcribe audio. Please try again.");
          } finally {
            setIsTranscribing(false);
          }
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      
      timerRef.current = setInterval(() => {
        setDuration((prev) => {
          if (prev >= 59) {
            stopRecording();
            return 60;
          }
          return prev + 1;
        });
      }, 1000);
      
    } catch (err) {
      console.error("Microphone access error:", err);
      setErrorMsg("Microphone access denied — enable it in your browser settings to use voice input.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  return {
    isRecording,
    isTranscribing,
    duration,
    errorMsg,
    toggleRecording,
    setErrorMsg
  };
}

export default function CopilotPage() {
  const { messages, loading, status, citations, confidence, sendMessage, submitIdentificationImage, clearChat, executionTime } =
    useStreamingChat();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);

  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Populate the composer from a History entry - no auto-send, no context carried over.
  const handleSelectHistoryQuery = (queryText: string) => {
    setInput(queryText);
    setShowHistory(false);
    inputRef.current?.focus();
  };

  // Comparison mode
  const [compareMode, setCompareMode] = useState(false);
  const [activeCompareTab, setActiveCompareTab] = useState<"keyword" | "copilot">("copilot");
  const [keywordResults, setKeywordResults] = useState<Array<{ text: string; score: number }>>([]);
  const [keywordLoading, setKeywordLoading] = useState(false);
  const [keywordTime, setKeywordTime] = useState<number | null>(null);

  const { isRecording, isTranscribing, duration, errorMsg, toggleRecording, setErrorMsg } = useMicrophone((transcribedText) => {
    setInput(transcribedText);
    inputRef.current?.focus();
  });

  const [viewportHeight, setViewportHeight] = useState("100%");

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;

    const vv = window.visualViewport;
    const handleResize = () => {
      setViewportHeight(`${vv.height}px`);
    };

    vv.addEventListener("resize", handleResize);
    vv.addEventListener("scroll", handleResize);

    // Initial call
    handleResize();

    return () => {
      vv.removeEventListener("resize", handleResize);
      vv.removeEventListener("scroll", handleResize);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        attachmentMenuRef.current &&
        !attachmentMenuRef.current.contains(event.target as Node)
      ) {
        setIsAttachmentMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, status]);

  // Auto-close sources/history sheets only when a NEW message arrives (query submitted),
  // NOT when a sheet is toggled open (which would immediately close it).
  const prevMsgCount = React.useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      setShowSources(false);
      setShowHistory(false);
    }
    prevMsgCount.current = messages.length;
  }, [messages.length]);

  const handleQuerySubmit = (query: string) => {
    if (!query.trim() || loading) return;
    sendMessage(query, compareMode ? "keyword-comparison" : "copilot");

    if (compareMode) {
      setKeywordLoading(true);
      setKeywordResults([]);
      setKeywordTime(null);

      const fetchKeyword = async () => {
        try {
          const url = `${env.NEXT_PUBLIC_API_URL}/api/v1/search/keyword`;
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
          });
          if (response.ok) {
            const data = await response.json();
            setKeywordResults(data.results || []);
            setKeywordTime(data.execution_time_sec ?? 0.0);
          } else {
            setKeywordTime(0.0);
          }
        } catch {
          setKeywordTime(0.0);
        } finally {
          setKeywordLoading(false);
        }
      };
      fetchKeyword();
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedImage(file);
      setPreviewUrl(URL.createObjectURL(file));
      setIsAttachmentMenuOpen(false);
      // Focus input after attaching so user can just hit enter
      setTimeout(() => inputRef.current?.focus(), 10);
    }
    // Reset input so the same file can be selected again if needed
    if (e.target) e.target.value = "";
  };

  const removeSelectedImage = () => {
    setSelectedImage(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    
    if (selectedImage) {
      submitIdentificationImage(selectedImage);
      removeSelectedImage();
      setInput("");
      return;
    }
    
    if (!input.trim()) return;
    handleQuerySubmit(input);
    setInput("");
  };

  const hasMessages = messages.length > 0;
  const lastAssistantIdx = [...messages].reverse().findIndex((m) => m.role === "assistant");
  const lastAssistantActualIdx = lastAssistantIdx !== -1 ? messages.length - 1 - lastAssistantIdx : -1;

  return (
    <div className="flex-1 flex overflow-hidden h-full relative no-zoom" style={{ height: viewportHeight }}>

      {/* ── Main Chat Column ── */}
      <div className="flex-1 flex flex-col h-full min-w-0 bg-background">

        {/* ── Header ── */}
        <div className="shrink-0 px-4 md:px-6 py-3.5 border-b border-border bg-card/40 backdrop-blur-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20 shrink-0">
              <Terminal className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display font-bold text-sm text-foreground truncate">
                {compareMode ? "Search Benchmarking" : "AI Copilot"}
              </h1>
              <p className="text-[10px] font-mono text-muted-foreground hidden md:block">
                {compareMode ? "Keyword vs. Hybrid RAG comparison" : "Hybrid vector-graph QA terminal"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!compareMode && (
              <button
                onClick={() => {
                  setShowHistory((v) => !v);
                  setShowSources(false);
                }}
                title="Query History"
                className={`inline-flex items-center gap-1.5 text-[10px] font-display font-semibold uppercase tracking-wider
                            border rounded-lg px-3 py-1.5 transition-all duration-150 min-h-[32px] tap-target
                            ${showHistory
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent"
                            }`}
              >
                <HistoryIcon className="h-3 w-3" />
                <span className="hidden sm:inline">History</span>
              </button>
            )}

            <button
              onClick={() => {
                setCompareMode(!compareMode);
                clearChat();
                setKeywordResults([]);
                setKeywordTime(null);
                setShowHistory(false);
              }}
              disabled={loading}
              className={`inline-flex items-center gap-1.5 text-[10px] font-display font-semibold uppercase tracking-wider
                          border rounded-lg px-3 py-1.5 transition-all duration-150 min-h-[32px] tap-target
                          disabled:opacity-50 disabled:cursor-not-allowed
                          ${compareMode
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent"
                          }`}
            >
              <BarChart2 className="h-3 w-3" />
              <span className="hidden sm:inline">{compareMode ? "Standard" : "Compare"}</span>
            </button>

            {hasMessages && (
              <Button
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={() => {
                  clearChat();
                  setKeywordResults([]);
                  setKeywordTime(null);
                }}
              >
                Clear
              </Button>
            )}

            {!compareMode && (
              <div className="hidden md:flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground border border-border px-2.5 py-1.5 rounded-lg">
                <span className="status-dot status-dot-online" />
                <span>Active</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Conversation Area ── */}
        <div ref={chatContainerRef} className="flex-1 min-h-0 overflow-y-auto scroll-touch px-4 md:px-6 py-5 space-y-4">

          {/* Empty State */}
          {!hasMessages && !compareMode && (
            <div className="h-full flex flex-col items-center justify-center max-w-md mx-auto py-12 space-y-6">
              <EmptyState
                icon={Bot}
                title="Plant Copilot Ready"
                description="Query pump tolerances, maintenance specifications, P&ID tags, or safety manual rules using hybrid RAG + graph retrieval."
              />
              <div className="w-full space-y-2">
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider text-center mb-3">
                  Suggested queries
                </p>
                {SUGGESTED_PROMPTS.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => handleQuerySubmit(prompt)}
                    className="w-full text-left text-xs font-mono p-3.5 rounded-lg border border-border bg-muted/10
                               hover:border-primary/30 hover:bg-primary/5 text-foreground/80
                               flex justify-between items-center group min-h-[48px] tap-target transition-all duration-150"
                  >
                    <span>{prompt}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Compare Mode */}
          {compareMode && (
            <div className="space-y-4">
              {/* Delta Analysis Banner */}
              {(executionTime !== null || keywordTime !== null) && (
                <div className="p-4 rounded-lg border border-border bg-card space-y-2 animate-fade-in">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[11px] font-display font-bold uppercase tracking-wider text-foreground">
                      Benchmarking Delta Analysis
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {keywordTime !== null && executionTime !== null ? (
                      <>
                        Keyword search: <span className="font-mono text-foreground font-semibold">{keywordResults.length} raw records</span> in{" "}
                        <span className="font-mono text-amber-warning font-bold">{keywordTime.toFixed(3)}s</span>.{" "}
                        Copilot synthesized a verified answer in{" "}
                        <span className="font-mono text-teal-success font-bold">{executionTime.toFixed(2)}s</span>,
                        saving manual scanning of ~<span className="font-mono text-foreground font-semibold">
                          {keywordResults.reduce((acc, r) => acc + r.text.split(" ").length, 0).toLocaleString()} words
                        </span>.
                      </>
                    ) : "Submit a query to compare methods..."}
                  </p>
                </div>
              )}

              {/* Mobile Tab Switcher */}
              <div className="lg:hidden">
                <Tabs
                  items={[
                    { id: "keyword", label: "Method A: Keyword", count: keywordResults.length },
                    { id: "copilot", label: "Method B: Copilot" },
                  ]}
                  activeId={activeCompareTab}
                  onChange={(id) => setActiveCompareTab(id as "keyword" | "copilot")}
                />
              </div>

              {/* Split panels */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-[400px]">
                {/* Keyword Panel */}
                <div className={`flex flex-col rounded-lg border border-border bg-card overflow-hidden ${
                  activeCompareTab === "keyword" ? "flex" : "hidden lg:flex"
                }`}>
                  <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                      Method A — Keyword Search
                    </span>
                    {keywordTime !== null && (
                      <Badge variant="warning">{keywordTime.toFixed(3)}s</Badge>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto scroll-touch p-4 space-y-3 font-mono text-xs">
                    {keywordLoading ? (
                      <div className="h-full flex items-center justify-center gap-2 text-muted-foreground animate-pulse">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span>Querying full-text indexes...</span>
                      </div>
                    ) : keywordResults.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-muted-foreground text-center py-12 border border-dashed border-border rounded-lg">
                        No index matches — submit a query
                      </div>
                    ) : (
                      keywordResults.map((res, rIdx) => (
                        <div key={rIdx} className="p-3 rounded-lg border border-border bg-muted/10 space-y-2">
                          <div className="flex justify-between items-center text-[9px] text-muted-foreground">
                            <span>Match #{rIdx + 1}</span>
                            <Badge variant="warning">Score: {res.score.toFixed(3)}</Badge>
                          </div>
                          <p className="text-foreground/80 leading-relaxed text-[11px] max-h-[100px] overflow-y-auto scroll-touch">
                            {res.text}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Copilot Panel */}
                <div className={`flex flex-col rounded-lg border border-border bg-card overflow-hidden ${
                  activeCompareTab === "copilot" ? "flex" : "hidden lg:flex"
                }`}>
                  <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-foreground">
                      <Sparkles className="h-3 w-3 text-primary" />
                      Method B — Copilot Hybrid RAG
                    </div>
                    {executionTime !== null && (
                      <Badge variant="success">{executionTime.toFixed(2)}s</Badge>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {messages.map((msg, idx) => {
                      const isUser = msg.role === "user";
                      return (
                        <div key={idx} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[90%] rounded-xl p-3 text-xs border ${
                            isUser
                              ? "bg-primary/10 border-primary/20 text-foreground"
                              : "bg-muted/20 border-border text-foreground"
                          }`}>
                            <FormattedMessage
                              content={msg.content}
                              citations={msg.citations || citations}
                              onCitationClick={(cite) => setActiveCitation(cite)}
                            />
                          </div>
                        </div>
                      );
                    })}
                    {status && (
                      <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                        {status}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Standard Messages */}
          {!compareMode && hasMessages && (
            <div className="space-y-4 md:space-y-5 max-w-3xl">
              {messages.map((msg, index) => {
                const isUser = msg.role === "user";
                const isLast = index === messages.length - 1;
                const isStreaming = isLast && !isUser && loading;
                const isLastAssistant = index === lastAssistantActualIdx && citations.length > 0;

                return (
                  <div
                    key={index}
                    className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"} animate-fade-in-up`}
                    style={{ animationDelay: "0ms" }}
                  >
                    {/* Avatar — AI only */}
                    {!isUser && (
                      <div className="shrink-0 mt-0.5">
                        <div className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                          <Bot className="h-3.5 w-3.5 text-primary" />
                        </div>
                      </div>
                    )}

                    <div className={`flex flex-col gap-1.5 ${isUser ? "items-end" : "items-start"} max-w-[85%] md:max-w-[78%]`}>
                      {/* Role label */}
                      <div className={`flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground ${isUser ? "flex-row-reverse" : ""}`}>
                        {isUser ? <User className="h-2.5 w-2.5" /> : null}
                        <span>{isUser ? "You" : "Marg AI"}</span>
                      </div>

                      {/* Bubble */}
                      <div
                        className={`rounded-2xl px-4 py-3 border ${
                          isUser
                            ? "rounded-tr-sm bg-primary/12 border-primary/20 text-foreground"
                            : "rounded-tl-sm bg-card border-border text-foreground border-l-2 border-l-primary/30"
                        }`}
                      >
                        {isUser ? (
                          <div className="flex flex-col gap-2">
                            {msg.image_url && (
                              <Image src={msg.image_url} alt="Attached photo" width={192} height={192} className="w-48 h-auto rounded-lg border border-border/50 object-cover" unoptimized />
                            )}
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        ) : msg.is_identification ? (
                          <EquipmentIdentificationCard 
                            data={msg.identification_data} 
                            onAskCopilot={(tag) => setInput(`Tell me about equipment ${tag}`)}
                            onViewGraph={(id) => window.location.href = `/graph-explorer?node=${id}`}
                            onViewRCA={(id) => window.location.href = `/rca?node=${id}`}
                          />
                        ) : (
                          <FormattedMessage 
                            content={msg.content} 
                            streaming={isStreaming} 
                            citations={msg.citations || citations} 
                            onCitationClick={(cite) => setActiveCitation(cite)}
                          />
                        )}
                      </div>

                      {/* Sources link — last AI message only */}
                      {isLastAssistant && (
                        <button
                          onClick={() => {
                            setShowSources(true);
                            setShowHistory(false);
                          }}
                          className="flex items-center gap-1.5 text-[10px] font-mono text-primary hover:text-primary/80 transition-colors tap-target py-1"
                        >
                          <BookOpen className="h-3 w-3 shrink-0" />
                          <span>Sources ({citations.length})</span>
                        </button>
                      )}
                    </div>

                    {/* Avatar — User only */}
                    {isUser && (
                      <div className="shrink-0 mt-0.5">
                        <div className="h-7 w-7 rounded-full bg-muted/60 border border-border flex items-center justify-center">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Typing indicator */}
              {loading && !status && (
                <div className="flex gap-3 justify-start animate-fade-in">
                  <div className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3.5 flex items-center gap-1.5">
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                  </div>
                </div>
              )}

              {/* Status text */}
              {status && (
                <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground animate-pulse pl-10">
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  <span>{status}</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── Input Composer ── */}
        <div className="shrink-0 border-t border-border bg-card/60 backdrop-blur-sm p-3 pb-[calc(12px+56px+env(safe-area-inset-bottom,0px))] md:p-4">
          <form onSubmit={handleSubmit} className="flex gap-2.5 max-w-3xl items-end">
            <div className="flex-1 flex flex-col">
              {previewUrl && (
                <div className="mb-2 relative self-start">
                  <Image src={previewUrl} alt="Preview" width={80} height={80} unoptimized className="w-20 h-20 object-cover rounded-lg border border-border" />
                  <button
                    type="button"
                    onClick={removeSelectedImage}
                    className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:bg-destructive/90 shadow-sm"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              
              <div className="flex items-center w-full bg-background border border-border rounded-xl focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all duration-150 min-h-[48px]">
                {/* Inline Attachment Menu Wrapper */}
                <div className="relative flex items-center justify-center" ref={attachmentMenuRef}>
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    ref={galleryInputRef} 
                    onChange={handleImageSelect}
                  />
                  <input 
                    type="file" 
                    accept="image/*" 
                    capture="environment"
                    className="hidden" 
                    ref={cameraInputRef} 
                    onChange={handleImageSelect}
                  />
                  
                  <button
                    type="button"
                    onClick={() => setIsAttachmentMenuOpen(!isAttachmentMenuOpen)}
                    className="shrink-0 h-8 w-8 ml-2 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-all flex items-center justify-center tap-target"
                    title="Attach photo"
                    disabled={loading}
                  >
                    <Plus className={`h-5 w-5 transition-transform duration-200 ${isAttachmentMenuOpen ? "rotate-45" : ""}`} />
                  </button>
                  
                  {isAttachmentMenuOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-48 bg-card border border-border rounded-xl shadow-[var(--shadow-elevated)] overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
                      {/* Mobile Options */}
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="w-full flex sm:hidden items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-accent hover:text-foreground transition-colors text-left"
                      >
                        <Camera className="h-4 w-4 text-muted-foreground" />
                        Take Photo
                      </button>
                      <button
                        type="button"
                        onClick={() => galleryInputRef.current?.click()}
                        className="w-full flex sm:hidden items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-accent hover:text-foreground transition-colors text-left border-t border-border/50"
                      >
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        Upload from Gallery
                      </button>
                      
                      {/* Desktop Option */}
                      <button
                        type="button"
                        onClick={() => galleryInputRef.current?.click()}
                        className="w-full hidden sm:flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-accent hover:text-foreground transition-colors text-left"
                      >
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        Upload Photo
                      </button>
                    </div>
                  )}
                </div>
                
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={isTranscribing ? "Transcribing..." : isRecording ? "Listening..." : "Query equipment tags, specs, or procedures..."}
                  disabled={loading || isTranscribing}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="flex-1 bg-transparent px-3 py-3 text-sm focus:outline-none text-foreground placeholder:text-muted-foreground/60 font-sans disabled:opacity-50"
                />
              </div>
            </div>
            
            <button
              type="button"
              onClick={toggleRecording}
              disabled={loading || isTranscribing}
              className={`shrink-0 h-12 w-12 rounded-xl border border-border items-center justify-center flex transition-all duration-150 ${
                isRecording 
                  ? "bg-red-500/10 text-red-500 border-red-500/30 animate-pulse" 
                  : "bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              title={isRecording ? "Stop recording" : "Voice input"}
            >
              {isTranscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isRecording ? (
                <div className="flex flex-col items-center justify-center">
                   <Mic className="h-4 w-4 mb-0.5" />
                   <span className="text-[9px] font-mono leading-none">{duration}s</span>
                </div>
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>
            <Button
              type="submit"
              disabled={loading || (!input.trim() && !selectedImage)}
              size="lg"
              className="shrink-0 min-h-[48px] px-5"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              <span className="hidden sm:inline ml-1">Send</span>
            </Button>
          </form>
          {errorMsg && (
            <div className="flex items-center gap-2 mt-2 pl-1 text-xs text-red-500">
               <X className="h-3 w-3 cursor-pointer" onClick={() => setErrorMsg(null)} />
               <span>{errorMsg}</span>
            </div>
          )}
          {executionTime !== null && !compareMode && !errorMsg && (
            <p className="text-[10px] font-mono text-muted-foreground mt-2 pl-1">
              Last response: {executionTime.toFixed(2)}s — hybrid graph + vector retrieval
            </p>
          )}
        </div>
      </div>

      {/* ── Right Sidebar — desktop (History takes priority over Sources when open) ── */}
      {!compareMode && (
        <div className="hidden lg:flex w-80 border-l border-border bg-card flex-col shrink-0 h-full overflow-y-auto scroll-touch">
          {showHistory ? (
            <HistoryPanel onSelectQuery={handleSelectHistoryQuery} />
          ) : (
            <CitationPanel
              confidence={confidence}
              citations={citations}
              onCitationClick={setActiveCitation}
            />
          )}
        </div>
      )}

      {/* ── Sources Bottom Sheet — mobile ── */}
      <BottomSheet
        open={showSources && !compareMode}
        onClose={() => setShowSources(false)}
        title="Sources & Grounding"
        maxHeight="70vh"
        bottomOffset="calc(4.5rem + env(safe-area-inset-bottom, 0px))"
        className="lg:hidden"
      >
        <CitationPanel
          confidence={confidence}
          citations={citations}
          onCitationClick={(cite) => {
            setActiveCitation(cite);
            setShowSources(false);
          }}
        />
      </BottomSheet>

      {/* ── History Bottom Sheet — mobile ── */}
      <BottomSheet
        open={showHistory && !compareMode}
        onClose={() => setShowHistory(false)}
        title="Query History"
        maxHeight="80vh"
        bottomOffset="calc(4.5rem + env(safe-area-inset-bottom, 0px))"
        className="lg:hidden"
      >
        <HistoryPanel onSelectQuery={handleSelectHistoryQuery} />
      </BottomSheet>

      {/* ── Citation Detail Modal ── */}
      {activeCitation && (
        <div className="absolute inset-0 bg-slate-950/75 z-50 flex items-end md:items-center justify-center p-0 md:p-6">
          <div className="w-full md:max-w-lg bg-card border border-border rounded-2xl md:rounded-xl shadow-[var(--shadow-elevated)] space-y-4 p-5 pb-[calc(20px+56px+env(safe-area-inset-bottom,0px))] md:p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <BookOpen className="h-4 w-4 text-primary" />
                </div>
                <h3 className="font-display font-bold text-sm text-foreground">
                  Source Reference
                </h3>
              </div>
              <button
                onClick={() => setActiveCitation(null)}
                className="text-muted-foreground hover:text-foreground transition-colors tap-target h-9 w-9 flex items-center justify-center rounded-lg hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="text-[10px] font-mono text-muted-foreground space-y-0.5">
                <div>Document: {activeCitation.document_name}</div>
                <div className="text-muted-foreground/60">ID: {activeCitation.document_id}</div>
                {activeCitation.chunk_id && (
                  <div className="text-muted-foreground/60 truncate">Chunk: {activeCitation.chunk_id}</div>
                )}
              </div>
              <div className="p-3 rounded-lg border border-border bg-muted/20 font-mono text-xs text-foreground/80 leading-relaxed">
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
