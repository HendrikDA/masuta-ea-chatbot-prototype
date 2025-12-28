import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Textarea,
  Text,
  Heading,
  Clipboard,
  Icon,
} from "@chakra-ui/react";
import Header from "./components/ui/Header";
import { colors } from "./utils/colors";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Toaster, toaster } from "./components/ui/toaster";
import { ActiveDb, loadActiveDb } from "./utils/dbToggle";

interface ChatMessage {
  role: "user" | "agent";
  content: string;
  cypher?: string;
}

export default function App() {
  const [userPrompt, setUserPrompt] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [output, setOutput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [activeDb, setActiveDb] = useState<ActiveDb>(() => loadActiveDb());

  const newSessionId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const handleDbChange = (db: ActiveDb) => {
    // Clear session ID and set a new one when database is toggled
    controllerRef.current?.abort();
    controllerRef.current = null;
    bufferRef.current = "";
    sessionIdRef.current = newSessionId();
    setActiveDb(db);
    setChatHistory([]);
  };

  const controllerRef = useRef<AbortController | null>(null);
  const bufferRef = useRef<string>("");

  const sessionIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
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
        body: JSON.stringify({
          prompt: userPrompt,
          sessionId: sessionIdRef.current,
        }),
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
          { role: "agent", content: agentText, cypher: data.cypher },
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
      <Header activeDb={activeDb} onDbChange={handleDbChange} />

      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          paddingTop: "2rem",
          paddingBottom: "8rem",
          overflowY: "auto",
          fontFamily: "system-ui",

          minHeight: "calc(100vh - 10rem)", // header + input approx
          display: chatHistory.length === 0 ? "flex" : "block",
          alignItems: chatHistory.length === 0 ? "center" : undefined,
          justifyContent: chatHistory.length === 0 ? "center" : undefined,
        }}
      >
        {chatHistory.length === 0 && (
          <Heading
            size="2xl"
            textAlign="center"
            fontFamily="system-ui, sans-serif"
            fontStyle="italic"
          >
            {activeDb === "speedparcel"
              ? "Ask Masutā something about SpeedParcel's enterprise architecture!"
              : "Import your data and ask Masutā something about it!"}
          </Heading>
        )}
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
            // Chatbot / agent message
            return (
              <div
                key={idx}
                style={{
                  ...baseStyle,
                  float: "left",
                  textAlign: "left",
                }}
              >
                <Text fontWeight="bold">Masutā</Text>
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
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(msg.cypher || "");
                    toaster.create({
                      description: "Cypher copied to clipboard.",
                      type: "success",
                    });
                  }}
                  px="0.5rem"
                  py="0.1rem"
                  height="2rem"
                  fontSize="0.65rem"
                  borderColor={colors.cream}
                  color={colors.cream}
                  fontWeight="bold"
                  display="inline-flex"
                  alignItems="center"
                  _hover={{
                    bg: colors.cream,
                    color: "black",
                  }}
                >
                  Copy Cypher
                  <Clipboard.Root value={msg.cypher || ""}>
                    <Clipboard.Trigger asChild>
                      <Icon
                        as={Clipboard.Indicator}
                        ml="0.5rem"
                        boxSize="0.9em"
                        pointerEvents="none"
                      />
                    </Clipboard.Trigger>
                  </Clipboard.Root>
                </Button>
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
          placeholder="Ask Masutā something about your enterprise architecture..."
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
      <Toaster />
    </>
  );
}
