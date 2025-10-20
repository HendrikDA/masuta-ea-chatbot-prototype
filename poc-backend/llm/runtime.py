# llm/runtime.py
import torch, threading
from typing import List, Dict, Generator, Optional
from transformers import AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer
from neo4j import GraphDatabase

DEFAULT_MODEL = "Qwen/Qwen2.5-7B-Instruct"

class ModelManager:
    def __init__(
        self,
        model_id: str = DEFAULT_MODEL,
        system_prompt: Optional[str] = None,
        driver=None,
        embedder=None,
        vector_index: Optional[str] = None,
    ):
        self.model_id = model_id
        self.system_prompt = system_prompt or (
            "You are an assistant in the realm of Enterprise Architecture Management (EAM). "
            "Support the user using only the information given in [CONTEXT] when available."
        )
        self.tok = AutoTokenizer.from_pretrained(self.model_id, use_fast=True)

        # RAG dependencies
        self.driver = driver
        self.embedder = embedder
        self.vector_index = vector_index

        # Device setup
        if torch.backends.mps.is_available() and not torch.cuda.is_available():
            dtype = torch.float16
            self.model = AutoModelForCausalLM.from_pretrained(self.model_id, torch_dtype=dtype)
            self.model.to("mps"); self.device = torch.device("mps")
        elif torch.cuda.is_available():
            dtype = torch.float16
            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_id, device_map="auto", torch_dtype=dtype
            )
            self.device = self.model.device
        else:
            dtype = torch.float32
            self.model = AutoModelForCausalLM.from_pretrained(self.model_id, torch_dtype=dtype)
            self.device = torch.device("cpu")

    # ---------- RAG ----------
    def retrieve_augmentation(self, query: str) -> str:
        print("Retrieving RAG context...")
        """Embed the query, perform vector search in Neo4j, and return text context."""
        if not (self.driver and self.embedder and self.vector_index):
            return ""  # RAG disabled

        qvec = self.embedder.encode([query])[0].tolist()
        with self.driver.session() as s:
            rows = s.run(
                """
                CALL db.index.vector.queryNodes($index, $k, $emb)
                YIELD node, score
                RETURN node {.id, .name, .description} AS n, score
                """,
                index=self.vector_index, k=5, emb=qvec,
            ).data()

        if not rows:
            print("No RAG context found.")
            return ""

        parts = []
        for i, r in enumerate(rows, 1):
            n = r.get("n") or {}
            name = n.get("name") or f"Node {i}"
            desc = (n.get("description") or "").strip().replace("\n", " ")
            parts.append(f"[{i}] {name}: {desc}")
        return "\n".join(parts)

    # ---------- Template / Generation ----------
    def apply_template(self, messages: List[Dict]) -> str:
        if not messages or messages[0].get("role") != "system":
            messages = [{"role": "system", "content": self.system_prompt}] + messages
        return self.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

    def generate(self, messages: List[Dict], max_new_tokens=512, temperature=0.2, top_p=0.9) -> str:
        prompt = self.apply_template(messages)
        inputs = self.tok(prompt, return_tensors="pt").to(self.device)
        with torch.no_grad():
            out = self.model.generate(
                **inputs, max_new_tokens=max_new_tokens, temperature=temperature, top_p=top_p
            )
        return self.tok.decode(out[0], skip_special_tokens=True)

    def stream_generate(
        self, messages: List[Dict], max_new_tokens=512, temperature=0.2, top_p=0.9
    ) -> Generator[str, None, None]:
        prompt = self.apply_template(messages)
        inputs = self.tok(prompt, return_tensors="pt").to(self.device)
        streamer = TextIteratorStreamer(self.tok, skip_prompt=True, skip_special_tokens=True)
        kwargs = dict(
            **inputs,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
            top_p=top_p,
            streamer=streamer,
        )
        thread = threading.Thread(target=self.model.generate, kwargs=kwargs)
        thread.start()
        for chunk in streamer:
            yield chunk
        thread.join()
