"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Search,
  Loader2,
  Network,
  X,
  Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { api, GraphResponse, NodeSchema, EdgeSchema } from "@/lib/api";

const InteractiveGraph = dynamic(
  () => import("@/components/features/graph-explorer/InteractiveGraph"),
  { ssr: false }
);

/* ── Node color helper for inspector ── */
function getNodeColor(labels: string[]): string {
  if (labels.includes("Document") || labels.includes("Chunk")) return "hsl(193 38% 47%)";
  if (labels.includes("Location")) return "hsl(160 36% 45%)";
  if (labels.includes("ProcessParameter")) return "hsl(33 70% 53%)";
  if (labels.includes("Failure")) return "hsl(0 72% 61%)";
  return "hsl(212 11% 54%)";
}

/* ── Node Detail content for inspector ── */
function NodeDetail({
  node,
  inEdges,
  outEdges,
  nodes = [],
}: {
  node: NodeSchema;
  inEdges: EdgeSchema[];
  outEdges: EdgeSchema[];
  nodes?: NodeSchema[];
}) {
  const dot = getNodeColor(node.labels);
  const getNodeName = (id: string) => {
    const found = nodes.find((n) => n.id === id);
    if (found) {
      return found.properties.display_name || found.properties.name || found.properties.tag || found.id;
    }
    return id;
  };
  return (
    <div className="space-y-5 p-5">
      {/* Identity */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="status-dot animate-none" style={{ background: dot }} />
          <Badge variant="info" className="text-[9px]">{node.labels[0]}</Badge>
        </div>
        <h3 className="font-mono font-bold text-sm text-foreground break-all">
          {node.properties.display_name || node.properties.tag || node.id}
        </h3>
        {(node.properties.tag || node.properties.display_name) && (
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5 break-all">{node.id}</p>
        )}
      </div>

      {/* Properties */}
      <div className="space-y-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Properties</span>
        <div className="rounded-lg border border-border bg-muted/10 divide-y divide-border">
          {Object.entries(node.properties).map(([key, val]) => (
            <div key={key} className="flex justify-between gap-3 px-3 py-2 text-[10px] font-mono">
              <span className="text-muted-foreground shrink-0">{key}</span>
              <span className="text-foreground/80 truncate text-right">{String(val)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Relationships */}
      <div className="space-y-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Relationships ({inEdges.length + outEdges.length})
        </span>
        <div className="space-y-1.5 max-h-48 overflow-y-auto scroll-touch">
          {outEdges.map((edge) => (
            <div key={edge.id} className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/5 text-[9px] font-mono">
              <span className="text-primary font-bold shrink-0">→ {edge.type}</span>
              <span className="text-muted-foreground truncate">{getNodeName(edge.target)}</span>
            </div>
          ))}
          {inEdges.map((edge) => (
            <div key={edge.id} className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/5 text-[9px] font-mono">
              <span className="text-teal-success font-bold shrink-0">← {edge.type}</span>
              <span className="text-muted-foreground truncate">{getNodeName(edge.source)}</span>
            </div>
          ))}
          {inEdges.length === 0 && outEdges.length === 0 && (
            <p className="text-[9px] text-muted-foreground italic">No active traversals recorded</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function GraphExplorerPage() {
  const [searchTag, setSearchTag] = useState("P-101");
  const [loading, setLoading] = useState(false);
  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedNode, setSelectedNode] = useState<NodeSchema | null>(null);
  const [incomingEdges, setIncomingEdges] = useState<EdgeSchema[]>([]);
  const [outgoingEdges, setOutgoingEdges] = useState<EdgeSchema[]>([]);
  const [showNodeSheet, setShowNodeSheet] = useState(false);

  useEffect(() => {
    handleSearch("P-101");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = async (tagToSearch: string) => {
    if (!tagToSearch.trim()) return;
    setLoading(true);
    setSelectedNode(null);
    setShowNodeSheet(false);
    setSearchError(null);
    try {
      const data = await api.getGraphExplorer(tagToSearch);
      setGraphData(data);
    } catch (e) {
      console.error("Graph explorer search failed", e);
      // Surface the failure instead of silently rendering fabricated placeholder data -
      // showing mock nodes here would look like a real (but wrong) knowledge graph result.
      setSearchError(
        "Could not reach the graph database. The backend may be unreachable or the query failed."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleNodeClick = (node: NodeSchema) => {
    setSelectedNode(node);
    if (!graphData) return;
    setIncomingEdges(graphData.edges.filter((e) => e.target === node.id));
    setOutgoingEdges(graphData.edges.filter((e) => e.source === node.id));
    if (window.innerWidth < 1024) setShowNodeSheet(true);
  };

  const closeNodeDetail = () => {
    setSelectedNode(null);
    setShowNodeSheet(false);
  };

  return (
    <div className="flex flex-1 overflow-hidden h-full relative no-zoom">
      {/* ── Main Graph Area ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <div className="shrink-0 px-4 md:px-6 py-3.5 border-b border-border bg-card/40 backdrop-blur-sm flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20 shrink-0">
              <Network className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display font-bold text-sm text-foreground truncate">
                P&amp;ID Graph Explorer
              </h1>
              <p className="text-[10px] font-mono text-muted-foreground hidden md:block">
                Equipment tag linkages and operational routing
              </p>
            </div>
          </div>

          {/* Search bar */}
          <div className="flex gap-2 w-full sm:w-auto shrink-0">
            <div className="relative flex-1 sm:w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={searchTag}
                onChange={(e) => setSearchTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch(searchTag)}
                placeholder="Tag (e.g. P-101)..."
                className="w-full bg-background border border-border rounded-lg pl-9 pr-4 py-2.5 text-xs
                           focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                           text-foreground font-mono placeholder:text-muted-foreground/60 min-h-[40px]"
              />
            </div>
            <Button
              onClick={() => handleSearch(searchTag)}
              size="sm"
              disabled={loading}
              className="min-h-[40px] px-4"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Query"}
            </Button>
          </div>
        </div>

        {/* Multiple Matches Banner */}
        {!!graphData?.matched_nodes_count && graphData.matched_nodes_count > 1 && (
          <div className="shrink-0 px-4 md:px-6 py-2.5 bg-primary/5 border-b border-border text-[10px] font-mono flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-primary font-bold">Multiple matches ({graphData.matched_nodes_count}):</span>
            <span className="text-muted-foreground">Showing</span>
            <span className="px-1.5 py-0.5 rounded bg-muted/50 border border-border text-foreground font-semibold">
              {graphData.center_node_id}
            </span>
            <span className="text-muted-foreground/60">| Jump to:</span>
            <div className="flex gap-2.5 items-center overflow-x-auto max-w-full no-scrollbar">
              {graphData.all_matched_nodes
                ?.filter((m) => m.id !== graphData.center_node_id)
                .slice(0, 4)
                .map((match, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setSearchTag(match.id);
                      handleSearch(match.id);
                    }}
                    className="text-primary hover:underline hover:text-primary/80 transition-colors shrink-0 font-medium cursor-pointer"
                  >
                    {match.display_name} ({match.labels[0]})
                  </button>
                ))}
              {graphData.all_matched_nodes && graphData.all_matched_nodes.length > 5 && (
                <span className="text-muted-foreground/50 shrink-0">
                  ...and {graphData.all_matched_nodes.length - 5} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Empty Matches Banner */}
        {graphData?.matched_nodes_count === 0 && (
          <div className="shrink-0 px-4 md:px-6 py-2.5 bg-amber-500/5 border-b border-border text-[10px] font-mono text-amber-500 flex items-center gap-1.5 animate-fade-in">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0 animate-pulse" />
            <span>No matches found in the graph database for &ldquo;{searchTag}&rdquo;</span>
          </div>
        )}

        {/* Search Error Banner */}
        {searchError && (
          <div className="shrink-0 px-4 md:px-6 py-2.5 bg-red-500/5 border-b border-border text-[10px] font-mono text-red-500 flex items-center gap-1.5 animate-fade-in">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0 animate-pulse" />
            <span>{searchError}</span>
          </div>
        )}

        {/* Graph canvas */}
        <div className="flex-1 relative overflow-hidden bg-[#0A0E13]">
          {loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 bg-[#080C0F]">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-xs font-mono text-muted-foreground font-semibold">Routing graph channels...</span>
            </div>
          ) : searchError && !graphData ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[#080C0F]">
              <EmptyState
                icon={Network}
                title="Graph query failed"
                description={searchError}
              />
            </div>
          ) : !graphData ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[#080C0F]">
              <EmptyState
                icon={Network}
                title="No graph data"
                description="Search an equipment tag to explore its P&ID graph subnetwork."
              />
            </div>
          ) : (
            <InteractiveGraph
              graphData={graphData}
              centerNodeId={graphData.center_node_id}
              selectedNode={selectedNode}
              onNodeClick={handleNodeClick}
              onCloseInspector={closeNodeDetail}
            />
          )}
        </div>
      </div>

      {/* ── Node Inspector — Desktop sidebar ── */}
      {selectedNode && (
        <div className="hidden lg:flex w-80 border-l border-border bg-card flex-col shrink-0 h-full animate-slide-in-right">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Cpu className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="font-display font-semibold text-xs uppercase tracking-wider text-foreground">
                Entity Inspector
              </span>
            </div>
            <button
              onClick={closeNodeDetail}
              className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto scroll-touch">
            <NodeDetail node={selectedNode} inEdges={incomingEdges} outEdges={outgoingEdges} nodes={graphData?.nodes || []} />
          </div>
          <div className="border-t border-border p-4">
            <Button variant="outline" size="sm" className="w-full" onClick={closeNodeDetail}>
              Close Inspector
            </Button>
          </div>
        </div>
      )}

      {/* ── Node Inspector — Mobile Bottom Sheet ── */}
      <BottomSheet
        open={showNodeSheet}
        onClose={closeNodeDetail}
        title={selectedNode?.properties.display_name || selectedNode?.properties.tag || selectedNode?.id || "Entity"}
        maxHeight="68vh"
        bottomOffset="calc(4.5rem + env(safe-area-inset-bottom, 0px))"
        className="lg:hidden"
      >
        {selectedNode && (
          <>
            <NodeDetail node={selectedNode} inEdges={incomingEdges} outEdges={outgoingEdges} nodes={graphData?.nodes || []} />
            <div className="border-t border-border p-4">
              <Button variant="outline" size="sm" className="w-full min-h-[44px]" onClick={closeNodeDetail}>
                Close Inspector
              </Button>
            </div>
          </>
        )}
      </BottomSheet>
    </div>
  );
}
