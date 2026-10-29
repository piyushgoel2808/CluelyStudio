# 01. System Architecture

## Overview

Cluely Studio is architected as an ultra-low-latency, multi-surface desktop application built on **Electron**, **TypeScript**, **React 18**, and **Tailwind CSS**. It bridges low-level operating system APIs (CoreAudio loopback, ScreenCaptureKit, window sharing protection) with local on-device machine learning models (Sherpa-ONNX, Ollama Gemma 4) and cloud inference endpoints.

---

## 1. Process Model & Multi-Window Topology

```mermaid
graph TB
    subgraph MainProcess["Electron Main Process (Node.js CommonJS)"]
        MainEntry["electron/main.ts"]
        WindowManager["windowManager.ts (3-Window Coordinator)"]
        Store["store.ts (Persistent Reactive State)"]
        AudioTrans["transcriptionService.ts"]
        LocalModels["localModelManager.ts (ONNX Mutex Queue)"]
        ScreenCap["screenCapture.ts (Self-Excluded Snapshots)"]
        AIRouter["aiRouter.ts (2-3s Quick-Thinking Engine)"]
        MemoryBrain["memoryBrain.ts (In-Memory 384-d Vector DB + BM25)"]
        CompanionServer["companionServer.ts (HTTP/WebSocket :45780)"]
    end

    subgraph WindowTopology["Specialized BrowserWindow Instances"]
        ControlWin["Control Pill HUD Window (/#/control • 196x54px)"]
        OverlayWin["Assistant Chat Overlay Window (/#/overlay • 668px)"]
        SettingsWin["Settings Studio Window (/#/settings • 960x680px)"]
    end

    subgraph RendererProcess["React 18 Renderer (Vite :5188)"]
        AppRoot["src/App.tsx (Hash Router: control / overlay / settings)"]
        ControlPill["ControlPill.tsx (C Badge, Ask, Mic, Settings)"]
        OverlayCard["CluelyOverlayCard.tsx (Scrollable Multi-Turn Feed)"]
        SettingsView["SettingsWindow.tsx & SessionsHistoryView.tsx"]
        AudioPipeline["useAudioPipeline.ts (Continuous Ref-Based Capture)"]
    end

    subgraph ExternalEngines["Local AI & Hardware Tap"]
        OllamaLocal["Ollama (http://127.0.0.1:11434 • Gemma 4 e4b / 12b)"]
        SherpaEngine["Local Sherpa-ONNX Runtime (Parakeet-TDT 0.6B)"]
        AudioTee["CoreAudio audiotee Tap (Loopback 48kHz -> 16kHz)"]
        MobileDevice["LAN Mobile Companion (:45780)"]
    end

    MainEntry --> WindowManager
    WindowManager --> ControlWin
    WindowManager --> OverlayWin
    WindowManager --> SettingsWin
    MainEntry --> Store
    MainEntry --> AudioTrans
    AudioTrans --> LocalModels
    LocalModels --> SherpaEngine
    MainEntry --> AIRouter
    AIRouter --> MemoryBrain
    AIRouter --> OllamaLocal
    MainEntry --> CompanionServer
    CompanionServer <--> MobileDevice

    AppRoot <-->|Electron IPC (preload.cjs)| MainEntry
    AudioPipeline <-->|PCM Streams| AudioTee
```

---

## 2. Window Management & Specialized Roles

The application coordinates three specialized `BrowserWindow` instances via [`windowManager.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/windowManager.ts):

### 1. Control Pill HUD Window (`/#/control`)
- **Dimensions**: `196px x 54px`
- **Window Flags**: `frame: false`, `transparent: true`, `backgroundColor: '#00000000'`, `alwaysOnTop: true` (`level: 'screen-saver'`), `skipTaskbar: true`, `hiddenInMissionControl: true`, `type: 'panel'`.
- **UI & Interactivity**: Renders the authentic Cluely floating pill widget:
  - **Blue "C" Circular Badge**: Cluely branding, toggles assistant visibility.
  - **"✨ Ask" Capsule Button**: Drops down the assistant overlay directly beneath the pill and auto-focuses the input bar.
  - **Microphone Circle Button**: Starts/stops meeting session audio capture with live pulsing indicator.
  - **Settings Gear Button**: Opens the 6-tab Settings Studio.
- **Draggable**: Dragging the pill moves it across multi-monitor setups without intercepting button clicks via `useWindowDrag('control')`.

### 2. Assistant Chat Overlay Window (`/#/overlay`)
- **Dimensions**: `668px` fixed width with dynamic height (`60px` to `850px`).
- **Positioning**: Automatically centers and tracks beneath the Control Pill HUD.
- **Features**: Includes prompt bar, screen snapshot preview, quick action chips, and a continuous multi-turn scrollable Q&A feed (`#1, #2, ...`).
- **Dismissal**: Easily dismissed with `Esc` or the top-right `✕` button to return to the compact pill.

### 3. Settings Studio Window (`/#/settings`)
- **Dimensions**: `960px x 670px` (minWidth: 860, minHeight: 600).
- **Tabs**: General & Audio, Sessions & Notes, Local AI & Vector DB, Modes & File RAG, Memory Vault, Shortcuts & Mobile.
- **Controls**: Live Overlay Opacity Slider (20%–100%), real WebAudio frequency analyser microphone meter, BYOK cloud credentials, and QLoRA fine-tuning exporter.

---

## 3. Hardware Screen-Sharing Stealth Protection

Stealth protection is applied across all overlay windows:
```typescript
public applyContentProtection(isCapturing: boolean = this.isCapturingScreen): void {
  this.isCapturingScreen = isCapturing;
  const state = store.getState();
  const protect = Boolean(state.undetectability || this.isCapturingScreen);

  for (const win of [this.controlWindow, this.overlayWindow, this.settingsWindow]) {
    if (win && !win.isDestroyed()) {
      win.setContentProtection(protect);
    }
  }
}
```
- **macOS**: Sets `NSWindowSharingNone` on the underlying `NSWindow`. The window is completely invisible in screen-capture APIs (Zoom, Google Meet, Microsoft Teams, Slack, OBS, Discord).
- **Windows**: Invokes `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` (Windows 10 2004+).
- **Self-Exclusion**: During `screen:capture`, `isCapturingScreen = true` is temporarily asserted so the assistant never captures or blocks its own screenshots.

---

## 4. Global App Synchronization (`⌘\`)

Pressing `CommandOrControl+\`:
1. If either the Assistant Overlay or Settings Studio is visible, records `wasSettingsVisibleBeforeHide` and hides all windows immediately.
2. If all windows are hidden, restores the Overlay and reinstates the Settings Studio if it was open prior to hiding.

---

## 5. Development Port & CommonJS Architecture
- **Vite Dev Server**: Runs on port `5188` (`vite --port 5188 --strictPort`), preventing port collisions with default Vite apps (5173).
- **CommonJS Output**: `esbuild` compiles `electron/main.ts` and `preload.ts` to `dist-electron/main.cjs` and `preload.cjs` with `--platform=node --format=cjs`, eliminating ES module loader syntax errors.
