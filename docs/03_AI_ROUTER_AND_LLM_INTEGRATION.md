# 03. AI Router & LLM Integration

## Overview

The AI Router ([`aiRouter.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/aiRouter.ts)) is the central orchestration engine responsible for processing live meeting context, grounding prompts in user modes and memories, and streaming instantaneous responses back to the stealth overlay and companion devices.

---

## 1. 100% Offline Local Architecture

All cloud models requiring external API keys (Google Gemini, OpenAI, Anthropic, Groq) have been completely removed. The AI Router operates **100% locally on-device** via Ollama on `http://127.0.0.1:11434`:

| Local Model | Size | Primary Use Case | Modality |
|---|---|---|---|
| **`gemma4:e4b`** (Default) | ~3.2 GB | Sub-250ms quick-thinking teleprompting, general Q&A | Text + Screen Snapshots |
| **`gemma4:12b`** | ~7.8 GB | Deep architectural reasoning, complex system design, live coding | Text + Screen Snapshots |
| **`nemotron-mini`** | ~2.7 GB | Ultra-compact low-latency fallback | Text |
| **`qwen3-vl`** | ~4.1 GB | Multimodal vision & visual OCR | Text + Vision |
| **`cluely-gemma4`** | Custom GGUF | Fine-tuned custom QLoRA adapter compiled in Settings | Text + Screen Snapshots |

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
