# 01. System Architecture

## Overview

Cluely Studio is architected as an ultra-low-latency, multi-surface desktop application built on **Electron 32**, **TypeScript**, **React 18**, and **Tailwind CSS**. It bridges low-level macOS system APIs (CoreAudio, ScreenCaptureKit) with local on-device machine learning models (Sherpa-ONNX, Ollama) and cloud inference endpoints.

---

## 1. Process Model

```mermaid
graph TB
    subgraph MainProcess["Electron Main Process (Node.js runtime)"]
        MainEntry["electron/main.ts"]
        WindowManager["windowManager.ts"]
        Store["store.ts (Persistent State)"]
        AudioTrans["transcriptionService.ts"]
        LocalModels["localModelManager.ts"]
        ScreenCap["screenCapture.ts"]
        AIRouter["aiRouter.ts"]
        MemoryBrain["memoryBrain.ts"]
        CompanionServer["companionServer.ts (HTTP/WebSocket :45780)"]
    end

    subgraph RendererProcess["Electron Renderer Process (Chromium)"]
        AppRoot["src/App.tsx"]
        AudioPipeline["useAudioPipeline.ts"]
        LiveScreen["useLiveScreen.ts"]
        OverlayCard["CluelyOverlayCard.tsx"]
        Drawer["OverlayDrawer.tsx"]
        SettingsWin["SettingsWindow.tsx"]
        SessionsView["SessionsHistoryView.tsx"]
    end

    subgraph ExternalServices["External Endpoints & Devices"]
        OllamaLocal["Ollama (http://127.0.0.1:11434)"]
        SherpaEngine["Local Sherpa-ONNX Runtime"]
        AudioTee["audiotee Daemon (System Audio Loopback)"]
        SecondaryDevice["Companion Client (Mobile Browser)"]
    end

    MainEntry --> WindowManager
    MainEntry --> Store
    MainEntry --> AudioTrans
    AudioTrans --> LocalModels
    LocalModels --> SherpaEngine
    MainEntry --> AIRouter
    AIRouter --> OllamaLocal
    MainEntry --> CompanionServer
    CompanionServer <--> SecondaryDevice

    AppRoot <-->|Electron IPC (preload.ts)| MainEntry
    AudioPipeline <-->|PCM Streams| AudioTee
```

---

## 2. Window Management & Stealth Overlay

The application manages multiple specialized Electron browser windows via [`windowManager.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/windowManager.ts):

1. **Floating Stealth Overlay Window (`overlay`)**:
   - **Properties**: `alwaysOnTop: true`, `transparent: true`, `frame: false`, `skipTaskbar: true`, `hasShadow: false`.
   - **Stealth Protection**: Set to exclude from screen captures using macOS native APIs (`setContentProtection(true)`) so the window does not appear in screen recordings or Zoom/Teams screen shares.
   - **Interactivity**: Dynamically toggles mouse event pass-through (`setIgnoreMouseEvents`) when the user hovers or moves the card.
2. **Settings & History Window (`settings`)**:
   - Standard framed window used for configuring API keys, audio devices, copilot modes, and reviewing previous meeting sessions and timelines.
3. **Companion Server (`companionServer.ts`)**:
   - An embedded HTTP & WebSocket server operating on port `45780`.
   - Allows users to open a web browser on their smartphone or tablet connected to the same Wi-Fi network and view real-time teleprompter responses with zero visibility on the main computer screen.

---

## 3. Persistent State Management (`store.ts`)

The persistent state is maintained through a unified `Store` singleton in [`store.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/store.ts).

### Storage Location
- **macOS**: `~/Library/Application Support/cluely-studio/cluely-studio-state.json`

### Core State Schema
- `isSessionActive`: Boolean indicating if recording and transcription are actively running.
- `activeModeId`: Active copilot mode (`gen-ai`, `interview`, `system-design`, etc.).
- `modes`: Array of customizable modes with prompt templates and attached knowledge files.
- `transcripts`: In-memory buffer of the latest 500 finalized speech transcript segments.
- `pastSessions`: Chronological archive of meeting sessions with full transcripts, durations, and AI assist events.
- `aiConfig`: Selected providers, active models, API keys, and latency profiles.
- `personalMemories`: User bio, project facts, and preferences used for contextual grounding.

---

## 4. Canonical IPC Data Contracts

The interface boundary between Electron Main and Renderer is defined in [`src/types/ipc.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/src/types/ipc.ts):

| IPC Channel | Direction | Payload | Description |
|---|---|---|---|
| `ai:ask-stream` | Renderer -> Main | `AIStreamRequest` | Initiates real-time multimodal streaming response. |
| `ai:cancel-stream` | Renderer -> Main | `requestId: string` | Aborts an in-flight LLM stream immediately. |
| `ai:stream-chunk` | Main -> Renderer | `AIStreamChunk` | Delivers streaming deltas, active model, and memory tags. |
| `audio:transcript-segment`| Main -> Renderer | `TranscriptSegment`| Emits real-time speech segments (partial & finalized). |
| `audio:system-pcm-chunk` | Main -> Renderer | `{ pcmBase64: string }`| Streams raw system loopback audio frames from audiotee. |
| `state:patch` | Renderer -> Main | `Partial<AppState>` | Atomically updates store fields and synchronizes across all windows. |
| `modes:attach-files` | Renderer -> Main | `{ modeId, files }` | Ingests and extracts text from attached PDF/TXT/MD files. |
