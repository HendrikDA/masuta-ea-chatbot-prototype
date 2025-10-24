import torch, threading
from typing import List, Dict, Generator, Optional
from transformers import AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer
from neo4j import GraphDatabase
import json
from textwrap import shorten


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
            "Everything you answer should be in the realm of Enterprise Architecture. Be concise."
        )
        self.tok = AutoTokenizer.from_pretrained(self.model_id, use_fast=True)

        # RAG dependencies
        self.driver = driver
        self.embedder = embedder
        self.vector_index = vector_index

        # Device setup
        if torch.backends.mps.is_available() and not torch.cuda.is_available():
            # fp16 sampling on MPS can be numerically unstable; we'll avoid sampling by default.
            dtype = torch.float16
            self.model = AutoModelForCausalLM.from_pretrained(self.model_id, torch_dtype=dtype)
            self.model.to("mps")
            self.device = torch.device("mps")
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

        # Ensure eval mode and a valid pad token
        self.model.eval()
        if self.tok.pad_token_id is None and self.tok.eos_token_id is not None:
            self.tok.pad_token = self.tok.eos_token  # safe default for most chat LLMs

        # ---- RAG single-flight cache ----
        self._rag_lock = threading.Lock()
        self._rag_last_query: Optional[str] = None   # stores normalized cache key
        self._rag_last_result: Optional[str] = None



    # ---------- RAG ----------
    def retrieve_augmentation(self, query: str) -> str:
        """
        Perform retrieval-augmented generation (RAG):
        - Vector search via vector index
        - Fallback to keyword search
        Executes only once per unique (normalized) user query.
        """

        q_raw = (query or "").strip()
        if not q_raw:
            print("RAG: empty query -> skip.")
            return ""

        # Normalize for cache key (lowercase + collapse whitespace to single spaces)
        q_key = " ".join(q_raw.lower().split())

        # prevent re-entry / loop for identical (normalized) queries
        with self._rag_lock:
            if self._rag_last_query == q_key and self._rag_last_result is not None:
                print("RAG: returning cached result for identical query.")
                return self._rag_last_result

        print("Retrieving RAG context...")
        if not (self.driver and self.embedder and self.vector_index):
            print("RAG disabled: missing driver/embedder/vector_index")
            return ""

        # --- Build embedding
        qvec = self.embedder.encode([q_raw])[0].tolist()
        emb_len = len(qvec)
        print(f"Embedding created. dims={emb_len}  preview={qvec[:8]}...")

        # --- Inspect vector indexes
        try:
            with self.driver.session() as s:
                idx_rows = s.run(
                    """
                    SHOW INDEXES
                    YIELD name, type, entityType, state, labelsOrTypes, properties, options
                    WHERE type = 'VECTOR'
                    RETURN name, entityType, state, labelsOrTypes, properties, options
                    """
                ).data()
            print("Indexes found (VECTOR/FULLTEXT):")
            for r in idx_rows:
                print(f"  - name={r['name']} type={r['entityType']} state={r['state']}")
                print(f"    labelsOrTypes={r['labelsOrTypes']} props={r['properties']} options={r.get('options')}")
        except Exception as e:
            print(f"Index introspection failed: {e}")

        # --- Vector search query
        cypher_vec = """
        CALL db.index.vector.queryNodes($index, $k, $emb)
        YIELD node, score

        OPTIONAL MATCH (owner)-[:HAS_EMBEDDING]->(node)
        OPTIONAL MATCH (node)-[:HAS_EMBEDDING]->(owner2)
        WITH coalesce(owner, owner2, node) AS n, score

        WITH n, score,
             [f IN [n.context, n.text, n.name]
              WHERE f IS NOT NULL AND f <> ''] AS sfields
        WHERE size(sfields) > 0

        RETURN n {
                .id, .name,
                context: head(sfields),
                labels: labels(n)
            } AS n,
            score
        ORDER BY score DESC
        LIMIT $k
        """

        params = {"index": self.vector_index, "k": 5, "emb": qvec}

        print("\n--- Cypher (parameterized, vector) ---")
        print(cypher_vec.strip())
        print("\n--- Params ---")
        print(f"index={params['index']!r}, k={params['k']}, emb_len={emb_len}")
        print("emb_preview_first_16=", qvec[:16])

        # Execute vector query
        try:
            with self.driver.session() as s:
                rows = s.run(cypher_vec, **params).data()
        except Exception as e:
            print(f"Vector query failed: {e}")
            rows = []

        print(f"\nVector query returned {len(rows)} rows.")

        # ---------- Fallback: keyword search ----------
        if not rows:
            tokens = [t.strip(".,:;!?()[]\"'") for t in q_raw.lower().split()]
            #tokens = [t for t in tokens if len(t) >= 4]
            kw_list = list(dict.fromkeys(tokens))
            print(f"FALLBACK textual search for tokens: {kw_list}")

            cypher_kw = """
            MATCH (n)
            WITH n,
                 [f IN [n.context, n.text, n.name]
                  WHERE f IS NOT NULL AND f <> ''] AS sfields
            WHERE size(sfields) > 0
            WITH n, sfields,
                 reduce(m=0, kw IN $kw_list |
                     m + CASE WHEN any(f IN sfields WHERE toLower(f) CONTAINS kw)
                              THEN 1 ELSE 0 END
                 ) AS matches
            WHERE matches > 0
            RETURN n {
                    .id, .name,
                    context: head(sfields),
                    labels: labels(n)
                } AS n,
                toFloat(matches) AS score
            ORDER BY score DESC
            LIMIT 5
            """

            with self.driver.session() as s:
                rows = s.run(cypher_kw, kw_list=kw_list).data()

            print(f"Keyword fallback returned {len(rows)} rows.")

        if not rows:
            print("No RAG context found after vector + keyword fallback.")
            return ""

        # --- Format results
        parts = []
        for i, r in enumerate(rows, 1):
            n = r.get("n") or {}
            name = (n.get("name") or n.get("id") or f"Result {i}").strip()
            ctx = (n.get("context") or "").strip().replace("\n", " ")
            parts.append(f"[{i}] {name}: {ctx}")
        result = "\n".join(parts)

        # Cache result for identical (normalized) query reuse
        with self._rag_lock:
            self._rag_last_query = q_key
            self._rag_last_result = result

        return result


    # ---------- Template / Generation ----------
    def apply_template(self, messages: List[Dict]) -> str:
        if not messages or messages[0].get("role") != "system":
            messages = [{"role": "system", "content": self.system_prompt}] + messages
        return self.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)


    def generate(self, messages: List[Dict], max_new_tokens=512, temperature=0.2, top_p=0.9) -> str:
        prompt = self.apply_template(messages)
        inputs = self.tok(prompt, return_tensors="pt").to(self.device)

        # Guard: sampling can produce NaN/inf probs on fp16/MPS. Default to greedy unless explicitly safe.
        safe_sample = (
            (temperature is not None and temperature > 0.0)
            and (top_p is not None and 0.0 < top_p < 1.0)
            and (self.device.type != "mps")  # avoid sampling on MPS by default
        )

        gen_kwargs = dict(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=bool(safe_sample),
            temperature=(temperature if safe_sample else None),
            top_p=(top_p if safe_sample else None),
        )

        with torch.no_grad():
            out = self.model.generate(**{k: v for k, v in gen_kwargs.items() if v is not None})

        return self.tok.decode(out[0], skip_special_tokens=True)



    def stream_generate(
        self, messages: List[Dict], max_new_tokens=512, temperature=0.2, top_p=0.9
    ) -> Generator[str, None, None]:
        prompt = self.apply_template(messages)
        inputs = self.tok(prompt, return_tensors="pt").to(self.device)
        streamer = TextIteratorStreamer(self.tok, skip_prompt=True, skip_special_tokens=True)

        safe_sample = (
            (temperature is not None and temperature > 0.0)
            and (top_p is not None and 0.0 < top_p < 1.0)
            and (self.device.type != "mps")
        )

        kwargs = dict(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=bool(safe_sample),
            temperature=(temperature if safe_sample else None),
            top_p=(top_p if safe_sample else None),
            streamer=streamer,
        )

        # Drop None values so HF doesn't infer sampling from them
        kwargs = {k: v for k, v in kwargs.items() if v is not None}

        thread = threading.Thread(target=self.model.generate, kwargs=kwargs)
        thread.start()
        for chunk in streamer:
            yield chunk
        thread.join()
