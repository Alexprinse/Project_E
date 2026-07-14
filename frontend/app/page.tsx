"use client";

import React, { useState, useEffect } from "react";
import { Database, Network, Clock, ShieldAlert, ListFilter } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";

interface IngestionJobCache {
  jobId: string;
  name: string;
  size: string;
  progress: number;
  status: string;
  timestamp: string;
}

export default function DashboardHome() {
  const [docCount, setDocCount] = useState(4);
  const [entityCount, setEntityCount] = useState(154);
  const [activities, setActivities] = useState<Array<{ id: string; msg: string; type: string; time: string }>>([]);

  useEffect(() => {
    // Read from uploader localStorage to show dynamic metrics
    try {
      const cached = localStorage.getItem("sutradhar_uploads");
      if (cached) {
        const jobs = JSON.parse(cached) as IngestionJobCache[];
        const completeCount = jobs.filter(j => j.status === "COMPLETED").length;
        setDocCount(completeCount + 4); // base mock + dynamic
        setEntityCount((completeCount * 14) + 154);
        
        // Populate recent activity
        const acts = jobs.map(j => ({
          id: j.jobId,
          msg: `Ingested document specifications: ${j.name} (${j.status})`,
          type: j.status === "COMPLETED" ? "success" : j.status === "FAILED" ? "error" : "warning",
          time: j.timestamp || "Just now"
        }));
        setActivities([...acts, ...MOCK_ACTIVITIES]);
      } else {
        setActivities(MOCK_ACTIVITIES);
      }
    } catch (e) {
      setActivities(MOCK_ACTIVITIES);
    }
  }, []);

  return (
    <div className="flex-1 overflow-y-auto scroll-touch p-4 md:p-8 space-y-5 md:space-y-8 max-w-6xl mx-auto w-full no-zoom">
      {/* ── Header: compact on mobile, full on desktop ── */}
      <div className="flex items-center justify-between border-b border-border pb-4 gap-3">
        <div className="min-w-0">
          <h1 className="font-display font-bold text-base md:text-2xl text-slate-100 tracking-tight uppercase leading-tight truncate">
            Sutradhar Control Room
          </h1>
          <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 hidden md:block">
            Plant-floor industrial knowledge intelligence terminal.
          </p>
        </div>
        {/* Status badge — always visible, compact on mobile */}
        <div className="shrink-0 text-[9px] md:text-[11px] font-mono text-muted-foreground border border-border px-2 md:px-3 py-1 md:py-1.5 rounded bg-muted/20 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-success animate-ping" />
          <span className="hidden sm:inline">UNIT 3 OVERSEER CONSOLE</span>
          <span className="sm:hidden">LIVE</span>
        </div>
      </div>

      {/* ── KPI Panel: 2×2 grid on mobile, 4-col on desktop ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
        {/* KPI 1 */}
        <div className="panel-card rounded">
          <div className="panel-card-header flex items-center justify-between">
            <span className="truncate">Docs Ingested</span>
            <Database className="h-3.5 w-3.5 text-primary shrink-0 ml-1" />
          </div>
          <div className="p-4 md:p-6">
            <div className="font-mono text-2xl md:text-3xl font-bold text-slate-100">{docCount}</div>
            <div className="text-[9px] md:text-[10px] text-muted-foreground mt-1 md:mt-2 leading-snug">
              Active plant flowsheets &amp; manuals
            </div>
          </div>
        </div>

        {/* KPI 2 */}
        <div className="panel-card rounded">
          <div className="panel-card-header flex items-center justify-between">
            <span className="truncate">Entities</span>
            <Network className="h-3.5 w-3.5 text-primary shrink-0 ml-1" />
          </div>
          <div className="p-4 md:p-6">
            <div className="font-mono text-2xl md:text-3xl font-bold text-slate-100">{entityCount}</div>
            <div className="text-[9px] md:text-[10px] text-muted-foreground mt-1 md:mt-2 leading-snug">
              Tag mappings resolved in graph
            </div>
          </div>
        </div>

        {/* KPI 3 */}
        <div className="panel-card rounded">
          <div className="panel-card-header flex items-center justify-between">
            <span className="truncate">Avg Response</span>
            <Clock className="h-3.5 w-3.5 text-primary shrink-0 ml-1" />
          </div>
          <div className="p-4 md:p-6">
            <div className="font-mono text-2xl md:text-3xl font-bold text-slate-100">2.4s</div>
            <div className="text-[9px] md:text-[10px] text-muted-foreground mt-1 md:mt-2 leading-snug">
              Hybrid vector-graph resolution
            </div>
          </div>
        </div>

        {/* KPI 4 */}
        <div className="panel-card rounded relative overflow-hidden">
          <div className="panel-card-header flex items-center justify-between">
            <span className="truncate">Compliance</span>
            <ShieldAlert className="h-3.5 w-3.5 text-amber-warning shrink-0 ml-1" />
          </div>
          <div className="p-4 md:p-6">
            <div className="font-mono text-[9px] md:text-xs font-semibold text-amber-warning/80 tracking-wide uppercase border border-amber-warning/20 px-2 py-1 rounded bg-amber-warning/5 w-max">
              Coming soon
            </div>
            <div className="text-[9px] md:text-[10px] text-muted-foreground mt-2 md:mt-4 leading-snug">
              Automated regulatory audits
            </div>
          </div>
        </div>
      </div>

      {/* ── Activity feed + Quick links ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-8">
        {/* Activity feed */}
        <div className="panel-card rounded md:col-span-2">
          <div className="panel-card-header flex items-center gap-2">
            <ListFilter className="h-3.5 w-3.5 text-primary" />
            <span>Recent System Actions</span>
          </div>
          <div className="p-4 md:p-6 divide-y divide-border/60 max-h-[300px] md:max-h-[350px] overflow-y-auto scroll-touch pr-2">
            {activities.map((act, index) => (
              <div
                key={index}
                className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3 text-xs min-h-[44px]"
              >
                <div className="flex gap-2.5 min-w-0">
                  <span className={`h-2 w-2 rounded-full mt-1 shrink-0 ${
                    act.type === "success"
                      ? "bg-teal-success"
                      : act.type === "error"
                      ? "bg-destructive"
                      : "bg-amber-warning"
                  }`} />
                  <div className="min-w-0">
                    <p className="text-slate-200 text-[11px] leading-snug">{act.msg}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{act.id.slice(0, 8)}</p>
                  </div>
                </div>
                <span className="text-[9px] text-muted-foreground shrink-0 font-mono whitespace-nowrap">
                  {act.time}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Terminal Quick Links */}
        <div className="panel-card rounded flex flex-col justify-between">
          <div className="panel-card-header">
            <span>Terminal Quick Links</span>
          </div>
          <div className="p-4 md:p-6 space-y-3 flex-1 flex flex-col justify-center">
            <Link
              href="/ingestion"
              className="flex justify-between items-center p-3 border border-border bg-muted/20 rounded transition-all duration-200 min-h-[52px] tap-target active:bg-muted/50 hover:border-slate-600 hover:bg-muted/40"
            >
              <div>
                <div className="text-xs font-semibold text-slate-200">Ingest Specifications</div>
                <div className="text-[10px] text-muted-foreground">Upload manuals &amp; flowsheets</div>
              </div>
              <Database className="h-4 w-4 text-primary shrink-0" />
            </Link>

            <Link
              href="/copilot"
              className="flex justify-between items-center p-3 border border-border bg-muted/20 rounded transition-all duration-200 min-h-[52px] tap-target active:bg-muted/50 hover:border-slate-600 hover:bg-muted/40"
            >
              <div>
                <div className="text-xs font-semibold text-slate-200">Plant Copilot RAG</div>
                <div className="text-[10px] text-muted-foreground">Search specs and details</div>
              </div>
              <Clock className="h-4 w-4 text-primary shrink-0" />
            </Link>

            <Link
              href="/graph-explorer"
              className="flex justify-between items-center p-3 border border-border bg-muted/20 rounded transition-all duration-200 min-h-[52px] tap-target active:bg-muted/50 hover:border-slate-600 hover:bg-muted/40"
            >
              <div>
                <div className="text-xs font-semibold text-slate-200">P&ID Graph Explorer</div>
                <div className="text-[10px] text-muted-foreground">Explore routed equipment</div>
              </div>
              <Network className="h-4 w-4 text-primary shrink-0" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const MOCK_ACTIVITIES = [
  { id: "SYS-MIG-1", msg: "Constraint equipment_tag_unique successfully validated", type: "success", time: "2026-07-14 14:00" },
  { id: "SYS-IDX-2", msg: "Created vector index chunk_embeddings [1024 dims]", type: "success", time: "2026-07-14 14:02" },
  { id: "DOC-990-2", msg: "Ingested document manual: Operating Specifications M-12", type: "success", time: "2026-07-14 15:10" },
  { id: "EQ-101-A", msg: "Resolved Pump P-101 merged and feed relationship written", type: "success", time: "2026-07-14 15:12" },
];
