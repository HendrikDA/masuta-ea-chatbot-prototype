# server.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

from llm.runtime import ModelManager
from state import conversations as conv

app = FastAPI(title="EA PoC - Qwen API")

# CORS for your React dev server (adjust port if needed)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load the model once at startup
mm = ModelManager()

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

@app.get("/healthz")
def healthz():
    return {"ok": True, "model": mm.model_id}

@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    # Find or create conversation
    cid = req.conversationId or conv.new_conversation(req.system)
    if req.system and not req.conversationId:
        # If new conversation and system provided, it was added in new_conversation()
        pass
    elif req.system and req.conversationId:
        # Allow system override mid-stream (replace or prepend)
        conv.append(cid, "system", req.system)

    # Append user message
    conv.append(cid, "user", req.userMessage)

    # Build message list
    messages = conv.get_messages(cid)
    params = req.params or ChatParams()

    # Generate
    text = mm.generate(
        messages=messages,
        max_new_tokens=params.max_new_tokens,
        temperature=params.temperature,
        top_p=params.top_p,
    )

    # Save assistant reply
    conv.append(cid, "assistant", text)

    return ChatResponse(conversationId=cid, reply=text)

@app.post("/chat/stream")
def chat_stream(req: ChatRequest):
    cid = req.conversationId or conv.new_conversation(req.system)
    if req.system and req.conversationId:
        conv.append(cid, "system", req.system)

    conv.append(cid, "user", req.userMessage)
    messages = conv.get_messages(cid)
    params = req.params or ChatParams()

    def sse():
        try:
            for chunk in mm.stream_generate(
                messages=messages,
                max_new_tokens=params.max_new_tokens,
                temperature=params.temperature,
                top_p=params.top_p,
            ):
                yield f"data: {chunk}\n\n"
            yield f"data: [DONE]\n\n"
        except Exception as e:
            yield f"event: error\ndata: {str(e)}\n\n"

    # Note: we also persist the full assistant reply at the end.
    # For simplicity, the client can stitch chunks; if you want to store it here,
    # buffer chunks and append once finished.

    return StreamingResponse(sse(), media_type="text/event-stream")
