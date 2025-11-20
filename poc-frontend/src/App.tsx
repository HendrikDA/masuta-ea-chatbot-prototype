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
  const [isLoading, setIsLoading] = useState(false);

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
      const res = await fetch("http://localhost:4000/api/neo4j/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userPrompt }),
        signal: controllerRef.current.signal,
      });

      const data = await res.json();

      if (data.error) {
        setChatHistory((prev) => [
          ...prev,
          { role: "agent", content: `Error: ${data.error}` },
        ]);
      } else {
        // Backend now returns { answer, cypher, rows }
        const agentText: string =
          typeof data.answer === "string"
            ? data.answer
            : "I could not generate an explanation from the result.";

        setChatHistory((prev) => [
          ...prev,
          { role: "agent", content: agentText },
        ]);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setChatHistory((prev) => [
          ...prev,
          { role: "agent", content: `API Error: ${err.message}` },
        ]);
      }
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
    }
  }, [userPrompt, isStreaming]);

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
    <>
      <Header />
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          // calculate height minus header and input area
          paddingTop: "2rem",
          paddingBottom: "8rem",
          overflowY: "auto",
          fontFamily: "system-ui",
        }}
      >
        {chatHistory.map((msg, idx) => {
          const baseStyle: React.CSSProperties = {
            width: "90%",
            marginBottom: "0.5rem",
            padding: "0.5rem 0.75rem",
            borderRadius: "12px",
            clear: "both",
            wordWrap: "break-word",
          };

          const normalized = msg.content
            // newline before '###' if it follows right after a sentence
            .replace(/([.!?])\s*###\s*/g, "$1\n\n### ")
            // H3 header ends with a dash: '### Title- ' → '### Title\n'
            .replace(/(###\s.+?)-\s+/g, "$1\n")
            // newline after sentence punctuation before a "-" (list item)
            .replace(/([.:;])\s*-\s/g, "$1\n- ")
            .replace(/([.!?])\s*###\s*/g, "$1\n\n### ")
            .replace(/(\d+\.)\s*/g, "\n$1 ")

            // collapse excessive line breaks
            .replace(/\n{3,}/g, "\n\n");

          if (msg.role === "user") {
            return (
              <div
                key={idx}
                style={{
                  ...baseStyle,
                  float: "right",
                  textAlign: "right",
                  marginTop: "4rem",
                }}
              >
                <Text fontWeight="bold">You</Text>
                <div
                  style={{
                    backgroundColor: colors.pink,
                    ...baseStyle,
                    float: "right",
                  }}
                >
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
                          style={{
                            fontWeight: "bold",
                            fontSize: "1.1rem",
                          }}
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
                <div
                  style={{
                    backgroundColor: colors.lightBlue,
                    color: colors.dark,
                    ...baseStyle,
                  }}
                >
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
                          style={{
                            fontWeight: "bold",
                            fontSize: "1.1rem",
                          }}
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
          }
        })}

        {isStreaming && (
          <div
            style={{
              clear: "both",
              position: "relative",
              background: colors.lightBlue,
              color: colors.dark,
              minHeight: 160,
              marginTop: "2rem",
              maxWidth: "80%",
              marginBottom: "0.5rem",
              padding: "0.5rem 0.75rem",
              borderRadius: "12px",
            }}
          >
            {output ? output : <i>Thinking...</i>}
            <Button
              onClick={stopStream}
              disabled={!isStreaming}
              style={{
                position: "absolute",
                bottom: "0.75rem",
                right: "0.75rem",
                backgroundColor: colors.lightBlue,
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
          background: colors.dark,
          borderTop: "1px solid #eee",
          padding: "1rem 0",
          display: "flex",
          justifyContent: "center",
          zIndex: 1000,
          borderColor: colors.purple,
        }}
      >
        <Textarea
          borderRadius="25px"
          padding="1rem 2rem"
          width="50rem"
          height="3.5rem"
          overflow="hidden"
          color={colors.white}
          fontWeight={400}
          // border colors purple gradient
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
    </>
  );
}
