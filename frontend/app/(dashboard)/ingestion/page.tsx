"use client";

import React, { useState, useEffect, useRef } from "react";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, X, Network, Database, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { api, IngestionStatusResponse, GraphResponse } from "@/lib/api";

interface IngestionJobCache {
  jobId: string;
  name: string;
  size: string;
  progress: number;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  timestamp: string;
  error?: string;
}

export default function IngestionPage() {
  const [files, setFiles] = useState<IngestionJobCache[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  
  // Drawer state
  const [selectedJob, setSelectedJob] = useState<IngestionJobCache | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load cache from localStorage on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem("marg_uploads");
      if (cached) {
        setFiles(JSON.parse(cached));
      }
    } catch (e) {
      console.error("Failed to load local storage uploads cache", e);
    }
  }, []);

  // Sync cache with localStorage on updates
  const updateFiles = (newFiles: IngestionJobCache[]) => {
    setFiles(newFiles);
    try {
      localStorage.setItem("marg_uploads", JSON.stringify(newFiles));
    } catch (e) {
      console.error("Failed to write local storage uploads cache", e);
    }
  };

  // Poll status of active jobs
  useEffect(() => {
    const activeJobs = files.filter(f => f.status === "QUEUED" || f.status === "PROCESSING");
    if (activeJobs.length === 0) return;

    const interval = setInterval(async () => {
      let updated = false;
      const polledFiles = await Promise.all(
        files.map(async (file) => {
          if (file.status === "QUEUED" || file.status === "PROCESSING") {
            try {
              const res: IngestionStatusResponse = await api.getIngestionStatus(file.jobId);
              updated = true;
              return {
                ...file,
                status: res.status,
                progress: res.progress,
                error: res.error,
              };
            } catch (e) {
              console.error("Failed to poll status for job", file.jobId, e);
              return file;
            }
          }
          return file;
        })
      );

      if (updated) {
        updateFiles(polledFiles);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [files]);

  // Load details drawer graph
  const handleOpenDrawer = async (job: IngestionJobCache) => {
    setSelectedJob(job);
    if (job.status !== "COMPLETED") {
      setGraphData(null);
      return;
    }
    
    setDrawerLoading(true);
    try {
      // Query graph explorer for the document node's connected subgraphs
      const data = await api.getGraphExplorer(job.jobId);
      setGraphData(data);
    } catch (e) {
      console.error("Failed to load extraction details subgraph", e);
      setGraphData(null);
    } finally {
      setDrawerLoading(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await uploadFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await uploadFile(e.target.files[0]);
    }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const res = await api.triggerIngestion(file);
      
      const sizeStr = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
      const timeStr = new Date().toISOString().replace("T", " ").slice(0, 16);
      
      const newJob: IngestionJobCache = {
        jobId: res.job_id,
        name: file.name,
        size: sizeStr,
        progress: 0,
        status: "QUEUED",
        timestamp: timeStr,
      };

      updateFiles([newJob, ...files]);
    } catch (e) {
      alert("Extraction trigger aborted: " + (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (e: React.MouseEvent, file: IngestionJobCache) => {
    e.stopPropagation(); // Avoid activating the selection drawer
    
    const confirmDelete = window.confirm(
      `Are you sure you want to delete "${file.name}"?\n\nThis will purge the document and any graph entities exclusively extracted from it.`
    );
    if (!confirmDelete) return;

    try {
      await api.deleteDocument(file.jobId);
      const filtered = files.filter(f => f.jobId !== file.jobId);
      updateFiles(filtered);
      
      // Close detail drawer if the deleted document was active
      if (selectedJob?.jobId === file.jobId) {
        setSelectedJob(null);
      }
    } catch (err) {
      alert("Failed to delete document: " + (err as Error).message);
    }
  };


  // Filter out chunk and document nodes to list only physical entities extracted
  const extractedEntities = graphData?.nodes.filter(
    n => n.id !== selectedJob?.jobId && !n.labels.includes("Chunk")
  ) || [];

  // Drawer content renderer
  const DrawerContent = () => {
    if (!selectedJob) return null;
    return (
      <div className="space-y-6 flex-1 overflow-y-auto pr-1">
        <div>
          <span className="text-[9px] font-mono text-primary uppercase border border-primary/20 px-2 py-0.5 rounded bg-primary/5">
            Metadata Inspector
          </span>
          <h3 className="font-display font-bold text-xs text-slate-200 mt-3 truncate uppercase tracking-wider">
            {selectedJob.name}
          </h3>
          <p className="text-[10px] font-mono text-muted-foreground mt-1">
            JOB: {selectedJob.jobId}
          </p>
        </div>

        {/* Status Section */}
        <div className="space-y-2 border-t border-border pt-4">
          <h4 className="text-[10px] font-display font-semibold uppercase text-slate-400 tracking-wider">
            Pipeline Status
          </h4>
          <div className="text-[11px] font-mono flex justify-between">
            <span className="text-muted-foreground">State:</span>
            <span className={
              selectedJob.status === "COMPLETED" 
                ? "text-teal-success" 
                : selectedJob.status === "FAILED" 
                ? "text-destructive" 
                : "text-amber-warning"
            }>
              {selectedJob.status}
            </span>
          </div>
          {selectedJob.error && (
            <div className="text-[10px] text-destructive font-mono border border-destructive/20 bg-destructive/5 p-2 rounded">
              Error: {selectedJob.error}
            </div>
          )}
        </div>

        {/* Extracted Entities Section */}
        <div className="space-y-3 border-t border-border pt-4">
          <h4 className="text-[10px] font-display font-semibold uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
            <Network className="h-3.5 w-3.5 text-primary" />
            <span>Resolved Graph Entities</span>
          </h4>

          {drawerLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs font-mono text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>TRAVERSING NEODB SCHEMATIC...</span>
            </div>
          ) : extractedEntities.length === 0 ? (
            <div className="text-[10px] text-muted-foreground italic font-mono">
              {selectedJob.status === "COMPLETED" 
                ? "[NO CORE ENTITIES RESOLVED FOR THIS ASSET]"
                : "[AWAITING EXTRACTION COMPLETION]"}
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {extractedEntities.map((entity, idx) => (
                <div
                  key={idx}
                  className="p-2 border border-border/80 bg-muted/10 rounded flex justify-between items-center text-[10px] font-mono"
                >
                  <div className="truncate">
                    <span className="text-slate-200 font-bold block truncate">
                      {entity.id}
                    </span>
                    <span className="text-muted-foreground text-[9px] block">
                      Type: {entity.properties.type || "Undefined"}
                    </span>
                  </div>
                  <span className="text-[8px] uppercase px-1.5 py-0.5 border border-border bg-muted/40 text-muted-foreground rounded shrink-0">
                    {entity.labels[0]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-1 overflow-hidden h-full no-zoom relative">
      {/* Ingestion Panel */}
      <div className="flex-1 overflow-y-auto scroll-touch p-4 md:p-8 space-y-5 md:space-y-8 max-w-5xl mx-auto w-full">
        {/* Header */}
        <div>
          <h1 className="font-display font-bold text-base md:text-xl text-slate-100 uppercase tracking-wider">
            Ingestion Pipeline
          </h1>
          <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5">
            Feed manuals, datasheets, or scanned flowsheets into the knowledge graph.
          </p>
        </div>

        {/* Drag and Drop block — also works as tap-to-upload on mobile */}
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border border-dashed rounded p-8 md:p-10 flex flex-col items-center justify-center transition-all duration-150 relative cursor-pointer tap-target ${
            dragActive
              ? "border-primary bg-primary/5"
              : "border-border hover:border-slate-600 bg-muted/10 active:bg-muted/30"
          }`}
        >
          <input
            type="file"
            id="file-upload"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileInput}
            accept=".pdf,.csv,.xlsx,.txt,.png,.jpg,.jpeg"
          />

          <div className="p-3 bg-muted/40 rounded border border-border/80 mb-3">
            <Upload className={`h-5 w-5 ${dragActive ? "text-primary" : "text-slate-400"}`} />
          </div>

          <h3 className="font-display font-medium text-slate-200 text-xs uppercase tracking-wider">
            Drag & drop file here
          </h3>
          <p className="text-[10px] text-muted-foreground mt-1 mb-4 font-mono">
            PDF, CSV, SPEC SHEETS, OR PNG/JPG P&IDs
          </p>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
            className="cursor-pointer font-display text-[10px] tracking-wider uppercase min-h-[44px] tap-target"
          >
            Browse Files
          </Button>

          {uploading && (
            <div className="absolute inset-0 bg-slate-950/70 rounded flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-xs text-slate-300 font-mono">ENCRYPTING & TRANSMITTING ASSET...</span>
            </div>
          )}
        </div>

        {/* Ingestion Table */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h3 className="font-display font-semibold text-xs tracking-wider uppercase text-slate-400">
              Terminal Log History
            </h3>
            <span className="text-[9px] font-mono text-muted-foreground">TOTAL: {files.length} ITEMS</span>
          </div>

          {files.length === 0 ? (
            <div className="border border-border rounded p-8 text-center text-xs text-muted-foreground font-mono">
              [SYSTEM STANDBY - NO INGESTED DOCUMENTS RECORDED]
            </div>
          ) : (
            <div className="border border-border rounded overflow-hidden overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs min-w-[360px]">
                <thead>
                  <tr className="bg-muted/40 border-b border-border font-display text-[10px] tracking-wider uppercase text-slate-300">
                    <th className="p-3">File Name</th>
                    <th className="p-3 hidden sm:table-cell">Job ID</th>
                    <th className="p-3 hidden md:table-cell">Ingested Time</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {files.map((file) => {
                    const isSelected = selectedJob?.jobId === file.jobId;
                    return (
                      <tr
                        key={file.jobId}
                        onClick={() => handleOpenDrawer(file)}
                        className={`cursor-pointer transition-colors tap-target hover:bg-muted/10 ${
                          isSelected ? "bg-muted/30" : ""
                        }`}
                        style={{ minHeight: 44 }}
                      >
                        <td className="p-3 font-medium text-slate-200">
                          <div className="flex items-center gap-2">
                            <FileText className="h-3.5 w-3.5 text-primary/85 shrink-0" />
                            <span className="truncate max-w-[140px] md:max-w-none">{file.name}</span>
                          </div>
                        </td>
                        <td className="p-3 font-mono text-[10px] text-muted-foreground hidden sm:table-cell">
                          {file.jobId.slice(0, 8)}...
                        </td>
                        <td className="p-3 font-mono text-[10px] text-muted-foreground hidden md:table-cell">
                          {file.timestamp}
                        </td>
                        <td className="p-3">
                          {file.status === "COMPLETED" && (
                            <span className="inline-flex items-center gap-1 text-teal-success font-medium text-[10px]">
                              <CheckCircle2 className="h-3 w-3" />
                              <span className="hidden sm:inline">Complete</span>
                            </span>
                          )}
                          {file.status === "FAILED" && (
                            <span className="inline-flex items-center gap-1 text-destructive font-medium text-[10px]">
                              <AlertCircle className="h-3 w-3" />
                              <span className="hidden sm:inline">Failed</span>
                            </span>
                          )}
                          {(file.status === "QUEUED" || file.status === "PROCESSING") && (
                            <span className="inline-flex items-center gap-1.5 text-amber-warning font-medium text-[10px] animate-pulse">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span className="hidden sm:inline">{file.status} ({file.progress}%)</span>
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={(e) => handleDeleteDocument(e, file)}
                            className="p-2 border border-transparent rounded hover:border-border hover:bg-muted/40 text-muted-foreground hover:text-destructive transition-all min-h-[40px] min-w-[40px] flex items-center justify-center tap-target ml-auto"
                            title="Delete Asset"
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
          )}
        </div>
      </div>

      {/* Right side Detail Drawer — desktop right panel / mobile bottom sheet */}
      <AnimatePresence>
        {selectedJob && (
          <>
            {/* Desktop Drawer (lg+) */}
            <motion.div
              initial={{ opacity: 0, x: 300 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 300 }}
              className="hidden lg:flex w-80 border-l border-border bg-card p-6 flex-col justify-between shrink-0 h-full relative"
            >
              <button
                onClick={() => setSelectedJob(null)}
                className="absolute top-4 right-4 text-muted-foreground hover:text-slate-100 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
              <DrawerContent />
              <div className="border-t border-border pt-4 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-[10px] tracking-wider uppercase font-display"
                  onClick={() => setSelectedJob(null)}
                >
                  Close Inspector
                </Button>
              </div>
            </motion.div>

            {/* Mobile Bottom Sheet Backdrop */}
            <div
              onClick={() => setSelectedJob(null)}
              className="lg:hidden absolute inset-0 bg-slate-950/60 z-40 sheet-backdrop animate-fade-in"
            />
            {/* Mobile Bottom Sheet (below lg) */}
            <div
              className="lg:hidden absolute left-0 right-0 z-50 bg-card border-t border-border rounded-t-2xl bottom-sheet flex flex-col"
              style={{
                bottom: "calc(0px + env(safe-area-inset-bottom, 0px))",
                maxHeight: "65vh",
              }}
            >
              {/* Drag handle */}
              <div className="shrink-0 flex justify-center pt-3 pb-1">
                <div className="h-1 w-10 rounded-full bg-border" />
              </div>
              {/* Sheet header */}
              <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border">
                <span className="font-display font-bold text-xs uppercase tracking-wider text-slate-200 truncate pr-4">
                  {selectedJob.name}
                </span>
                <button
                  onClick={() => setSelectedJob(null)}
                  className="text-muted-foreground hover:text-slate-100 transition-colors tap-target min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {/* Sheet content */}
              <div className="flex-1 min-h-0 overflow-y-auto scroll-touch p-5">
                <DrawerContent />
                <div className="border-t border-border pt-4 mt-4 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-[10px] tracking-wider uppercase font-display min-h-[44px] tap-target"
                    onClick={() => setSelectedJob(null)}
                  >
                    Close Inspector
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
