## Setup

> pip install torch torchvision torchaudio

> pip install -U transformers accelerate sentencepiece tokenizers

Verify by runnnig this:

> python -c "from transformers import AutoTokenizer; print('Transformers installed ✅')"

If a "Transformers installed ✅" is output, then you're good to go.

Once everything is setup, you can run

> python run_qwen.py

The first time running it will install a few things and take a minute.

For the server-version run the following (you must activate some Python stuff before running the server)

> source .venv/bin/activate
> uvicorn server:app --host 0.0.0.0 --port 8000 --reload

## Troubleshooting

### Resetting the .venv

Delete the broken venv

> rm -rf .venv

Recreate it

> python3 -m venv .venv

Activate it

> source .venv/bin/activate

Reinstall dependencies

> pip install -r requirements.txt
