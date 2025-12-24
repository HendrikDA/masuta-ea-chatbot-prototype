export const ELEMENTS_CYPHER = `
CALL apoc.load.xml(
  $file,
  "//*[local-name()='elements']/*[local-name()='element']",
  {},
  true
) YIELD value AS el
WITH
  el.identifier AS id,
  el['xsi:type'] AS archiType,
  head([c IN coalesce(el._element, []) WHERE c._type = 'name' | c._text]) AS name
WHERE id IS NOT NULL
MERGE (n:ArchiElement {id: id})
SET n.name = name,
    n.archiType = archiType
WITH n, archiType
WHERE archiType IS NOT NULL
CALL apoc.create.addLabels(n, [archiType]) YIELD node
RETURN count(*) AS elementsImported;
`;

export const RELS_CYPHER = `
CALL apoc.load.xml(
  $file,
  "//*[local-name()='relationships']/*[local-name()='relationship']",
  {},
  true
) YIELD value AS r
WITH
  r.identifier AS rid,
  r.source AS sid,
  r.target AS tid,
  r['xsi:type'] AS archiRelType,
  head([c IN coalesce(r._element, []) WHERE c._type = 'name' | c._text]) AS relName
WHERE rid IS NOT NULL AND sid IS NOT NULL AND tid IS NOT NULL
MATCH (s:ArchiElement {id: sid})
MATCH (t:ArchiElement {id: tid})
WITH s, t, rid, archiRelType, relName,
     toUpper(apoc.text.regreplace(coalesce(archiRelType, "ARCHI_REL"), "[^A-Za-z0-9_]", "_")) AS relType
CALL apoc.merge.relationship(
  s,
  relType,
  {id: rid},
  {archiType: archiRelType, name: relName},
  t,
  {}
) YIELD rel
RETURN count(*) AS relationshipsImported;
`;
