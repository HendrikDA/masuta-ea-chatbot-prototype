# populate_embeddings.py
from neo4j import GraphDatabase
from sentence_transformers import SentenceTransformer

# --- 🔧 Config ---
NEO4J_URI = "neo4j+s://fde218db.databases.neo4j.io"
NEO4J_USERNAME = "neo4j"
NEO4J_PASSWORD = "VgkdUn1MfwDO5ad3TdAh2eFzu9Ry0wNjly1QaFpxJK0"
EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"   # -> 384 dimensions
BATCH_SIZE = 64

print("Connecting to Neo4j…")
driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USERNAME, NEO4J_PASSWORD))
embedder = SentenceTransformer(EMBEDDING_MODEL)

# Ensure nodes have the :Chunk label (so RAG queries can find them)
with driver.session() as s:
    s.run("""
    MATCH (n)
    WHERE n.description IS NOT NULL
    SET n:Chunk
    """)

# --- 🚀 Retrieve nodes without embeddings ---
with driver.session() as s:
    records = s.run("""
        MATCH (n:Chunk)
        WHERE n.description IS NOT NULL AND n.embedding IS NULL
        RETURN id(n) AS id, n.description AS text
    """).data()

if not records:
    print("✅ All nodes already have embeddings.")
    driver.close()
    exit()

print(f"Embedding {len(records)} nodes…")

# # --- 🔢 Compute and store embeddings in batches ---
# texts = [r["text"] for r in records]
# ids = [r["id"] for r in records]

# for i in range(0, len(texts), BATCH_SIZE):
#     batch_texts = texts[i:i + BATCH_SIZE]
#     batch_ids = ids[i:i + BATCH_SIZE]
#     vectors = embedder.encode(batch_texts, batch_size=BATCH_SIZE)
#     for node_id, vec in zip(batch_ids, vectors):
#         with driver.session() as s:
#             s.run("MATCH (n) WHERE id(n)=$id SET n.embedding=$emb", id=node_id, emb=vec.tolist())
#     print(f"Processed {min(i+BATCH_SIZE, len(texts))}/{len(texts)} nodes")

# print("✅ Embedding population complete.")
# driver.close()
