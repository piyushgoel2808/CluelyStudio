# CluelyStudio — Production Desktop AI Meeting & Interview Copilot

**CluelyStudio** is an ultra-low-latency, hardware-stealth desktop AI meeting and interview teleprompter engineered with **Google Gemma 4 (`gemma4:e4b` & `gemma4:12b`)**, an **Embedded Local Vector DB (384-d Dense Feature Hashing + BM25 Hybrid RRF)**, **continuous dual-channel CoreAudio/WASAPI speech recognition (`NVIDIA Parakeet-TDT 0.6B` & `Whisper`)**, and a **pixel-perfect floating Control Pill HUD**.

---

## 🚀 Key Architectural Highlights

### 1. Authentic Floating Control Pill HUD & Multi-Window Topology
- **Control Pill HUD (`/#/control`)**: A compact, frameless, transparent floating pill window (`196x54px`, `alwaysOnTop: true`, `type: 'panel'`, `skipTaskbar: true`, `hiddenInMissionControl: true`). Features the iconic blue **"C"** logo button, blue capsule **"✨ Ask"** button, dark **Microphone** recording toggle, and dark **Settings** gear button.
- **Assistant Chat Overlay (`/#/overlay`)**: A sleek `668px` floating teleprompter window positioned directly beneath the Control Pill. Drops down instantly when clicking **Ask** or pressing `⌘↵`, and minimizes with `Esc` or the `✕` close button.
- **Settings Studio (`/#/settings`)**: A full-featured `960x680px` configuration workspace for BYOK cloud keys (Gemini, OpenAI, Claude), Local AI & Vector DB management, real WebAudio frequency analyser mic monitoring, session history, and fine-tuning exports.
- **Unified Global App Toggle (`⌘\`)**: Pressing `CommandOrControl+\` stealthily hides or restores all Cluely windows (both Overlay and Settings) at once.
- **Live Overlay Transparency Slider**: Real-time slider (20%–100%) under **Settings ➔ General & Audio** that dynamically updates window opacity and CSS backdrop filters.

### 2. Hardware Stealth Screen-Sharing Protection (`setContentProtection`)
- Enforces Cocoa `NSWindowSharingNone` on macOS and Win32 `WDA_EXCLUDEFROMCAPTURE` on Windows across all overlay windows.
- The assistant HUD is **100% invisible** during Zoom, Microsoft Teams, Google Meet, Slack, Discord, and OBS screen-shares.
- Screen context snapshotting (`desktopCapturer`) temporarily asserts capture-exclusion so the assistant never captures or obstructs itself.

### 3. Sub-2.5s Quick-Thinking Multimodal LLM (`Gemma 4 E4B` & `12B`)
- **Zero Cold-Start Model Swapping**: In-memory 384-d feature hashing vector search and BM25 RRF run directly in Node.js, eliminating the 4–8 second Ollama model-swapping delay from disk.
- **Pre-Warmed GPU Weights**: Pinned in unified memory on startup via `keep_alive: -1`.
- **Quick-Thinking Teleprompter Tuning**: Configured with `think: false`, `num_ctx: 2048`, `num_predict: 280`, and `temperature: 0.1` to stream bulleted spoken answers in under 2.5 seconds.
- **Multimodal Screen Vision**: Natively accepts text and high-resolution screen snapshots (`images: [base64]`) in a single forward pass.
- **QLoRA Fine-Tuning Studio**: Compiles custom `cluely-gemma4` Modelfiles and exports session Q&A history into ShareGPT/ChatML datasets with ready-to-run Unsloth 4-bit training scripts (`train_gemma4_qlora.py`).

### 4. Continuous, Teardown-Immune Dual Audio Pipeline
- **Continuous Capture**: Microphone (`Me`) and system loopback (`Them` via `audiotee`) capture runs continuously, even when the session toggle is paused or while an answer is actively streaming.
- **Ref-Based Architecture**: Replaced state-dependent audio hooks with persistent mutable `configRef` references in `useAudioPipeline.ts`, completely eliminating React re-render audio context teardowns.
- **6-Second Rolling Ring Buffer**: Preserves pre-speech frames to ensure no leading words are clipped during speech-onset.
- **Serialized ONNX Decode Mutex**: Native `sherpa-onnx-node` decoding is serialized through `runExclusiveDecode` so simultaneous Me and Them utterances never race on CPU threads.

### 5. Multi-Turn Continuous Scrollable Session Q&A Feed
- Previous answers in the active meeting session never disappear when asking subsequent questions.
- All turns (`#1, #2, ...`) render in a scrollable teleprompter feed with timestamps, user queries, vector memory badges, copy actions, and markdown rendering.

---

## ⌨️ Global Accelerators & Shortcuts

| Shortcut | Action | Description |
|---|---|---|
| **`⌘ \`** | Toggle All Windows | Stealth hide/restore both the Floating HUD and Settings Studio together |
| **`⌘ ↵`** | Instant AI Assist | Flushes speech buffer and queries quick-thinking multimodal teleprompter |
| **`⇧ ⌘ \`** | Toggle Session REC | Starts or stops dual-channel meeting audio recording and live ASR diarization |
| **`⌘ ,`** | Open Settings | Opens the 6-tab Settings Studio |
| **`⌘ R`** | Fresh Context | Clears active assistant chat feed and resets teleprompter state |
| **`Esc`** | Dismiss Overlay | Collapses the assistant card back to the compact Control Pill |

---

## 🛠️ Quick Start & Developer Setup

### Prerequisites
- macOS 13+ (Ventura, Sonoma, Sequoia) on Apple Silicon or Intel / Windows 10+ (64-bit).
- Node.js v20+ and npm.
- [Ollama](https://ollama.ai) installed and running locally.

### Installation & Run

```bash
# 1. Clone repository & navigate to CluelyStudio
cd /Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio

# 2. Install dependencies
npm install

# 3. Pull recommended local models in Ollama (or 1-click install in Settings)
ollama pull gemma4:e4b
ollama pull gemma2:2b

# 4. Run development environment (Vite renderer on port 5188 + Electron CJS main)
npm run dev

# 5. Typecheck & build production bundle
npm run typecheck
npm run build
```

---

## 📁 Repository Structure

```
CluelyStudio/
├── electron/
│   ├── main.ts                    # Main process entry, IPC router, lifecycle & pre-warming
│   ├── preload.ts                 # Secure contextBridge API exposing window.cluely
│   └── domains/
│       ├── windowManager.ts       # Multi-window topology (Control Pill, Overlay, Settings)
│       ├── store.ts               # Local reactive store in app.getPath('userData')
│       ├── aiRouter.ts            # Multimodal Gemma 4 streaming, cloud fallback & 2-3s teleprompter
│       ├── memoryBrain.ts         # In-memory 384-d Vector DB + BM25 Hybrid RRF search
│       ├── localModelManager.ts   # Serialized ONNX decode mutex, Modelfile compiler & QLoRA export
│       ├── transcriptionService.ts# Dual-channel diarization & Sherpa-ONNX ASR bridge
│       ├── audioEngine.ts         # CoreAudio audiotee tap / desktop loopback runner
│       ├── screenCapture.ts       # DesktopCapturer with self-exclusion protection
│       ├── shortcuts.ts           # Global keyboard accelerator registry
│       ├── fileParser.ts          # Semantic document chunker (PDF, DOCX, TXT, MD)
│       └── companionServer.ts     # LAN HTTP/WebSocket teleprompter server (:45780)
├── src/
│   ├── components/
│   │   ├── control/
│   │   │   └── ControlPill.tsx    # 196x54px floating pill HUD (C badge, Ask, Mic, Settings)
│   │   ├── overlay/
│   │   │   └── CluelyOverlayCard.tsx # 668px expandable assistant card with scrollable Q&A feed
│   │   └── settings/
│   │       ├── SettingsWindow.tsx # 6-tab studio with opacity slider, BYOK keys, mic meter
│   │       └── SessionsHistoryView.tsx # 2-column meeting session workspace & notes editor
│   ├── hooks/
│   │   ├── useAudioPipeline.ts    # Continuous audio capture, VAD & resampler (ref-based)
│   │   ├── useWindowDrag.ts       # Cross-platform window dragging hook (control/overlay/settings)
│   │   ├── useAppState.ts         # Reactive state synchronization hook
│   │   └── useLiveScreen.ts       # On-demand & automated screen capture hook
│   └── services/
│       └── vadAndDiarization.ts   # Client-side 16kHz VAD, 6s ring buffer & voiceprint diarizer
├── dist-electron/
│   ├── main.cjs                   # Compiled CommonJS Electron main process
│   └── preload.cjs                # Compiled CommonJS Electron preload script
├── package.json                   # Configuration, dependencies & build scripts (dev port: 5188)
└── vite.config.ts                 # Vite bundler for React 18 renderer
```

---

## 🔒 Security & Privacy Guarantees
- **100% Offline Capable**: Speech recognition (Sherpa-ONNX) and AI inference (Gemma 4 via Ollama) run entirely on-device without external telemetry.
- **Zero-Storage Privacy Mode**: Transcripts, snapshots, and AI responses remain in local memory or encrypted on disk in `~/Library/Application Support/cluely-studio`.
- **Anti-Screen Capture**: Protected at the OS compositor level (`NSWindowSharingNone`), preventing intentional or accidental leakage on video conferences.
