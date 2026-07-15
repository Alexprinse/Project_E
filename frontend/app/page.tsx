"use client";

import React, { useState, useEffect } from "react";
import {
  Database,
  Network,
  Clock,
  ShieldAlert,
  MessageSquare,
  ArrowRight,
  Activity,
  Zap,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { MetricCard } from "@/components/ui/metric-card";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface IngestionJobCache {
  jobId: string;
  name: string;
  size: string;
  progress: number;
  status: string;
  timestamp: string;
}

interface ActivityItem {
  id: string;
  msg: string;
  type: "success" | "error" | "warning" | "info";
  time: string;
}

const MOCK_ACTIVITIES: ActivityItem[] = [
  { id: "SYS-MIG-1", msg: "Constraint equipment_tag_unique validated", type: "success", time: "14:00" },
  { id: "SYS-IDX-2", msg: "Vector index chunk_embeddings [1024 dims] created", type: "success", time: "14:02" },
  { id: "DOC-990-2", msg: "Ingested: Operating Specifications M-12", type: "success", time: "15:10" },
  { id: "EQ-101-A", msg: "Pump P-101 merged — feed relationship resolved", type: "success", time: "15:12" },
];

const QUICK_LINKS = [
  {
    href: "/ingestion",
    icon: Database,
    label: "Ingest Specifications",
    sub: "Upload manuals & flowsheets",
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    href: "/copilot",
    icon: MessageSquare,
    label: "Plant Copilot",
    sub: "Hybrid vector-graph QA",
    color: "text-teal-success",
    bg: "bg-teal-success/10",
  },
  {
    href: "/graph-explorer",
    icon: Network,
    label: "P&ID Graph Explorer",
    sub: "Explore routed equipment",
    color: "text-amber-warning",
    bg: "bg-amber-warning/10",
  },
  {
    href: "/rca",
    icon: ShieldAlert,
    label: "RCA Assistant",
    sub: "Failure root cause analysis",
    color: "text-destructive",
    bg: "bg-destructive/10",
  },
];

const activityIcon = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertCircle,
  info: Loader2,
};

const activityBadgeVariant: Record<string, "success" | "danger" | "warning" | "info"> = {
  success: "success",
  error: "danger",
  warning: "warning",
  info: "info",
};

