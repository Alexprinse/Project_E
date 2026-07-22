import { env } from "@/lib/env";

export interface FailureNode {
  id: string;
  date?: string;
  severity?: string;
  description?: string;
  equipment_tag?: string;
  equipment_display?: string;
}

export interface RcaFailuresResponse {
  failures: FailureNode[];
}

export interface HealthCheckResponse {
  status: string;
  database_connected: boolean;
  version: string;
}

export interface IngestionTriggerResponse {
  job_id: string;
  filename: string;
  status: string;
  message: string;
}

export interface IngestionStatusResponse {
  id: string;
  file_name: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress: number;
  error?: string;
}

export interface IngestionJobResponse extends IngestionStatusResponse {
  created_at?: number;
  updated_at?: number;
}

export interface IngestionJobsResponse {
  jobs: IngestionJobResponse[];
}

export interface StatsOverviewResponse {
  document_count: number;
  entity_count: number;
  chunk_count: number;
  failure_count: number;
  active_ingestion_jobs: number;
  completed_ingestion_jobs: number;
  failed_ingestion_jobs: number;
  database_connected: boolean;
  vector_index_state?: string | null;
  recent_jobs: IngestionJobResponse[];
}

export interface NodeSchema {
  id: string;
  labels: string[];
  properties: Record<string, any>;
}

export interface EdgeSchema {
  id: string;
  type: string;
  source: string;
  target: string;
  properties: Record<string, any>;
}

export interface GraphResponse {
  nodes: NodeSchema[];
  edges: EdgeSchema[];
  center_node_id?: string;
  matched_nodes_count?: number;
  all_matched_nodes?: Array<{ id: string; display_name: string; labels: string[] }>;
}

export interface Citation {
  chunk_id?: string;
  document_id: string;
  document_name: string;
  snippet: string;
}

export interface CopilotChatResponse {
  answer: string;
  citations: Citation[];
  confidence: "high" | "medium" | "low";
  conversation_id: string;
}

export interface HistoryEntry {
  id: string;
  query_type: "copilot" | "rca" | "keyword-comparison" | string;
  query_text: string;
  answer_text: string;
  citations: Citation[];
  confidence: "high" | "medium" | "low" | null;
  execution_time_sec: number | null;
  created_at: number | null;
}

export interface HistoryListResponse {
  entries: HistoryEntry[];
  count: number;
}

export interface HistoryDeleteResponse {
  success: boolean;
  deleted_count: number;
}

/**
 * Perform type-safe requests to the FastAPI backend.
 */
async function fetchAPI<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${env.NEXT_PUBLIC_API_URL}${path}`;
  
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown API Error");
    throw new Error(`API Error [${response.status}]: ${text}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  getHealth: () => fetchAPI<HealthCheckResponse>("/api/v1/health"),
  
  triggerIngestion: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return fetchAPI<IngestionTriggerResponse>("/api/v1/ingestion", {
      method: "POST",
      body: formData,
    });
  },
  
  getIngestionStatus: (jobId: string) => 
    fetchAPI<IngestionStatusResponse>(`/api/v1/ingestion/${jobId}`),

  getIngestionJobs: () =>
    fetchAPI<IngestionJobsResponse>("/api/v1/ingestion/jobs"),

  getStatsOverview: () =>
    fetchAPI<StatsOverviewResponse>("/api/v1/stats/overview"),
    
  getGraphExplorer: (centerNodeId: string) =>
    fetchAPI<GraphResponse>(`/api/v1/graph/explorer?center_node_id=${encodeURIComponent(centerNodeId)}`),

  deleteDocument: (documentId: string) =>
    fetchAPI<{ success: boolean; message: string }>(`/api/v1/ingestion/${encodeURIComponent(documentId)}`, {
      method: "DELETE",
    }),

  getFailures: () => fetchAPI<RcaFailuresResponse>("/api/v1/rca/failures"),

  getHistory: (limit = 50) =>
    fetchAPI<HistoryListResponse>(`/api/v1/history?limit=${limit}`),

  deleteHistoryEntry: (entryId: string) =>
    fetchAPI<HistoryDeleteResponse>(`/api/v1/history/${encodeURIComponent(entryId)}`, {
      method: "DELETE",
    }),

  clearHistory: () =>
    fetchAPI<HistoryDeleteResponse>("/api/v1/history", { method: "DELETE" }),
};
