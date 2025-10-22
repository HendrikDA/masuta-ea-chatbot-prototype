import React, { useCallback, useEffect, useRef, useState } from "react";
import { Provider } from "./components/ui/provider";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { Button, Textarea, Text } from "@chakra-ui/react";
import Header from "./components/ui/Header";
import { colors } from "./utils/colors";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // NEW: Refs for scrollable chat and footer
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [footerHeight, setFooterHeight] = useState<number>(96); // sensible default

  // Observe footer height to pad the scroll area correctly
  useEffect(() => {
    if (!footerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setFooterHeight(e.contentRect.height);
      }
    });
    ro.observe(footerRef.current);
    return () => ro.disconnect();
  }, []);

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
  useEffect(() => () => controllerRef.current?.abort(), []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = userPrompt === "" ? "3rem" : `${el.scrollHeight}px`;
  }, [userPrompt]);

  // NEW: Auto-scroll to bottom when history/streaming output changes
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatHistory, output, isStreaming]);

  // Styles
  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    fontFamily: "system-ui",
  };

  const contentShellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 720,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    flex: 1,
  };

  const chatScrollerStyle: React.CSSProperties = {
    flex: 1,
    overflowY: "auto",
    padding: "0 1rem 1rem 1rem",
    // reserve space so the fixed footer never covers content
    paddingBottom: footerHeight + 16,
  };

  const rowStyle = (role: "user" | "agent"): React.CSSProperties => ({
    display: "flex",
    justifyContent: role === "user" ? "flex-end" : "flex-start",
    marginTop: role === "user" ? "1rem" : "0.75rem",
  });

  const bubbleStyle = (role: "user" | "agent"): React.CSSProperties => ({
    maxWidth: "80%",
    padding: "0.5rem 0.75rem",
    borderRadius: 12,
    backgroundColor: role === "user" ? colors.pink : colors.lightBlue,
    color: role === "user" ? colors.dark : colors.dark,
    wordWrap: "break-word",
    whiteSpace: "pre-wrap",
  });

  const nameStyle: React.CSSProperties = {
    fontWeight: 700,
    marginBottom: "0.25rem",
    fontSize: "0.9rem",
  };

  return (
    <Provider>
      <div style={pageStyle}>
        <div style={contentShellStyle}>
          <Header />

          <div ref={chatScrollRef} style={chatScrollerStyle}>
            {chatHistory.map((msg, idx) => {
              const normalized = msg.content
                .replace(/([.!?])\s*###\s*/g, "$1\n\n### ")
                .replace(/(###\s.+?)-\s+/g, "$1\n")
                .replace(/([.:;])\s*-\s/g, "$1\n- ")
                .replace(/([.!?])\s*###\s*/g, "$1\n\n### ")
                .replace(/(\d+\.)\s*/g, "\n$1 ")
                .replace(/\n{3,}/g, "\n\n");

              return (
                <div key={idx} style={rowStyle(msg.role)}>
                  <div style={bubbleStyle(msg.role)}>
                    <div style={nameStyle}>
                      {msg.role === "user" ? "You" : "Agent"}
                    </div>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        ul: (props) => (
                          <ul
                            style={{
                              margin: "0.5rem 0",
                              paddingLeft: "1.25rem",
                              listStyleType: "disc",
                            }}
                            {...props}
                          />
                        ),
                        ol: (props) => (
                          <ol
                            style={{
                              margin: "0.5rem 0",
                              paddingLeft: "1.25rem",
                              listStyleType: "decimal",
                            }}
                            {...props}
                          />
                        ),
                        li: (props) => (
                          <li style={{ margin: "0.15rem 0" }} {...props} />
                        ),
                        h3: (props) => (
                          <h3
                            style={{ fontWeight: "bold", fontSize: "1.1rem" }}
                            {...props}
                          />
                        ),
                      }}
                    >
                      {normalized}
                    </ReactMarkdown>
                  </div>
                </div>
              );
            })}

            {isStreaming && (
              <div style={rowStyle("agent")}>
                <div
                  style={{
                    ...bubbleStyle("agent"),
                    minHeight: 120,
                    position: "relative",
                  }}
                >
                  {output ? output : <i>Thinking...</i>}
                  <Button
                    onClick={stopStream}
                    disabled={!isStreaming}
                    style={{
                      position: "absolute",
                      bottom: "0.5rem",
                      right: "0.5rem",
                      backgroundColor: colors.lightBlue,
                      color: colors.dark,
                      fontWeight: "bold",
                      padding: "0.2rem 1rem",
                    }}
                  >
                    Stop
                  </Button>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>

        {/* FOOTER */}
        <div
          ref={footerRef}
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            background: colors.dark,
            borderTop: `1px solid ${colors.purple}`,
            padding: "1rem 0",
            display: "flex",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <Textarea
            ref={textareaRef}
            borderRadius="25px"
            padding="1rem 2rem"
            width="50rem"
            height="3.5rem"
            overflow="hidden"
            color={colors.white}
            fontWeight={400}
            borderColor={colors.purple}
            borderWidth="3px"
            placeholder="Ask Masuta something about your enterprise architecture..."
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
