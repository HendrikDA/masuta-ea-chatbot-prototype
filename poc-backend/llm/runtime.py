# llm/runtime.py
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
        if not (self.driver and self.embedder and self.vector_index):
            print("RAG disabled: missing driver/embedder/vector_index")
            return ""

        # --- Build embedding
        qvec = self.embedder.encode([query])[0].tolist()
        emb_len = len(qvec)
        print(f"Embedding created. dims={emb_len}  preview={qvec[:8]}...")

        # --- Inspect vector indexes to catch name/label/property mismatches
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
            print("Vector indexes found:")
            for r in idx_rows:
                print(f"  - name={r['name']} entityType={r['entityType']} state={r['state']}")
                print(f"    labelsOrTypes={r['labelsOrTypes']} props={r['properties']} options={r.get('options')}")
        except Exception as e:
            print(f"Index introspection failed: {e}")

        # --- (Optional) quick dimension probe from any node behind the index label
        try:
            with self.driver.session() as s:
                dim_probe = s.run(
                    """
                    // Try to infer the embedding length from any indexed node (if property is 'embedding')
                    CALL db.indexes() YIELD name, entityType, labelsOrTypes, properties
                    WITH *
                    WHERE name = $index AND entityType = 'NODE'
                    WITH labelsOrTypes[0] AS L, properties[0] AS P
                    CALL {
                    WITH L, P
                    CALL db.labels() YIELD label
                    WITH label, L WHERE label = L
                    CALL {
                        WITH label, P
                        MATCH (n:`${dummy}`) RETURN 0 LIMIT 0
                    } RETURN 0 LIMIT 0
                    } RETURN 0
                    """,  # (no-op; left here to avoid raising if APOC/db.labels mismatch)
                    index=self.vector_index
                )
        except Exception:
            pass

        # --- Vector search: index -> embedding node -> owner node(s)
        cypher_vec = """
        CALL db.index.vector.queryNodes($index, $k, $emb)
        YIELD node, score

        // Try both directions to find the "owner" that carries human-readable text
        OPTIONAL MATCH (owner)-[:HAS_EMBEDDING]->(node)
        OPTIONAL MATCH (node)-[:HAS_EMBEDDING]->(owner2)

        WITH coalesce(owner, owner2, node) AS n, score

        // Keep nodes that have at least one textual field
        WITH n, score, [n.context, n.text, n.value, n.name] AS fields
        WHERE any(f IN fields WHERE f IS NOT NULL AND f <> '')

        RETURN n {
                .id, .name,
                context: coalesce(n.context, n.text, n.value, n.name),
                labels: labels(n)
            } AS n,
            score
        ORDER BY score DESC
        LIMIT $k
        """
        params = {"index": self.vector_index, "k": 5, "emb": qvec}

        # --- Log exact queries for Browser
        print("\n--- Cypher (parameterized, vector) ---")
        print(cypher_vec.strip())
        print("\n--- Params ---")
        print(f"index={params['index']!r}, k={params['k']}, emb_len={emb_len}")
        print("emb_preview_first_16=", qvec[:16])

        inline_vec = (
            "CALL db.index.vector.queryNodes("
            + json.dumps(self.vector_index) + ", "
            + str(params["k"]) + ", "
            + json.dumps(qvec)
            + ")\nYIELD node, score\n"
            "OPTIONAL MATCH (owner)-[:HAS_EMBEDDING]->(node)\n"
            "OPTIONAL MATCH (node)-[:HAS_EMBEDDING]->(owner2)\n"
            "WITH coalesce(owner, owner2, node) AS n, score\n"
            "WITH n, score, [n.context, n.text, n.value, n.name] AS fields\n"
            "WHERE any(f IN fields WHERE f IS NOT NULL AND f <> '')\n"
            "RETURN n { .id, .name, context: coalesce(n.context, n.text, n.value, n.name), labels: labels(n) } AS n, score\n"
            "ORDER BY score DESC\n"
            "LIMIT " + str(params["k"])
        )
        print("\n--- Cypher (INLINE, paste in Browser) ---")
        print(shorten(inline_vec, width=900, placeholder=" ... [truncated] ..."))

        # --- Execute vector search
        with self.driver.session() as s:
            rows = s.run(cypher_vec, **params).data()

        print(f"\nVector query returned {len(rows)} rows.")
        # ---------- Fallback: keyword search (in case index name/prop/dim is wrong) ----------
        if not rows:
            phrase = None
            qlow = query.lower()
            # simple phrase extraction: if "town planner" present, use it; else use longest word >= 4 chars
            if "town planner" in qlow:
                phrase = "town planner"
            else:
                tokens = [t.strip(".,:;!?()[]\"'") for t in qlow.split()]
                tokens = [t for t in tokens if len(t) >= 4]
                phrase = tokens[0] if tokens else qlow

            print(f"FALLBACK textual search for phrase: {phrase!r}")

            cypher_kw = """
            MATCH (n)
            WITH n, [n.context, n.text, n.value, n.name] AS fields
            WHERE any(f IN fields WHERE f IS NOT NULL AND toLower(f) CONTAINS $kw)
            RETURN n {
                    .id, .name,
                    context: coalesce(n.context, n.text, n.value, n.name),
                    labels: labels(n)
                } AS n,
                1.0 AS score
            LIMIT 5
            """
            print("\n--- Cypher (parameterized, keyword fallback) ---")
            print(cypher_kw.strip())
            print("--- Params ---")
            print({"kw": phrase})

            with self.driver.session() as s:
                rows = s.run(cypher_kw, kw=phrase).data()

            print(f"Keyword fallback returned {len(rows)} rows.")

        if not rows:
            print("No RAG context found after vector + keyword fallback.")
            print("Hints:")
            print("  - Confirm the vector index points to the correct label/property (e.g., :Embedding(embedding)).")
            print("  - Make sure HAS_EMBEDDING connects embedding nodes to owners (direction may vary).")
            print("  - Verify owner nodes have one of: context/text/value/name.")
            return ""

        # --- Format results
        parts = []
        for i, r in enumerate(rows, 1):
            n = r.get("n") or {}
            name = (n.get("name") or n.get("id") or f"Result {i}").strip()
            ctx = (n.get("context") or "").strip().replace("\n", " ")
            parts.append(f"[{i}] {name}: {ctx}")
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
