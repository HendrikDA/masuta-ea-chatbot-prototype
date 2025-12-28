// src/schema-helper.ts
type IndexRow = {
  name?: string;
  type?: string; // RANGE / FULLTEXT / VECTOR / LOOKUP ...
  entityType?: string;
  labelsOrTypes?: string[] | string;
  properties?: string[] | string;
  state?: string;
  uniqueness?: string;
  indexProvider?: string;
};

function firstRow(raw: any): any | null {
  if (!raw) return null;
  if (Array.isArray(raw.rows) && raw.rows.length > 0) return raw.rows[0];
  return null;
}

function unwrapUsingColumns(raw: any): any | null {
  const row = firstRow(raw);
  const cols = Array.isArray(raw?.columns) ? raw.columns : null;
  if (!row || !cols || cols.length === 0) return null;

  const firstCol = cols[0];
  if (row && Object.prototype.hasOwnProperty.call(row, firstCol)) {
    return row[firstCol];
  }
  return null;
}

function unwrapApocMetaSchema(raw: any): any {
  if (!raw) return {};

  // ✅ Your case: array of records like [{ value: {...} }]
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (first?.value && typeof first.value === "object") return first.value;
    if (first?.schema && typeof first.schema === "object") return first.schema;
    return {};
  }

  // MCP-style { columns: [...], rows: [...] }
  const byCols = unwrapUsingColumns(raw);
  if (byCols && typeof byCols === "object") return byCols;

  const row = firstRow(raw);
  if (row?.value && typeof row.value === "object") return row.value;
  if (row?.schema && typeof row.schema === "object") return row.schema;

  // Already a map
  if (raw && typeof raw === "object" && !raw.rows && !raw.columns) return raw;

  return {};
}

function unwrapShowIndexes(raw: any): IndexRow[] {
  if (!raw) return [];
  if (Array.isArray(raw.rows)) return raw.rows as IndexRow[];
  if (Array.isArray(raw)) return raw as IndexRow[];
  return [];
}

function normalizeList(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return [v];
  return [String(v)];
}

export default function summarizeGraphSchema(
  apocMetaSchemaRaw: any,
  showIndexesRaw: any
): string {
  const schemaMap = unwrapApocMetaSchema(apocMetaSchemaRaw);
  const indexRows = unwrapShowIndexes(showIndexesRaw);

  const nodeEntries = Object.entries(schemaMap).filter(
    ([, v]: any) => v?.type === "node"
  ) as Array<[string, any]>;

  const relEntries = Object.entries(schemaMap).filter(
    ([, v]: any) => v?.type === "relationship"
  ) as Array<[string, any]>;

  const labelsBlock = nodeEntries
    .map(([label, info]) => {
      const props = info?.properties ?? {};
      const propLines = Object.entries(props)
        .map(([k, meta]: any) => {
          const type = meta?.type ? String(meta.type) : "UNKNOWN";
          const idx = meta?.indexed ? " indexed" : "";
          const uniq = meta?.unique ? " unique" : "";
          return `  - ${k}: ${type}${idx}${uniq}`;
        })
        .sort()
        .join("\n");

      const rels = info?.relationships ?? {};
      const relLines = Object.entries(rels)
        .map(([relType, relMeta]: any) => {
          const dir = relMeta?.direction ? String(relMeta.direction) : "?";
          const targets =
            normalizeList(relMeta?.labels).join("|") || "(unknown)";
          const arrow = dir === "out" ? "->" : dir === "in" ? "<-" : "-";
          const cnt =
            typeof relMeta?.count === "number"
              ? ` (count≈${relMeta.count})`
              : "";
          return `  - (:${label})-[:${relType}]${arrow}(:${targets})${cnt}`;
        })
        .sort()
        .join("\n");

      return `Label :${label} (count≈${info?.count ?? "?"})
Properties:
${propLines || "  - (none found)"}
Relationships:
${relLines || "  - (none found)"}`;
    })
    .join("\n\n");

  const relTypesBlock = relEntries
    .map(([t, v]) => `- :${t} (count≈${v?.count ?? "?"})`)
    .sort()
    .join("\n");

  const vectorIndexes = indexRows
    .filter((r) =>
      String(r.type ?? "")
        .toUpperCase()
        .includes("VECTOR")
    )
    .map((r: any) => {
      const lot = normalizeList(r.labelsOrTypes).join("|");
      const props = normalizeList(r.properties).join(", ");
      return `- ${r.name} on ${lot}(${props})`;
    });

  const fulltextIndexes = indexRows
    .filter((r) =>
      String(r.type ?? "")
        .toUpperCase()
        .includes("FULLTEXT")
    )
    .map((r: any) => {
      const lot = normalizeList(r.labelsOrTypes).join("|");
      const props = normalizeList(r.properties).join(", ");
      return `- ${r.name} on ${lot}(${props})`;
    });

  const otherIndexes = indexRows
    .filter(
      (r) =>
        !String(r.type ?? "")
          .toUpperCase()
          .includes("VECTOR") &&
        !String(r.type ?? "")
          .toUpperCase()
          .includes("FULLTEXT")
    )
    .slice(0, 25)
    .map((r: any) => {
      const lot = normalizeList(r.labelsOrTypes).join("|");
      const props = normalizeList(r.properties).join(", ");
      return `- ${r.name} [${r.type}] on ${lot}(${props})`;
    });

  return `
Schema summary (from apoc.meta.schema + SHOW INDEXES)

Labels & properties:
${labelsBlock || "- (none found)"}

Relationship types:
${relTypesBlock || "- (none found)"}

Indexes (use as query entry points):
Vector indexes:
${vectorIndexes.join("\n") || "- (none found)"}

Fulltext indexes:
${fulltextIndexes.join("\n") || "- (none found)"}

Other indexes (sample):
${otherIndexes.join("\n") || "- (none found)"}
`.trim();
}