export default function DashboardHome() {
  const [docCount, setDocCount] = useState(4);
  const [entityCount, setEntityCount] = useState(154);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const cached = localStorage.getItem("marg_uploads");
      if (cached) {
        const jobs = JSON.parse(cached) as IngestionJobCache[];
        const completeCount = jobs.filter((j) => j.status === "COMPLETED").length;
        setDocCount(completeCount + 4);
        setEntityCount(completeCount * 14 + 154);
        const acts: ActivityItem[] = jobs.map((j) => ({
          id: j.jobId,
          msg: `Ingested: ${j.name} — ${j.status}`,
          type: j.status === "COMPLETED" ? "success" : j.status === "FAILED" ? "error" : "warning",
          time: j.timestamp?.slice(11, 16) || "—",
        }));
        setActivities([...acts, ...MOCK_ACTIVITIES]);
      } else {
        setActivities(MOCK_ACTIVITIES);
      }
    } catch {
      setActivities(MOCK_ACTIVITIES);
    }
  }, []);

  if (!mounted) {
    return (
      <div className="flex-1 overflow-y-auto scroll-touch p-4 md:p-8 space-y-6 max-w-6xl mx-auto w-full no-zoom">
        <div className="h-16 skeleton-shimmer rounded-lg" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 skeleton-shimmer rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scroll-touch no-zoom">
      <div className="p-4 md:p-8 space-y-6 md:space-y-8 max-w-6xl mx-auto w-full">

        {/* ── Page Header ── */}
        <div className="animate-fade-in-up">
          <div className="flex items-start justify-between gap-4 pb-5 border-b border-border">
            <div>
              <h1 className="font-display font-bold text-xl md:text-2xl text-foreground tracking-tight">
                Control Room
              </h1>
              <p className="text-sm text-muted-foreground mt-1 hidden md:block">
                Industrial knowledge intelligence — asset operations overview
              </p>
            </div>

            {/* System health badge */}
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card">
              <span className="status-dot status-dot-online" />
              <div className="text-right hidden sm:block">
                <div className="text-[10px] font-mono text-teal-success uppercase tracking-wider font-semibold">
                  All Systems
                </div>
                <div className="text-[9px] font-mono text-muted-foreground">
                  Unit 3 Overseer
                </div>
              </div>
              <span className="sm:hidden text-[10px] font-mono text-teal-success font-bold uppercase">Live</span>
            </div>
          </div>
        </div>

        {/* ── KPI Grid ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 stagger-children">
          <MetricCard
            icon={Database}
            label="Docs Ingested"
            value={docCount}
            subtitle="Active plant flowsheets & manuals"
            variant="info"
            trend="up"
            trendLabel="+2 this week"
            delay={0}
          />
          <MetricCard
            icon={Network}
            label="Graph Entities"
            value={entityCount}
            subtitle="Tag mappings resolved in Neo4j"
            variant="success"
            trend="up"
            trendLabel="Fully resolved"
            delay={70}
          />
          <MetricCard
            icon={Clock}
            label="Avg Response"
            value="2.4s"
            subtitle="Hybrid vector-graph resolution"
            variant="default"
            trend="down"
            trendLabel="↓ 0.3s vs baseline"
            delay={140}
          />
          <MetricCard
            icon={ShieldAlert}
            label="Compliance"
            variant="warning"
            value="—"
            subtitle="Automated regulatory audits"
            badge={
              <Badge variant="warning">Soon</Badge>
            }
            delay={210}
          />
        </div>

        {/* ── System Status Strip ── */}
        <Card className="animate-fade-in-up" style={{ animationDelay: "280ms" }}>
          <CardBody className="py-3 px-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-2 text-[11px] font-mono">
                <span className="status-dot status-dot-online" />
                <span className="text-muted-foreground">Neo4j AuraDB</span>
                <Badge variant="success" className="text-[8px]">Connected</Badge>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono">
                <span className="status-dot status-dot-online" />
                <span className="text-muted-foreground">Gemini 2.5 Pro</span>
                <Badge variant="success" className="text-[8px]">Online</Badge>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono">
                <span className="status-dot status-dot-online" />
                <span className="text-muted-foreground">Vector Index</span>
                <Badge variant="info" className="text-[8px]">1024-dim</Badge>
              </div>
              <div className="ml-auto hidden md:flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                <Zap className="h-3 w-3 text-primary" />
                <span>Hybrid RAG + Graph Traversal Active</span>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* ── Main Content Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">

          {/* Activity Feed — 2 cols */}
          <Card
            className="lg:col-span-2 animate-fade-in-up"
            style={{ animationDelay: "350ms" }}
            elevated
          >
            <CardHeader>
              <div className="p-1.5 rounded-md bg-primary/10">
                <Activity className="h-3.5 w-3.5 text-primary" />
              </div>
              <CardTitle>System Activity</CardTitle>
              <span className="ml-auto text-[9px] font-mono text-muted-foreground">
                {activities.length} events
              </span>
            </CardHeader>
            <CardBody className="p-0">
              <div className="divide-y divide-border max-h-[320px] overflow-y-auto scroll-touch">
                {activities.map((act, idx) => {
                  const Icon = activityIcon[act.type];
                  return (
                    <div
                      key={idx}
                      className="flex items-start gap-3 px-5 py-3.5 hover:bg-muted/20 transition-colors"
                    >
                      <div className={`mt-0.5 shrink-0 ${
                        act.type === "success" ? "text-teal-success" :
                        act.type === "error" ? "text-destructive" : "text-amber-warning"
                      }`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground/90 leading-snug">{act.msg}</p>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          {act.id.slice(0, 12)}
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <Badge variant={activityBadgeVariant[act.type] || "default"}>
                          {act.type}
                        </Badge>
                        <span className="text-[9px] font-mono text-muted-foreground whitespace-nowrap hidden sm:block">
                          {act.time}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>

          {/* Quick Actions */}
          <Card
            className="animate-fade-in-up"
            style={{ animationDelay: "420ms" }}
          >
            <CardHeader>
              <div className="p-1.5 rounded-md bg-amber-warning/10">
                <TrendingUp className="h-3.5 w-3.5 text-amber-warning" />
              </div>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardBody className="p-3 space-y-2">
              {QUICK_LINKS.map(({ href, icon: Icon, label, sub, color, bg }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/10
                             hover:bg-accent hover:border-border/80 hover:-translate-y-0.5
                             transition-all duration-150 group tap-target min-h-[52px]"
                >
                  <div className={`p-2 rounded-lg shrink-0 ${bg}`}>
                    <Icon className={`h-3.5 w-3.5 ${color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-foreground/90 truncate">{label}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{sub}</div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                </Link>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
