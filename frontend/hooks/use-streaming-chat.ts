import { useState, useCallback, useEffect, useRef } from "react";
import { env } from "@/lib/env";
import { Citation } from "@/lib/api";
import { useLoadingMessage } from "./use-loading-message";

export interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  image_url?: string;
  is_identification?: boolean;
  identification_data?: any;
}

export function useStreamingChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [internalStatus, setInternalStatus] = useState<string>("");
  const rotatingMessage = useLoadingMessage(loading, "");
  const status = internalStatus || (loading ? rotatingMessage : "");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [confidence, setConfidence] = useState<"high" | "medium" | "low" | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);

  // Tracks the most recently started/valid stream so a superseded or cleared
  // stream's late-arriving events can be ignored instead of corrupting state.
  const activeRequestId = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const sendMessage = useCallback(async (query: string, queryType: "copilot" | "keyword-comparison" = "copilot") => {
    if (!query.trim()) return;

    // Supersede any previous in-flight stream.
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestId = ++activeRequestId.current;
    const isStale = () => activeRequestId.current !== requestId;

    setLoading(true);
    setInternalStatus("");
    setCitations([]);
    setConfidence(null);
    setExecutionTime(null);

    // 1. Add User message
    const userMessage: Message = { role: "user", content: query };
    setMessages((prev) => [...prev, userMessage]);

    // 2. Open Stream via POST request using Streams API
    try {
      const url = `${env.NEXT_PUBLIC_API_URL}/api/v1/copilot/query`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          conversation_id: conversationId || undefined,
          query_type: queryType,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to initiate chat stream: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("No response body stream received.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (isStale()) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Split by double newline (which divides SSE events, handling both \n\n and \r\n\r\n)
        const parts = buffer.split(/\r?\n\r?\n/);
        // Keep the last partial event in the buffer
        buffer = parts.pop() || "";

        for (const rawEvent of parts) {
          if (!rawEvent.trim()) continue;

          // Parse SSE event details
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
              setInternalStatus(data.message || "");
            } else if (eventType === "token") {
              assistantText += data.token;
              
              // Append or update last assistant token in list
              setMessages((prev) => {
                const base = prev.slice(0, -1);
                const last = prev[prev.length - 1];
                if (last && last.role === "assistant") {
                   return [...base, { role: "assistant", content: assistantText }];
                } else {
                  return [...prev, { role: "assistant", content: assistantText }];
                }
              });
            } else if (eventType === "done") {
              setConversationId(data.conversation_id);
              setCitations(data.citations || []);
              setConfidence(data.confidence || "medium");
              setExecutionTime(data.execution_time_sec !== undefined && data.execution_time_sec !== null ? data.execution_time_sec : null);
              setInternalStatus("");
              
              // Update last assistant message with its actual citations
              setMessages((prev) => {
                const base = prev.slice(0, -1);
                const last = prev[prev.length - 1];
                if (last && last.role === "assistant") {
                  return [...base, { ...last, citations: data.citations || [] }];
                }
                return prev;
              });
            } else if (eventType === "error") {
              setInternalStatus(`Error: ${data.error}`);
            }
          } catch (err) {
            console.error("Failed to parse event JSON data payload", err, eventData);
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        // Superseded or unmounted - not a real error, nothing to surface.
        return;
      }
      console.error("Stream reader loop aborted with error", e);
      if (!isStale()) {
        setInternalStatus("Error: Plant terminal offline.");
      }
    } finally {
      if (!isStale()) {
        setLoading(false);
      }
    }
  }, [conversationId]);

  const clearChat = useCallback(() => {
    // Invalidate any in-flight stream so its late events can't repopulate
    // the conversation we're about to empty.
    abortControllerRef.current?.abort();
    activeRequestId.current += 1;
    setMessages([]);
    setCitations([]);
    setConfidence(null);
    setInternalStatus("");
    setConversationId(null);
    setExecutionTime(null);
    setLoading(false);
  }, []);

  const submitIdentificationImage = useCallback(async (file: File) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestId = ++activeRequestId.current;
    const isStale = () => activeRequestId.current !== requestId;

    setLoading(true);
    setInternalStatus("Analyzing image...");
    setCitations([]);
    setConfidence(null);
    setExecutionTime(null);

    const imageUrl = URL.createObjectURL(file);
    const userMessage: Message = { 
      role: "user", 
      content: "Identify equipment in this photo",
      image_url: imageUrl
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const url = `${env.NEXT_PUBLIC_API_URL}/api/v1/copilot/identify-equipment`;
      const formData = new FormData();
      formData.append("file", file);

      const t0 = performance.now();
      const response = await fetch(url, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      const t1 = performance.now();

      if (isStale()) return;

      setExecutionTime((t1 - t0) / 1000);
      
      const assistantMessage: Message = {
        role: "assistant",
        content: data.message || "Identification complete",
        is_identification: true,
        identification_data: data
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setInternalStatus("");
    } catch (err: any) {
      if (err.name === "AbortError") return;
      if (isStale()) return;
      
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err.message || "Failed to identify equipment"}` }
      ]);
      setInternalStatus("");
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, []);

  return {
    messages,
    loading,
    status,
    citations,
    confidence,
    conversationId,
    sendMessage,
    submitIdentificationImage,
    clearChat,
    executionTime,
  };
}
