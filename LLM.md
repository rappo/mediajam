# Mediajam LLM / RAG Architecture

## Overview

Mediajam uses a local Ollama instance for three features:
1. **Chat** — Natural language queries about the library (text-to-SQL + conversational)
2. **Discovery** — RAG-powered recommendations using semantic search over media overviews
3. **Tag & Summarize** — AI-generated tags for media items

## Infrastructure

| Component | Purpose |
|-----------|---------|
| Ollama | Local LLM host (chat + embeddings) |
| sqlite-vec (vec0) | Vector storage for embeddings |
| `overview_embeddings` | vec0 virtual table storing 768-dim vectors keyed by `media_parent_id` |
| `embedding_hashes` | Content hashes to skip already-embedded items |

## API Endpoints

### `POST /api/ask`

Unified chat endpoint. Classifies questions into `data`, `discovery`, or `chat` and routes accordingly.

**Request:**
```json
{
  "question": "recommend a dark classic movie",
  "history": [
    { "role": "user", "text": "hi" },
    { "role": "assistant", "text": "Hello! How can I help?" }
  ]
}
```

**Response types:**

| Type | Pipeline | Response includes |
|------|----------|-------------------|
| `data` | Question → SQL generation → execute → summarize | `sql`, `results`, `count`, `summary` |
| `discovery` | Question → embed → vec0 semantic search → enrich with tags/status → LLM recommendation | `summary`, `sources` |
| `chat` | Question → direct LLM response with library stats context | `summary` |

### `GET /api/ask/status`

Health check for LLM infrastructure.

**Response:**
```json
{
  "ollamaConnected": true,
  "chatModel": "llama3.2:latest",
  "embeddingModel": "nomic-embed-text:latest",
  "ragAvailable": true,
  "embeddingsTotal": 2129,
  "overviewsTotal": 2129,
  "embeddingsPct": 100
}
```

### `POST /api/embeddings/generate`

Generate embeddings for all media items with overviews. Streams progress via SSE.

**Request:** `{}` (empty body to start)

**SSE events:**
```
data: {"type":"progress","done":50,"total":2129,"title":"The Matrix"}
data: {"type":"complete","embedded":2129,"skipped":0}
```

### `POST /api/embeddings/stats`

Get current embedding coverage.

**Response:**
```json
{ "embedded": 2129, "total": 2129, "missing": 0 }
```

## RAG Pipeline (Discovery)

```
User question
  → embed(question) via Ollama nomic-embed-text
  → vec0 cosine similarity search (top 15, distance < 0.65)
  → Enrich candidates with:
      - media_tags (genre, mood, theme)
      - watch status (watched/unwatched children)
      - recent playback history (last 5 plays)
      - favorites status
  → Format as context block
  → LLM generates recommendation from context
  → Return summary + source cards
```

## Chat Pipeline (Data Queries)

```
User question
  → Classify: data / discovery / chat
  → If data:
      → Generate SQL from schema + question
      → Execute (read-only, max 50 rows)
      → LLM summarizes results
  → If chat:
      → LLM responds with library stats context
```

## Conversation History

The chat widget sends the last 10 conversation turns to `/api/ask`. History is included in:
- Classification (so follow-ups like "something similar" work)
- All response prompts (for conversational context)

## Configuration

Set via `PUT /api/settings`:

| Setting | Example |
|---------|---------|
| `ollama_url` | `http://192.168.1.100:11434` |
| `ollama_chat_model` | `llama3.2:latest` |
| `ollama_embed_model` | `nomic-embed-text:latest` |

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/server/ollama.js` | Ollama client (generate, embed, isEmbeddingAvailable) |
| `src/routes/api/ask/+server.js` | Chat endpoint (classify, RAG, text-to-SQL) |
| `src/routes/api/ask/status/+server.js` | Health check endpoint |
| `src/routes/api/embeddings/generate/+server.js` | Embedding generation with hash-based dedup |
| `src/lib/components/ChatWidget.svelte` | Chat UI (floating/docked, history, status panel) |
