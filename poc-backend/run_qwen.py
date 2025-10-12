import sys, threading
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer

MODEL_ID = "Qwen/Qwen2.5-7B-Instruct"   # swap to "Qwen/Qwen2.5-3B-Instruct" if you need lighter
SYSTEM = "You are an Enterprise Architecture assistant. Be concise. Cite which context item you used when possible."

def get_device_map():
    if torch.cuda.is_available(): return "auto"
    if torch.backends.mps.is_available(): return {"": "mps"}
    return "cpu"

def load_model():
    tok = AutoTokenizer.from_pretrained(MODEL_ID, use_fast=True)
    dtype = torch.float16 if (torch.cuda.is_available() or torch.backends.mps.is_available()) else torch.float32
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        device_map=get_device_map(),
        torch_dtype=dtype
    )
    return tok, model

def trim_history(messages, max_turns=8):
    # Keep system + last N user/assistant turns
    sys_msg = messages[0:1]
    turns = messages[1:]
    # Each turn is 1 user + 1 assistant (ideally). Keep last max_turns*2 messages.
    return sys_msg + turns[-max_turns*2:]

def make_prompt(tok, messages):
    return tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

def generate_stream(tok, model, prompt, max_new_tokens=512, temperature=0.2, top_p=0.9):
    inputs = tok(prompt, return_tensors="pt").to(model.device)
    streamer = TextIteratorStreamer(tok, skip_prompt=True, skip_special_tokens=True)
    gen_kwargs = dict(
        **inputs,
        max_new_tokens=max_new_tokens,
        temperature=temperature,
        top_p=top_p,
        streamer=streamer
    )
    t = threading.Thread(target=model.generate, kwargs=gen_kwargs)
    t.start()
    for text in streamer:
        yield text
    t.join()

def main():
    print("Loading model…")
    tok, model = load_model()
    print("Ready. Type your message. Commands: /reset, /system, /exit\n")

    messages = [{"role": "system", "content": SYSTEM}]

    while True:
        try:
            user = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye!"); break

        if not user: 
            continue
        if user.lower() in {"/exit", ":q", "quit"}:
            print("Bye!"); break
        if user.startswith("/reset"):
            messages = [{"role": "system", "content": SYSTEM}]
            print("🔄 Conversation reset.\n"); continue
        if user.startswith("/system"):
            new_sys = user[len("/system"):].strip()
            if new_sys:
                messages[0] = {"role": "system", "content": new_sys}
                print("✅ System prompt updated.\n")
            else:
                print(f"Current system prompt:\n{messages[0]['content']}\n")
            continue

        # Add user message and trim context
        messages.append({"role": "user", "content": user})
        messages = trim_history(messages, max_turns=8)

        prompt = make_prompt(tok, messages)
        print("Assistant: ", end="", flush=True)

        reply_chunks = []
        try:
            for chunk in generate_stream(tok, model, prompt):
                reply_chunks.append(chunk)
                sys.stdout.write(chunk); sys.stdout.flush()
            print()  # newline
        except RuntimeError as e:
            print(f"\n⚠️ Generation error: {e}")
            continue

        # Save assistant reply in history
        messages.append({"role": "assistant", "content": "".join(reply_chunks)})

if __name__ == "__main__":
    main()
