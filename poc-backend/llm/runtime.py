# llm/runtime.py
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer
from typing import List, Dict, Generator
import threading

DEFAULT_MODEL = "Qwen/Qwen2.5-7B-Instruct"  # if OOM on M2, try "Qwen/Qwen2.5-3B-Instruct"

class ModelManager:
    def __init__(self, model_id: str = DEFAULT_MODEL, system_prompt: str | None = None):
        self.model_id = model_id
        self.system_prompt = system_prompt or (
            "You are an assistant in the realm of Enterprise Architecture Management (EAM). You will be speaking with an enterprise architect (EA). Support them within this realm to the best of your ability. If the EA wants to discuss things unrelated to enterprise architecture management, then please tell him that you can only stay on topic. Be concise and ground claims in the provided context when available. Please use correct Markdown syntax for an answer."
        )
        self.tok = AutoTokenizer.from_pretrained(self.model_id, use_fast=True)

        # Dtype + device for Apple M2 (MPS)
        if torch.backends.mps.is_available() and not torch.cuda.is_available():
            dtype = torch.float16
            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_id, torch_dtype=dtype
            )
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
            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_id, torch_dtype=dtype
            )
            self.device = torch.device("cpu")

    def apply_template(self, messages: List[Dict]) -> str:
        # Ensure a system message exists
        has_system = len(messages) > 0 and messages[0].get("role") == "system"
        if not has_system:
            messages = [{"role": "system", "content": self.system_prompt}] + messages
        return self.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

    def generate(
        self,
        messages: List[Dict],
        max_new_tokens: int = 512,
        temperature: float = 0.2,
        top_p: float = 0.9,
    ) -> str:
        prompt = self.apply_template(messages)
        inputs = self.tok(prompt, return_tensors="pt").to(self.device)
        with torch.no_grad():
            out = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                top_p=top_p,
            )
        return self.tok.decode(out[0], skip_special_tokens=True)

    def stream_generate(
        self,
        messages: List[Dict],
        max_new_tokens: int = 512,
        temperature: float = 0.2,
        top_p: float = 0.9,
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
