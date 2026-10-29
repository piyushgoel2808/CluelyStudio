# 06. Settings, Sessions & Companion Web App

## Overview

Cluely Studio includes tools for reviewing past meetings, analyzing conversation timelines with embedded AI assist responses, adjusting live HUD transparency, and projecting teleprompter answers to external mobile devices.

---

## 1. Meeting Session Management & Continuous Q&A Feed

Sessions are continuously recorded and managed by [`store.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/store.ts):
- **Lifecycle**: Begins when `isSessionActive` is enabled (via UI or `⇧⌘\`).
- **Continuous Scrollable Q&A Feed**: Unlike ephemeral assistants that wipe past answers on every new query, `CluelyOverlayCard.tsx` preserves all meeting Q&A turns (`#1, #2, ...`) in a scrollable teleprompter feed with timestamps, user queries, vector memory badges, and formatted markdown.
- **Dynamic Titling & Notes**: When a session ends, `memoryBrain.generateSessionNotes()` synthesizes an executive summary, action items, and structured notes 100% locally.

---

## 2. Live Overlay Opacity Slider (Settings ➔ General & Audio)

Users can dial in their desired HUD transparency:
- **Range**: `20%` (ultra-stealth glass) to `100%` (fully solid opaque dark).
- **Default**: `92%`.
- **Mechanism**:
  ```typescript
  // Applied to Electron window:
  this.overlayWindow.setOpacity(Math.max(0.2, Math.min(1.0, opacity)));
  // Applied to CSS backdrop blur:
  style={{ opacity: overlayOpacity }}
  ```
- Persisted across restarts in `cluely-studio-state.json`.

---

## 3. Real WebAudio Microphone Frequency Analyser

Under **Settings ➔ General & Audio**:
- Replaced synthetic random meters with a real WebAudio `AnalyserNode` frequency spectrum meter.
- Displays live decibel RMS energy and 16-band audio equalizer bars, confirming microphone gain and background noise levels before meetings.

---

## 4. Gemma 4 Domain Adaptation & QLoRA Fine-Tuning Studio

Located under **Settings ➔ Local AI & Vector DB**:
- **1-Click Modelfile Compilation (`buildCustomGemmaModel`)**: Compiles and registers `cluely-gemma4:e4b` or `cluely-gemma4:12b` via Ollama `/api/create` with locked anti-hallucination system instructions.
- **QLoRA Fine-Tuning Kit Exporter (`exportFineTuneDataset`)**: Exports real session Q&A pairs into a ShareGPT/ChatML dataset (`cluely_gemma4_finetune.jsonl`) alongside a ready-to-run Unsloth 4-bit QLoRA script (`train_gemma4_qlora.py`) for custom adapter training.

---

## 5. LAN Companion Server (`companionServer.ts`)

Operating on port `45780`:
- Generates a local QR code in Settings.
- Allows secondary devices (smartphones, tablets) on the same Wi-Fi network to display live teleprompter streams with zero visibility on the main computer screen.
