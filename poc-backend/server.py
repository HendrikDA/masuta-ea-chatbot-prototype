# server.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from neo4j import GraphDatabase
from sentence_transformers import SentenceTransformer

from llm.runtime import ModelManager
from state import conversations as conv

# ---------- FastAPI setup ----------
app = FastAPI(title="EA PoC - Qwen + Neo4j RAG")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Neo4j + Embedder setup ----------
NEO4J_URI = "neo4j+s://fde218db.databases.neo4j.io"
NEO4J_USERNAME = "neo4j"
NEO4J_PASSWORD = "VgkdUn1MfwDO5ad3TdAh2eFzu9Ry0wNjly1QaFpxJK0"
VECTOR_INDEX = "kg_text_chunks_v1"

print("Connecting to Neo4j…")
driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USERNAME, NEO4J_PASSWORD))
print("Connected to Neo4j ✅")

# Create vector index if not exists (384 dims for BGE-small)
with driver.session() as s:
    s.run("""
    CREATE VECTOR INDEX kg_text_chunks_v1
    IF NOT EXISTS
    FOR (n:Chunk)
    ON (n.embedding)
    OPTIONS {indexConfig:{
      `vector.dimensions`: 384,
      `vector.similarity_function`: 'cosine'
    }}
    """)

# SentenceTransformer embedder
embedder = SentenceTransformer("BAAI/bge-small-en-v1.5")

# ---------- ModelManager with RAG ----------
mm = ModelManager(driver=driver, embedder=embedder, vector_index=VECTOR_INDEX)

# ---------- API Models ----------
class ChatParams(BaseModel):
    max_new_tokens: int = 512
    temperature: float = 0.2
    top_p: float = 0.9

class ChatRequest(BaseModel):
    conversationId: Optional[str] = None
    userMessage: str
    system: Optional[str] = None
    params: Optional[ChatParams] = None

class ChatResponse(BaseModel):
    conversationId: str
    reply: str

# ---------- Helpers ----------
def ensure_system_and_inject_context(messages: list, ctx: str) -> None:
    """Make sure the first message is a system message and inject [CONTEXT]."""
    if not messages or messages[0].get("role") != "system":
        # insert as first element to guarantee order
        messages.insert(0, {"role": "system", "content": mm.system_prompt})
    if ctx:
        messages[0]["content"] += f"\n\n[CONTEXT]\n{ctx}"

# ---------- Routes ----------
@app.get("/healthz")
def healthz():
    return {"ok": True, "model": mm.model_id}

@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    cid = req.conversationId or conv.new_conversation(req.system)
    if req.system and req.conversationId:
        conv.append(cid, "system", req.system)

    # Append user message and build messages
    conv.append(cid, "user", req.userMessage)
    messages = conv.get_messages(cid)

    # RAG once, inject once, log once
    ctx = mm.retrieve_augmentation(req.userMessage)
    ensure_system_and_inject_context(messages, ctx)
    print("🔍 RAG Context:\n", ctx)
    preview_prompt = mm.apply_template(messages)
    print("🧠 Full Prompt to LLM:\n", preview_prompt)

    # Generate
    params = req.params or ChatParams()
    text = mm.generate(messages, params.max_new_tokens, params.temperature, params.top_p)
    print("📝 Reply:\n", text)

    conv.append(cid, "assistant", text)
    return ChatResponse(conversationId=cid, reply=text)

@app.post("/chat/stream")
def chat_stream(req: ChatRequest):
    cid = req.conversationId or conv.new_conversation(req.system)
    if req.system and req.conversationId:
        conv.append(cid, "system", req.system)

    conv.append(cid, "user", req.userMessage)
    messages = conv.get_messages(cid)

    # RAG once, inject once, log once
    ctx = mm.retrieve_augmentation(req.userMessage)
    ensure_system_and_inject_context(messages, ctx)
    print("🔍 RAG Context:\n", ctx)
    preview_prompt = mm.apply_template(messages)
    print("🧠 Full Prompt to LLM:\n", preview_prompt)

    params = req.params or ChatParams()

    def sse():
        try:
            for chunk in mm.stream_generate(messages, params.max_new_tokens, params.temperature, params.top_p):
                yield f"data: {chunk}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"event: error\ndata: {str(e)}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream")
