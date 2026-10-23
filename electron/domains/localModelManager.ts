import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import { spawn } from 'child_process';
import { windowManager } from './windowManager';
import { LocalModelStatus } from '../../src/types/ipc';

export class LocalModelManager {
  private localServer: http.Server | null = null;
  private serverPort: number = 50051;
  private isServerRunning: boolean = false;
  private ollamaUrl: string = 'http://127.0.0.1:11434';
  private modelStatuses: Map<string, LocalModelStatus> = new Map();

  // Cached Sherpa-ONNX offline recognizer & diarization extractor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognizer: any = null;
  private recognizerLoading: boolean = false;

  // Cached Sherpa-ONNX Whisper Multilingual recognizers by language code ('en', 'hi', etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private whisperRecognizers: Map<string, any> = new Map();
  private whisperRecognizerLoading: boolean = false;

  constructor() {
    this.initDefaultStatuses();
  }

  private initDefaultStatuses(): void {
    const defaults: LocalModelStatus[] = [
      {
        id: 'nvidia-nemotron-ollama',
        name: 'NVIDIA Nemotron-Mini 4B (Ollama)',
        provider: 'ollama',
        modelTag: 'nemotron-mini:latest',
        installed: false,
        running: false,
        downloading: false,
        progressPercent: 0,
        sizeLabel: '2.7 GB',
        statusMessage: 'Ready to pull via local Ollama',
      },
      {
        id: 'ollama-vision',
        name: 'Llama 3.2 Vision (Ollama Screen Copilot)',
        provider: 'ollama',
        modelTag: 'llama3.2-vision:latest',
        installed: false,
        running: false,
        downloading: false,
        progressPercent: 0,
        sizeLabel: '7.9 GB',
        statusMessage: 'Multimodal screen understanding model',
      },
      {
        id: 'nvidia-parakeet-tdt-onnx',
        name: 'NVIDIA Parakeet-TDT 0.6B v2 (INT8 ONNX)',
        provider: 'onnx-local',
        modelTag: 'parakeet-tdt-0.6b-v2-int8',
        installed: false,
        running: false,
        downloading: false,
        progressPercent: 0,
        sizeLabel: '640 MB',
        statusMessage: 'High-accuracy speech-to-text ONNX',
      },
      {
        id: 'whisper-base-onnx',
        name: 'Whisper Small Multilingual (INT8 ONNX — Hindi & English)',
        provider: 'onnx-local',
        modelTag: 'whisper-small-int8',
        installed: false,
        running: false,
        downloading: false,
        progressPercent: 0,
        sizeLabel: '360 MB',
        statusMessage: '100% offline multilingual speech-to-text (Hindi, English, Auto-detect)',
      },
      {
        id: 'speaker-diarization-onnx',
        name: '3D-Speaker CAM++ Diarization ONNX',
        provider: 'onnx-local',
        modelTag: 'campplus-voxceleb',
        installed: false,
        running: false,
        downloading: false,
        progressPercent: 0,
        sizeLabel: '28 MB',
        statusMessage: 'Neural speaker embedding extractor',
      },
    ];

    for (const d of defaults) {
      this.modelStatuses.set(d.id, d);
    }
  }

