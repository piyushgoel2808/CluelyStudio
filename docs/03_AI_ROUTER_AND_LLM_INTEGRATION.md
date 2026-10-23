# 03. AI Router & LLM Integration

## Overview

The AI Router ([`aiRouter.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/aiRouter.ts)) is the central orchestration engine responsible for processing live meeting context, grounding prompts in user modes and memories, and streaming instantaneous responses back to the stealth overlay and companion devices.

---

## 1. Multi-Provider Architecture

The router seamlessly switches between local on-device models and high-throughput cloud endpoints:

| Provider | Supported Models | Primary Use Case | Streaming Protocol |
|---|---|---|---|
| **Local Ollama** (Default) | `gemma4:e4b`, `nemotron-mini`, `qwen3-vl`, `llama3.1:8b`, `deepseek-r1:14b` | 100% offline, zero data leakage, sub-150ms teleprompting | HTTP POST NDJSON |
| **Google Gemini** | `gemini-2.5-flash`, `gemini-1.5-pro` | Cloud multimodal analysis and ultra-long context | SSE (`v1beta/models/...:streamGenerateContent`) |
| **OpenAI** | `gpt-4o`, `gpt-4o-mini` | Production coding and technical deep-dives | SSE (`/v1/chat/completions`) |
| **Anthropic** | `claude-3-5-sonnet-20241022` | Complex software architecture and system design | Anthropic SSE messages API |
| **Groq** | `llama-3.3-70b-versatile` | High-speed cloud teleprompting (~300 tokens/sec) | OpenAI-compatible SSE |

---

## 2. Local Ollama Deep-Dive & Gemma 4 Optimization

When operating offline, Cluely utilizes **Ollama** running locally on `http://127.0.0.1:11434`.

### The Gemma 4 e4b Latency Challenge
`gemma4:e4b` (Google Gemma 7.5B) is an exceptionally capable reasoning model, but by default Ollama runs its internal thinking engine (`json.message.thinking`), generating 300–500 tokens of inner monologue before emitting the first word of the answer. When combined with a token ceiling (`num_predict: 450`), the thinking buffer consumed the entire token allocation, resulting in blank responses and a stalled UI.

### The Optimization Solution
In [`aiRouter.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/aiRouter.ts#L607-L740):
1. **`think: false` Directive**: Passed directly at the top level of the Ollama request body to deactivate the thinking process.
2. **Chunk-Level Thinking Filter**: Chunks containing `json.message.thinking` are immediately bypassed so reasoning monologue is never transmitted as content chunks.
3. **Regex `<think>` Stripper**: Any residual `<think>...</think>` tags appearing in text streams are stripped in real time.
4. **Token Budgeting**:
   ```typescript
   options: {
     temperature: 0.15,
     top_p: 0.85,
     num_predict: 450, // Optimal token limit for 1.5-2 minutes of spoken answer
   }
   ```
   **Result**: Time-to-First-Token (TTFT) dropped from **21.6 seconds** down to **147 milliseconds**!

---

## 3. Voice Assist Synchronization & In-Flight ASR Drain

When the user triggers a voice assist (e.g., via `⌘ ↵` or Quick Assist actions with empty input):
1. **ASR Drain (`waitForPendingTranscriptions`)**: The router calls `await transcriptionService.waitForPendingTranscriptions(1500)` before reading transcripts. This ensures any in-flight Sherpa-ONNX Parakeet-TDT speech recognition process has completely written its tokens to `store.transcripts`.
2. **Deterministic Cursor Tracking**: The router inspects `lastConsumedTranscriptId`. Only segments that arrived after this ID (plus a 4-second safety overlap buffer) are sliced as the current unanswered question.
3. **Cursor Advancement**: On `triggerSource === 'voice'`, `lastConsumedTranscriptId` is immediately updated to the newest segment, guaranteeing subsequent turns do not repeat the same question. On `triggerSource === 'typed'`, the cursor is untouched so room speech remains pending.

---

## 4. Single-Flight Concurrency & Stream Aborts

During live meetings, participants often change topics rapidly or the user requests fresh answers before an earlier query finishes generating.
- `aiRouter` maintains an `activeStreams: Map<string, AbortController>()`.
- Whenever a new prompt request arrives, all existing in-flight streams are immediately aborted (`ctrl.abort()`) and cleared.
- This prevents memory collisions, GPU VRAM thrashing, and out-of-order chunk display.

---

## 5. Screen Vision & Memory Protection

Screen capture is handled by [`screenCapture.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/screenCapture.ts):
- **OOM Defense**: To prevent out-of-memory kernel traps (`SIGTRAP` / `brk 0`) when scanning 4K Retina displays, the capture pipeline:
  1. Restricts capture targets to `types: ['screen']`.
  2. Resizes bitmaps to max **1280x720**.
  3. Compresses frames to **JPEG (quality 80%)** before converting to base64.
- **Audio-Only Guard**: Screen capture is only invoked when the user has explicitly attached a screenshot or activated `isLiveScreenActive`. Normal audio assist prompts run purely against speech transcripts to maintain maximum speed.
