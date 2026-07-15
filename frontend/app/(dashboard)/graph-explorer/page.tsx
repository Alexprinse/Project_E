"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  Loader2,
  Network,
  X,
  BookOpen,
  Cpu,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, GraphResponse, NodeSchema, EdgeSchema } from "@/lib/api";

interface PositionedNode extends NodeSchema {
  x: number;
  y: number;
}

const SVG_WIDTH = 820;
const SVG_HEIGHT = 520;

export default function GraphExplorerPage() {
  const [searchTag, setSearchTag] = useState("P-101");
  const [loading, setLoading] = useState(false);
  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [positionedNodes, setPositionedNodes] = useState<PositionedNode[]>([]);

  // Node detail state
  const [selectedNode, setSelectedNode] = useState<PositionedNode | null>(null);
  const [incomingEdges, setIncomingEdges] = useState<EdgeSchema[]>([]);
  const [outgoingEdges, setOutgoingEdges] = useState<EdgeSchema[]>([]);

  // Mobile: bottom sheet open state
  const [showNodeSheet, setShowNodeSheet] = useState(false);

  // Track if user is on a touch device for layout decisions
  const isMobile = typeof window !== "undefined" && window.innerWidth < 1024;

  // Load default tag on mount
  useEffect(() => {
    handleSearch("P-101");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = async (tagToSearch: string) => {
    if (!tagToSearch.trim()) return;
    setLoading(true);
    setSelectedNode(null);
    setShowNodeSheet(false);
    try {
      const data = await api.getGraphExplorer(tagToSearch);
      setGraphData(data);
      const positioned = layoutNodes(data.nodes, tagToSearch);
      setPositionedNodes(positioned);
    } catch (e) {
      console.error("Failed to load graph explorer details", e);
      const mockData = generateMockGraph(tagToSearch);
      setGraphData(mockData);
      setPositionedNodes(layoutNodes(mockData.nodes, tagToSearch));
    } finally {
      setLoading(false);
    }
  };

  // P&ID Schematic Layout Algorithm (improved to prevent overlaps on large graphs)
  const layoutNodes = (nodes: NodeSchema[], centerId: string): PositionedNode[] => {
    const centerX = SVG_WIDTH / 2;
    const centerY = SVG_HEIGHT / 2;
    let docIndex = 0;
    let locIndex = 0;
    let paramIndex = 0;
    let otherIndex = 0;

    return nodes.map((node) => {
      if (node.id.toLowerCase() === centerId.toLowerCase() || node.properties.tag === centerId) {
        return { ...node, x: centerX, y: centerY };
      }
      if (node.labels.includes("Document") || node.labels.includes("Chunk")) {
        const col = docIndex % 4;
        const row = Math.floor(docIndex / 4);
        const xOffset = centerX - 270 + col * 180;
        docIndex++;
        return { ...node, x: xOffset, y: centerY + 160 + row * 60 };
      }
      if (node.labels.includes("Location")) {
        const col = locIndex % 3;
        const row = Math.floor(locIndex / 3);
        const xOffset = centerX - 200 + col * 200;
        locIndex++;
        return { ...node, x: xOffset, y: centerY - 160 - row * 60 };
      }
      if (node.labels.includes("ProcessParameter")) {
        const col = paramIndex % 2;
        const row = Math.floor(paramIndex / 2);
        const yOffset = centerY - 120 + row * 80;
        paramIndex++;
        return { ...node, x: centerX + 260 + col * 120, y: yOffset };
      }
      // Equipment, WorkOrder, Failure, etc.
      const col = otherIndex % 2;
      const row = Math.floor(otherIndex / 2);
      const yOffset = centerY - 120 + row * 80;
      otherIndex++;
      return { ...node, x: centerX - 260 - col * 120, y: yOffset };
    });
  };

  // Node selection handler
  const handleNodeClick = (node: PositionedNode) => {
    setSelectedNode(node);
    if (!graphData) return;
    setIncomingEdges(graphData.edges.filter((e) => e.target === node.id));
    setOutgoingEdges(graphData.edges.filter((e) => e.source === node.id));
    // On mobile, open the bottom sheet
    if (window.innerWidth < 1024) {
      setShowNodeSheet(true);
    }
  };

  const closeNodeDetail = () => {
    setSelectedNode(null);
    setShowNodeSheet(false);
  };

  // Manhattan Right-Angled path generator
  const getManhattanPath = (x1: number, y1: number, x2: number, y2: number) => {
    const midX = x1 + (x2 - x1) / 2;
    return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
  };

  /* ─── Node detail JSX (reused in sidebar + bottom sheet) ─── */
  const NodeDetailContent = () =>
    selectedNode ? (
      <div className="space-y-6">
        <div className="space-y-3">
          <h4 className="text-[10px] font-display font-semibold uppercase text-slate-400 tracking-wider">
            Node Properties
          </h4>
          <div className="p-3 border border-border bg-muted/15 rounded space-y-2 text-[10px] font-mono">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground shrink-0">ID:</span>
              <span className="text-slate-200 font-bold truncate">{selectedNode.id}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground shrink-0">Label:</span>
              <span className="text-primary font-bold">{selectedNode.labels.join(", ")}</span>
            </div>
            {Object.entries(selectedNode.properties).map(([key, val]) => (
              <div key={key} className="flex justify-between gap-2">
                <span className="text-muted-foreground shrink-0">{key}:</span>
                <span className="text-slate-200 truncate">{String(val)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <h4 className="text-[10px] font-display font-semibold uppercase text-slate-400 tracking-wider">
            Routed Relationships
          </h4>
          <div className="space-y-2 max-h-52 overflow-y-auto scroll-touch pr-1">
            {outgoingEdges.map((edge) => (
              <div key={edge.id} className="p-2 border border-border bg-muted/5 rounded text-[9px] font-mono">
                <span className="text-primary font-semibold">-{edge.type}➔</span>
                <span className="text-slate-300 block mt-1 truncate">Target: {edge.target}</span>
              </div>
            ))}
            {incomingEdges.map((edge) => (
              <div key={edge.id} className="p-2 border border-border bg-muted/5 rounded text-[9px] font-mono">
                <span className="text-teal-success font-semibold">◀{edge.type}-</span>
                <span className="text-slate-300 block mt-1 truncate">Source: {edge.source}</span>
              </div>
            ))}
            {outgoingEdges.length === 0 && incomingEdges.length === 0 && (
              <div className="text-[9px] text-muted-foreground italic">
                [NO ACTIVE TRAVERSALS RECORDED]
              </div>
            )}
          </div>
        </div>
      </div>
    ) : null;

  return (
    <div className="flex flex-1 overflow-hidden h-full relative no-zoom">
      {/* ── Main Schematic Area ── */}
      <div className="flex-1 flex flex-col overflow-hidden p-4 md:p-8 space-y-4 md:space-y-6 min-w-0">
        {/* Search controls */}
        <div className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
          <div className="min-w-0">
            <h1 className="font-display font-bold text-base md:text-xl text-slate-100 uppercase tracking-wider truncate">
              P&amp;ID Graph Explorer
            </h1>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 hidden sm:block">
              Explore equipment tag linkages and operations routing logs.
            </p>
          </div>

          <div className="flex gap-2 w-full sm:w-max shrink-0">
            <div className="relative flex-1 sm:w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={searchTag}
                onChange={(e) => setSearchTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch(searchTag)}
                placeholder="Search tag (e.g. P-101)..."
                className="w-full bg-card border border-border rounded pl-9 pr-4 py-2 text-xs focus:outline-none focus:border-primary text-slate-200 font-mono min-h-[44px]"
              />
            </div>
            <Button
              onClick={() => handleSearch(searchTag)}
              size="sm"
              disabled={loading}
              className="font-display text-[10px] tracking-wider uppercase min-h-[44px] px-4 tap-target"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Query"}
            </Button>
          </div>
        </div>

        {/* ── SVG Canvas — viewBox for responsive/touch zoom ──
            graph-touch: enables pinch-to-zoom via touch-action: pinch-zoom
            overflow-auto: allows pan by scrolling on touch */}
        <div className="flex-1 border border-border rounded bg-muted/5 relative overflow-auto flex items-center justify-center min-h-[300px] graph-touch">
          {loading ? (
            <div className="flex flex-col items-center gap-3 text-xs font-mono text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span>ROUTING GRAPH CHANNELS...</span>
            </div>
          ) : positionedNodes.length === 0 ? (
            <div className="text-xs font-mono text-muted-foreground border border-dashed border-border/60 p-6 rounded text-center">
              [GRID SYSTEM OFFLINE - RUN A SEARCH TO INITIATE MAP]
            </div>
          ) : (
            <div className="w-full h-full min-h-[400px] p-2 flex items-center justify-center">
              {/* viewBox makes the SVG scale to container width while preserving layout coords.
                  preserveAspectRatio="xMidYMid meet" centers it. overflow="visible" for labels. */}
              <svg
                viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                className="w-full h-full border border-border/40 bg-slate-950/45 rounded shadow-inner"
                preserveAspectRatio="xMidYMid meet"
                style={{ maxHeight: "100%", touchAction: "pinch-zoom" }}
              >
                <defs>
                  <marker
                    id="arrow"
                    viewBox="0 0 10 10"
                    refX="6"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 2 L 8 5 L 0 8 z" fill="#4A90A4" />
                  </marker>
                </defs>

                {/* Connection lines */}
                {graphData?.edges.map((edge) => {
                  const sourceNode = positionedNodes.find((n) => n.id === edge.source);
                  const targetNode = positionedNodes.find((n) => n.id === edge.target);
                  if (!sourceNode || !targetNode) return null;
                  return (
                    <g key={edge.id} className="group">
                      <path
                        d={getManhattanPath(sourceNode.x, sourceNode.y, targetNode.x, targetNode.y)}
                        fill="none"
                        stroke={
                          edge.type === "GOVERNS" || edge.type === "HAS_DOCUMENT"
                            ? "#2C353F"
                            : "#4A90A4"
                        }
                        strokeWidth="1.2"
                        strokeDasharray={edge.type === "HAS_DOCUMENT" ? "3 3" : undefined}
                        markerEnd="url(#arrow)"
                        className="transition-all duration-200 group-hover:stroke-slate-100 group-hover:stroke-[1.8]"
                      />
                      <title>{edge.type}</title>
                    </g>
                  );
                })}

                {/* Rectangular nodes — larger hit area for touch */}
                {positionedNodes.map((node) => {
                  const isSelected = selectedNode?.id === node.id;
                  const isCenter =
                    node.id.toLowerCase() === searchTag.toLowerCase() ||
                    node.properties.tag === searchTag;
                  const width = 110;
                  const height = 44; // slightly taller for touch

                  return (
                    <g
                      key={node.id}
                      onClick={() => handleNodeClick(node)}
                      className="cursor-pointer group select-none"
                    >
                      {/* Invisible larger hit area for touch */}
                      <rect
                        x={node.x - width / 2 - 8}
                        y={node.y - height / 2 - 8}
                        width={width + 16}
                        height={height + 16}
                        fill="transparent"
                      />
                      {/* Visible node rect */}
                      <rect
                        x={node.x - width / 2}
                        y={node.y - height / 2}
                        width={width}
                        height={height}
                        rx="2"
                        fill="#1C2128"
                        stroke={
                          isSelected
                            ? "hsl(var(--industrial-teal))"
                            : isCenter
                            ? "#4A90A4"
                            : "#2C353F"
                        }
                        strokeWidth={isSelected || isCenter ? "2" : "1.2"}
                        className="transition-all duration-200 group-hover:fill-slate-900 group-hover:stroke-slate-400"
                      />
                      <circle
                        cx={node.x - width / 2 + 15}
                        cy={node.y}
                        r="6"
                        fill={
                          node.labels.includes("Document")
                            ? "#4A90A4"
                            : node.labels.includes("Location")
                            ? "hsl(var(--industrial-teal))"
                            : node.labels.includes("ProcessParameter")
                            ? "hsl(var(--industrial-amber))"
                            : "#8A94A0"
                        }
                        className="opacity-80"
                      />
                      <text
                        x={node.x + 8}
                        y={node.y - 4}
                        textAnchor="middle"
                        fill="#E6E8EA"
                        fontSize="9"
                        fontWeight="600"
                        fontFamily="monospace"
                        className="group-hover:fill-white"
                      >
                        {node.properties.tag || node.id.slice(0, 10)}
                      </text>
                      <text
                        x={node.x + 8}
                        y={node.y + 8}
                        textAnchor="middle"
                        fill="#8A94A0"
                        fontSize="7"
                        fontFamily="sans-serif"
                      >
                        {node.labels[0]}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>

        {/* Mobile hint */}
        {positionedNodes.length > 0 && (
          <p className="lg:hidden text-center text-[9px] text-muted-foreground font-mono shrink-0">
            TAP A NODE TO INSPECT · PINCH TO ZOOM · DRAG TO PAN
          </p>
        )}
      </div>

      {/* ── Node Detail Sidebar — desktop only (lg+) ── */}
      {selectedNode && (
        <div className="hidden lg:flex w-80 border-l border-border bg-card p-6 flex-col justify-between shrink-0 h-full overflow-y-auto scroll-touch">
          <div>
            <div className="flex items-center justify-between border-b border-border pb-3 mb-6">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-primary" />
                <h3 className="font-display font-bold text-xs uppercase text-slate-200 tracking-wider">
                  Entity Details
                </h3>
              </div>
              <button
                onClick={closeNodeDetail}
                className="text-muted-foreground hover:text-slate-100 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <NodeDetailContent />
          </div>
          <div className="border-t border-border pt-4 mt-4">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-[10px] tracking-wider uppercase font-display"
              onClick={closeNodeDetail}
            >
              Clear Inspector
            </Button>
          </div>
        </div>
      )}

      {/* ── Node Detail Bottom Sheet — mobile only, conditionally rendered ── */}
      {showNodeSheet && (
        <>
          {/* Backdrop */}
          <div
            onClick={closeNodeDetail}
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
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-primary" />
                <span className="font-display font-bold text-xs uppercase tracking-wider text-slate-200">
                  {selectedNode?.properties.tag || selectedNode?.id.slice(0, 12) || "Entity Details"}
                </span>
              </div>
              <button
                onClick={closeNodeDetail}
                className="text-muted-foreground hover:text-slate-100 transition-colors tap-target min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Sheet content — flex-1 min-h-0 is the scrollable region */}
            <div className="flex-1 min-h-0 overflow-y-auto scroll-touch p-5">
              <NodeDetailContent />
              <div className="pt-4 mt-4 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-[10px] tracking-wider uppercase font-display min-h-[44px] tap-target"
                  onClick={closeNodeDetail}
                >
                  Clear Inspector
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Subgraph mock fallback generator for offline styling
const generateMockGraph = (tag: string): GraphResponse => {
  return {
    nodes: [
      { id: tag, labels: ["Equipment"], properties: { tag, type: "Centrifugal Pump", location: "Unit 3", criticality: "High" } },
      { id: "LOC-UNIT3", labels: ["Location"], properties: { name: "Unit 3", unit: "Refinery-A" } },
      { id: "DOC-TEST-01", labels: ["Document"], properties: { name: "Operating Manual M-12", version: "1.0" } },
      { id: "PP-DISCHARGE", labels: ["ProcessParameter"], properties: { name: "Discharge Pressure", normal_min: 400, normal_max: 500 } },
    ],
    edges: [
      { id: "E1", type: "OCCURRED_ON", source: tag, target: "LOC-UNIT3", properties: {} },
      { id: "E2", type: "HAS_DOCUMENT", source: "DOC-TEST-01", target: tag, properties: {} },
      { id: "E3", type: "HAS_PARAMETER", source: tag, target: "PP-DISCHARGE", properties: {} },
    ],
  };
};