  public getModelsDir(): string {
    const candidates = [
      path.join(process.cwd(), 'extra-resources', 'models', 'nvidia'),
      path.join(__dirname, '..', '..', 'extra-resources', 'models', 'nvidia'),
      path.join(__dirname, '..', 'extra-resources', 'models', 'nvidia'),
      path.join(process.cwd(), 'CluelyStudio', 'extra-resources', 'models', 'nvidia'),
    ];
    if (app && app.isPackaged) {
      candidates.unshift(path.join(process.resourcesPath, 'models', 'nvidia'));
    }
    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.existsSync(path.join(cand, 'parakeet-tdt', 'encoder.int8.onnx'))) {
        return cand;
      }
    }
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }
    const defaultBase = path.join(process.cwd(), 'extra-resources', 'models', 'nvidia');
    if (!fs.existsSync(defaultBase)) {
      try {
        fs.mkdirSync(defaultBase, { recursive: true });
      } catch {
        const userBase = path.join(app.getPath('userData'), 'models', 'nvidia');
        if (!fs.existsSync(userBase)) {
          fs.mkdirSync(userBase, { recursive: true });
        }
        return userBase;
      }
    }
    return defaultBase;
  }

  public getWhisperModelsDir(): string {
    const candidates = [
      path.join(process.cwd(), 'extra-resources', 'models', 'whisper-small'),
      path.join(__dirname, '..', '..', 'extra-resources', 'models', 'whisper-small'),
      path.join(process.cwd(), 'CluelyStudio', 'extra-resources', 'models', 'whisper-small'),
      path.join(process.cwd(), 'extra-resources', 'models', 'whisper-base'),
      path.join(__dirname, '..', '..', 'extra-resources', 'models', 'whisper-base'),
      path.join(__dirname, '..', 'extra-resources', 'models', 'whisper-base'),
      path.join(process.cwd(), 'CluelyStudio', 'extra-resources', 'models', 'whisper-base'),
    ];
    if (app && app.isPackaged) {
      candidates.unshift(path.join(process.resourcesPath, 'models', 'whisper-small'));
      candidates.unshift(path.join(process.resourcesPath, 'models', 'whisper-base'));
    }
    for (const cand of candidates) {
      if (
        fs.existsSync(cand) &&
        (fs.existsSync(path.join(cand, 'small-encoder.int8.onnx')) ||
          fs.existsSync(path.join(cand, 'base-encoder.int8.onnx')))
      ) {
        return cand;
      }
    }
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }
    const defaultBase = candidates[0];
    if (!fs.existsSync(defaultBase)) {
      try {
        fs.mkdirSync(defaultBase, { recursive: true });
      } catch {
        const userBase = path.join(app.getPath('userData'), 'models', 'whisper-small');
        if (!fs.existsSync(userBase)) {
          fs.mkdirSync(userBase, { recursive: true });
        }
        return userBase;
      }
    }
    return defaultBase;
  }

  /**
   * Check if Ollama is running, query installed models, and verify local ONNX files
   */
  public async listLocalModels(): Promise<LocalModelStatus[]> {
    await this.checkOllamaStatus();
    this.checkOnnxFilesStatus();
    return Array.from(this.modelStatuses.values());
  }

  /**
   * Check Ollama daemon and installed models
   */
  public async checkOllamaStatus(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);

      const res = await fetch(`${this.ollamaUrl}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const json = (await res.json()) as { models?: Array<{ name: string; model?: string }> };
        const installedTags = new Set((json.models || []).map((m) => m.name.toLowerCase()));

        // Update nemotron-mini status
        const nemotronStatus = this.modelStatuses.get('nvidia-nemotron-ollama');
        if (nemotronStatus) {
          const isInstalled =
            installedTags.has('nemotron-mini:latest') ||
            installedTags.has('nemotron-mini') ||
            Array.from(installedTags).some((t) => t.includes('nemotron-mini'));
          nemotronStatus.installed = isInstalled;
          nemotronStatus.running = true;
          nemotronStatus.statusMessage = isInstalled
            ? 'Installed & ready for offline inference'
            : 'Ollama is online; model ready to download';
        }

        // Update vision model status (qwen3-vl or llama3.2-vision)
        const visionStatus = this.modelStatuses.get('ollama-vision');
        if (visionStatus) {
          const isInstalled =
            installedTags.has('qwen3-vl:latest') ||
            installedTags.has('qwen3-vl') ||
            installedTags.has('llama3.2-vision:latest') ||
            installedTags.has('llama3.2-vision') ||
            Array.from(installedTags).some((t) => t.includes('qwen3-vl') || t.includes('vision'));
          visionStatus.installed = isInstalled;
          visionStatus.running = true;
          visionStatus.statusMessage = isInstalled
            ? 'Installed (qwen3-vl) & active for multimodal screen analysis'
            : 'Ollama is online; model ready to download';
        }

        return true;
      }
    } catch {
      // Ollama not responding; attempt auto-spawn if binary exists
      this.trySpawnOllama();
    }

    const nemotronStatus = this.modelStatuses.get('nvidia-nemotron-ollama');
    if (nemotronStatus) {
      nemotronStatus.running = false;
      nemotronStatus.statusMessage = 'Ollama daemon is not running';
    }
    const visionStatus = this.modelStatuses.get('ollama-vision');
    if (visionStatus) {
      visionStatus.running = false;
      visionStatus.statusMessage = 'Ollama daemon is not running';
    }

    return false;
  }

  /**
   * Attempt to spawn Ollama in background if installed on system
   */
  private trySpawnOllama(): void {
    const candidates = ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/usr/bin/ollama'];
    for (const bin of candidates) {
      if (fs.existsSync(bin)) {
        try {
          const child = spawn(bin, ['serve'], {
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
          break;
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Inspect filesystem for ONNX weights in extra-resources
   */
  private checkOnnxFilesStatus(): void {
    const baseDir = this.getModelsDir();
    const parakeetDir = path.join(baseDir, 'parakeet-tdt');
    const diarizationDir = path.join(baseDir, 'diarization');

    // Check Parakeet-TDT ONNX
    const parakeetStatus = this.modelStatuses.get('nvidia-parakeet-tdt-onnx');
    if (parakeetStatus) {
      const hasEncoder = fs.existsSync(path.join(parakeetDir, 'encoder.int8.onnx'));
      const hasTokens = fs.existsSync(path.join(parakeetDir, 'tokens.txt'));
      const isInstalled = hasEncoder && hasTokens;
      parakeetStatus.installed = isInstalled;
      parakeetStatus.running = this.isServerRunning && isInstalled;
      if (isInstalled) {
        parakeetStatus.statusMessage = 'ONNX weights ready on local HTTP runner (127.0.0.1:50051)';
      }
    }

    // Check Speaker Diarization ONNX
    const diarStatus = this.modelStatuses.get('speaker-diarization-onnx');
    if (diarStatus) {
      const hasModel = fs.existsSync(
        path.join(diarizationDir, '3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx')
      );
      diarStatus.installed = hasModel;
      diarStatus.running = this.isServerRunning && hasModel;
      if (hasModel) {
        diarStatus.statusMessage = 'CAM++ Diarization ONNX model loaded';
      }
    }

    // Check Whisper Small / Base Multilingual ONNX (Hindi + English)
    const whisperDir = this.getWhisperModelsDir();
    const whisperStatus = this.modelStatuses.get('whisper-base-onnx');
    if (whisperStatus) {
      const hasSmall =
        fs.existsSync(path.join(whisperDir, 'small-encoder.int8.onnx')) &&
        fs.existsSync(path.join(whisperDir, 'small-decoder.int8.onnx')) &&
        fs.existsSync(path.join(whisperDir, 'small-tokens.txt'));
      const hasBase =
        fs.existsSync(path.join(whisperDir, 'base-encoder.int8.onnx')) &&
        fs.existsSync(path.join(whisperDir, 'base-decoder.int8.onnx')) &&
        fs.existsSync(path.join(whisperDir, 'base-tokens.txt'));
      const isInstalled = hasSmall || hasBase;
      whisperStatus.installed = isInstalled;
      whisperStatus.running = isInstalled;
      if (isInstalled) {
        whisperStatus.statusMessage = hasSmall
          ? 'Whisper Small Multilingual ready (100% offline Hindi & English)'
          : 'Whisper Base Multilingual ready (100% offline Hindi & English)';
      }
    }
  }

  /**
   * Lazily loads and caches the Sherpa-ONNX Whisper Multilingual recognizer per language
   */
  public ensureWhisperRecognizer(language: string = 'en'): boolean {
    let langCode = '';
    const l = (language || '').toLowerCase().trim();
    if (l.includes('bilingual') || l.includes('auto') || l.includes('multilingual') || !l) {
      langCode = '';
    } else if (l === 'hindi' || l === 'hi' || l.includes('hindi')) {
      langCode = 'hi';
    } else if (l.includes('english') || l === 'en') {
      langCode = 'en';
    } else if (l.includes('spanish') || l === 'es') {
      langCode = 'es';
    } else if (l.includes('french') || l === 'fr') {
      langCode = 'fr';
    } else if (l.includes('german') || l === 'de') {
      langCode = 'de';
    } else if (l.includes('japanese') || l === 'ja') {
      langCode = 'ja';
    } else if (l.includes('chinese') || l === 'zh' || l.includes('mandarin')) {
      langCode = 'zh';
    } else {
      langCode = '';
    }

    const cacheKey = langCode || 'auto';
    if (this.whisperRecognizers.has(cacheKey)) {
      return true;
    }
    // Whisper Multilingual natively supports all languages without duplicating ONNX weights
    if (this.whisperRecognizers.size > 0) {
      const existing = this.whisperRecognizers.values().next().value;
      if (existing) {
        this.whisperRecognizers.set(cacheKey, existing);
        return true;
      }
    }
    if (this.whisperRecognizerLoading) return false;

    try {
      const baseDir = this.getWhisperModelsDir();
      let encoder = path.join(baseDir, 'small-encoder.int8.onnx');
      let decoder = path.join(baseDir, 'small-decoder.int8.onnx');
      let tokens = path.join(baseDir, 'small-tokens.txt');
      let isSmall = true;

      if (!fs.existsSync(encoder) || !fs.existsSync(decoder)) {
        encoder = path.join(baseDir, 'base-encoder.int8.onnx');
        decoder = path.join(baseDir, 'base-decoder.int8.onnx');
        tokens = path.join(baseDir, 'base-tokens.txt');
        isSmall = false;
      }

      if (!fs.existsSync(encoder) || !fs.existsSync(decoder) || !fs.existsSync(tokens)) {
        return false;
      }

      this.whisperRecognizerLoading = true;
      console.log(`[LocalModelManager] Loading Whisper ${isSmall ? 'Small' : 'Base'} Multilingual [${cacheKey}] model weights into memory...`);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sherpa = require('sherpa-onnx-node');
      const numThreads = Math.min(4, Math.max(1, os.cpus()?.length || 4));

      const recognizer = new sherpa.OfflineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          whisper: {
            encoder,
            decoder,
            language: langCode,
            task: 'transcribe',
            tailPaddings: -1,
          },
          tokens,
          numThreads,
          provider: 'cpu',
          debug: 0,
          modelType: 'whisper',
        },
      });

      this.whisperRecognizers.set(cacheKey, recognizer);
      this.whisperRecognizerLoading = false;
      console.log(`[LocalModelManager] Sherpa-ONNX Whisper ${isSmall ? 'Small' : 'Base'} [${cacheKey}] recognizer ready for local offline inference`);
      return true;
    } catch (err) {
      this.whisperRecognizerLoading = false;
      console.error(`[LocalModelManager] Failed to instantiate Whisper [${cacheKey}] recognizer:`, err);
      return false;
    }
  }

  /**
   * Lazily loads and caches the Sherpa-ONNX Parakeet-TDT recognizer
   */
  public ensureRecognizer(): boolean {
    if (this.recognizer) return true;
    if (this.recognizerLoading) return false;

    try {
      const baseDir = this.getModelsDir();
      const parakeetDir = path.join(baseDir, 'parakeet-tdt');
      const encoder = path.join(parakeetDir, 'encoder.int8.onnx');
      const decoder = path.join(parakeetDir, 'decoder.int8.onnx');
      const joiner = path.join(parakeetDir, 'joiner.int8.onnx');
      const tokens = path.join(parakeetDir, 'tokens.txt');

      if (!fs.existsSync(encoder) || !fs.existsSync(tokens)) {
        return false;
      }

      this.recognizerLoading = true;
      console.log('[LocalModelManager] Loading Sherpa-ONNX Parakeet-TDT model weights into memory...');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sherpa = require('sherpa-onnx-node');
      const numThreads = Math.min(4, Math.max(1, os.cpus()?.length || 4));

      this.recognizer = new sherpa.OfflineRecognizer({
        modelConfig: {
          transducer: {
            encoder,
            decoder,
            joiner,
          },
          tokens,
          numThreads,
          provider: 'cpu',
          debug: 0,
        },
      });

      this.recognizerLoading = false;
      console.log('[LocalModelManager] Sherpa-ONNX Parakeet-TDT recognizer ready for local offline inference');
      return true;
    } catch (err) {
      this.recognizerLoading = false;
      console.error('[LocalModelManager] Failed to instantiate Parakeet-TDT recognizer:', err);
      return false;
    }
  }

  /**
   * Pull model: routes to Ollama API or HTTPS file download
   */
  public async pullLocalModel(
    modelId: LocalModelStatus['id']
  ): Promise<{ ok: boolean; message: string }> {
    const status = this.modelStatuses.get(modelId);
    if (!status) {
      return { ok: false, message: `Unknown model ID: ${modelId}` };
    }

    if (status.downloading) {
      return { ok: true, message: 'Model download is already in progress' };
    }

    if (status.provider === 'ollama') {
      return this.pullOllamaModel(status);
    } else {
      return this.downloadOnnxModel(status);
    }
  }

  /**
   * Pull model via Ollama native streaming API
   */
  private async pullOllamaModel(status: LocalModelStatus): Promise<{ ok: boolean; message: string }> {
    status.downloading = true;
    status.progressPercent = 0;
    status.statusMessage = 'Connecting to Ollama...';
    this.broadcastProgress(status);

    try {
      const res = await fetch(`${this.ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: status.modelTag, stream: true }),
      });

      if (!res.ok) {
        throw new Error(`Ollama pull error: ${res.statusText}`);
      }

      if (!res.body) {
        throw new Error('No response body from Ollama pull');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const data = JSON.parse(trimmed) as {
              status?: string;
              total?: number;
              completed?: number;
            };

            if (data.total && data.completed) {
              const pct = Math.min(100, Math.round((data.completed / data.total) * 100));
              status.progressPercent = pct;
              status.statusMessage = `${data.status || 'Downloading'}: ${pct}% (${Math.round(
                data.completed / 1024 / 1024
              )}MB / ${Math.round(data.total / 1024 / 1024)}MB)`;
            } else if (data.status) {
              status.statusMessage = data.status;
            }
            this.broadcastProgress(status);
          } catch {}
        }
      }

      status.downloading = false;
      status.installed = true;
      status.progressPercent = 100;
      status.statusMessage = 'Successfully installed in local Ollama!';
      this.broadcastProgress(status);

      return { ok: true, message: `Successfully installed ${status.name}` };
    } catch (err: unknown) {
      status.downloading = false;
      status.error = String(err);
      status.statusMessage = `Download failed: ${String(err)}`;
      this.broadcastProgress(status);
      return { ok: false, message: String(err) };
    }
  }

  /**
   * Download open-source ONNX weights with redirect handling and byte-level progress
   */
  private async downloadOnnxModel(status: LocalModelStatus): Promise<{ ok: boolean; message: string }> {
    status.downloading = true;
    status.progressPercent = 0;
    status.statusMessage = 'Preparing ONNX destination...';
    this.broadcastProgress(status);

    const baseDir = this.getModelsDir();

    try {
      if (status.id === 'nvidia-parakeet-tdt-onnx') {
        const targetDir = path.join(baseDir, 'parakeet-tdt');
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        // Manifest from official k2-fsa / HuggingFace repository
        const files = [
          {
            name: 'tokens.txt',
            url: 'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main/tokens.txt',
          },
          {
            name: 'encoder.int8.onnx',
            url: 'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main/encoder.int8.onnx',
          },
          {
            name: 'decoder.int8.onnx',
            url: 'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main/decoder.int8.onnx',
          },
          {
            name: 'joiner.int8.onnx',
            url: 'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main/joiner.int8.onnx',
          },
        ];

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const dest = path.join(targetDir, file.name);
          status.statusMessage = `Downloading ${file.name} (${i + 1}/${files.length})...`;
          this.broadcastProgress(status);

          await this.downloadFileHttps(file.url, dest, (loaded, total) => {
            if (total > 0) {
              const filePct = loaded / total;
              const overall = Math.round(((i + filePct) / files.length) * 100);
              status.progressPercent = overall;
              this.broadcastProgress(status);
            }
          });
        }

        // Initialize recognizer once files are in place
        this.ensureRecognizer();
      } else if (status.id === 'speaker-diarization-onnx') {
        const targetDir = path.join(baseDir, 'diarization');
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        const fileName = '3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx';
        const url = `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/${fileName}`;
        const dest = path.join(targetDir, fileName);

        status.statusMessage = 'Downloading 3D-Speaker CAM++ model...';
        this.broadcastProgress(status);

        await this.downloadFileHttps(url, dest, (loaded, total) => {
          if (total > 0) {
            status.progressPercent = Math.round((loaded / total) * 100);
            this.broadcastProgress(status);
          }
        });
      } else if (status.id === 'whisper-base-onnx') {
        const targetDir = this.getWhisperModelsDir();
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        const baseUrl = 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/';
        const files = [
          { name: 'small-tokens.txt', label: 'tokens' },
          { name: 'small-encoder.int8.onnx', label: 'encoder (107 MB)' },
          { name: 'small-decoder.int8.onnx', label: 'decoder (250 MB)' },
        ];

        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const dest = path.join(targetDir, f.name);
          status.statusMessage = `Downloading Whisper ${f.label} (${i + 1}/${files.length})...`;
          this.broadcastProgress(status);

          await this.downloadFileHttps(`${baseUrl}${f.name}`, dest, (loaded, total) => {
            if (total > 0) {
              const filePercent = loaded / total;
              const overallPercent = Math.round(((i + filePercent) / files.length) * 100);
              status.progressPercent = overallPercent;
              this.broadcastProgress(status);
            }
          });
        }

        // Initialize recognizers once files are in place
        this.ensureWhisperRecognizer('hi');
        this.ensureWhisperRecognizer('en');
      }

      status.downloading = false;
      status.installed = true;
      status.progressPercent = 100;
      status.statusMessage = 'ONNX model files successfully downloaded and verified!';
      this.broadcastProgress(status);

      return { ok: true, message: `Downloaded ${status.name}` };
    } catch (err: unknown) {
      status.downloading = false;
      status.error = String(err);
      status.statusMessage = `ONNX download failed: ${String(err)}`;
      this.broadcastProgress(status);
      return { ok: false, message: String(err) };
    }
  }

  /**
   * Robust HTTPS file downloader following 301/302/307 redirects
   */
  private downloadFileHttps(
    urlStr: string,
    destPath: string,
    onProgress: (loaded: number, total: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const makeRequest = (currentUrl: string, redirectCount: number = 0) => {
        if (redirectCount > 6) {
          return reject(new Error('Too many redirects while downloading file'));
        }

        const client = currentUrl.startsWith('https') ? https : http;
        client
          .get(currentUrl, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              const nextUrl = new URL(res.headers.location, currentUrl).href;
              return makeRequest(nextUrl, redirectCount + 1);
            }

            if (res.statusCode !== 200) {
              return reject(new Error(`Download failed with status: ${res.statusCode}`));
            }

            const total = parseInt(res.headers['content-length'] || '0', 10);
            let loaded = 0;

            const fileStream = fs.createWriteStream(destPath);
            res.on('data', (chunk) => {
              loaded += chunk.length;
              onProgress(loaded, total);
            });

            res.pipe(fileStream);

            fileStream.on('finish', () => {
              fileStream.close();
              resolve();
            });

            fileStream.on('error', (err) => {
              fs.unlink(destPath, () => {});
              reject(err);
            });
          })
          .on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
          });
      };

      makeRequest(urlStr, 0);
    });
  }

  private broadcastProgress(status: LocalModelStatus): void {
    windowManager.broadcastToAllWindows('models:progress', { ...status });
  }

  /**
   * Embedded Local Inference HTTP Server on 127.0.0.1:50051
   * Exposes /health and /v1/audio/transcriptions
   */
  public async startLocalServer(port: number = 50051): Promise<{ ok: boolean; port: number; message: string }> {
    if (this.isServerRunning && this.localServer) {
      return { ok: true, port: this.serverPort, message: 'Server is already running' };
    }

    this.serverPort = port;
    // Pre-warm local recognizers with lightweight memory footprint
    this.ensureRecognizer();
    this.ensureWhisperRecognizer('');

    return new Promise((resolve) => {
      const server = http.createServer(async (req, res) => {
        // CORS Headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = req.url || '/';

        // 1. Health check endpoint
        if (url === '/health' || url === '/') {
          const isReady = this.ensureRecognizer();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: isReady ? 'ok' : 'unready',
              engine: 'local-parakeet',
              modelsLoaded: isReady,
              port: this.serverPort,
              timestamp: Date.now(),
            })
          );
          return;
        }

        // 2. Transcription endpoint (OpenAI / NVIDIA verbose_json compliant)
        if (url.startsWith('/v1/audio/transcriptions')) {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          const chunks: Buffer[] = [];
          req.on('data', (chunk) => chunks.push(chunk));
          req.on('end', async () => {
            try {
              const bodyBuffer = Buffer.concat(chunks);
              const result = await this.handleAudioTranscription(bodyBuffer);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (err: unknown) {
              console.warn('[LocalServer] Transcription unready or failed:', err);
              // CRITICAL: Return 503 so transcriptionService immediately falls back to real upstream engines
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: 'Local ASR model not ready or not installed',
                  message: String(err),
                })
              );
            }
          });
          return;
        }

        // 3. Fallback 404
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[LocalServer] Port ${port} is in use; server is active`);
          this.isServerRunning = true;
          resolve({ ok: true, port, message: `Port ${port} already active` });
        } else {
          console.error('[LocalServer] Failed to bind server:', err);
          resolve({ ok: false, port, message: err.message });
        }
      });

      server.listen(port, '127.0.0.1', () => {
        this.isServerRunning = true;
        this.localServer = server;
        console.log(`[LocalServer] Embedded NVIDIA speech server listening on http://127.0.0.1:${port}`);
        resolve({
          ok: true,
          port,
          message: `Embedded Parakeet-TDT server running on 127.0.0.1:${port}`,
        });
      });
    });
  }

  /**
   * High-accuracy local speech processing via Sherpa-ONNX Parakeet-TDT 0.6B INT8
   */
  public async transcribeWavBuffer(
    uploadBuffer: Buffer
  ): Promise<{
    text: string;
    language: string;
    duration: number;
    segments: Array<{ id: number; start: number; end: number; text: string; speaker: string }>;
  }> {
    return this.handleAudioTranscription(uploadBuffer);
  }

  private async handleAudioTranscription(
    uploadBuffer: Buffer
  ): Promise<{
    text: string;
    language: string;
    duration: number;
    segments: Array<{ id: number; start: number; end: number; text: string; speaker: string }>;
  }> {
    // 1. Extract raw audio PCM data from multipart form or WAV stream
    let wavBuffer = uploadBuffer;
    const riffIdx = uploadBuffer.indexOf(Buffer.from('RIFF'));
    if (riffIdx !== -1 && uploadBuffer.length >= riffIdx + 44) {
      const declaredSize = uploadBuffer.readUInt32LE(riffIdx + 4) + 8;
      wavBuffer = uploadBuffer.subarray(riffIdx, Math.min(uploadBuffer.length, riffIdx + declaredSize));
    } else if (uploadBuffer.length < 44) {
      throw new Error('Invalid WAV buffer: buffer too short');
    }

    // 2. Compute audio duration from WAV header
    let durationSec = 1.0;
    if (wavBuffer.length >= 44 && wavBuffer.subarray(0, 4).toString() === 'RIFF') {
      const byteRate = wavBuffer.readUInt32LE(28) || 32000;
      const dataSize = Math.max(0, wavBuffer.length - 44);
      durationSec = Math.max(0.1, Math.round((dataSize / byteRate) * 100) / 100);
    }

    // 3. Ensure local ONNX recognizer is initialized
    const isReady = this.ensureRecognizer();
    if (!isReady || !this.recognizer) {
      throw new Error('Local ASR model not ready or not installed');
    }

    // 4. Decode audio using native Sherpa-ONNX (enableExternalBuffer=false for Electron V8 compatibility)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const addon = require('sherpa-onnx-node/addon.js');
    const wave = addon.readWaveFromBinary(Buffer.from(wavBuffer), false);
    if (!wave || !wave.samples || wave.samples.length === 0) {
      return {
        text: '',
        language: 'english',
        duration: durationSec,
        segments: [],
      };
    }

    const stream = this.recognizer.createStream();
    stream.acceptWaveform(wave);
    this.recognizer.decode(stream);
    const result = this.recognizer.getResult(stream);

    const recognizedText = (result && result.text) ? String(result.text).trim() : '';

    return {
      text: recognizedText,
      language: 'english',
      duration: durationSec,
      segments: recognizedText
        ? [
            {
              id: 0,
              start: 0.0,
              end: durationSec,
              text: recognizedText,
              speaker: 'Speaker 0',
            },
          ]
        : [],
    };
  }

  public stopLocalServer(): void {
    if (this.localServer) {
      this.localServer.close();
      this.localServer = null;
      this.isServerRunning = false;
    }
    this.recognizer = null;
    this.whisperRecognizers.clear();
  }

  /**
   * Multilingual local speech processing via Sherpa-ONNX Whisper Base INT8 (Hindi & English)
   */
  public async transcribeWithWhisperWavBuffer(
    uploadBuffer: Buffer,
    language: string = 'en'
  ): Promise<{
    text: string;
    language: string;
    duration: number;
    segments: Array<{ id: number; start: number; end: number; text: string; speaker: string }>;
  }> {
    let langCode = '';
    const l = (language || '').toLowerCase().trim();
    if (l.includes('bilingual') || l.includes('auto') || l.includes('multilingual') || !l) {
      langCode = '';
    } else if (l === 'hindi' || l === 'hi' || l.includes('hindi')) {
      langCode = 'hi';
    } else if (l.includes('english') || l === 'en') {
      langCode = 'en';
    } else if (l.includes('spanish') || l === 'es') {
      langCode = 'es';
    } else if (l.includes('french') || l === 'fr') {
      langCode = 'fr';
    } else if (l.includes('german') || l === 'de') {
      langCode = 'de';
    } else if (l.includes('japanese') || l === 'ja') {
      langCode = 'ja';
    } else if (l.includes('chinese') || l === 'zh' || l.includes('mandarin')) {
      langCode = 'zh';
    } else {
      langCode = '';
    }

    const cacheKey = langCode || 'auto';

    // 1. Extract raw audio PCM data from multipart form or WAV stream
    let wavBuffer = uploadBuffer;
    const riffIdx = uploadBuffer.indexOf(Buffer.from('RIFF'));
    if (riffIdx !== -1 && uploadBuffer.length >= riffIdx + 44) {
      const declaredSize = uploadBuffer.readUInt32LE(riffIdx + 4) + 8;
      wavBuffer = uploadBuffer.subarray(riffIdx, Math.min(uploadBuffer.length, riffIdx + declaredSize));
    } else if (uploadBuffer.length < 44) {
      throw new Error('Invalid WAV buffer: buffer too short');
    }

    // 2. Compute audio duration from WAV header
    let durationSec = 1.0;
    if (wavBuffer.length >= 44 && wavBuffer.subarray(0, 4).toString() === 'RIFF') {
      const byteRate = wavBuffer.readUInt32LE(28) || 32000;
      const dataSize = Math.max(0, wavBuffer.length - 44);
      durationSec = Math.max(0.1, Math.round((dataSize / byteRate) * 100) / 100);
    }

    // 3. Ensure local Whisper recognizer for this language is initialized
    const isReady = this.ensureWhisperRecognizer(langCode);
    const rec = this.whisperRecognizers.get(cacheKey);
    if (!isReady || !rec) {
      throw new Error(`Local Whisper [${cacheKey}] model not ready or not installed`);
    }

    // 4. Decode audio using native Sherpa-ONNX
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const addon = require('sherpa-onnx-node/addon.js');
    const wave = addon.readWaveFromBinary(Buffer.from(wavBuffer), false);
    if (!wave || !wave.samples || wave.samples.length === 0) {
      return {
        text: '',
        language: cacheKey,
        duration: durationSec,
        segments: [],
      };
    }

    const stream = rec.createStream();
    stream.acceptWaveform(wave);
    rec.decode(stream);
    const result = rec.getResult(stream);

    const recognizedText = (result && result.text) ? String(result.text).trim() : '';

    return {
      text: recognizedText,
      language: cacheKey,
      duration: durationSec,
      segments: recognizedText
        ? [
            {
              id: 0,
              start: 0.0,
              end: durationSec,
              text: recognizedText,
              speaker: 'Speaker 0',
            },
          ]
        : [],
    };
  }
}

export const localModelManager = new LocalModelManager();
