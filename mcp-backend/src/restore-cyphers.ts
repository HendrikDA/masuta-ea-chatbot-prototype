import { readFile } from "node:fs/promises";
import { ensureNeo4jMcp, writeCypher } from "./neo4jMcpClient.js";

/**
 * Remove cypher-shell directives like:
 * :begin
 * :commit
 * :param x => 123
 * :use db
 * :schema
 * etc.
 *
 * We only keep actual Cypher statements.
 */
function stripCypherShellDirectives(raw: string): string {
  // Remove UTF-8 BOM if present
  let s = raw.replace(/^\uFEFF/, "");

  // Drop any line that starts with ":" (cypher-shell command)
  // Keep newlines so error line numbers are less confusing.
  s = s.replace(/^\s*:[^\n]*\n?/gm, "");

  return s;
}

function splitCypherStatements(input: string): string[] {
  // Simple & robust enough for APOC exports:
  // split on semicolons not inside quotes/backticks.
  const out: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];

    // toggle quote states (ignore escaped quotes for ' and ")
    if (!inDouble && !inBacktick && c === "'" && input[i - 1] !== "\\") {
      inSingle = !inSingle;
      buf += c;
      continue;
    }
    if (!inSingle && !inBacktick && c === `"` && input[i - 1] !== "\\") {
      inDouble = !inDouble;
      buf += c;
      continue;
    }
    if (!inSingle && !inDouble && c === "`") {
      inBacktick = !inBacktick;
      buf += c;
      continue;
    }

    if (!inSingle && !inDouble && !inBacktick && c === ";") {
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = "";
      continue;
    }

    buf += c;
  }

  const last = buf.trim();
  if (last) out.push(last);
  return out;
}

export async function runCypherFile(filePath: string) {
  // Always write to playground for restore
  await ensureNeo4jMcp(false);

  const raw = await readFile(filePath, "utf8");

  // ✅ NEW: strip :begin/:commit/etc
  const cleaned = stripCypherShellDirectives(raw);

  const statements = splitCypherStatements(cleaned);

  console.log(
    `[Restore] Loaded ${statements.length} statements from ${filePath}`
  );

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    if (!stmt) continue;
    try {
      await writeCypher(stmt);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error(
        `[Restore] FAILED at statement #${i + 1}/${statements.length}: ${msg}`
      );
      console.error(`[Restore] Statement head: ${stmt.slice(0, 500)}\n`);
      throw new Error(`Restore failed at statement #${i + 1}: ${msg}`);
    }
  }

  return { ok: true, statements: statements.length };
}
