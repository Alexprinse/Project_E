"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { forceCollide } from "d3-force";
import {
  Maximize2,
  Minimize2,
  RotateCcw,
  Camera,
  Filter,
  Settings,
  Layers,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { NodeSchema, EdgeSchema, GraphResponse } from "@/lib/api";

interface InteractiveGraphProps {
  graphData: GraphResponse;
  searchTag: string;
  selectedNode: NodeSchema | null;
  onNodeClick: (node: NodeSchema) => void;
  onCloseInspector: () => void;
}

const COLOR_MAP = {
  document: { fill: "rgba(74, 144, 164, 0.15)", border: "#4A90A4", label: "Document", color: "#4A90A4" },
  location: { fill: "rgba(74, 156, 130, 0.15)", border: "#4A9C82", label: "Location", color: "#4A9C82" },
  processparameter: { fill: "rgba(217, 142, 51, 0.15)", border: "#D98E33", label: "Parameter", color: "#D98E33" },
  failure: { fill: "rgba(248, 81, 73, 0.15)", border: "#F85149", label: "Failure", color: "#F85149" },
  equipment: { fill: "rgba(138, 148, 160, 0.15)", border: "#8A94A0", label: "Equipment", color: "#8A94A0" },
};

function getNodeMeta(labels: string[]) {
  const primaryLabel = labels[0]?.toLowerCase() || "";
  if (primaryLabel.includes("document") || primaryLabel.includes("chunk")) return COLOR_MAP.document;
  if (primaryLabel.includes("location")) return COLOR_MAP.location;
  if (primaryLabel.includes("processparameter")) return COLOR_MAP.processparameter;
  if (primaryLabel.includes("failure")) return COLOR_MAP.failure;
  return COLOR_MAP.equipment;
}

export default function InteractiveGraph({
  graphData,
  searchTag,
  selectedNode,
  onNodeClick,
  onCloseInspector,
}: InteractiveGraphProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Settings states
  const [showParticles, setShowParticles] = useState(true);
  const [forceStrength, setForceStrength] = useState(-180);
  const [particleSpeed, setParticleSpeed] = useState(3);

  // Filter states
  const [excludedTypes, setExcludedTypes] = useState<Record<string, boolean>>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const graph2DInstanceRef = useRef<any>(null);
  const hasAutoCentered = useRef(false);

  // Reset auto center flag when data changes
  useEffect(() => {
    hasAutoCentered.current = false;
  }, [graphData]);

  // Listen to resize events (viewport scale switches) to automatically re-center camera
  useEffect(() => {
    const handleResize = () => {
      if (graph2DInstanceRef.current) {
        graph2DInstanceRef.current.zoomToFit(300, 40);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleEngineStop = () => {
    if (!hasAutoCentered.current && graph2DInstanceRef.current) {
      graph2DInstanceRef.current.zoomToFit(400, 40);
      hasAutoCentered.current = true;
    }
  };

  // Create clean clones of nodes and edges to prevent react-force-graph mutations
  const cleanData = useMemo(() => {
    const types = new Set<string>();
    const nodes = graphData.nodes
      .map((n) => {
        const typeLabel = n.labels[0] || "Unknown";
        types.add(typeLabel);
        return {
          id: n.id,
          labels: [...n.labels],
          properties: { ...n.properties },
        };
      })
      .filter((n) => !excludedTypes[n.labels[0] || "Unknown"]);

    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = graphData.edges
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
        properties: { ...e.properties },
      }))
      .filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target));

    return { nodes, links, allTypes: Array.from(types) };
  }, [graphData, excludedTypes]);

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Fit view
  const fitGraph = () => {
    if (graph2DInstanceRef.current) {
      graph2DInstanceRef.current.zoomToFit(400, 50);
    }
  };

  // Reset camera view
  const resetCamera = () => {
    if (graph2DInstanceRef.current) {
      graph2DInstanceRef.current.centerAt(0, 0, 400);
      graph2DInstanceRef.current.zoom(1.2, 400);
    }
  };

  // Center on node
  const focusNode = (node: any) => {
    if (!node) return;
    if (graph2DInstanceRef.current) {
      graph2DInstanceRef.current.centerAt(node.x, node.y, 400);
      graph2DInstanceRef.current.zoom(1.8, 400);
    }
  };

  // Focus node on search tag / selection changes
  useEffect(() => {
    if (selectedNode) {
      const match = cleanData.nodes.find((n) => n.id === selectedNode.id);
      if (match) setTimeout(() => focusNode(match), 200);
    } else if (searchTag) {
      const match = cleanData.nodes.find(
        (n) => n.id.toLowerCase() === searchTag.toLowerCase() || n.properties.tag === searchTag
      );
      if (match) setTimeout(() => focusNode(match), 200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, searchTag]);

  // Adjust force simulation on settings changes and layout initialization
  useEffect(() => {
    if (graph2DInstanceRef.current) {
      // 1. Give links more room to separate boxes
      graph2DInstanceRef.current.d3Force("link").distance(100);

      // 2. Adjust charge repulsion
      graph2DInstanceRef.current.d3Force("charge").strength(forceStrength);

      // 3. Add dynamic collision radius to prevent boxes from overlapping
      graph2DInstanceRef.current.d3Force(
        "collide",
        forceCollide()
          .radius((node: any) => {
            const label = node.properties.tag || node.id;
            const textWidth = label.length * 6;
            const boxWidth = Math.max(90, textWidth + 30);
            return boxWidth / 2 + 12; // Radius of boundary + buffer spacing
          })
          .iterations(2)
      );

      graph2DInstanceRef.current.d3ReheatSimulation();
    }
  }, [cleanData, forceStrength]);

  // Capture snapshot
  const exportSnapshot = () => {
    const canvasElement = containerRef.current?.querySelector("canvas") || null;
    if (!canvasElement) return;
    const link = document.createElement("a");
    link.download = `marg-graph-schematic-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvasElement.toDataURL("image/png");
    link.click();
  };

  const toggleTypeFilter = (type: string) => {
    setExcludedTypes((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full flex-1 flex flex-col min-h-[400px] bg-[#080C0F] transition-all overflow-hidden ${
        isFullscreen ? "h-screen w-screen p-6" : "h-full rounded-xl border border-border bg-[#07090C]"
      }`}
    >
      {/* ── Floating Morphic Toolbar ── */}
      <div className="absolute top-4 left-4 right-4 z-20 flex flex-wrap gap-2 justify-between items-center bg-card/60 backdrop-blur-md border border-border px-4 py-2.5 rounded-xl shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="status-dot status-dot-online" />
            <span className="text-[10px] font-display font-bold uppercase tracking-wider text-foreground">
              Schematic Engine
            </span>
          </div>

          <Badge variant="outline" className="hidden sm:inline-flex bg-muted/30 font-mono text-[9px]">
            {cleanData.nodes.length} nodes · {cleanData.links.length} links
          </Badge>
        </div>

        {/* Action Controls Group */}
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" onClick={fitGraph} title="Fit Graph View">
            <Layers className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={resetCamera} title="Reset Camera Location">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={exportSnapshot} title="Capture Snapshot PNG">
            <Camera className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setShowFilters(!showFilters);
              setShowSettings(false);
            }}
            className={showFilters ? "bg-primary/10 text-primary border border-primary/20" : ""}
            title="Toggle Filters"
          >
            <Filter className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setShowSettings(!showSettings);
              setShowFilters(false);
            }}
            className={showSettings ? "bg-primary/10 text-primary border border-primary/20" : ""}
            title="Explorer Settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={toggleFullscreen} title="Toggle Fullscreen">
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* ── Left Floating Controls Menu: Filters ── */}
      {showFilters && (
        <Card className="absolute top-16 right-4 z-20 w-52 glass shadow-lg border border-border rounded-xl animate-fade-in-up">
          <CardHeader className="py-2.5 px-4 border-b border-border">
            <CardTitle className="text-[10px] tracking-widest font-mono text-muted-foreground uppercase flex items-center justify-between">
              <span>Filter Nodes</span>
              <X className="h-3 w-3 cursor-pointer hover:text-foreground" onClick={() => setShowFilters(false)} />
            </CardTitle>
          </CardHeader>
          <CardBody className="p-3 space-y-2">
            {cleanData.allTypes.map((type) => {
              const isChecked = !excludedTypes[type];
              return (
                <button
                  key={type}
                  onClick={() => toggleTypeFilter(type)}
                  className="w-full flex items-center justify-between p-2 rounded-lg border border-border hover:bg-accent text-[10px] font-mono text-foreground/80 tap-target transition-all"
                >
                  <span>{type}</span>
                  <div className={`h-4 w-4 rounded border border-border flex items-center justify-center transition-colors ${
                    isChecked ? "bg-primary border-primary text-primary-foreground" : "bg-transparent"
                  }`}>
                    {isChecked && <Check className="h-3 w-3 stroke-[3]" />}
                  </div>
                </button>
              );
            })}
            {cleanData.allTypes.length === 0 && (
              <p className="text-[9px] font-mono text-muted-foreground italic text-center py-2">No active tags available</p>
            )}
          </CardBody>
        </Card>
      )}

      {/* ── Left Floating Controls Menu: Settings ── */}
      {showSettings && (
        <Card className="absolute top-16 right-4 z-20 w-60 glass shadow-lg border border-border rounded-xl animate-fade-in-up">
          <CardHeader className="py-2.5 px-4 border-b border-border">
            <CardTitle className="text-[10px] tracking-widest font-mono text-muted-foreground uppercase flex items-center justify-between">
              <span>Physic Settings</span>
              <X className="h-3 w-3 cursor-pointer hover:text-foreground" onClick={() => setShowSettings(false)} />
            </CardTitle>
          </CardHeader>
          <CardBody className="p-4 space-y-4 font-mono text-[10px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Link Activity Flow</span>
              <button
                onClick={() => setShowParticles(!showParticles)}
                className={`px-2.5 py-1 rounded border text-[9px] uppercase tracking-wider font-semibold transition-all ${
                  showParticles ? "bg-primary/20 border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {showParticles ? "Active" : "Off"}
              </button>
            </div>

            {/* Charge Strength Slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span>Charge Repulsion</span>
                <span className="text-foreground">{forceStrength}</span>
              </div>
              <input
                type="range"
                min="-600"
                max="-50"
                step="25"
                value={forceStrength}
                onChange={(e) => setForceStrength(Number(e.target.value))}
                className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>

            {/* Particle Speed Slider */}
            {showParticles && (
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span>Particle Velocity</span>
                  <span className="text-foreground">{particleSpeed}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  value={particleSpeed}
                  onChange={(e) => setParticleSpeed(Number(e.target.value))}
                  className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                />
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* ── Active Graph Canvas Area ── */}
      <div className="flex-1 w-full h-full relative" style={{ touchAction: "none" }}>
        <ForceGraph2D
          ref={graph2DInstanceRef}
          graphData={cleanData}
          backgroundColor="#080C0F"
          cooldownTicks={120}
          onEngineStop={handleEngineStop}
          onNodeClick={onNodeClick}
          nodeRelSize={7}
          linkWidth={(link: any) =>
            link.source.id === selectedNode?.id || link.target.id === selectedNode?.id
              ? 2.4
              : 1.4
          }
          linkColor={(link: any) =>
            link.source.id === selectedNode?.id || link.target.id === selectedNode?.id
              ? "rgba(74, 144, 164, 0.95)"
              : "rgba(138, 148, 160, 0.45)"
          }
          linkDirectionalArrowLength={4.5}
          linkDirectionalArrowColor={(link: any) =>
            link.source.id === selectedNode?.id || link.target.id === selectedNode?.id
              ? "rgba(74, 144, 164, 0.95)"
              : "rgba(138, 148, 160, 0.45)"
          }
          linkDirectionalArrowRelPos={1}
          linkDirectionalParticles={(link: any) =>
            showParticles && (link.source.id === selectedNode?.id || link.target.id === selectedNode?.id || link.type !== "HAS_DOCUMENT")
              ? 3
              : 0
          }
          linkDirectionalParticleWidth={2.4}
          linkDirectionalParticleSpeed={(link: any) => particleSpeed * 0.003}
          nodeCanvasObject={(node: any, ctx, globalScale) => {
            const isSelected = selectedNode?.id === node.id;
            const isCenter = searchTag && (node.id.toLowerCase() === searchTag.toLowerCase() || node.properties.tag === searchTag);
            const meta = getNodeMeta(node.labels);

            const label = node.properties.tag || node.id;
            const subLabel = node.labels[0] || "Unknown";

            // Dynamic box width depending on label length
            const fontSize = 10;
            ctx.font = `bold ${fontSize}px var(--font-mono), monospace`;
            const textWidth = ctx.measureText(label).width;
            const boxWidth = Math.max(90, textWidth + 30); // padding for dot + text
            const boxHeight = 24;

            const x = node.x - boxWidth / 2;
            const y = node.y - boxHeight / 2;
            const radius = 4;

            // Draw shadow
            ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
            ctx.fillRect(x + 2, y + 2, boxWidth, boxHeight);

            // Draw rounded rect box background
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + boxWidth - radius, y);
            ctx.quadraticCurveTo(x + boxWidth, y, x + boxWidth, y + radius);
            ctx.lineTo(x + boxWidth, y + boxHeight - radius);
            ctx.quadraticCurveTo(x + boxWidth, y + boxHeight, x + boxWidth - radius, y + boxHeight);
            ctx.lineTo(x + radius, y + boxHeight);
            ctx.quadraticCurveTo(x, y + boxHeight, x, y + boxHeight - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();

            ctx.fillStyle = isSelected
              ? "rgba(33, 40, 48, 0.95)"
              : isCenter
              ? "rgba(22, 37, 45, 0.95)"
              : "rgba(18, 22, 28, 0.9)";
            ctx.fill();

            // Draw border
            ctx.lineWidth = isSelected || isCenter ? 1.8 : 1;
            ctx.strokeStyle = isSelected
              ? "hsl(160 36% 45%)"
              : isCenter
              ? "hsl(193 38% 47%)"
              : meta.border;
            ctx.stroke();

            // Draw status/type indicator dot on the left side
            ctx.beginPath();
            ctx.arc(x + 10, y + boxHeight / 2, 3.5, 0, 2 * Math.PI, false);
            ctx.fillStyle = meta.color;
            ctx.fill();

            // Draw label text inside
            ctx.font = `bold ${fontSize}px var(--font-mono), monospace`;
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillStyle = isSelected ? "white" : "hsl(210 8% 92%)";
            ctx.fillText(label, x + 20, y + boxHeight / 2);

            // Draw sublabel type below the box
            if (globalScale > 0.7) {
              ctx.font = `bold 6.5px var(--font-sans), sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillStyle = "rgba(138, 148, 160, 0.75)";
              ctx.fillText(subLabel.toUpperCase(), node.x, y + boxHeight + 3);
            }
          }}
        />
      </div>

      {/* ── Legend Floating Card — bottom-left ── */}
      <div className="absolute bottom-4 left-4 z-10 glass rounded-xl border border-border/60 p-3 space-y-1.5 hidden md:block">
        <div className="flex items-center gap-1.5 mb-1 select-none">
          <Layers className="h-3 w-3 text-muted-foreground" />
          <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Legend</span>
        </div>
        {Object.entries(COLOR_MAP).map(([key, item]) => (
          <div key={key} className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground select-none">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: item.color }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
