"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  Network,
  Trash2,
  CloudUpload,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { api, IngestionStatusResponse, GraphResponse } from "@/lib/api";
import { useLoadingMessage } from "@/hooks/use-loading-message";

interface IngestionJobCache {
  jobId: string;
  name: string;
  size: string;
  progress: number;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  timestamp: string;
  error?: string;
}

const ACCEPTED_TYPES = [".pdf", ".csv", ".xlsx", ".xls", ".txt", ".png", ".jpg", ".jpeg"];

function statusVariant(status: string): "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "COMPLETED": return "success";
    case "FAILED": return "danger";
    case "PROCESSING": return "warning";
    default: return "info";
  }
}

export default function IngestionPage() {
  const [files, setFiles] = useState<IngestionJobCache[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const loadingMessage = useLoadingMessage(uploading, "Transmitting asset...");

  const [selectedJob, setSelectedJob] = useState<IngestionJobCache | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const cached = localStorage.getItem("marg_uploads");
      if (cached) setFiles(JSON.parse(cached));
    } catch {
      /* ignore */
    }
  }, []);

  const updateFiles = (newFiles: IngestionJobCache[]) => {
    setFiles(newFiles);
    try {
      localStorage.setItem("marg_uploads", JSON.stringify(newFiles));
    } catch {
      /* ignore */
    }
  };

  // Poll active jobs
  useEffect(() => {
    const active = files.filter((f) => f.status === "QUEUED" || f.status === "PROCESSING");
    if (!active.length) return;

    const interval = setInterval(async () => {
      let updated = false;
      const polled = await Promise.all(
        files.map(async (file) => {
          if (file.status === "QUEUED" || file.status === "PROCESSING") {
            try {
              const res: IngestionStatusResponse = await api.getIngestionStatus(file.jobId);
              updated = true;
              return { ...file, status: res.status, progress: res.progress, error: res.error };
            } catch {
              return file;
            }
          }
          return file;
        })
      );
      if (updated) updateFiles(polled);
    }, 1500);

    return () => clearInterval(interval);
  }, [files]);

  const handleOpenDrawer = async (job: IngestionJobCache) => {
    setSelectedJob(job);
    if (job.status !== "COMPLETED") { setGraphData(null); return; }
    setDrawerLoading(true);
    try {
      const data = await api.getGraphExplorer(job.jobId);
      setGraphData(data);
    } catch {
      setGraphData(null);
    } finally {
      setDrawerLoading(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) await uploadFile(e.dataTransfer.files[0]);
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) await uploadFile(e.target.files[0]);
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const res = await api.triggerIngestion(file);
      const newJob: IngestionJobCache = {
        jobId: res.job_id,
        name: file.name,
        size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
        progress: 0,
        status: "QUEUED",
        timestamp: new Date().toISOString().replace("T", " ").slice(0, 16),
      };
      updateFiles([newJob, ...files]);
    } catch (e) {
      alert("Upload failed: " + (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, file: IngestionJobCache) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${file.name}"?\n\nThis will purge the document and any exclusively extracted graph entities.`)) return;
    try {
      await api.deleteDocument(file.jobId);
      const filtered = files.filter((f) => f.jobId !== file.jobId);
      updateFiles(filtered);
      if (selectedJob?.jobId === file.jobId) setSelectedJob(null);
    } catch (err) {
      alert("Delete failed: " + (err as Error).message);
    }
  };

  const extractedEntities = graphData?.nodes.filter(
    (n) => n.id !== selectedJob?.jobId && !n.labels.includes("Chunk")
  ) || [];

  const DrawerContent = () => {
    if (!selectedJob) return null;
    return (
      <div className="space-y-5 p-5">
        {/* Meta */}
        <div>
          <Badge variant="info" className="mb-2">Metadata Inspector</Badge>
          <h3 className="font-display font-bold text-sm text-foreground mt-2 break-words">
            {selectedJob.name}
          </h3>
          <p className="text-[10px] font-mono text-muted-foreground mt-1">
            JOB: {selectedJob.jobId}
          </p>
        </div>

        {/* Status */}
        <div className="space-y-2 border-t border-border pt-4">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Pipeline Status</span>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground text-xs">State</span>
            <Badge variant={statusVariant(selectedJob.status)} dot>
              {selectedJob.status}
            </Badge>
          </div>
          {(selectedJob.status === "QUEUED" || selectedJob.status === "PROCESSING") && (
            <div className="space-y-1.5">
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-warning transition-all duration-500"
                  style={{ width: `${selectedJob.progress}%` }}
                />
              </div>
              <p className="text-[10px] font-mono text-muted-foreground text-right">{selectedJob.progress}%</p>
            </div>
          )}
          {selectedJob.error && (
            <div className="text-[10px] text-destructive font-mono border border-destructive/20 bg-destructive/5 p-2.5 rounded-lg">
              {selectedJob.error}
            </div>
          )}
        </div>

        {/* Graph Entities */}
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <Network className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Graph Entities</span>
          </div>

          {drawerLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} height={36} className="rounded-lg" />)}
            </div>
          ) : extractedEntities.length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic font-mono">
              {selectedJob.status === "COMPLETED" ? "No core entities resolved" : "Awaiting extraction..."}
            </p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto scroll-touch pr-1">
              {extractedEntities.map((entity, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-muted/10"
                >
                  <div className="min-w-0 flex-1 mr-2">
                    <p className="text-xs font-mono font-semibold text-foreground truncate">{entity.id}</p>
                    <p className="text-[9px] text-muted-foreground">{entity.properties.type || "Undefined"}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[8px]">
                    {entity.labels[0]}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* File info */}
        <div className="border-t border-border pt-4 grid grid-cols-2 gap-3 text-[10px] font-mono text-muted-foreground">
          <div><span className="block text-[9px] uppercase tracking-wider mb-0.5">Size</span>{selectedJob.size}</div>
          <div><span className="block text-[9px] uppercase tracking-wider mb-0.5">Ingested</span>{selectedJob.timestamp}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-1 overflow-hidden h-full no-zoom relative">
      {/* ── Main Panel ── */}
      <div className="flex-1 overflow-y-auto scroll-touch p-4 md:p-8 space-y-6 max-w-5xl mx-auto w-full">

        {/* Header */}
        <div className="animate-fade-in-up">
          <h1 className="font-display font-bold text-xl md:text-2xl text-foreground tracking-tight">
            Ingestion Pipeline
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Feed manuals, datasheets, or scanned flowsheets into the knowledge graph.
          </p>
        </div>

        {/* ── Drop Zone ── */}
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative cursor-pointer rounded-xl border-2 border-dashed py-14 md:py-20
                      flex flex-col items-center justify-center text-center transition-all duration-200 tap-target
                      ${dragActive
                        ? "border-primary bg-primary/5 scale-[1.01]"
                        : "border-border hover:border-primary/40 hover:bg-muted/5 bg-muted/5"
                      }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileInput}
            accept={ACCEPTED_TYPES.join(",")}
          />

          {/* Upload icon */}
          <div className={`mb-4 p-4 rounded-2xl border transition-all duration-200 ${
            dragActive ? "bg-primary/15 border-primary/30" : "bg-muted/30 border-border"
          }`}>
            <CloudUpload className={`h-8 w-8 ${dragActive ? "text-primary" : "text-muted-foreground"} transition-colors`} />
          </div>

          <h3 className="font-display font-semibold text-base text-foreground mb-1">
            {dragActive ? "Release to upload" : "Drop file here"}
          </h3>
          <p className="text-sm text-muted-foreground mb-5">
            or click to browse your files
          </p>

          {/* File type chips */}
          <div className="flex flex-wrap gap-1.5 justify-center mb-5">
            {ACCEPTED_TYPES.map((t) => (
              <span key={t} className="text-[9px] font-mono px-2 py-0.5 rounded border border-border bg-muted/30 text-muted-foreground uppercase">
                {t.replace(".", "")}
              </span>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Browse Files
          </Button>

          {/* Uploading overlay */}
          {uploading && (
            <div className="absolute inset-0 rounded-xl bg-background/80 backdrop-blur-sm flex items-center justify-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm font-mono text-foreground">{loadingMessage}</span>
            </div>
          )}
        </div>

        {/* ── Job List ── */}
        <Card>
          <CardHeader>
            <div className="p-1.5 rounded-md bg-primary/10">
              <FileText className="h-3.5 w-3.5 text-primary" />
            </div>
            <CardTitle>Ingestion Log</CardTitle>
            <span className="ml-auto text-[9px] font-mono text-muted-foreground">
              {files.length} items
            </span>
          </CardHeader>

          {files.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={Upload}
                title="No documents yet"
                description="Upload a PDF, datasheet, or scanned P&ID flowsheet to get started."
              />
            </CardBody>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="px-5 py-3 font-display text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">File</th>
                      <th className="px-5 py-3 font-display text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Job ID</th>
                      <th className="px-5 py-3 font-display text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Ingested</th>
                      <th className="px-5 py-3 font-display text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</th>
                      <th className="px-5 py-3 font-display text-[10px] uppercase tracking-wider text-muted-foreground font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {files.map((file) => {
                      const isSelected = selectedJob?.jobId === file.jobId;
                      return (
                        <tr
                          key={file.jobId}
                          onClick={() => handleOpenDrawer(file)}
                          className={`cursor-pointer transition-colors hover:bg-muted/10 ${isSelected ? "bg-primary/5" : ""}`}
                        >
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <div className="p-1.5 rounded-md bg-primary/10 shrink-0">
                                <FileText className="h-3 w-3 text-primary" />
                              </div>
                              <div>
                                <span className="font-medium text-foreground truncate block max-w-[200px]">{file.name}</span>
                                <span className="text-[10px] text-muted-foreground font-mono">{file.size}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 font-mono text-[10px] text-muted-foreground">
                            {file.jobId.slice(0, 10)}…
                          </td>
                          <td className="px-5 py-3.5 font-mono text-[10px] text-muted-foreground">
                            {file.timestamp}
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              <Badge variant={statusVariant(file.status)} dot>
                                {file.status === "PROCESSING" ? `${file.status} ${file.progress}%` : file.status}
                              </Badge>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <button
                              onClick={(e) => handleDelete(e, file)}
                              className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-transparent
                                         text-muted-foreground hover:text-destructive hover:border-destructive/20 hover:bg-destructive/5
                                         transition-all duration-150"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-border">
                {files.map((file) => {
                  const isSelected = selectedJob?.jobId === file.jobId;
                  return (
                    <div
                      key={file.jobId}
                      onClick={() => handleOpenDrawer(file)}
                      className={`flex items-start gap-3 px-5 py-4 cursor-pointer transition-colors tap-target min-h-[64px]
                                  ${isSelected ? "bg-primary/5" : "hover:bg-muted/10"}`}
                    >
                      <div className="p-2 rounded-lg bg-primary/10 shrink-0 mt-0.5">
                        <FileText className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Badge variant={statusVariant(file.status)} dot>
                            {file.status}
                          </Badge>
                          <span className="text-[10px] font-mono text-muted-foreground">{file.size}</span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDelete(e, file)}
                        className="p-1.5 text-muted-foreground hover:text-destructive transition-colors tap-target"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ── Desktop Right Panel ── */}
      {selectedJob && (
        <div className="hidden lg:flex w-80 border-l border-border bg-card flex-col shrink-0 h-full relative animate-slide-in-right">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
            <span className="font-display font-semibold text-xs uppercase tracking-wider text-muted-foreground">
              Inspector
            </span>
            <button
              onClick={() => setSelectedJob(null)}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto scroll-touch">
            <DrawerContent />
          </div>
          <div className="border-t border-border p-4">
            <Button variant="outline" size="sm" className="w-full" onClick={() => setSelectedJob(null)}>
              Close Inspector
            </Button>
          </div>
        </div>
      )}

      {/* ── Mobile Bottom Sheet ── */}
      <BottomSheet
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        title={selectedJob?.name}
        maxHeight="72vh"
        className="lg:hidden"
      >
        <DrawerContent />
        <div className="border-t border-border p-4">
          <Button variant="outline" size="sm" className="w-full min-h-[44px]" onClick={() => setSelectedJob(null)}>
            Close Inspector
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
