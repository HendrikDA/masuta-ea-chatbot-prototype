import { ensureNeo4jMcp, writeCypher } from "../neo4jMcpClient.js";
import { ELEMENTS_CYPHER, RELS_CYPHER } from "./transpiler-cyphers.js";

function assertSafeXmlFilename(fileName: string) {
  console.log("Asserting filename:", fileName);
  // Prevent "../", absolute paths, weird chars
  if (!/^[A-Za-z0-9._-]+\.xml$/i.test(fileName)) {
    throw new Error("Invalid filename. Use something like 'BOM.xml'.");
  }
}

function cypherCreateConstraints() {
  return `
CREATE CONSTRAINT archi_element_id IF NOT EXISTS
FOR (e:ArchiElement) REQUIRE e.id IS UNIQUE;
`;
}

function cypherImportElements(fileUrl: string) {
  return ELEMENTS_CYPHER;
}

function cypherImportRelationships(fileUrl: string) {
  return RELS_CYPHER;
}

function cypherValidationSummary() {
  return `
MATCH (e:ArchiElement) WITH count(e) AS nodes
MATCH ()-[r]->() WITH nodes, count(r) AS rels
RETURN nodes, rels;
`;
}

export async function importArchiXmlFromNeo4jImportDir(fileName: string) {
  console.log("Filename: ", fileName);
  assertSafeXmlFilename(fileName);

  // write DB
  await ensureNeo4jMcp(false);

  const fileUrl = `file:///data/${fileName}`; // Todo: Replace the local preconfigured file with the uploaded version

  // 1) constraints (optional but recommended)
  await writeCypher(cypherCreateConstraints());

  // 2) elements (✅ pass $file param)
  const elRes = await writeCypher(ELEMENTS_CYPHER, { file: fileUrl });
  const elementsImported =
    elRes?.[0]?.elementsImported ?? elRes?.elementsImported ?? null;

  // 3) relationships (✅ pass $file param)
  const relRes = await writeCypher(RELS_CYPHER, { file: fileUrl });
  const relationshipsImported =
    relRes?.[0]?.relationshipsImported ?? relRes?.relationshipsImported ?? null;

  // 4) quick validation summary
  const summary = await writeCypher(cypherValidationSummary());

  return {
    fileName,
    fileUrl,
    elementsImported,
    relationshipsImported,
    summary,
  };
}
