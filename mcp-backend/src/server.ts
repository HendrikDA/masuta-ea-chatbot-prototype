import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ListToolsResultSchema,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";

const NEO4J_ENV = {
  NEO4J_URI: "neo4j+s://fde218db.databases.neo4j.io",
  NEO4J_USERNAME: "neo4j",
  NEO4J_PASSWORD: "VgkdUn1MfwDO5ad3TdAh2eFzu9Ry0wNjly1QaFpxJK0",
  NEO4J_DATABASE: "neo4j",
  NEO4J_READ_ONLY: "true",
  NEO4J_TELEMETRY: "false",
};

async function main() {
  const transport = new StdioClientTransport({
    command: "neo4j-mcp",
    args: [],
    env: {
      ...(process.env as Record<string, string>),
      ...NEO4J_ENV,
    },
  });

  const clientOptions: any = {
    capabilities: {
      tools: {},
    },
  };

  const client = new Client(
    {
      name: "neo4j-mcp-client-node",
      version: "1.0.0",
    },
    clientOptions
  );

  await client.connect(transport);

  const toolsResponse = await client.request(
    { method: "tools/list" },
    ListToolsResultSchema
  );

  console.log(
    "Connected to Neo4j MCP with tools:",
    toolsResponse.tools.map((t) => t.name)
  );

  const cypher = "MATCH (n) RETURN n LIMIT 5";

  const readResult = await client.request(
    {
      method: "tools/call",
      params: {
        name: "read-cypher",
        arguments: { query: cypher },
      },
    },
    CallToolResultSchema
  );

  console.log("read-cypher result:");
  console.dir(readResult, { depth: null });

  await transport.close();
}

main().catch((err) => {
  console.error("Error in Neo4j MCP client:", err);
  process.exit(1);
});
