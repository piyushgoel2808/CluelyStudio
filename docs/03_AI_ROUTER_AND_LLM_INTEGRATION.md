# 03. AI Router & LLM Integration

## Overview

The AI Router ([`aiRouter.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/aiRouter.ts)) is the central orchestration engine responsible for processing live meeting context, grounding prompts in user modes and memories, and streaming instantaneous responses back to the stealth overlay and companion devices.

---

## 1. Multi-Provider Architecture

The router seamlessly switches between local on-device models and high-throughput cloud endpoints:

| Provider | Supported Models | Primary Use Case | Streaming Protocol |
|---|---|---|---|
| **Local Ollama** (Default) | `gemma4:e4b`, `gemma4:12b`, `nemotron-mini`, `qwen3-vl` | 100% offline, zero data leakage, sub-250ms teleprompting | HTTP POST NDJSON |
| **Google Gemini** | `gemini-2.5-flash`, `gemini-1.5-pro` | Cloud multimodal analysis and ultra-long context | SSE (`v1beta/models/...:streamGenerateContent`) |
| **OpenAI** | `gpt-4o`, `gpt-4o-mini` | Production coding and technical deep-dives | SSE (`/v1/chat/completions`) |
| **Anthropic** | `claude-3-5-sonnet-20241022` | Complex software architecture and system design | Anthropic SSE messages API |
| **Groq** | `llama-3.3-70b-versatile` | High-speed cloud teleprompting (~300 tokens/sec) | OpenAI-compatible SSE |

---

## 2. 2–3 Second Quick-Thinking Teleprompter Tuning

To deliver live meeting answers that appear on the user's teleprompter in **2–3 seconds**, `aiRouter.ts` implements three critical optimizations:

### 1. In-Memory Vector Search (Zero Model Swapping)
- **Problem**: Calling Ollama's `/api/embed` (using `gemma2:2b` or `nomic-embed-text`) immediately before `/api/chat` (using `gemma4:e4b`) forced Ollama to constantly unload and reload multi-gigabyte models into unified memory on every turn, causing a 4–8 second freeze.
- **Solution**: Live Q&A ranking runs via [`memoryBrain.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/memoryBrain.ts)'s deterministic 384-dimensional feature hashing vectorizer + BM25 Reciprocal Rank Fusion (RRF). Retrieval executes in **<1 millisecond** in-process, without touching Ollama or unloading the active LLM.

### 2. Startup GPU Pre-Warming (`keep_alive: -1`)
- On application launch, `aiRouter.prewarmLocalModel()` sends a single-token warmup request with `keep_alive: -1`.
- The `gemma4:e4b` model weights remain pinned in Apple Silicon unified GPU memory, eliminating initial cold-start latency.

### 3. Quick-Thinking Teleprompter Parameters
```typescript
{
  model: targetModel,
  messages: formattedMessages,
  images: latestImageDataUrl ? [cleanBase64] : undefined,
  think: false,      // Disables reasoning monologue buffer
  stream: true,
  keep_alive: -1,    // Keeps model pinned in GPU memory
  options: {
    temperature: 0.1, // Locked-in deterministic precision
    top_p: 0.85,
    num_ctx: 2048,    // Tight context window for sub-100ms prefill
    num_predict: 280, // Concise spoken answer budget (~45 seconds of speech)
  }
}
```

---

## 3. Multimodal Screen Vision

When screen vision is enabled or `Solve Screen` is clicked:
- Screen capture is performed using `desktopCapturer.getSources({ types: ['screen'] })`.
- Bitmaps are scaled to max `1280x720` to prevent memory bottlenecks.
- `gemma4:e4b` and `gemma4:12b` natively process text and image inputs in a single forward pass, providing instant code solutions and slide analysis.

---

## 4. Single-Flight Concurrency & Stream Aborts

- `aiRouter` maintains an `activeStreams: Map<string, AbortController>()`.
- If a user triggers a new assist while a previous query is generating, the in-flight stream is aborted immediately (`ctrl.abort()`), preventing token interleaving and GPU thrashing.
