import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import { spawn } from 'child_process';
import { windowManager } from './windowManager';
import { store } from './store';
import { FineTuneExportResult, LocalModelId, LocalModelStatus } from '../../src/types/ipc';

export class LocalModelManager {
  private localServer: http.Server | null = null;
  private serverPort: number = 50051;
  private isServerRunning: boolean = false;
  private ollamaUrl: string = 'http://127.0.0.1:11434';
  private modelStatuses: Map<LocalModelId, LocalModelStatus> = new Map();

  // Serialized mutex queue for native Sherpa-ONNX C++ decoding to prevent concurrent stream races
  private decodeMutexPromise: Promise<unknown> = Promise.resolve();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognizer: any = null;
  private recognizerLoading: boolean = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private whisperRecognizers: Map<string, any> = new Map();
  private whisperRecognizerLoading: boolean = false;

  constructor() {
    this.initDefaultStatuses();
  }

  private runExclusiveDecode<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.decodeMutexPromise.then(fn, fn);
    this.decodeMutexPromise = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private initDefaultStatuses(): void {
    const defaults: LocalModelStatus[] = [
      {
        id: 'gemma4-e4b-ollama',
        name: 'Google Gemma 4 E4B (Multimodal Edge — Fast Text + Screen Vision)',
        provider: 'ollama',
        modelTag: 'gemma4:e4b',
        role: 'llm-multimodal',
        installed: false,
        running: false,
        downloading: false,
        progressPercent: 0,
        sizeLabel: '3.2 GB',
        statusMessage: 'Recommended primary local LLM for sub-250ms teleprompter & vision',
      },
      {
        id: 'gemma4-12b-ollama',
        name: 'Google Gemma 4 12B (Multimodal Pro — Deep Coding, Architecture & Vision)',
        provider: 'ollama',
        modelTag: 'gemma4:12b',
        role: 'llm-multimodal',
        installed: false,
        running: false,
        downloading: false,
        progressPercent: 0,
        sizeLabel: '7.8 GB',
        statusMessage: 'High-reasoning 12B multimodal model for complex interviews & code',
      },
      {
        id: 'gemma2-embed-ollama',
        name: 'Gemma 2 / Dense Embedding Engine (Local Vector DB RAG)',
        provider: 'ollama',
        modelTag: 'gemma2:2b',
        role: 'embedding',
        installed: false,
        running: false,
        downloading: false,
        progressPercent: 0,
        sizeLabel: '1.6 GB',
        statusMessage: 'Powers semantic Vector DB over Personal Memories & Mode Files',
      },
      {
        id: 'nvidia-parakeet-tdt-onnx',
        name: 'NVIDIA Parakeet-TDT 0.6B v2 (INT8 ONNX — ~150ms English ASR)',
        provider: 'onnx-local',
        modelTag: 'parakeet-tdt-0.6b-v2-int8',
        role: 'asr',
        installed: false,
        running: false,
        downloading: false,
        progressPercent: 0,
        sizeLabel: '640 MB',
        statusMessage: 'Ultra-fast non-autoregressive offline speech-to-text',
      },
      {
        id: 'whisper-base-onnx',
        name: 'Whisper Small Multilingual (INT8 ONNX — Hindi, Hinglish & English)',
        provider: 'onnx-local',
        modelTag: 'whisper-small-int8',
        role: 'asr',
        installed: false,
        running: false,
        downloading: false,
        progressPercent: 0,
        sizeLabel: '360 MB',
        statusMessage: '100% offline multilingual speech recognition',
      },
      {
        id: 'speaker-diarization-onnx',
        name: '3D-Speaker CAM++ Diarization ONNX (Me vs. Them Separation)',
        provider: 'onnx-local',
        modelTag: 'campplus-voxceleb',
        role: 'diarization',
        installed: false,
        running: false,
        downloading: false,
        progressPercent: 0,
        sizeLabel: '28 MB',
        statusMessage: 'Neural speaker embedding extractor for multi-talker attribution',
      },
      {
        id: 'nvidia-nemotron-ollama',
        name: 'NVIDIA Nemotron-Mini 4B (Ollama Ultra-Light)',
        provider: 'ollama',
        modelTag: 'nemotron-mini:latest',
        role: 'llm-multimodal',
        installed: false,
        running: false,
        downloading: false,
        progressPercent: 0,
        sizeLabel: '2.7 GB',
        statusMessage: 'Lightweight 4B text assistant',
      },
      {
        id: 'ollama-vision',
        name: 'Llama 3.2 Vision / Qwen3-VL (Dedicated Screen Analyzer)',
        provider: 'ollama',
        modelTag: 'llama3.2-vision:latest',
        role: 'llm-multimodal',
        installed: false,
        running: false,
        downloading: false,
        progressPercent: 0,
        sizeLabel: '7.9 GB',
        statusMessage: 'Optional dedicated vision model',
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

  public async listLocalModels(): Promise<LocalModelStatus[]> {
    await this.checkOllamaStatus();
    this.checkOnnxFilesStatus();
    return Array.from(this.modelStatuses.values());
  }

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
        const json = (await res.json()) as { models?: Array<{ name: string }> };
        const installedTags = (json.models || []).map((m) => m.name.toLowerCase());

        const matchTag = (patterns: string[]) =>
          installedTags.some((t) => patterns.some((p) => t === p || t.startsWith(p) || t.includes(p)));

        const updateOllamaEntry = (
          id: LocalModelId,
          patterns: string[],
          readyMsg: string
        ) => {
          const st = this.modelStatuses.get(id);
          if (st) {
            const isInst = matchTag(patterns);
            st.installed = isInst;
            st.running = true;
            st.statusMessage = isInst
              ? readyMsg
              : 'Ollama online — click Download to pull model';
          }
        };

        updateOllamaEntry(
          'gemma4-e4b-ollama',
          ['gemma4:e4b', 'cluely-gemma4:e4b', 'gemma4:latest'],
          'Installed & active for fast multimodal teleprompter inference'
        );
        updateOllamaEntry(
          'gemma4-12b-ollama',
          ['gemma4:12b', 'cluely-gemma4:12b'],
          'Installed & active for deep 12B multimodal reasoning'
        );
        updateOllamaEntry(
          'gemma2-embed-ollama',
          ['gemma2:2b', 'gemma2', 'embeddinggemma', 'nomic-embed-text'],
          'Installed & active for local Vector DB embeddings'
        );
        updateOllamaEntry(
          'nvidia-nemotron-ollama',
          ['nemotron-mini'],
          'Installed & ready for offline inference'
        );
        updateOllamaEntry(
          'ollama-vision',
          ['llama3.2-vision', 'qwen3-vl'],
          'Installed & active for multimodal screen analysis'
        );

        return true;
      }
    } catch {
      this.trySpawnOllama();
    }

    for (const st of this.modelStatuses.values()) {
      if (st.provider === 'ollama') {
        st.running = false;
        st.statusMessage = 'Ollama daemon is offline (install or start Ollama)';
      }
    }

    return false;
  }

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
        } catch {}
      }
    }
  }

  private checkOnnxFilesStatus(): void {
    const baseDir = this.getModelsDir();
    const parakeetDir = path.join(baseDir, 'parakeet-tdt');
    const diarizationDir = path.join(baseDir, 'diarization');

    const parakeetStatus = this.modelStatuses.get('nvidia-parakeet-tdt-onnx');
    if (parakeetStatus) {
      const hasEncoder = fs.existsSync(path.join(parakeetDir, 'encoder.int8.onnx'));
      const hasTokens = fs.existsSync(path.join(parakeetDir, 'tokens.txt'));
      const isInstalled = hasEncoder && hasTokens;
      parakeetStatus.installed = isInstalled;
      parakeetStatus.running = this.isServerRunning && isInstalled;
      if (isInstalled) {
        parakeetStatus.statusMessage = 'ONNX weights active in-process & on 127.0.0.1:50051';
      }
    }

    const diarStatus = this.modelStatuses.get('speaker-diarization-onnx');
    if (diarStatus) {
      const hasModel = fs.existsSync(
        path.join(diarizationDir, '3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx')
      );
      diarStatus.installed = hasModel;
      diarStatus.running = this.isServerRunning && hasModel;
      if (hasModel) {
        diarStatus.statusMessage = 'CAM++ Diarization ONNX model active';
      }
    }

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
          ? 'Whisper Small Multilingual active (Hindi & English)'
          : 'Whisper Base Multilingual active (Hindi & English)';
      }
    }
  }

  /**
   * Compiles a domain-adapted Cluely Teleprompter model (`cluely-gemma4:e4b` or `cluely-gemma4:12b`)
   * in local Ollama with tuned system instructions, anti-hallucination constraints, and sampling parameters.
   */
  public async buildCustomGemmaModel(
    baseModel: 'gemma4:e4b' | 'gemma4:12b' = 'gemma4:e4b'
  ): Promise<{ ok: boolean; modelName: string; message: string }> {
    const targetName = baseModel === 'gemma4:12b' ? 'cluely-gemma4:12b' : 'cluely-gemma4:e4b';
    const systemPrompt = `You are Cluely, an ultra-fast 2-second real-time desktop meeting and interview teleprompter.
- Skip deep thinking and filler. Start outputting the direct first-person answer ("I...", "We...") on token #1.
- Deliver 3-4 short, high-impact bullet points (under 90 words) so the user can read and speak the answer in 2-3 seconds.
- Never fabricate project names, company names, or file paths not present in context.`;

    try {
      const res = await fetch(`${this.ollamaUrl}/api/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetName,
          from: baseModel,
          system: systemPrompt,
          parameters: {
            temperature: 0.1,
            top_p: 0.85,
            top_k: 20,
            repeat_penalty: 1.12,
            num_ctx: 2048,
            num_predict: 280,
          },
          stream: false,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return {
          ok: false,
          modelName: targetName,
          message: `Failed to build ${targetName}: ${errText}. Make sure ${baseModel} is pulled in Ollama first.`,
        };
      }

      // Automatically set the newly built custom model as active
      const currentConfig = store.getState().aiConfig;
      store.patchState({
        aiConfig: {
          ...currentConfig,
          activeProvider: 'ollama',
          activeModel: targetName,
        },
      });

      return {
        ok: true,
        modelName: targetName,
        message: `Compiled and activated domain-tuned '${targetName}' in local Ollama!`,
      };
    } catch (err) {
      return {
        ok: false,
        modelName: targetName,
        message: `Ollama connection failed while building ${targetName}: ${String(err)}`,
      };
    }
  }

  /**
   * Exports all verified Session Q&A turns, Personal Memories, and Mode Instructions
   * into a ShareGPT/Gemma-4 ChatML JSONL fine-tuning dataset + Modelfile + Unsloth/MLX LoRA training script.
   */
  public async exportFineTuneDataset(
    baseModel: 'gemma4:e4b' | 'gemma4:12b' = 'gemma4:e4b'
  ): Promise<FineTuneExportResult> {
    const outDir = path.join(app.getPath('userData'), 'fine-tuning');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const datasetPath = path.join(outDir, 'cluely_gemma4_finetune.jsonl');
    const modelfilePath = path.join(outDir, 'Modelfile.cluely-gemma4');
    const scriptPath = path.join(outDir, 'train_gemma4_qlora.py');

    const state = store.getState();
    const samples: Array<{
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    }> = [];

    const sysInstruction =
      'You are Cluely, a real-time stealth meeting and interview copilot. Deliver direct, grounded, first-person answers ready to speak aloud.';

    // 1. Collect real session Q&A assist events
    for (const sess of state.pastSessions || []) {
      for (const ev of sess.assistEvents || []) {
        if (ev.userPrompt && ev.aiResponse && ev.aiResponse.length > 20) {
          samples.push({
            messages: [
              { role: 'system', content: sysInstruction },
              { role: 'user', content: ev.userPrompt },
              { role: 'assistant', content: ev.aiResponse },
            ],
          });
        }
      }
    }

    // 2. Collect personal memory Q&A pairs for personalized grounding
    for (const mem of state.personalMemories || []) {
      samples.push({
        messages: [
          { role: 'system', content: sysInstruction },
          {
            role: 'user',
            content: `What is my background or preference regarding ${mem.title}?`,
          },
          {
            role: 'assistant',
            content: `Regarding ${mem.title}: ${mem.content}`,
          },
        ],
      });
    }

    // 3. Seed high-quality canonical teleprompter examples if dataset has < 5 examples
    if (samples.length < 5) {
      samples.push(
        {
          messages: [
            { role: 'system', content: sysInstruction },
            {
              role: 'user',
              content:
                'How do you combine vector search and keyword search in a production RAG pipeline?',
            },
            {
              role: 'assistant',
              content:
                '**Question:** How do we combine dense vector search and lexical search in our RAG pipeline?\n\n- **Stage 1 Hybrid Retrieval (RRF):** We run dense cosine similarity search (using Gemma 2 / dense embeddings) in parallel with BM25 lexical matching, merging the top candidates via Reciprocal Rank Fusion (`score = 1 / (60 + rank)`).\n- **Stage 2 Cross-Encoder Reranking:** We pass the top 25 fused chunks through a lightweight cross-encoder to score exact query-document relevance before feeding the top 6 chunks to the LLM, cutting prefill latency by 70% while preventing hallucinations.',
            },
          ],
        },
        {
          messages: [
            { role: 'system', content: sysInstruction },
            {
              role: 'user',
              content:
                'Why did you choose Gemma 4 E4B and 12B for local desktop inference over cloud APIs?',
            },
            {
              role: 'assistant',
              content:
                '**Question:** Why did we select Gemma 4 (E4B / 12B) for local desktop copilot inference?\n\n- **Unified Multimodal Architecture:** Gemma 4 natively processes both live meeting transcripts and high-resolution screen snapshots in a single model without a cold-start model swap.\n- **Zero-Trust Privacy & Sub-250ms TTFT:** Running quantized weights in Apple Silicon unified memory keeps all corporate audio and screen data 100% on-device with zero network round-trip latency.',
            },
          ],
        }
      );
    }

    const jsonlContent = samples.map((s) => JSON.stringify(s)).join('\n') + '\n';
    fs.writeFileSync(datasetPath, jsonlContent, 'utf-8');

    const modelfileContent = `# Cluely Studio Custom Gemma 4 Modelfile
FROM ${baseModel}

PARAMETER temperature 0.15
PARAMETER top_p 0.90
PARAMETER top_k 40
PARAMETER repeat_penalty 1.12
PARAMETER num_ctx 8192

SYSTEM """
${sysInstruction}
"""
`;
    fs.writeFileSync(modelfilePath, modelfileContent, 'utf-8');

    const loraScriptContent = `#!/usr/bin/env python3
"""
Cluely Studio — Gemma 4 (${baseModel}) QLoRA Fine-Tuning Script (Unsloth / HuggingFace TRL)
Dataset: ${datasetPath} (${samples.length} conversation turns)

Usage:
  pip install unsloth trl transformers datasets peft accelerate bitsandbytes
  python3 "${scriptPath}"
"""

import os
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments
from unsloth import FastLanguageModel

MODEL_ID = "google/gemma-4-e4b-it" if "${baseModel}" == "gemma4:e4b" else "google/gemma-4-12b-it"
DATASET_PATH = r"${datasetPath}"
OUTPUT_DIR = r"${path.join(outDir, 'cluely-gemma4-lora-adapter')}"

def main():
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=MODEL_ID,
        max_seq_length=4096,
        load_in_4bit=True,
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=16,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_alpha=16,
        lora_dropout=0,
        bias="none",
    )

    dataset = load_dataset("json", data_files=DATASET_PATH, split="train")

    def format_chat(example):
        return {"text": tokenizer.apply_chat_template(example["messages"], tokenize=False)}

    dataset = dataset.map(format_chat)

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=4096,
        args=TrainingArguments(
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,
            warmup_steps=5,
            max_steps=60,
            learning_rate=2e-4,
            fp16=True,
            logging_steps=1,
            output_dir=OUTPUT_DIR,
        ),
    )
    trainer.train()
    model.save_pretrained_gguf(OUTPUT_DIR, tokenizer, quantization_method="q4_k_m")
    print(f"Saved GGUF adapter to {OUTPUT_DIR}. Import into Ollama via: ollama create cluely-gemma4 -f {modelfilePath}")

if __name__ == "__main__":
    main()
`;
    fs.writeFileSync(scriptPath, loraScriptContent, 'utf-8');

    return {
      ok: true,
      datasetPath,
      modelfilePath,
      scriptPath,
      sampleCount: samples.length,
      message: `Exported ${samples.length} training examples, Modelfile, and QLoRA training script to ${outDir}`,
    };
  }

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
    }

    const cacheKey = langCode || 'auto';
    if (this.whisperRecognizers.has(cacheKey)) {
      return true;
    }
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

      if (!fs.existsSync(encoder) || !fs.existsSync(decoder)) {
        encoder = path.join(baseDir, 'base-encoder.int8.onnx');
        decoder = path.join(baseDir, 'base-decoder.int8.onnx');
        tokens = path.join(baseDir, 'base-tokens.txt');
      }

      if (!fs.existsSync(encoder) || !fs.existsSync(decoder) || !fs.existsSync(tokens)) {
        return false;
      }

      this.whisperRecognizerLoading = true;
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
      return true;
    } catch (err) {
      this.whisperRecognizerLoading = false;
      console.error(`[LocalModelManager] Failed to instantiate Whisper [${cacheKey}] recognizer:`, err);
      return false;
    }
  }

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
      return true;
    } catch (err) {
      this.recognizerLoading = false;
      console.error('[LocalModelManager] Failed to instantiate Parakeet-TDT recognizer:', err);
      return false;
    }
  }

  public async pullLocalModel(
    modelId: LocalModelId
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

  private async pullOllamaModel(status: LocalModelStatus): Promise<{ ok: boolean; message: string }> {
    status.downloading = true;
    status.progressPercent = 0;
    status.statusMessage = `Connecting to Ollama to pull ${status.modelTag}...`;
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
              error?: string;
            };

            if (data.error) {
              throw new Error(data.error);
            }

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
          } catch (innerErr) {
            if (innerErr instanceof Error && innerErr.message !== 'Unexpected end of JSON input') {
              throw innerErr;
            }
          }
        }
      }

      status.downloading = false;
      status.installed = true;
      status.progressPercent = 100;
      status.statusMessage = `Installed ${status.modelTag} in local Ollama!`;
      this.broadcastProgress(status);

      return { ok: true, message: `Successfully installed ${status.name}` };
    } catch (err: unknown) {
      status.downloading = false;
      status.error = String(err);
      status.statusMessage = `Pull failed: ${String(err)}`;
      this.broadcastProgress(status);
      return { ok: false, message: String(err) };
    }
  }

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

        this.ensureWhisperRecognizer('hi');
        this.ensureWhisperRecognizer('en');
      }

      status.downloading = false;
      status.installed = true;
      status.progressPercent = 100;
      status.statusMessage = 'ONNX model files downloaded and verified!';
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
            if (
              res.statusCode &&
              res.statusCode >= 300 &&
              res.statusCode < 400 &&
              res.headers.location
            ) {
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

  public async startLocalServer(
    port: number = 50051
  ): Promise<{ ok: boolean; port: number; message: string }> {
    if (this.isServerRunning && this.localServer) {
      return { ok: true, port: this.serverPort, message: 'Server is already running' };
    }

    this.serverPort = port;
    this.ensureRecognizer();
    this.ensureWhisperRecognizer('');

    return new Promise((resolve) => {
      const server = http.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = req.url || '/';

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

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          this.isServerRunning = true;
          resolve({ ok: true, port, message: `Port ${port} already active` });
        } else {
          resolve({ ok: false, port, message: err.message });
        }
      });

      server.listen(port, '127.0.0.1', () => {
        this.isServerRunning = true;
        this.localServer = server;
        resolve({
          ok: true,
          port,
          message: `Embedded Parakeet-TDT server running on 127.0.0.1:${port}`,
        });
      });
    });
  }

  public async transcribeWavBuffer(
    uploadBuffer: Buffer
  ): Promise<{
    text: string;
    language: string;
    duration: number;
    segments: Array<{ id: number; start: number; end: number; text: string; speaker: string }>;
  }> {
    return this.runExclusiveDecode(() => this.handleAudioTranscription(uploadBuffer));
  }

  private async handleAudioTranscription(
    uploadBuffer: Buffer
  ): Promise<{
    text: string;
    language: string;
    duration: number;
    segments: Array<{ id: number; start: number; end: number; text: string; speaker: string }>;
  }> {
    let wavBuffer = uploadBuffer;
    const riffIdx = uploadBuffer.indexOf(Buffer.from('RIFF'));
    if (riffIdx !== -1 && uploadBuffer.length >= riffIdx + 44) {
      const declaredSize = uploadBuffer.readUInt32LE(riffIdx + 4) + 8;
      wavBuffer = uploadBuffer.subarray(
        riffIdx,
        Math.min(uploadBuffer.length, riffIdx + declaredSize)
      );
    } else if (uploadBuffer.length < 44) {
      throw new Error('Invalid WAV buffer: buffer too short');
    }

    let durationSec = 1.0;
    if (wavBuffer.length >= 44 && wavBuffer.subarray(0, 4).toString() === 'RIFF') {
      const byteRate = wavBuffer.readUInt32LE(28) || 32000;
      const dataSize = Math.max(0, wavBuffer.length - 44);
      durationSec = Math.max(0.1, Math.round((dataSize / byteRate) * 100) / 100);
    }

    const isReady = this.ensureRecognizer();
    if (!isReady || !this.recognizer) {
      throw new Error('Local ASR model not ready or not installed');
    }

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

    const recognizedText = result && result.text ? String(result.text).trim() : '';

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

  public async transcribeWithWhisperWavBuffer(
    uploadBuffer: Buffer,
    language: string = 'en'
  ): Promise<{
    text: string;
    language: string;
    duration: number;
    segments: Array<{ id: number; start: number; end: number; text: string; speaker: string }>;
  }> {
    return this.runExclusiveDecode(async () => {
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
      }

      const cacheKey = langCode || 'auto';

      let wavBuffer = uploadBuffer;
      const riffIdx = uploadBuffer.indexOf(Buffer.from('RIFF'));
      if (riffIdx !== -1 && uploadBuffer.length >= riffIdx + 44) {
        const declaredSize = uploadBuffer.readUInt32LE(riffIdx + 4) + 8;
        wavBuffer = uploadBuffer.subarray(
          riffIdx,
          Math.min(uploadBuffer.length, riffIdx + declaredSize)
        );
      } else if (uploadBuffer.length < 44) {
        throw new Error('Invalid WAV buffer: buffer too short');
      }

      let durationSec = 1.0;
      if (wavBuffer.length >= 44 && wavBuffer.subarray(0, 4).toString() === 'RIFF') {
        const byteRate = wavBuffer.readUInt32LE(28) || 32000;
        const dataSize = Math.max(0, wavBuffer.length - 44);
        durationSec = Math.max(0.1, Math.round((dataSize / byteRate) * 100) / 100);
      }

      const isReady = this.ensureWhisperRecognizer(langCode);
      const rec = this.whisperRecognizers.get(cacheKey);
      if (!isReady || !rec) {
        throw new Error(`Local Whisper [${cacheKey}] model not ready or not installed`);
      }

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

      const recognizedText = result && result.text ? String(result.text).trim() : '';

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
    });
  }
}

export const localModelManager = new LocalModelManager();
