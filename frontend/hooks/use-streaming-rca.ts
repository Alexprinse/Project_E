import { useState, useCallback, useEffect, useRef } from "react";
import { env } from "@/lib/env";
import { api, Citation, FailureNode } from "@/lib/api";

export function useStreamingRca() {
  const [failures, setFailures] = useState<FailureNode[]>([]);
  const [loadingFailures, setLoadingFailures] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [status, setStatus] = useState("");
  const [rcaReport, setRcaReport] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [confidence, setConfidence] = useState<"high" | "medium" | "low" | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Tracks the most recently started analysis so a superseded stream's late-arriving
  // events can be ignored instead of overwriting a newer analysis's state.
  const activeRequestId = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cancel any in-flight stream on unmount so it can't call state setters after teardown.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const fetchFailures = useCallback(async () => {
    setLoadingFailures(true);
    setError(null);
    try {
      const data = await api.getFailures();
      setFailures(data.failures || []);
    } catch (e) {
      console.error("Failed to load failures list", e);
      setError("Failed to load failures list from database.");
    } finally {
      setLoadingFailures(false);
    }
  }, []);

  const runAnalysis = useCallback(async (failureId: string) => {
    if (!failureId) return;

    // Supersede any previous in-flight analysis: abort its request and bump the
    // request id so its late-arriving events are ignored rather than corrupting
    // this new call's state.
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestId = ++activeRequestId.current;
    const isStale = () => activeRequestId.current !== requestId;

    setLoadingAnalysis(true);
    setStatus("Initiating analysis...");
    setRcaReport("");
    setCitations([]);
    setConfidence(null);
    setExecutionTime(null);
    setError(null);

    try {
      const url = `${env.NEXT_PUBLIC_API_URL}/api/v1/rca/analyze`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ failure_id: failureId }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to start RCA analysis: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("No response stream body received.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullReportText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (isStale()) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() || "";

        for (const rawEvent of parts) {
          if (!rawEvent.trim()) continue;

          let eventType = "message";
          let eventData = "";

          const lines = rawEvent.split("\n");
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              eventData = line.slice(5).trim();
            }
          }

          if (!eventData) continue;
          if (isStale()) continue;

          try {
            const data = JSON.parse(eventData);
            if (eventType === "status") {
              setStatus(data.message || "Analyzing...");
            } else if (eventType === "token") {
              fullReportText += data.token;
              setRcaReport(fullReportText);
            } else if (eventType === "done") {
              setRcaReport(data.answer);
              setCitations(data.citations || []);
              setConfidence(data.confidence || "medium");
              setExecutionTime(data.execution_time_sec !== undefined ? data.execution_time_sec : null);
              setStatus("");
            } else if (eventType === "error") {
              setError(data.error);
              setStatus("");
            }
          } catch (err) {
            console.error("Failed to parse event JSON data payload", err);
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        // Superseded or unmounted - not a real error, nothing to surface.
        return;
      }
      console.error("RCA stream error", e);
      if (!isStale()) {
        setError((e as Error).message || "Plant terminal network error.");
        setStatus("");
      }
    } finally {
      if (!isStale()) {
        setLoadingAnalysis(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchFailures();
  }, [fetchFailures]);

  return {
    failures,
    loadingFailures,
    loadingAnalysis,
    status,
    rcaReport,
    citations,
    confidence,
    executionTime,
    error,
    runAnalysis,
    refreshFailures: fetchFailures
  };
}
