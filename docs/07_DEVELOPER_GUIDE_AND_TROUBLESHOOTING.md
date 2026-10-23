# 07. Developer Guide & Troubleshooting

## Overview

This guide provides instructions for setting up, building, running, and debugging Cluely Studio on macOS.

---

## 1. Prerequisites

- **macOS**: macOS 13+ (Ventura, Sonoma, Sequoia) on Apple Silicon (M1/M2/M3/M4 recommended) or Intel.
- **Node.js**: v18.0.0 or higher (v20+ recommended).
- **Package Manager**: `npm` or `yarn`.
- **Local Model Engine**: [Ollama](https://ollama.ai) installed and running in the background.

---

## 2. Environment Setup

### 1. Install Dependencies
```bash
cd CluelyStudio
npm install
```

### 2. Pull Local Ollama Models
Ensure Ollama is running (`ollama serve`), then pull the required models:
```bash
# Recommended primary chat & interview model (~140ms latency)
ollama pull gemma4:e4b

# Lightweight fast fallback chat model (NVIDIA 4B)
ollama pull nemotron-mini

# Semantic memory embeddings
ollama pull all-minilm

# Optional multimodal screen vision model
ollama pull qwen3-vl
```

### 3. Verify Local Speech Models (Sherpa-ONNX)
Verify that the offline model weights exist in `CluelyStudio/resources/models/`:
- `sherpa-onnx-nemo-fast-conformer-tdt-en-24500/` (Parakeet-TDT 0.6B)
- `sherpa-onnx-whisper-small/` (Whisper Small multilingual)

---

## 3. Building & Running

### Development Mode (Hot-Reloading)
Runs Vite dev server on port `5173` and boots Electron simultaneously:
```bash
npm run dev
```

### Compiling Electron Main Process
Compiles `electron/main.ts` and `electron/preload.ts` to `dist-electron/`:
```bash
npm run build:electron
```

### TypeScript Validation
Checks for type errors across both renderer and main processes:
```bash
npx tsc --noEmit
```

### Production Distribution Package
Packages the app as a signed macOS DMG / App bundle:
```bash
npm run package:mac
```

---

## 4. macOS Permissions & Privacy Settings

For full functionality, macOS requires granting system permissions:
1. **Microphone**: Required for user voice capture (`Me`).
   - *System Settings > Privacy & Security > Microphone > Enable Cluely*.
2. **Screen Recording**: Required for live screen analysis and OCR.
   - *System Settings > Privacy & Security > Screen Recording > Enable Cluely*.
3. **Accessibility**: Required for global keyboard shortcuts (`Cmd+Enter`, `Cmd+,`).
   - *System Settings > Privacy & Security > Accessibility > Enable Cluely*.

---

## 5. Troubleshooting Runbooks

### 1. Ollama Model Giving No Output or Lagging
- **Cause**: Model running thinking process or token limit reached during reasoning.
- **Solution**:
  - Verify that `think: false` is configured in `streamOllama` in [`aiRouter.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/aiRouter.ts).
  - Test via curl:
    ```bash
    curl -s -X POST http://127.0.0.1:11434/api/chat -d '{"model":"gemma4:e4b","messages":[{"role":"user","content":"Say hi"}],"think":false,"stream":false}'
    ```

### 2. Screen Capture Crashing with SIGTRAP (`brk 0`)
- **Cause**: Trying to allocate uncompressed bitmaps of 4K/5K displays simultaneously.
- **Solution**: Ensure [`screenCapture.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/screenCapture.ts) scales captures to `1280x720` and uses JPEG compression.

### 3. Speech Recognition Failing on Hindi/English Technical Terms
- **Cause**: ASR mishearing technical terms due to accents or acoustics.
- **Solution**: The LLM prompt in [`aiRouter.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/aiRouter.ts) automatically repairs domain terms using Active Mode ground truth. Ensure the relevant mode (`gen-ai` or `interview`) is selected in the overlay dropdown.

### 4. Typed Prompt Lingering and Overriding Spoken Speech
- **Cause**: `inputValue` in the overlay card wasn't cleared upon submission.
- **Solution**: Fixed in `CluelyOverlayCard.tsx` and `App.tsx` by clearing input immediately upon submission, placing live speech dialogue at the top of the LLM prompt, and labeling session history as background reference only.
