# state/conversations.py
from __future__ import annotations
from typing import Dict, List
import uuid

# conversation_id -> list[{"role": "user"|"assistant"|"system", "content": "..."}]
_CONV: Dict[str, List[dict]] = {}

def new_conversation(system_message: str | None = None) -> str:
    cid = str(uuid.uuid4())
    _CONV[cid] = []
    if system_message:
        _CONV[cid].append({"role": "system", "content": system_message})
    return cid

def get_messages(conversation_id: str) -> List[dict]:
    return _CONV.get(conversation_id, [])

def append(conversation_id: str, role: str, content: str, max_turns: int = 8) -> None:
    msgs = _CONV.setdefault(conversation_id, [])
    msgs.append({"role": role, "content": content})
    # Keep system + last N user/assistant turns (2 messages per turn)
    sys = [m for m in msgs if m["role"] == "system"]
    ua = [m for m in msgs if m["role"] in ("user", "assistant")]
    trimmed = sys[:1] + ua[-max_turns*2:]
    _CONV[conversation_id] = trimmed

def reset(conversation_id: str, keep_system: bool = True) -> None:
    msgs = _CONV.get(conversation_id, [])
    if keep_system:
        sys = [m for m in msgs if m["role"] == "system"][:1]
        _CONV[conversation_id] = sys
    else:
        _CONV[conversation_id] = []
