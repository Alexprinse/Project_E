"use client";

import React, { useState, useRef, useEffect } from "react";
import { Send, Sparkles, RefreshCw, Layers } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useStreamingChat } from "@/hooks/use-streaming-chat";

export function ChatPanel() {
  const [input, setInput] = useState("");
  const { messages, loading, status, sendMessage, clearChat } = useStreamingChat();
  const context = { entities: [] as string[], chunks: [] as string[] };
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    sendMessage(input);
    setInput("");
  };

  return (
    <div className="flex flex-1 overflow-hidden h-full">
      {/* Chat Area */}
      <div className="flex-1 flex flex-col justify-between h-full bg-slate-950/20">
        {/* Chat History Header */}
        <div className="p-4 border-b border-border glass flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-display font-semibold text-sm">Industrial QA Copilot</h2>
              <p className="text-[11px] text-muted-foreground">Ask questions referencing manuals & engineering graphs</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={clearChat} disabled={loading}>
            Clear History
          </Button>
        </div>

        {/* Message Log */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <AnimatePresence>
            {messages.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-3"
              >
                <div className="p-3 bg-primary/10 rounded-full border border-primary/20">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-display font-medium text-slate-200">AI Knowledge Assistant</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Search across engineering standards, process flow metrics, and pipelines. Try querying:
                  <span className="block mt-2 font-mono text-[10px] text-primary/80">&quot;What are the specs for pipeline A?&quot;</span>
                </p>
              </motion.div>
            ) : (
              messages.map((msg, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-xl px-4 py-3 text-xs leading-relaxed ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground font-medium shadow-glow"
                        : "bg-slate-900 border border-border text-slate-100"
                    }`}
                  >
                    <div className="whitespace-pre-line">{msg.content}</div>
                  </div>
                </motion.div>
              ))
            )}

            {/* Ingestion Worker Status Indicator */}
            {loading && status && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 text-xs text-primary bg-primary/5 border border-primary/10 px-3 py-1.5 rounded-lg w-max"
              >
                <RefreshCw className="h-3 w-3 animate-spin" />
                <span>{status}</span>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={chatEndRef} />
        </div>

        {/* Input panel */}
        <form onSubmit={handleSend} className="p-4 border-t border-border glass flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search industrial assets..."
            className="flex-1 bg-slate-900 border border-border rounded-lg px-4 py-2.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary transition-all placeholder:text-muted-foreground"
            disabled={loading}
          />
          <Button type="submit" size="icon" disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>

      {/* RAG Context Sidebar */}
      {context && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-80 border-l border-border glass p-6 overflow-y-auto space-y-6 shrink-0 hidden md:block"
        >
          <div className="flex items-center gap-2 text-slate-200 border-b border-border pb-3">
            <Layers className="h-4 w-4 text-primary" />
            <h3 className="font-display font-semibold text-xs tracking-wider uppercase">Retrieved Context</h3>
          </div>

          {/* Graph Entities */}
          <div className="space-y-3">
            <h4 className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Matched Entities</h4>
            {context.entities.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">No graph nodes resolved.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {context.entities.map((ent: string, idx: number) => (
                  <span
                    key={idx}
                    className="text-[10px] bg-slate-900 border border-border px-2 py-1 rounded text-primary font-mono"
                  >
                    {ent}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Text Chunks */}
          <div className="space-y-3">
            <h4 className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Source Passages</h4>
            {context.chunks.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">No document chunks fetched.</p>
            ) : (
              <div className="space-y-3">
                {context.chunks.map((chunk: string, idx: number) => (
                  <div key={idx} className="bg-slate-900/50 border border-border/60 p-3 rounded-lg text-[10px] text-slate-300 leading-normal">
                    {chunk}
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
