// src/neo4jMcpClient.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const NEO4J_ENV: Record<string, string> = {
  NEO4J_URI: process.env.NEO4J_URI!,
  NEO4J_USERNAME: process.env.NEO4J_USER!,
  NEO4J_PASSWORD: process.env.NEO4J_PASSWORD!,
  NEO4J_DATABASE: process.env.NEO4J_DATABASE!,
  NEO4J_READ_ONLY: "true",
  NEO4J_TELEMETRY: "false",
};

let transport: StdioClientTransport | null = null;
let client: Client | null = null;

export async function initNeo4jMcp() {
  if (client) return; // already initialized

  transport = new StdioClientTransport({
    command: "neo4j-mcp",
    args: [],
    env: {
      ...(process.env as Record<string, string>),
      ...NEO4J_ENV,
    },
  });

  client = new Client({
    name: "neo4j-mcp-client-node",
    version: "1.0.0",
  });

  await client.connect(transport);
  console.log("[MCP] Connected to Neo4j MCP server");
}

export async function readCypher(query: string) {
  if (!client) {
    throw new Error(
      "Neo4j MCP client not initialized. Call initNeo4jMcp() first."
    );
  }

  const result = await client.request(
    {
      method: "tools/call",
      params: {
        name: "read-cypher",
        arguments: { query },
      },
    },
    CallToolResultSchema
  );

  // Handle tool-level errors
  if ((result as any).isError) {
    const msg = (result as any).content?.[0]?.text ?? "Unknown Neo4j MCP error";
    throw new Error(msg);
  }

  // Neo4j MCP returns a single text chunk with JSON rows
  const first = result.content[0];
  if (!first || first.type !== "text") {
    throw new Error("Unexpected MCP response format");
  }

  const rows = JSON.parse(first.text);
  return rows; // array of { n: { Id, ElementId, Labels, Props } } etc.
}

export async function shutdownNeo4jMcp() {
  if (transport) {
    await transport.close();
    transport = null;
    client = null;
    console.log("[MCP] Neo4j MCP transport closed");
  }
}
