## Setup

> pip install torch torchvision torchaudio

> pip install -U transformers accelerate sentencepiece tokenizers

Verify by runnnig this:

> python -c "from transformers import AutoTokenizer; print('Transformers installed ✅')"

If a "Transformers installed ✅" is output, then you're good to go.

Once everything is setup, you can run

> python run_qwen.py

The first time running it will install a few things and take a minute.

#### Neo4j

If your neo4j database is newly setup, then you have to configure a few things in it first.

First, make sure that the following ciphers are run so that all nodes have a common Chunk:

```
MATCH (n:Application)    WHERE n.description IS NOT NULL SET n:Chunk;MATCH (n:Concept)        WHERE n.description IS NOT NULL SET n:Chunk;
MATCH (n:Discipline)     WHERE n.description IS NOT NULL SET n:Chunk;
MATCH (n:Issue)          WHERE n.description IS NOT NULL SET n:Chunk;
MATCH (n:Layer)          WHERE n.description IS NOT NULL SET n:Chunk;
MATCH (n:Objective)      WHERE n.description IS NOT NULL SET n:Chunk;
MATCH (n:Organization)   WHERE n.description IS NOT NULL SET n:Chunk;
MATCH (n:Process)        WHERE n.description IS NOT NULL SET n:Chunk;
MATCH (n:Role)           WHERE n.description IS NOT NULL SET n:Chunk;
```

Then, make sure that the embeddings of the graph database are set by running the populate_embeddings.py file:

> python llm/populate_embeddings.py

#### Ready to run the server

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
