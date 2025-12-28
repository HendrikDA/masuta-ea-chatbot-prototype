// src/neo4jMcpClient.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const NEO4J_ENV_SPEEDPARCEL: Record<string, string> = {
  NEO4J_URI: process.env.LOCAL_SPEEDPARCEL_NEO4J_URI!,
  NEO4J_USERNAME: process.env.LOCAL_SPEEDPARCEL_NEO4J_USER!,
  NEO4J_PASSWORD: process.env.LOCAL_SPEEDPARCEL_NEO4J_PASSWORD!,
  NEO4J_DATABASE: process.env.LOCAL_SPEEDPARCEL_NEO4J_DATABASE!,
  NEO4J_READ_ONLY: "true",
  NEO4J_TELEMETRY: "false",
};

const NEO4J_ENV_PLAYGROUND: Record<string, string> = {
  NEO4J_URI: process.env.LOCAL_PLAYGROUND_NEO4J_URI!,
  NEO4J_USERNAME: process.env.LOCAL_PLAYGROUND_NEO4J_USER!,
  NEO4J_PASSWORD: process.env.LOCAL_PLAYGROUND_NEO4J_PASSWORD!,
  NEO4J_DATABASE: process.env.LOCAL_PLAYGROUND_NEO4J_DATABASE!,
  NEO4J_READ_ONLY: "false",
  NEO4J_TELEMETRY: "false",
};

type DbTarget = "speedparcel" | "playground";

let transport: StdioClientTransport | null = null;
let client: Client | null = null;

// Track what we're currently connected to
let currentTarget: DbTarget | null = null;

// Prevent race conditions when multiple calls try to (re)connect at once
let initPromise: Promise<void> | null = null;

function targetFromFlag(useSpeedparcel: boolean): DbTarget {
  return useSpeedparcel ? "speedparcel" : "playground";
}

function envForTarget(target: DbTarget): Record<string, string> {
  return target === "speedparcel"
    ? NEO4J_ENV_SPEEDPARCEL
    : NEO4J_ENV_PLAYGROUND;
}

async function connectToTarget(target: DbTarget) {
  // Always start from a clean state
  await shutdownNeo4jMcp();

  transport = new StdioClientTransport({
    command: "neo4j-mcp",
    args: [],
    env: {
      ...(process.env as Record<string, string>),
      ...envForTarget(target),
    },
  });

  client = new Client({
    name: "neo4j-mcp-client-node",
    version: "1.0.0",
  });

  await client.connect(transport);
  currentTarget = target;

  console.log(`[MCP] Connected to Neo4j MCP server (${target})`);
}

/**
 * Ensure we're connected to the requested database. If already connected to that DB, do nothing.
 * If connected to the other DB, reconnect.
 */
export async function ensureNeo4jMcp(useSpeedparcel: boolean = false) {
  const desiredTarget = targetFromFlag(useSpeedparcel);

  // If we’re already connected to the right DB, nothing to do.
  if (client && currentTarget === desiredTarget) return;

  // If an init is already in flight, await it first, then re-check.
  if (initPromise) {
    await initPromise;
    if (client && currentTarget === desiredTarget) return;
  }

  // Start (re)connect; store promise so concurrent callers coalesce
  initPromise = (async () => {
    // If connected but to the wrong target → reconnect
    if (client && currentTarget !== desiredTarget) {
      console.log(`[MCP] Switching DB ${currentTarget} -> ${desiredTarget}`);
    } else {
      console.log(`[MCP] Initializing DB connection: ${desiredTarget}`);
    }

    await connectToTarget(desiredTarget);
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

export async function readCypher(
  query: string,
  params: Record<string, any> = {}
) {
  if (!client) {
    throw new Error(
      "Neo4j MCP client not initialized. Call ensureNeo4jMcp() first."
    );
  }

  const result = await client.request(
    {
      method: "tools/call",
      params: {
        name: "read-cypher",
        arguments: { query, params },
      },
    },
    CallToolResultSchema
  );

  if ((result as any).isError) {
    const msg = (result as any).content?.[0]?.text ?? "Unknown Neo4j MCP error";
    throw new Error(msg);
  }

  const first = result.content[0];
  if (!first || first.type !== "text") {
    throw new Error("Unexpected MCP response format");
  }

  return JSON.parse(first.text);
}

export async function writeCypher(
  query: string,
  params: Record<string, any> = {}
) {
  if (!client) {
    throw new Error(
      "Neo4j MCP client not initialized. Call ensureNeo4jMcp() first."
    );
  }

  const result = await client.request(
    {
      method: "tools/call",
      params: {
        name: "write-cypher",
        arguments: { query, params },
      },
    },
    CallToolResultSchema
  );

  if ((result as any).isError) {
    const msg = (result as any).content?.[0]?.text ?? "Unknown Neo4j MCP error";
    throw new Error(msg);
  }

  const first = result.content[0];
  if (!first || first.type !== "text")
    throw new Error("Unexpected MCP response format");

  return JSON.parse(first.text);
}

export async function shutdownNeo4jMcp() {
  if (transport) {
    try {
      await transport.close();
    } catch (e) {
      // ignore close errors; we still want to reset state
    }
  }
  transport = null;
  client = null;
  currentTarget = null;
  console.log("[MCP] Neo4j MCP transport closed");
}

// Optional helper (useful for debugging / UI)
export function getCurrentDbTarget(): DbTarget | null {
  return currentTarget;
}
