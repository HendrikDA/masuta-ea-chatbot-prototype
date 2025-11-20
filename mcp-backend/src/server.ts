// src/server.ts
import express from "express";
import "dotenv/config";
import cors from "cors";
import {
  initNeo4jMcp,
  readCypher,
  shutdownNeo4jMcp,
} from "./neo4jMcpClient.js";

import OpenAI from "openai";

// --------------------
// OpenAI Client Setup
// --------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --------------------
// Express Setup
// --------------------
const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// ------------------------------------
// Helper: generate Cypher using GPT
// ------------------------------------
async function nlToCypher(nlPrompt: string, schema: string) {
  const systemPrompt = `
You are an expert Cypher generator. 
You receive:
1) A natural-language request.
2) The Neo4j schema.

Your task:
- Write a SINGLE valid Cypher query.
- MUST use only labels, properties and relationships from the schema. 
- MUST NOT invent schema elements.
- Output ONLY Cypher. No explanations.
`;

  const userPrompt = `
Natural language request:
${nlPrompt}

Schema:
${schema}
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1", // or "gpt-4.1-mini"
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const cypher = completion.choices?.[0]?.message?.content?.trim();
  if (!cypher) throw new Error("LLM returned no Cypher");

  return cypher;
}

// ------------------------------------
// Helper: explain result in natural language
// ------------------------------------
async function explainResult(
  userPrompt: string,
  cypher: string,
  rows: unknown
) {
  const systemPrompt = `
You are a senior enterprise architect mentoring a junior enterprise architect.
You are given:
- The junior's original question.
- The Cypher query that was executed against the EA knowledge graph.
- The resulting rows from the query.

Your task:
- Provide a concise, helpful explanation in natural language (3–6 sentences).
- Speak like an experienced EA explaining the findings to a junior colleague.
- Refer to concrete numbers or entities from the result when relevant.
- If the result set is empty, explain that clearly and suggest what might be missing or how to refine the question.
- Do NOT output Cypher or JSON, only natural language.
`;

  const userContent = `
Original question:
${userPrompt}

Executed Cypher:
${cypher}

Result rows (JSON):
${JSON.stringify(rows, null, 2)}
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });

  const answer = completion.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("LLM returned no answer");

  return answer;
}

// ------------------------------------
// GET /health
// ------------------------------------
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ------------------------------------
// POST /api/neo4j/query
// Body: { prompt: "How many capabilities are supported by StatManPlus?" }
// ------------------------------------
app.post("/api/neo4j/query", async (req, res) => {
  try {
    const { prompt } = req.body as { prompt?: string };

    if (!prompt || typeof prompt !== "string") {
      return res
        .status(400)
        .json({ error: "Missing or invalid 'prompt' in body" });
    }

    // 1) Fetch schema dynamically from MCP server (can be cached)
    const schemaResult = await readCypher(`
      CALL db.schema.visualization()
    `);
    const schemaText = JSON.stringify(schemaResult, null, 2);

    // 2) Convert NL → Cypher
    const cypher = await nlToCypher(prompt, schemaText);
    console.log("[LLM] Generated Cypher:", cypher);

    // 3) Execute Cypher via MCP
    const rows = await readCypher(cypher);

    // 4) Turn result into a natural-language explanation
    const answer = await explainResult(prompt, cypher, rows);

    // 5) Send answer (plus debug info) back to frontend
    res.json({
      answer, // natural-language EA explanation
      cypher, // optional, for debugging / dev UI
      rows, // optional, raw data
    });
  } catch (err: any) {
    console.error("[API] Error in /api/neo4j/query:", err);
    res.status(500).json({ error: err.message ?? "Internal server error" });
  }
});

// ------------------------------------
// Start server + init MCP
// ------------------------------------
async function start() {
  await initNeo4jMcp();

  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

// ------------------------------------
// Graceful shutdown
// ------------------------------------
process.on("SIGINT", async () => {
  console.log("Received SIGINT. Shutting down...");
  await shutdownNeo4jMcp();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM. Shutting down...");
  await shutdownNeo4jMcp();
  process.exit(0);
});

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
