import * as http from 'http';
import * as os from 'os';
import { transcriptionService } from './transcriptionService';
import { aiRouter } from './aiRouter';
import { memoryBrain } from './memoryBrain';
import { store } from './store';
import { CompanionServerInfo } from '../../src/types/ipc';

export class CompanionServer {
  private server: http.Server | null = null;
  private port: number = 45780;
  private isRunning: boolean = false;
  private pairingPin: string = '';
  private sseClients: Set<http.ServerResponse> = new Set();

  constructor() {
    this.pairingPin = this.generatePin();
  }

  private generatePin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  public getLanIp(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const netList = interfaces[name];
      if (!netList) continue;
      for (const net of netList) {
        // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
    return '127.0.0.1';
  }

  public getInfo(): CompanionServerInfo {
    const lanIp = this.getLanIp();
    return {
      running: this.isRunning,
      port: this.port,
      lanIp,
      companionUrl: `http://${lanIp}:${this.port}/companion?pin=${this.pairingPin}`,
      pairingPin: this.pairingPin,
      connectedClients: this.sseClients.size,
    };
  }

  public async start(desiredPort: number = 45780): Promise<CompanionServerInfo> {
    if (this.isRunning && this.server) {
      return this.getInfo();
    }

    this.port = desiredPort;

    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[CompanionServer] Port ${this.port} in use, trying ${this.port + 1}...`);
          this.port += 1;
          server.listen(this.port, '0.0.0.0');
        } else {
          console.error('[CompanionServer] Startup error:', err);
          resolve(this.getInfo());
        }
      });

      server.listen(this.port, '0.0.0.0', () => {
        this.isRunning = true;
        this.server = server;
        console.log(`[CompanionServer] Running on http://${this.getLanIp()}:${this.port}/companion`);
        resolve(this.getInfo());
      });
    });
  }

  public stop(): void {
    if (this.server) {
      for (const client of this.sseClients) {
        try {
          client.end();
        } catch {}
      }
      this.sseClients.clear();
      this.server.close();
      this.server = null;
      this.isRunning = false;
    }
  }

  /**
   * Broadcast real-time events to connected iOS devices
   */
  public broadcastToClients(eventType: string, data: any): void {
    if (this.sseClients.size === 0) return;
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Pairing-Pin');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // 1. Serve iOS Companion PWA App
    if (pathname === '/companion' || pathname === '/') {
      const pinParam = url.searchParams.get('pin') || '';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.renderCompanionHtml(pinParam));
      return;
    }

    // 2. Info endpoint
    if (pathname === '/api/companion/info') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.getInfo()));
      return;
    }

    // 3. SSE Stream endpoint
    if (pathname === '/api/companion/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write('\n');

      this.sseClients.add(res);

      // Send initial welcome & state
      const state = store.getState();
      const initialPayload = {
        activeMode: state.modes.find((m) => m.id === state.activeModeId)?.name || 'General',
        isSessionActive: state.isSessionActive,
        meetingEnvironment: state.meetingEnvironment,
      };
      res.write(`event: init\ndata: ${JSON.stringify(initialPayload)}\n\n`);

      req.on('close', () => {
        this.sseClients.delete(res);
      });
      return;
    }

    // 4. Pocket Microphone Audio Chunk Upload
    if (pathname === '/api/companion/audio-chunk' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const json = JSON.parse(body);
          if (json.wavBase64) {
            await transcriptionService.transcribeSegment({
              wavBase64: json.wavBase64,
              role: 'them',
              speakerId: 'pocket_mic_ios',
              speakerLabel: json.speakerLabel || 'Table Mic (iOS)',
              durationMs: json.durationMs || 3000,
              speakerColor: '#38bdf8',
            });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err: unknown) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
      return;
    }

    // 5. Remote "Ask Cluely" trigger
    if (pathname === '/api/companion/ask' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const json = body ? JSON.parse(body) : {};
          const prompt = json.prompt || '';
          const reqId = `ios_${Date.now()}`;
          await aiRouter.streamPrompt({
            requestId: reqId,
            prompt,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, requestId: reqId }));
        } catch (err: unknown) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
      return;
    }

    // 6. Quick Memory Note trigger
    if (pathname === '/api/companion/memory' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const json = JSON.parse(body);
          if (!json.title || !json.content) {
            throw new Error('Title and content are required');
          }
          const memory = await memoryBrain.addMemory({
            title: json.title,
            content: json.content,
            category: json.category || 'meeting_fact',
            tags: ['ios-companion', ...(json.tags || [])],
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, memory }));
        } catch (err: unknown) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  /**
   * Self-contained, dark-mode, zero-dependency iOS Web App for iPhone
   */
  private renderCompanionHtml(pin: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Cluely">
  <meta name="theme-color" content="#0d0d0f">
  <title>Cluely Pocket Companion</title>
  <style>
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin: 0; padding: 0; }
    body {
      background: #0d0d0f;
      color: #f3f4f6;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
      user-select: none;
    }
    header {
      background: #141417;
      padding: 14px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .logo-badge {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .logo-icon {
      width: 28px;
      height: 28px;
      background: rgba(56,189,248,0.2);
      border: 1px solid rgba(56,189,248,0.4);
      color: #38bdf8;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 14px;
    }
    .title { font-weight: 600; font-size: 15px; }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 8px #22c55e;
    }
    main {
      flex: 1;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow-y: auto;
    }
    .card {
      background: #18181c;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 16px;
    }
    .card-title {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgba(255,255,255,0.5);
      margin-bottom: 10px;
      font-weight: 600;
    }
    /* Mic Control */
    .mic-button {
      width: 100%;
      padding: 18px;
      border-radius: 14px;
      border: none;
      background: #0091FF;
      color: white;
      font-size: 16px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(0,145,255,0.3);
      transition: all 0.2s;
    }
    .mic-button.recording {
      background: #ef4444;
      box-shadow: 0 4px 15px rgba(239,68,68,0.4);
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(1); }
      50% { transform: scale(0.98); }
      100% { transform: scale(1); }
    }
    /* AI Response Teleprompter */
    .teleprompter {
      background: rgba(0,0,0,0.4);
      border-radius: 12px;
      padding: 14px;
      min-height: 120px;
      font-size: 15px;
      line-height: 1.5;
      color: #e2e8f0;
      white-space: pre-wrap;
    }
    /* Transcripts List */
    .transcript-item {
      padding: 10px;
      border-radius: 10px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.05);
      margin-bottom: 8px;
      font-size: 13px;
    }
    .speaker-tag {
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      margin-bottom: 3px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .speaker-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    .action-row {
      display: grid;
      grid-cols: 2;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .action-btn {
      padding: 12px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.06);
      color: white;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo-badge">
      <div class="logo-icon">C</div>
      <div>
        <div class="title">Cluely iOS Companion</div>
        <div style="font-size: 10px; color: rgba(255,255,255,0.4);">Pocket Mic & Teleprompter</div>
      </div>
    </div>
    <div id="statusDot" class="status-dot"></div>
  </header>

  <main>
    <!-- Card 1: Pocket Table Microphone -->
    <div class="card">
      <div class="card-title">Pocket Microphone (Offline Meetings)</div>
      <button id="micBtn" class="mic-button" onclick="togglePocketMic()">
        <span id="micIcon">🎙️</span>
        <span id="micText">Start Pocket Table Mic</span>
      </button>
      <div id="micStatus" style="font-size: 11px; color: rgba(255,255,255,0.4); text-align: center; margin-top: 8px;">
        Tap to stream table audio to Mac for diarization
      </div>
    </div>

    <!-- Card 2: Remote Trigger Actions -->
    <div class="action-row">
      <button class="action-btn" onclick="triggerAskCluely()" style="border-color: rgba(56,189,248,0.3); background: rgba(56,189,248,0.1);">
        ✨ Ask Cluely (⌘↵)
      </button>
      <button class="action-btn" onclick="saveQuickMemory()" style="border-color: rgba(168,85,247,0.3); background: rgba(168,85,247,0.1);">
        🧠 Quick Fact Note
      </button>
    </div>

    <!-- Card 3: Real-Time AI Teleprompter -->
    <div class="card">
      <div class="card-title">Live AI Coaching Teleprompter</div>
      <div id="teleprompter" class="teleprompter">Listening to meeting... Answers and talking points will stream here.</div>
    </div>

    <!-- Card 4: 4-Track Live Transcript -->
    <div class="card">
      <div class="card-title">Live 4-Track Transcript Feed</div>
      <div id="transcriptFeed" style="max-height: 200px; overflow-y: auto;">
        <div style="font-size: 12px; color: rgba(255,255,255,0.3); text-align: center; padding: 12px;">
          No speech captured yet
        </div>
      </div>
    </div>
  </main>

  <script>
    let isRecording = false;
    let audioContext = null;
    let mediaStream = null;
    let processor = null;
    let audioChunks = [];
    const pin = "${pin}";

    // Connect SSE events stream
    const evtSource = new EventSource('/api/companion/events');
    evtSource.addEventListener('init', (e) => {
      document.getElementById('statusDot').style.background = '#22c55e';
    });
    evtSource.addEventListener('ai:stream-chunk', (e) => {
      const data = JSON.parse(e.data);
      const tele = document.getElementById('teleprompter');
      if (data.delta) {
        if (tele.innerText.includes('Listening to meeting...')) tele.innerText = '';
        tele.innerText += data.delta;
      }
    });
    evtSource.addEventListener('audio:transcript-segment', (e) => {
      const seg = JSON.parse(e.data);
      addTranscriptItem(seg);
    });

    function addTranscriptItem(seg) {
      const feed = document.getElementById('transcriptFeed');
      if (feed.innerText.includes('No speech captured yet')) feed.innerHTML = '';

      const item = document.createElement('div');
      item.className = 'transcript-item';
      const color = seg.speakerColor || '#38bdf8';
      item.innerHTML = \`
        <div class="speaker-tag" style="color: \${color};">
          <span class="speaker-dot" style="background: \${color};"></span>
          <span>\${seg.speakerLabel || 'Speaker'}</span>
        </div>
        <div>\${seg.text}</div>
      \`;
      feed.insertBefore(item, feed.firstChild);
    }

    async function togglePocketMic() {
      const btn = document.getElementById('micBtn');
      const text = document.getElementById('micText');
      const status = document.getElementById('micStatus');

      if (!isRecording) {
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
          const source = audioContext.createMediaStreamSource(mediaStream);
          processor = audioContext.createScriptProcessor(4096, 1, 1);

          audioChunks = [];
          processor.onaudioprocess = (e) => {
            if (!isRecording) return;
            const input = e.inputBuffer.getChannelData(0);
            const pcm = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) {
              const s = Math.max(-1, Math.min(1, input[i]));
              pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            audioChunks.push(pcm);
          };

          source.connect(processor);
          processor.connect(audioContext.destination);

          // Flush every 4 seconds to Mac
          window.micInterval = setInterval(flushAudioToMac, 4000);

          isRecording = true;
          btn.className = 'mic-button recording';
          text.innerText = 'Pocket Mic Active (Streaming)';
          status.innerText = 'iPhone microphone is capturing room audio...';
        } catch (err) {
          alert('Microphone access error: ' + err.message);
        }
      } else {
        isRecording = false;
        clearInterval(window.micInterval);
        if (processor) processor.disconnect();
        if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
        if (audioContext) audioContext.close();
        btn.className = 'mic-button';
        text.innerText = 'Start Pocket Table Mic';
        status.innerText = 'Microphone paused';
      }
    }

    async function flushAudioToMac() {
      if (audioChunks.length === 0) return;
      const totalLen = audioChunks.reduce((acc, c) => acc + c.length, 0);
      if (totalLen < 16000) return; // at least 1s

      const merged = new Int16Array(totalLen);
      let offset = 0;
      for (const c of audioChunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      audioChunks = [];

      const wavBase64 = encodeWavBase64(merged, 16000);
      fetch('/api/companion/audio-chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wavBase64, durationMs: Math.round((totalLen / 16000) * 1000) })
      }).catch(console.error);
    }

    function encodeWavBase64(pcmInt16, sampleRate) {
      const buffer = new ArrayBuffer(44 + pcmInt16.byteLength);
      const view = new DataView(buffer);
      const writeStr = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
      };
      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + pcmInt16.byteLength, true);
      writeStr(8, 'WAVEfmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, 'data');
      view.setUint32(40, pcmInt16.byteLength, true);
      new Uint8Array(buffer, 44).set(new Uint8Array(pcmInt16.buffer, pcmInt16.byteOffset, pcmInt16.byteLength));

      let bin = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.byteLength; i += 8192) {
        bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + 8192, bytes.byteLength))));
      }
      return btoa(bin);
    }

    function triggerAskCluely() {
      fetch('/api/companion/ask', { method: 'POST', body: JSON.stringify({}) });
      document.getElementById('teleprompter').innerText = 'Generating answer...';
    }

    function saveQuickMemory() {
      const text = prompt('Enter a quick fact or note to save in Memory:');
      if (text && text.trim()) {
        fetch('/api/companion/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Quick iPhone Note', content: text.trim() })
        }).then(() => alert('Saved to Memory Vault!'));
      }
    }
  </script>
</body>
</html>`;
  }
}

export const companionServer = new CompanionServer();
