# server.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from neo4j import GraphDatabase

from llm.runtime import ModelManager
from state import conversations as conv


class ToggleRequest(BaseModel):
    use_rag: bool


# ---------- FastAPI setup ----------
app = FastAPI(title="EA PoC - Qwen + Neo4j RAG")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Neo4j setup ----------
NEO4J_URI = "neo4j+s://fde218db.databases.neo4j.io"
NEO4J_USERNAME = "neo4j"
NEO4J_PASSWORD = "VgkdUn1MfwDO5ad3TdAh2eFzu9Ry0wNjly1QaFpxJK0"

# This is now the unified OpenAI-based index on :Embedding.value
VECTOR_INDEX = "chunkVectorIndex"

print("Connecting to Neo4j…")
driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USERNAME, NEO4J_PASSWORD))
print("Connected to Neo4j ✅")

# NOTE:
# We do NOT create a vector index here anymore.
# The index `chunkVectorIndex` is created by your Neo4j notebooks
# on (e:Embedding).value with 1536 dimensions (text-embedding-3-small).


# ---------- ModelManager with RAG ----------
# embedder=None because ModelManager will use OpenAI embeddings internally
mm = ModelManager(driver=driver, embedder=None, vector_index=VECTOR_INDEX)


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
    sys_msg = {
        "role": "system",
        "content": mm.system_prompt + (f"\n\n[CONTEXT]\n{ctx}" if ctx else "")
    }

    turns = [m for m in messages if m.get("role") in ("user", "assistant")]
    trimmed = turns[-(max_turns * 2):]

    return [sys_msg] + trimmed


def build_current_turn_prompt(user_text: str, ctx: str) -> list:
    """
    Build a prompt that contains ONLY:
      - a fresh system message (base system + latest [CONTEXT])
      - the current user question
    """
    sys_msg = {
        "role": "system",
        "content": mm.system_prompt + (f"\n\n[CONTEXT]\n{ctx}" if ctx else "")
    }
    return [sys_msg, {"role": "user", "content": user_text}]


# ---------- Routes ----------
@app.get("/healthz")
def healthz():
    return {"ok": True, "model": mm.model_id}


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    cid = req.conversationId or conv.new_conversation(req.system)
    if req.system and req.conversationId:
        conv.append(cid, "system", req.system)

    conv.append(cid, "user", req.userMessage)

    # RAG only on the CURRENT user text
    use_rag = getattr(mm, "use_rag", True)
    ctx = mm.retrieve_augmentation(req.userMessage) if use_rag else ""
    prompt_messages = build_current_turn_prompt(req.userMessage, ctx)

    print("🔍 RAG Context:\n", ctx)
    preview_prompt = mm.apply_template(prompt_messages)
    print("🧠 Full Prompt to LLM:\n", preview_prompt)

    params = req.params or ChatParams()
    text = mm.generate(
        prompt_messages,
        params.max_new_tokens,
        params.temperature,
        params.top_p,
    )
    print("📝 Reply:\n", text)

    conv.append(cid, "assistant", text)
    return ChatResponse(conversationId=cid, reply=text)


@app.post("/chat/stream")
def chat_stream(req: ChatRequest):
    """
    SSE streaming endpoint:
    - Sets Content-Type: text/event-stream
    - Frames each token chunk as 'data: ...\\n\\n'
    - Sends a final '[DONE]' event
    """
    cid = req.conversationId or conv.new_conversation(req.system)
    if req.system and req.conversationId:
        conv.append(cid, "system", req.system)

    conv.append(cid, "user", req.userMessage)

    use_rag = getattr(mm, "use_rag", True)
    ctx = mm.retrieve_augmentation(req.userMessage) if use_rag else ""
    prompt_messages = build_current_turn_prompt(req.userMessage, ctx)

    print("🔍 RAG Context:\n", ctx)
    preview_prompt = mm.apply_template(prompt_messages)
    print("🧠 Full Prompt to LLM:\n", preview_prompt)

    params = req.params or ChatParams()

    token_gen = mm.stream_generate(
        prompt_messages,
        params.max_new_tokens,
        params.temperature,
        params.top_p,
    )

    def sse_wrapper():
        try:
            for chunk in token_gen:
                if not chunk:
                    continue
                yield f"data: {chunk}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }

    return StreamingResponse(
        sse_wrapper(), media_type="text/event-stream", headers=headers
    )


@app.post("/rag/toggle")
def toggle_rag(req: ToggleRequest):
    mm.use_rag = req.use_rag
    status = "enabled" if req.use_rag else "disabled"
    print(f"RAG has been {status}.")
    return {"rag_enabled": mm.use_rag}
