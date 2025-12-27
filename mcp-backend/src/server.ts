// src/server.ts
import express from "express";
import "dotenv/config";
import cors from "cors";
import {
  ensureNeo4jMcp,
  getCurrentDbTarget,
  readCypher,
  shutdownNeo4jMcp,
  writeCypher,
} from "./neo4jMcpClient.js";

import OpenAI from "openai";
import { importArchiXmlFromNeo4jImportDir } from "./apoc-transpiler/transpile.js";
import { upload } from "./apoc-transpiler/uploader.js";
import summarizeGraphSchema from "./schema-helper.js";

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
You are working with a Neo4j graph whose structure is described in the schema summary.

Important rules:
- Do not assume fixed labels like :Application or :Chunk unless they appear in the schema.
- Infer meaning from label names (e.g. ApplicationComponent ≈ application).
- Prefer relationships such as SERVING, REALIZATION, SUPPORTS when present.
- If no text-centric nodes exist, answer using structural relationships.

ArchiMate interpretation hints:
- Labels containing "Application" usually represent applications or application services.
- Labels containing "Business" represent business-layer concepts.
- Relationships named REALIZATION, SERVING, ASSIGNMENT often express "supports" or "implements".
- Use node property "name" as the primary identifier unless otherwise specified.

Query strategy: structural traversal over ArchiMate application & business layers.
Graph traversal strategy (important):
- Multi-hop traversal is allowed and often needed. Use 1..3 hops.
- Do NOT invent relationship types like INFLUENCES/CAUSES/etc unless they are explicitly listed in the schema context.
- If you are unsure which relationship types connect the nodes, do a bounded generic traversal:
    MATCH (start)-[r*1..3]-(end)
  and then filter by end-node labels and/or end-node properties (e.g., name).
- Prefer filtering by labels and name-like properties rather than guessing relationship types.

Traversal decision heuristic:
- Use 1 hop for direct relationships (e.g. "which capability supports X").
- Use 2–3 hops for indirect effects (e.g. "what are the consequences of X").
- If the question implies a chain of influence, model it as a path, not a single edge.

Name matching:
- If the schema shows a 'name' property, use it.
- If uncertain, match on any of these properties if present: name, label, title, documentation.
- Use case-insensitive CONTAINS for the starting node when exact match might fail.

Your task:
- Write a SINGLE valid Cypher query.
- Make a best effort to use :Chunk (and its relevant properties) when the question
  asks about information that would typically come from text.
- Output ONLY Cypher. No explanations.

Cypher syntax rules (important):
- Do NOT use exists(node.property).
- Neo4j 5+ requires property existence checks to use:
    node.property IS NOT NULL
- Always use "IS NOT NULL" instead of "exists(...)"
- Do NOT use EXPLAIN or PROFILE, and do NOT wrap the query in CALL { ... } subqueries; always produce a top-level MATCH … RETURN query.
`;

  const userPrompt = `
Natural language request:
${nlPrompt}

Schema:
${schema}
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5", // or "gpt-5-nano"
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
// Helper: refine fallback cyphers
// ------------------------------------
/*async function refineCypherForChunks(
  nlPrompt: string,
  previousCypher: string,
  schema: string
) {
  const systemPrompt = `
You are an expert Cypher generator for a Neo4j-based Enterprise Architecture knowledge graph.

The previous Cypher query returned no rows.
We suspect that it targeted the wrong labels (e.g. :Concept instead of :Chunk).

Hints:
- More data is stored in different nodes. The database consists of the nodes Application, BusinessObject, Capability, Chunk, Concept, Document, Embedding, and Section
- The main textual and textbook knowledge is usually stored in :Chunk nodes (properties like 'text', 'context', 'table_summary').
- Information about the business objects are stored in the :BusinessObject nodes and Association relationships
- Information about the business capability support matrix (e.g. which applications support which capabilities) is stored in the :Capability nodes and SUPPORTS relationships.
- Try to refocus the query so that it matches the model
- Only use labels, properties, and relationships that actually exist in the schema.
- You may reuse parts of the previous query if still valid, but adjust the label/structure.

Your task:
- Generate a NEW Cypher query that is more likely to return relevant data for the user's request.
- Output ONLY Cypher. No explanations.
`;

  const userPrompt = `
Original natural-language request:
${nlPrompt}

Previous Cypher (returned 0 rows):
${previousCypher}

Schema:
${schema}
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const cypher = completion.choices?.[0]?.message?.content?.trim();
  if (!cypher) throw new Error("LLM fallback returned no Cypher");

  return cypher;
}*/

