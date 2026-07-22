import React from "react";
import { Search, Zap, FileText, AlertTriangle, Activity, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EquipmentIdentificationCardProps {
  data: any;
  onAskCopilot?: (tag: string) => void;
  onViewGraph?: (nodeId: string) => void;
  onViewRCA?: (nodeId: string) => void;
}

function SingleCard({
  tag,
  matchedNodeId,
  subgraph,
  onAskCopilot,
  onViewGraph,
  onViewRCA
}: {
  tag: string;
  matchedNodeId: string;
  subgraph: any;
  onAskCopilot?: (tag: string) => void;
  onViewGraph?: (nodeId: string) => void;
  onViewRCA?: (nodeId: string) => void;
}) {
  const node = subgraph?.nodes?.find((n: any) => n.id === matchedNodeId);
  const nodeProps = node?.properties || {};
  
  const displayName = nodeProps.display_name || nodeProps.tag || tag;
  const type = nodeProps.type || "Equipment";
  const criticality = nodeProps.criticality || "Unknown";
  
  let docCount = 0;
  let failureCount = 0;
  
  if (subgraph?.edges) {
    const edgeTargets = subgraph.edges
      .filter((e: any) => e.source === matchedNodeId)
      .map((e: any) => e.target);
      
    subgraph.nodes?.forEach((n: any) => {
      if (edgeTargets.includes(n.id)) {
        if (n.labels?.includes("Document")) docCount++;
        if (n.labels?.includes("Failure")) failureCount++;
      }
    });
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 w-full max-w-sm">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Zap className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider">{type}</div>
            <div className="font-semibold text-foreground text-sm">{displayName}</div>
          </div>
        </div>
      </div>
      
      <div className="space-y-2 mb-4">
        <div className="flex justify-between items-center text-xs">
          <span className="text-muted-foreground flex items-center gap-1.5"><Activity className="h-3 w-3" /> Criticality</span>
          <span className="font-medium text-foreground">{criticality}</span>
        </div>
        <div className="flex justify-between items-center text-xs">
          <span className="text-muted-foreground flex items-center gap-1.5"><FileText className="h-3 w-3" /> Documents</span>
          <span className="font-medium text-foreground">{docCount}</span>
        </div>
        {failureCount > 0 && (
          <div className="flex justify-between items-center text-xs text-destructive">
            <span className="flex items-center gap-1.5"><AlertTriangle className="h-3 w-3" /> Failures</span>
            <span className="font-medium">{failureCount} reported</span>
          </div>
        )}
      </div>
      
      <div className="flex flex-col gap-2 pt-3 border-t border-border/50">
        <Button 
          variant="outline" 
          size="sm" 
          className="w-full justify-start text-xs h-8"
          onClick={() => onAskCopilot?.(tag)}
        >
          <Search className="h-3 w-3 mr-2" />
          Ask Copilot about {tag}
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="w-full justify-start text-xs h-8"
          onClick={() => onViewGraph?.(matchedNodeId)}
        >
          View in Graph Explorer
        </Button>
        {failureCount > 0 && (
          <Button 
            variant="destructive" 
            size="sm" 
            className="w-full justify-start text-xs h-8 bg-destructive/10 text-destructive hover:bg-destructive/20 border-0"
            onClick={() => onViewRCA?.(matchedNodeId)}
          >
            <AlertTriangle className="h-3 w-3 mr-2" />
            View RCA Analysis
          </Button>
        )}
      </div>
    </div>
  );
}

export function EquipmentIdentificationCard({
  data,
  onAskCopilot,
  onViewGraph,
  onViewRCA
}: EquipmentIdentificationCardProps) {
  if (!data.matched) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 space-y-2 max-w-sm">
        <p className="text-sm text-foreground/80 leading-relaxed">
          {data.message}
        </p>
      </div>
    );
  }

  const matches = data.matches && data.matches.length > 0 
    ? data.matches 
    : [{
        tag: data.identified_tag,
        matched_node_id: data.matched_node_id,
        subgraph: data.subgraph
      }];

  const unmatchedTags: string[] = data.unmatched_tags || [];

  return (
    <div className="space-y-3 w-full max-w-sm">
      {matches.length > 1 && (
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 px-0.5">
          <Zap className="h-3.5 w-3.5 text-primary" />
          Identified {matches.length} Equipment Items in Photo
        </div>
      )}

      <div className="space-y-3">
        {matches.map((item: any, idx: number) => (
          <SingleCard
            key={item.matched_node_id || idx}
            tag={item.tag}
            matchedNodeId={item.matched_node_id}
            subgraph={item.subgraph}
            onAskCopilot={onAskCopilot}
            onViewGraph={onViewGraph}
            onViewRCA={onViewRCA}
          />
        ))}
      </div>

      {unmatchedTags.length > 0 && (
        <div className="bg-muted/40 border border-border/80 rounded-xl p-3 text-xs text-muted-foreground flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-medium text-foreground">Tags detected but not in graph: </span>
            <span className="font-mono text-amber-600 dark:text-amber-400">{unmatchedTags.join(", ")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
