import { store } from './store';
import { windowManager } from './windowManager';
import { companionServer } from './companionServer';
import { localModelManager } from './localModelManager';
import {
  NvidiaConnectionTestResult,
  TranscribePayload,
  TranscriptSegment,
} from '../../src/types/ipc';

export class TranscriptionService {
  private activeTranscriptions: Set<Promise<unknown>> = new Set();

  /**
   * Wait for any in-flight ASR transcription tasks to finish (up to maxWaitMs).
   * Called by aiRouter before reading transcripts so freshly spoken words are
   * guaranteed to be committed to the store before slicing!
   */
  public async waitForPendingTranscriptions(maxWaitMs: number = 1500): Promise<void> {
    if (this.activeTranscriptions.size === 0) return;
    const currentPromises = Array.from(this.activeTranscriptions);
    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, maxWaitMs));
    await Promise.race([
      Promise.allSettled(currentPromises),
      timeoutPromise,
    ]);
  }

  public async transcribeSegment(
    payload: TranscribePayload
  ): Promise<TranscriptSegment | null> {
    const taskPromise = this._executeTranscribeSegment(payload);
    this.activeTranscriptions.add(taskPromise);
    try {
      return await taskPromise;
    } finally {
      this.activeTranscriptions.delete(taskPromise);
    }
  }

  private async _executeTranscribeSegment(
    payload: TranscribePayload
  ): Promise<TranscriptSegment | null> {
    const state = store.getState();
    const config = state.aiConfig;
    const provider = config.voiceProvider || 'nvidia-parakeet-tdt';
    const language = state.transcriptionLanguage || 'English';

    let transcribedText = '';
    const isPartial = Boolean(payload.isPartial);

    try {
      if (provider === 'whisper-base-onnx') {
        transcribedText = await this.transcribeWithWhisperBase(
          payload.wavBase64,
          language
        );
      } else if (provider === 'nvidia-hybrid') {
        transcribedText = await this.transcribeNvidiaHybrid(
          payload.wavBase64,
          isPartial,
          language
        );
      } else if (provider === 'nvidia-parakeet-tdt') {
        transcribedText = await this.transcribeWithParakeetTDT(
          payload.wavBase64,
          language
        );
      } else if (provider === 'nvidia-nemotron-nim') {
        transcribedText = await this.transcribeWithNemotron(
          payload.wavBase64,
          language
        );
      } else if (provider === 'groq-whisper') {
        transcribedText = await this.transcribeWithGroq(
          payload.wavBase64,
          config.apiKeys.groq,
          language
        );
      } else if (provider === 'deepgram-nova3') {
        transcribedText = await this.transcribeWithDeepgram(
          payload.wavBase64,
          config.apiKeys.deepgram,
          language
        );
      } else {
        // Fallback: If Gemini API key is configured, use Gemini; otherwise use local offline Parakeet-TDT
        if (config.apiKeys.gemini) {
          transcribedText = await this.transcribeWithGemini(
            payload.wavBase64,
            config.apiKeys.gemini,
            config.activeModel || 'gemini-2.5-flash',
            language
          );
        } else {
          transcribedText = await this.transcribeWithParakeetTDT(
            payload.wavBase64,
            language
          );
        }
      }
    } catch (error) {
      console.warn('[TranscriptionService] Primary speech engine error, falling back to local Parakeet-TDT:', error);
      try {
        transcribedText = await this.transcribeWithParakeetTDT(
          payload.wavBase64,
          language
        );
      } catch (fbErr) {
        console.error('[TranscriptionService] Local Parakeet-TDT fallback also failed:', fbErr);
      }
    }

    const cleanText = this.sanitizeAndFilterASRText(transcribedText);
    if (!cleanText) {
      return null;
    }

    const startMs = payload.startTimeMs ?? 0;
    const endMs = payload.endTimeMs ?? (startMs + payload.durationMs);
    const formattedTimestamp = this.formatTimestamp(startMs, endMs);

    const segment: TranscriptSegment = {
      id: `seg_${payload.speakerId}_${Math.floor(startMs / 1000)}_${isPartial ? 'part' : 'fin'}`,
      speakerId: payload.speakerId,
      speakerLabel: payload.speakerLabel,
      role: payload.role,
      text: cleanText,
      timestamp: Date.now(),
      startTimeMs: startMs,
      endTimeMs: endMs,
      formattedTimestamp,
      speakerColor: payload.speakerColor || (payload.role === 'me' ? '#22c55e' : '#38bdf8'),
      isPartial,
    };

    windowManager.broadcastToAllWindows('audio:transcript-segment', segment);
    companionServer.broadcastToClients('audio:transcript-segment', segment);

    // Persist finalized transcripts to store & disk log
    store.addTranscriptSegment(segment);

    return segment;
  }

  /**
   * Meetily's exact repetition cleaner and meaningless output suppressor
   */
  private sanitizeAndFilterASRText(raw: string): string | null {
    if (!raw) return null;
    let text = raw.trim();

    // 1. Strip bracketed noise tokens (Meetily / Whisper)
    text = text.replace(/^[(\[*][\s\S]*?[)\]*]$/g, '').trim();
    text = text.replace(
      /\((?:music|applause|laughter|whispering|coughing|birds chirping|crying|cheering|chuckle|somber|draken|burr|burur|skr|saturday|praise of the film|thank you|thanks)\)/gi,
      ''
    ).trim();
    text = text.replace(
      /\*(?:music|applause|laughter|somber|skr|hug|boss|humming|cough)\*/gi,
      ''
    ).trim();

    // 2. Meetily's is_meaningless_output check
    const lower = text.toLowerCase();
    const meaninglessPatterns = [
      'thank you for watching',
      'thanks for watching',
      'like and subscribe',
      'subscribe to the channel',
      'music playing',
      'applause',
      'laughter',
      'um um um',
      'uh uh uh',
      'ah ah ah',
      'subtitles by',
      'translated by',
    ];
    for (const pat of meaninglessPatterns) {
      if (lower.includes(pat)) {
        return null;
      }
    }

    // 3. Meetily unique characters check: if text is mostly same character
    const uniqueChars = new Set(text.replace(/\s+/g, ''));
    if (uniqueChars.size <= 3 && text.length > 8) {
      return null;
    }

    // 4. Reject Arabic / Urdu script hallucinations in Hindi/English meetings
    if (/[\u0600-\u06FF]/.test(text)) {
      return null;
    }

    // 5. Reject pure Devanagari combining signs / matras without any base consonants
    if (/[\u0900-\u097F]/.test(text)) {
      const hasBaseConsonant = /[\u0904-\u0939]/.test(text);
      if (!hasBaseConsonant) {
        return null;
      }
    }

    // 6. Meetily's remove_word_repetitions: collapse consecutive duplicate words
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const cleanedWords: string[] = [];
      let i = 0;
      while (i < words.length) {
        const currentWord = words[i];
        let repeatCount = 1;
        while (
          i + repeatCount < words.length &&
          words[i + repeatCount].toLowerCase() === currentWord.toLowerCase()
        ) {
          repeatCount++;
        }
        cleanedWords.push(currentWord);
        i += repeatCount;
      }

      // 7. Meetily's remove_phrase_repetitions: 2- to 5-word phrase loops
      const finalWords: string[] = [];
      let j = 0;
      while (j < cleanedWords.length) {
        let phraseFound = false;
        const maxPhraseLen = Math.min(5, Math.floor((cleanedWords.length - j) / 2));
        for (let phraseLen = 2; phraseLen <= maxPhraseLen; phraseLen++) {
          const phrase1 = cleanedWords.slice(j, j + phraseLen).join(' ').toLowerCase();
          const phrase2 = cleanedWords.slice(j + phraseLen, j + phraseLen * 2).join(' ').toLowerCase();
          if (phrase1 === phrase2) {
            finalWords.push(...cleanedWords.slice(j, j + phraseLen));
            j += phraseLen * 2;
            phraseFound = true;
            break;
          }
        }
        if (!phraseFound) {
          finalWords.push(cleanedWords[j]);
          j += 1;
        }
      }

      // 8. Meetily's repetition ratio check (> 0.70 discarded)
      const wordCount = finalWords.length;
      if (wordCount >= 4) {
        const uniqueWords = new Set(finalWords.map((w) => w.toLowerCase()));
        const repetitionRatio = 1.0 - uniqueWords.size / wordCount;
        if (repetitionRatio > 0.7) {
          return null;
        }
      }

      text = finalWords.join(' ');
    }

    // 9. Strip leading/trailing punctuation often emitted by Whisper on silence (e.g. "-, ", "..., ")
    text = text.replace(/^[-,\s.:;~_`'"]+|[-,\s.:;~_`'"]+$/g, '').trim();
    if (text === '...' || text === '..' || text === '.' || text === '-' || text === '--') {
      return null;
    }

    if (text.length < 2) return null;

    return text;
  }

  /**
   * Stage 2 & 3: NVIDIA Hybrid Pipeline
   * Emits live partial captions using Nemotron-Speech-Streaming, then finalizes with Parakeet-TDT 0.6B v2
   */
  private async transcribeNvidiaHybrid(
    wavBase64: string,
    isPartial: boolean,
    language: string
  ): Promise<string> {
    const config = store.getState().aiConfig.nvidiaSpeech;
    if (isPartial) {
      if (config.nimApiKey) {
        try {
          return await this.transcribeWithNemotron(wavBase64, language);
        } catch {
          // Fall back to local Parakeet if Cloud Nemotron fails
        }
      }
      return this.transcribeWithParakeetTDT(wavBase64, language);
    } else {
      return this.transcribeWithParakeetTDT(wavBase64, language);
    }
  }

  /**
   * Whisper Base / Small Multilingual INT8 ONNX (Meetily Multilingual Whisper Engine)
   */
  public async transcribeWithWhisperBase(
    wavBase64: string,
    language: string
  ): Promise<string> {
    const wavBuffer = Buffer.from(wavBase64, 'base64');
    try {
      const directResult = await localModelManager.transcribeWithWhisperWavBuffer(
        wavBuffer,
        language
      );
      if (directResult && directResult.text) {
        return directResult.text.trim();
      }
    } catch (err) {
      console.warn('[TranscriptionService] Whisper Multilingual direct execution failed:', err);
    }
    return '';
  }

  /**
   * NVIDIA Parakeet-TDT 0.6B v2 (Meetily's primary real-time speech engine for English)
   * Non-autoregressive fast-conformer RNN-T (~150ms latency, zero hallucination loops)
   */
  public async transcribeWithParakeetTDT(
    wavBase64: string,
    _language: string
  ): Promise<string> {
    const config = store.getState().aiConfig.nvidiaSpeech;
    const wavBuffer = Buffer.from(wavBase64, 'base64');

    // 1. Direct in-process Sherpa-ONNX execution (Zero HTTP overhead, 150ms latency)
    try {
      const directResult = await localModelManager.transcribeWavBuffer(wavBuffer);
      if (directResult && directResult.text) {
        return directResult.text.trim();
      }
    } catch (err) {
      console.warn('[TranscriptionService] Parakeet-TDT direct execution failed:', err);
    }

    // 2. Try Local Parakeet Server (e.g. 127.0.0.1:50051)
    if (config.localParakeetUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const formData = new FormData();
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });
        formData.append('file', blob, 'audio.wav');
        formData.append('model', config.parakeetModelId);
        formData.append('response_format', 'verbose_json');

        const localRes = await fetch(config.localParakeetUrl, {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (localRes.ok) {
          const json = (await localRes.json()) as { text?: string };
          return (json.text || '').trim();
        }
      } catch {
        // Local not running
      }
    }

    // 3. Fall back to Cloud NVIDIA Developer NIM endpoint
    if (!config.nimApiKey) {
      return '';
    }

    const formData = new FormData();
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    formData.append('file', blob, 'audio.wav');
    formData.append('model', config.parakeetModelId);
    formData.append('response_format', 'verbose_json');

    const res = await fetch(config.nimEndpointUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.nimApiKey}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`NVIDIA NIM Parakeet error ${res.status}: ${err}`);
    }

    const data = (await res.json()) as { text?: string };
    return data.text ? data.text.trim() : '';
  }

  /**
   * NVIDIA Nemotron Speech Streaming (Ultra-low-latency streaming captions)
   */
  public async transcribeWithNemotron(
    wavBase64: string,
    _language: string
  ): Promise<string> {
    const config = store.getState().aiConfig.nvidiaSpeech;
    const wavBuffer = Buffer.from(wavBase64, 'base64');

    if (!config.nimApiKey) {
      throw new Error('NVIDIA NIM API Key not set for Nemotron');
    }

    const formData = new FormData();
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    formData.append('file', blob, 'audio.wav');
    formData.append('model', config.nemotronModelId);
    formData.append('response_format', 'json');

    const res = await fetch(config.nimEndpointUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.nimApiKey}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`NVIDIA Nemotron error ${res.status}: ${err}`);
    }

    const data = (await res.json()) as { text?: string };
    return data.text ? data.text.trim() : '';
  }

  public async testNvidiaConnection(): Promise<NvidiaConnectionTestResult> {
    const config = store.getState().aiConfig.nvidiaSpeech;
    const start = Date.now();

    // 1. Test Local Parakeet URL
    if (config.localParakeetUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 800);
        const res = await fetch(config.localParakeetUrl, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const latencyMs = Date.now() - start;
        if (res.status < 500) {
          return {
            ok: true,
            latencyMs,
            engine: 'local-parakeet',
            message: `Connected to Local Parakeet server (${latencyMs}ms)`,
          };
        }
      } catch {
        // local not running
      }
    }

    // 2. Test NVIDIA Developer NIM Cloud Endpoint
    if (config.nimApiKey && config.nimApiKey.startsWith('nvapi-')) {
      const nimStart = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${config.nimApiKey}`,
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const latencyMs = Date.now() - nimStart;

        if (res.ok) {
          return {
            ok: true,
            latencyMs,
            engine: 'nvidia-nim',
            message: `Connected to NVIDIA Developer NIM Cloud API (${latencyMs}ms)`,
          };
        } else {
          return {
            ok: false,
            latencyMs,
            engine: 'nvidia-nim',
            message: `NVIDIA NIM responded with HTTP ${res.status}`,
          };
        }
      } catch (err) {
        return {
          ok: false,
          latencyMs: Date.now() - nimStart,
          engine: 'nvidia-nim',
          message: `NVIDIA NIM unreachable: ${String(err)}`,
        };
      }
    }

    return {
      ok: false,
      latencyMs: 0,
      engine: 'none',
      message: 'No NVIDIA server reachable. Set a valid nvapi-... key or start local Parakeet-TDT.',
    };
  }

  private async transcribeWithGemini(
    wavBase64: string,
    apiKey: string,
    modelName: string,
    language: string
  ): Promise<string> {
    if (!apiKey) {
      console.warn('[TranscriptionService] No Gemini API key configured in Settings');
      return '';
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const promptText = `Transcribe the spoken audio accurately in ${language}. Output ONLY the exact spoken words without timestamps, speaker tags, or commentary. If there is only silence or background noise, output an empty string.`;

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inline_data: {
                mime_type: 'audio/wav',
                data: wavBase64,
              },
            },
            {
              text: promptText,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 1024,
      },
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[TranscriptionService] Gemini API returned status ${response.status}:`, errText);
      return '';
    }

    interface GeminiResponse {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      }>;
    }

    const json = (await response.json()) as GeminiResponse;
    const parts = json.candidates?.[0]?.content?.parts;
    if (parts && parts.length > 0 && parts[0].text) {
      return parts[0].text.trim();
    }
    return '';
  }

  private async transcribeWithGroq(
    wavBase64: string,
    apiKey: string,
    language: string
  ): Promise<string> {
    if (!apiKey) {
      console.warn('[TranscriptionService] No Groq API key configured in Settings');
      return '';
    }

    const wavBuffer = Buffer.from(wavBase64, 'base64');
    const formData = new FormData();
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    formData.append('file', blob, 'audio.wav');
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'json');

    let langCode = 'auto';
    const langLower = language.toLowerCase();
    if (langLower.startsWith('en')) {
      langCode = 'en';
    } else if (langLower.includes('hindi') || langLower === 'hi') {
      langCode = 'hi';
    } else if (langLower.includes('spanish') || langLower === 'es') {
      langCode = 'es';
    } else if (langLower.includes('french') || langLower === 'fr') {
      langCode = 'fr';
    } else if (langLower.includes('german') || langLower === 'de') {
      langCode = 'de';
    } else if (langLower.includes('japanese') || langLower === 'ja') {
      langCode = 'ja';
    }
    if (langCode !== 'auto') {
      formData.append('language', langCode);
    }

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[TranscriptionService] Groq API returned status ${response.status}:`, errText);
      return '';
    }

    interface GroqResponse {
      text?: string;
    }
    const json = (await response.json()) as GroqResponse;
    return json.text || '';
  }

  private async transcribeWithDeepgram(
    wavBase64: string,
    apiKey: string,
    language: string
  ): Promise<string> {
    if (!apiKey) {
      console.warn('[TranscriptionService] No Deepgram API key configured in Settings');
      return '';
    }

    const wavBuffer = Buffer.from(wavBase64, 'base64');
    let langCode = 'multi';
    const langLower = language.toLowerCase();
    if (langLower.startsWith('en')) {
      langCode = 'en';
    } else if (langLower.includes('hindi') || langLower === 'hi') {
      langCode = 'hi';
    }
    const url = `https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=${langCode}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'audio/wav',
      },
      body: wavBuffer,
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[TranscriptionService] Deepgram API returned status ${response.status}:`, err);
      return '';
    }

    interface DeepgramResponse {
      results?: {
        channels?: Array<{
          alternatives?: Array<{
            transcript?: string;
          }>;
        }>;
      };
    }

    const json = (await response.json()) as DeepgramResponse;
    const transcript = json.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    return transcript || '';
  }

  private formatTimeMs(ms: number): string {
    const safeMs = Math.max(0, ms);
    const totalSec = Math.floor(safeMs / 1000);
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    const hundredths = Math.floor((safeMs % 1000) / 10);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${hundredths
      .toString()
      .padStart(2, '0')}`;
  }

  private formatTimestamp(startMs: number, endMs: number): string {
    return `[${this.formatTimeMs(startMs)} - ${this.formatTimeMs(endMs)}]`;
  }
}

export const transcriptionService = new TranscriptionService();
