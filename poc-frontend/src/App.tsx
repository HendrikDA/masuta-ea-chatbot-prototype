import React, { useCallback, useEffect, useRef, useState } from "react";
import { Provider } from "./components/ui/provider";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { Button, Textarea, Text } from "@chakra-ui/react";
import Header from "./components/ui/Header";
import { colors } from "./utils/colors";
import ReactMarkdown from "react-markdown";

interface ChatMessage {
  role: "user" | "agent";
  content: string;
}

export default function App() {
  const [userPrompt, setUserPrompt] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [output, setOutput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  const bufferRef = useRef<string>("");

  // Append streamed tokens to visible output + buffer
  const appendTokenToUI = useCallback((chunk: string) => {
    if (!chunk || chunk === "[DONE]") return;
    bufferRef.current += chunk;
    setOutput((prev) => prev + chunk);
  }, []);

  const startStream = useCallback(async () => {
    if (isStreaming || !userPrompt.trim()) return;

    bufferRef.current = "";
    setOutput("");
    setIsStreaming(true);

    controllerRef.current = new AbortController();

    // Add the user message to the chat history
    setChatHistory((prev) => [...prev, { role: "user", content: userPrompt }]);

    try {
      await fetchEventSource("http://localhost:8000/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: "1234",
          userMessage: userPrompt,
        }),
        signal: controllerRef.current.signal,
        onmessage(ev) {
          if (ev.data === "[DONE]") {
            controllerRef.current?.abort();
            setIsStreaming(false);

            const finalReply = bufferRef.current.trim();
            setChatHistory((prev) => [
              ...prev,
              { role: "agent", content: finalReply },
            ]);
            bufferRef.current = "";
            return;
          }
          appendTokenToUI(ev.data);
        },
        onerror(err) {
          console.error("Stream error:", err);
          controllerRef.current?.abort();
          setIsStreaming(false);
        },
      });
    } catch (e: any) {
      if (e.name !== "AbortError") console.error("Streaming aborted:", e);
      setIsStreaming(false);
    } finally {
      setUserPrompt("");
    }
  }, [isStreaming, userPrompt, appendTokenToUI]);

  const stopStream = useCallback(() => {
    controllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = userPrompt === "" ? "3rem" : `${el.scrollHeight}px`;
  }, [userPrompt]);

  return (
    <Provider>
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          paddingBottom: "8rem", // space for the fixed input
          fontFamily: "system-ui",
        }}
      >
        <Header />

        <div style={{ marginTop: "5rem" }}>
          {chatHistory.map((msg, idx) => {
            const baseStyle: React.CSSProperties = {
              width: "90%",
              marginBottom: "0.5rem",
              padding: "0.5rem 0.75rem",
              borderRadius: "12px",
              clear: "both",
              wordWrap: "break-word",
            };

            if (msg.role === "user") {
              return (
                <div
                  key={idx}
                  style={{
                    ...baseStyle,
                    float: "right",
                  }}
                >
                  <Text fontWeight="bold" textAlign="right">
                    You
                  </Text>
                  <Text
                    style={{
                      backgroundColor: colors.lightBlue,
                      ...baseStyle,
                      float: "right",
                    }}
                  >
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </Text>
                </div>
              );
            } else {
              return (
                <div
                  key={idx}
                  style={{
                    ...baseStyle,
                    float: "left",
                    textAlign: "left",
                  }}
                >
                  <Text fontWeight="bold">Agent</Text>
                  <Text style={{ backgroundColor: colors.cream, ...baseStyle }}>
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </Text>
                </div>
              );
            }
          })}

          {isStreaming && (
            <div
              style={{
                clear: "both",
                position: "relative",
                background: colors.cream,
                minHeight: 160,
                marginTop: "2rem",
                maxWidth: "80%",
                marginBottom: "0.5rem",
                padding: "0.5rem 0.75rem",
                borderRadius: "12px",
              }}
            >
              {output}
              <Button
                onClick={stopStream}
                disabled={!isStreaming}
                style={{
                  position: "absolute",
                  bottom: "0.75rem",
                  right: "0.75rem",
                  backgroundColor: colors.cream,
                  color: colors.dark,
                  fontWeight: "bold",
                  padding: "0.2rem 1rem",
                }}
              >
                Stop
              </Button>
            </div>
          )}
        </div>

        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            background: "#fff",
            borderTop: "1px solid #eee",
            padding: "1rem 0",
            display: "flex",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <Textarea
            borderRadius="25px"
            padding="1rem 2rem"
            width="50rem"
            height="3.5rem"
            overflow="hidden"
            color={colors.dark}
            fontWeight={400}
            placeholder="Ask <copilot> something about your enterprise architecture..."
            _placeholder={{ color: "inherit" }}
            value={userPrompt}
            resize="none"
            rows={1}
            onChange={(e) => setUserPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                setUserPrompt("");
                startStream();
              }
            }}
          />
        </div>
      </div>
    </Provider>
  );
}
