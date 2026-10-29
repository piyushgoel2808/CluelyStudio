# 07. Developer Guide & Troubleshooting

## Overview

This guide provides instructions for setting up, building, running, and debugging Cluely Studio on macOS and Windows.

---

## 1. Prerequisites

- **macOS**: macOS 13+ (Ventura, Sonoma, Sequoia) on Apple Silicon (M1/M2/M3/M4 recommended) or Intel / Windows 10+ (64-bit).
- **Node.js**: v20.0.0 or higher.
- **Local Model Engine**: [Ollama](https://ollama.ai) installed and running locally.

---

## 2. Environment Setup

### 1. Install Dependencies
```bash
cd CluelyStudio
npm install
```

### 2. Pull Recommended Local Models
Ensure Ollama is running (`ollama serve`), then pull the primary chat and embedding models:
```bash
# Primary multimodal chat & interview model (~140ms latency)
ollama pull gemma4:e4b

# Embedding model for file RAG and semantic vector indexing
ollama pull gemma2:2b

# Optional deep reasoning 12B model
ollama pull gemma4:12b
```

---

## 3. Building & Running

### Development Mode (Port 5188)
Runs Vite dev server on dedicated port `5188` and boots Electron simultaneously:
```bash
npm run dev
```

### Compiling Electron Main Process
Compiles `electron/main.ts` and `electron/preload.ts` to `dist-electron/main.cjs` and `preload.cjs` as strict CommonJS:
```bash
npm run build:electron
```

### TypeScript Validation
Checks for type errors across both renderer and main processes:
```bash
npm run typecheck
```

### Full Production Build
Compiles both the Electron main bundle and the Vite React renderer into `dist/`:
```bash
npm run build
```

---

## 4. macOS Permissions & Privacy Settings

For full functionality, macOS requires granting system permissions:
1. **Microphone**: Required for user voice capture (`Me`). Enable under *System Settings ➔ Privacy & Security ➔ Microphone*.
2. **Screen Recording**: Required for `desktopCapturer` visual screen context and slide analysis. Enable under *System Settings ➔ Privacy & Security ➔ Screen Recording*.
3. **Accessibility**: Required for global shortcut registration (`globalShortcut`) when other apps have focus.

---

## 5. Troubleshooting Runbook

### Error: `Port 5173 is already in use`
- **Cause**: Another Vite application is running on port 5173.
- **Solution**: CluelyStudio uses dedicated port **`5188`** by default in `package.json` and `vite.config.ts`. If port 5188 is ever occupied, run:
  ```bash
  lsof -ti :5188 | xargs kill -9
  ```

### Error: `SyntaxError: Cannot use import statement outside a module`
- **Cause**: An ES module file was loaded in a CommonJS context.
- **Solution**: Run `npm run build:electron`. This generates strict CommonJS bundles (`dist-electron/main.cjs` and `dist-electron/preload.cjs`).

### Model Latency or Blank Responses with Ollama
- **Cause**: Model was running default thinking buffers or had unloaded from unified GPU memory.
- **Solution**: CluelyStudio automatically pre-warms `gemma4:e4b` on startup with `keep_alive: -1` and sends `think: false` with `num_predict: 280`. Ensure Ollama is running and accessible at `http://127.0.0.1:11434`.