// ------------------------------------
// Helper: explain result in natural language (Markdown)
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
- Provide a concise, helpful explanation. Usually within 1–6 sentences. If a question is straightforward to answer, then a brief answer is appropriate, but it may be more if the request is complex.
- Speak like an experienced EA explaining the findings to a junior colleague.
- Do not mention the Cypher, queries, or other technical details unless relevant to the explanation.
- Refer to concrete numbers or entities from the result when relevant.
- If the result set is empty, explain that clearly and suggest what might be missing or how to refine the question.
- Respond in GitHub-flavored Markdown.
- Use formatting where it adds value, e.g.:
  - Short headings (## Summary, ## Details)
  - Bullet lists for key points
  - Fenced code blocks for Cypher or JSON snippets when helpful.
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

export async function resetPlaygroundGraphDatabase() {
  await ensureNeo4jMcp(false);

  if (getCurrentDbTarget() !== "playground") {
    throw new Error("Refusing to reset DB because target is not 'playground'.");
  }

  const batchQuery = `
    MATCH (n)
    WITH n LIMIT 10000
    DETACH DELETE n
    RETURN count(n) AS deleted
  `;

  let total = 0;
  const maxBatches = 100000; // safety guard

  for (let i = 0; i < maxBatches; i++) {
    const rows = await writeCypher(batchQuery);

    // MCP returns rows as JSON (array). Expect: [{ deleted: <number> }]
    const deleted = Array.isArray(rows) ? Number(rows?.[0]?.deleted ?? 0) : 0;

    total += deleted;

    if (deleted === 0) {
      console.log(`[RESET] Done. Total deleted: ${total}`);
      return { ok: true, deleted: total };
    }

    if (i % 10 === 0) {
      console.log(`[RESET] Batch ${i + 1}: deleted ${deleted}, total ${total}`);
    }
  }

  throw new Error(
    `[RESET] Aborted after ${maxBatches} batches (deleted so far: ${total}).`
  );
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

    const schemaText = summarizeGraphSchema(schemaResult);

    // 2) Convert NL → initial Cypher
    let cypher = await nlToCypher(prompt, schemaText);
    console.log("[LLM] Generated Cypher:", cypher);

    // 3) Execute Cypher via MCP
    let rows: unknown = await readCypher(cypher);

    // 3a) If no rows, try a fallback focusing on :Chunk
    /*if (Array.isArray(rows) && rows.length === 0) {
      console.log(
        "[API] No rows returned, trying fallback Cypher focused on :Chunk…"
      );
      const fallbackCypher = await refineCypherForChunks(
        prompt,
        cypher,
        schemaText
      );
      console.log("[LLM] Fallback Cypher:", fallbackCypher);

      const fallbackRows = await readCypher(fallbackCypher);

      if (Array.isArray(fallbackRows) && fallbackRows.length > 0) {
        console.log(
          "[API] Fallback query returned rows, using fallback result."
        );
        cypher = fallbackCypher;
        rows = fallbackRows;
      } else {
        console.log("[API] Fallback query also returned no rows.");
      }
    }*/

    // 4) Turn result into a natural-language explanation
    const answer = await explainResult(prompt, cypher, rows);

    // 5) Send answer (plus debug info) back to frontend
    res.json({
      answer, // natural-language EA explanation (Markdown)
      cypher, // final Cypher used
      rows, // final rows (may be empty)
    });
  } catch (err: any) {
    console.error("[API] Error in /api/neo4j/query:", err);
    res.status(500).json({ error: err.message ?? "Internal server error" });
  }
});

// ------------------------------------
// POST /api/neo4j/togglespeedparcel
// Body: { prompt: "How many capabilities are supported by StatManPlus?" }
// ------------------------------------
app.post("/api/neo4j/togglespeedparcel", async (req, res) => {
  try {
    const { use_speedparcel } = req.body as { use_speedparcel?: boolean };

    if (use_speedparcel === undefined || typeof use_speedparcel !== "boolean") {
      return res
        .status(400)
        .json({ error: "Missing or invalid 'use_speedparcel' in body" });
    }

    console.log("Toggling. Using SpeedParcel data?:", use_speedparcel);

    await ensureNeo4jMcp(use_speedparcel);

    res.json({ status: "ok", use_speedparcel, active: getCurrentDbTarget() });
  } catch (err: any) {
    console.error("[API] Error in /api/neo4j/togglespeedparcel:", err);
    res.status(500).json({ error: err.message ?? "Internal server error" });
  }
});

// Endpoint to reset the graph database
app.post("/api/admin/reset-graph", async (_req, res) => {
  try {
    await resetPlaygroundGraphDatabase();

    res.status(200).json({ success: true });
  } catch (e) {
    console.log("Error during graph reset: ", e);
    res.status(500).json({ success: false, error: String(e) });
  }
});

// Endpoint to add data to the graph database
app.post("/api/admin/add-data", upload.array("files", 10), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) ?? [];

    if (!files.length) {
      return res.status(400).json({
        success: false,
        error: "No files uploaded. Use form-data key 'files'.",
      });
    }

    // Import each uploaded file
    const results = [];
    for (const f of files) {
      // Important: pass ONLY the filename; Neo4j reads it via file:///data/<name>.xml
      const r = await importArchiXmlFromNeo4jImportDir(f.filename);
      results.push({ file: f.filename, result: r });
    }

    res.status(200).json({ success: true, results });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message ?? String(e) });
  }
});

// ------------------------------------
// Start server (no DB init here)
// ------------------------------------
async function start() {
  await ensureNeo4jMcp(); // default to SpeedParcel on startup

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
