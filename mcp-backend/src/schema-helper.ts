export default function summarizeGraphSchema(schemaResult: any): string {
  // MCP usually wraps rows → unwrap defensively
  const root = Array.isArray(schemaResult?.rows)
    ? schemaResult.rows[0]
    : Array.isArray(schemaResult)
    ? schemaResult[0]
    : schemaResult;

  const nodes = root?.nodes ?? [];
  const relationships = root?.relationships ?? [];

  // --- Collect labels ---
  const labels = new Set<string>();
  for (const n of nodes) {
    if (Array.isArray(n.labels)) {
      n.labels.forEach((l: string) => labels.add(l));
    }
  }

  // --- Collect relationship patterns ---
  const relPatterns = new Set<string>();
  for (const r of relationships) {
    if (r.startNode && r.endNode && r.type) {
      relPatterns.add(
        `(:${r.startNode.labels?.[0] ?? "?"})-[:${r.type}]->(:${
          r.endNode.labels?.[0] ?? "?"
        })`
      );
    }
  }

  // --- Heuristic grouping (very important) ---
  const applicationLabels = [...labels].filter((l) =>
    l.toLowerCase().includes("application")
  );
  const businessLabels = [...labels].filter(
    (l) =>
      l.toLowerCase().includes("business") ||
      l.toLowerCase().includes("process") ||
      l.toLowerCase().includes("capability") ||
      l.toLowerCase().includes("actor") ||
      l.toLowerCase().includes("role")
  );
  const technologyLabels = [...labels].filter(
    (l) =>
      l.toLowerCase().includes("node") ||
      l.toLowerCase().includes("technology") ||
      l.toLowerCase().includes("system")
  );

  return `
GRAPH SCHEMA SUMMARY

Node labels present:
${[...labels]
  .sort()
  .map((l) => `- ${l}`)
  .join("\n")}

Application-layer nodes:
${applicationLabels.map((l) => `- ${l}`).join("\n") || "- (none)"}

Business-layer nodes:
${businessLabels.map((l) => `- ${l}`).join("\n") || "- (none)"}

Technology-layer nodes:
${technologyLabels.map((l) => `- ${l}`).join("\n") || "- (none)"}

Observed relationship patterns:
${[...relPatterns]
  .slice(0, 15)
  .map((p) => `- ${p}`)
  .join("\n")}

Notes:
- Use property 'name' as the primary identifier unless stated otherwise.
- Prefer structural traversal using REALIZATION, SERVING, SUPPORTS, ASSIGNMENT when present.
`.trim();
}
