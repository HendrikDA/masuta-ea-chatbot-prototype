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
def build_prompt_messages(messages: list, ctx: str, max_turns: int = 6) -> list:
    """
    Build a *fresh* prompt for this turn only:
    - Do NOT mutate the stored conversation.
    - Replace the system message with (base system + latest [CONTEXT]) for this turn.
    - Keep only the last `max_turns` user/assistant pairs for the LLM.
    """
    # Base system (never mutated in storage)
    sys_msg = {
        "role": "system",
        "content": mm.system_prompt + (f"\n\n[CONTEXT]\n{ctx}" if ctx else "")
    }

    # Drop any stored system messages and keep only dialogue turns
    turns = [m for m in messages if m.get("role") in ("user", "assistant")]

    # Trim to the last N turns (user+assistant pairs -> up to 2*max_turns messages)
    trimmed = turns[-(max_turns*2):]

    # Return a brand-new list for generation
    return [sys_msg] + trimmed


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
    prompt_messages = build_prompt_messages(messages, ctx, max_turns=6)

    print("🔍 RAG Context:\n", ctx)
    preview_prompt = mm.apply_template(prompt_messages)
    print("🧠 Full Prompt to LLM:\n", preview_prompt)

    # Generate using the trimmed, non-mutating prompt
    params = req.params or ChatParams()
    text = mm.generate(prompt_messages, params.max_new_tokens, params.temperature, params.top_p)
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
    prompt_messages = build_prompt_messages(messages, ctx, max_turns=6)

    print("🔍 RAG Context:\n", ctx)
    preview_prompt = mm.apply_template(prompt_messages)
    print("🧠 Full Prompt to LLM:\n", preview_prompt)

    params = req.params or ChatParams()

    def sse():
        try:
            for chunk in mm.stream_generate(prompt_messages, params.max_new_tokens, params.temperature, params.top_p):
                yield f"data: {chunk}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream")
