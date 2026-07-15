import { useState, useCallback } from "react";
import { env } from "@/lib/env";
import { Citation } from "@/lib/api";

export interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

export function useStreamingChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [confidence, setConfidence] = useState<"high" | "medium" | "low" | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);

  const sendMessage = useCallback(async (query: string) => {
    if (!query.trim()) return;

    setLoading(true);
    setStatus("Connecting to industrial copilot...");
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
        }),
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

          try {
            const data = JSON.parse(eventData);
            if (eventType === "status") {
              setStatus(data.message || "Thinking...");
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
              setStatus("");
              
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
              setStatus(`Error: ${data.error}`);
            }
          } catch (err) {
            console.error("Failed to parse event JSON data payload", err, eventData);
          }
        }
      }
    } catch (e) {
      console.error("Stream reader loop aborted with error", e);
      setStatus("Error: Plant terminal offline.");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setCitations([]);
    setConfidence(null);
    setStatus("");
    setConversationId(null);
    setExecutionTime(null);
  }, []);

  return {
    messages,
    loading,
    status,
    citations,
    confidence,
    conversationId,
    sendMessage,
    clearChat,
    executionTime,
  };
}
