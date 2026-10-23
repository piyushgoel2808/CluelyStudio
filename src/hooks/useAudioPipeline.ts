import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, TranscriptSegment } from '../types/ipc';
import {
  RealTimeVAD,
  SpeakerDiarizer,
  encodePcmToWavBase64Client,
  enrollUserVoice,
  formatTimestamp,
} from '../services/vadAndDiarization';

/**
 * Continuous stateful linear-interpolation resampler across block boundaries.
 * Prevents phase clicks, sample truncation, and 23Hz audio aliasing buzzing.
 */
class ContinuousResampler {
  private inSampleRate: number;
  private outSampleRate: number;
  private lastSample: number = 0;
  private phase: number = 0;

  constructor(inSampleRate: number = 48000, outSampleRate: number = 16000) {
    this.inSampleRate = inSampleRate || 48000;
    this.outSampleRate = outSampleRate || 16000;
  }

  public setInputSampleRate(rate: number): void {
    if (rate > 0 && rate !== this.inSampleRate) {
      this.inSampleRate = rate;
      this.phase = 0;
      this.lastSample = 0;
    }
  }

  public process(input: Float32Array): Int16Array {
    if (this.inSampleRate === this.outSampleRate) {
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return pcm;
    }

    const step = this.inSampleRate / this.outSampleRate;
    const estimatedOut = Math.floor((input.length - this.phase) / step) + 1;
    const output = new Int16Array(Math.max(0, estimatedOut));
    let outIdx = 0;

    let p = this.phase;
    while (p < input.length) {
      const idx = Math.floor(p);
      const frac = p - idx;
      const s0 = idx === 0 ? this.lastSample : input[idx - 1];
      const s1 = input[idx];
      const sample = s0 + frac * (s1 - s0);
      const s = Math.max(-1, Math.min(1, sample));
      output[outIdx++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      p += step;
    }

    this.phase = p - input.length;
    this.lastSample = input.length > 0 ? input[input.length - 1] : 0;

    return output.subarray(0, outIdx);
  }
}

export function useAudioPipeline(state: AppState | null) {
  const isSessionActive = Boolean(state?.isSessionActive);
  const meetingEnvironment = state?.meetingEnvironment || 'online';
  const voiceProfiles = state?.voiceProfiles || [];
  const latencyProfile = state?.aiConfig?.nvidiaSpeech?.latencyProfile || 'balanced';

  const [micLevel, setMicLevel] = useState<number>(0);
  const [systemLevel, setSystemLevel] = useState<number>(0);
  const [combinedBands, setCombinedBands] = useState<number[]>([0.15, 0.25, 0.35, 0.2, 0.3]);
  const [segments, setSegments] = useState<TranscriptSegment[]>(() => state?.transcripts || []);

  const sessionStartTimeRef = useRef<number>(Date.now());
  const micVADRef = useRef<RealTimeVAD>(new RealTimeVAD(latencyProfile));
  const sysVADRef = useRef<RealTimeVAD>(new RealTimeVAD(latencyProfile));
  const diarizerRef = useRef<SpeakerDiarizer>(new SpeakerDiarizer());

  // Sync historical transcripts from persisted state
  useEffect(() => {
    if (state?.transcripts && state.transcripts.length > 0) {
      setSegments((prev) => {
        if (prev.length === 0) return state.transcripts;
        return prev;
      });
    }
  }, [state?.transcripts]);

  const micContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const desktopLoopbackStreamRef = useRef<MediaStream | null>(null);
  const desktopLoopbackContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Update VAD latency profile if changed in state
  useEffect(() => {
    micVADRef.current.setLatencyProfile(latencyProfile);
    sysVADRef.current.setLatencyProfile(latencyProfile);
  }, [latencyProfile]);

  // Track session start time
  useEffect(() => {
    if (isSessionActive) {
      sessionStartTimeRef.current = Date.now();
    }
  }, [isSessionActive]);

  // Sync incoming segments from IPC (handles both partial streaming & finalized replacement)
  useEffect(() => {
    if (window.cluely && window.cluely.onTranscriptSegment) {
      const unsub = window.cluely.onTranscriptSegment((newSegment) => {
        setSegments((prev) => {
          const newBaseId = newSegment.id.replace(/_(part|fin)$/, '');
          const existingIdx = prev.findIndex((s) => {
            if (s.id === newSegment.id) return true;
            const sBaseId = s.id.replace(/_(part|fin)$/, '');
            if (sBaseId === newBaseId) return true;
            if (
              s.isPartial &&
              s.speakerId === newSegment.speakerId &&
              Math.abs(s.startTimeMs - newSegment.startTimeMs) < 1500
            ) {
              return true;
            }
            return false;
          });

          if (existingIdx !== -1) {
            // Only overwrite if the existing segment was a partial preview of this utterance
            if (prev[existingIdx].isPartial) {
              const updated = [...prev];
              updated[existingIdx] = newSegment;
              return updated;
            }
            // If already finalized with same ID, ignore duplicate
            if (prev[existingIdx].id === newSegment.id) {
              return prev;
            }
          }

          return [newSegment, ...prev];
        });
      });
      return unsub;
    }
  }, []);

  // Listen to system audio levels from audiotee via IPC
  useEffect(() => {
    if (window.cluely && window.cluely.onSystemAudioLevel) {
      const unsub = window.cluely.onSystemAudioLevel(({ rms }) => {
        setSystemLevel(rms);
      });
      return unsub;
    }
  }, []);

  const inFlightTranscriptionsRef = useRef<Set<Promise<unknown>>>(new Set());

  // Helper to transcribe a detected speech utterance
  const handleVADResult = useCallback(
    (
      vadResult: ReturnType<RealTimeVAD['processChunk']>,
      sourceChannel: 'mic' | 'system'
    ): Promise<unknown> | null => {
      if (!vadResult || !window.cluely?.transcribeSegment) return null;

      const wavBase64 = encodePcmToWavBase64Client(vadResult.pcmInt16);
      const speakerInfo = diarizerRef.current.resolveSpeaker(
        vadResult.voiceprint,
        sourceChannel,
        meetingEnvironment,
        voiceProfiles
      );

      const sessionStart = sessionStartTimeRef.current;
      const startMs = Math.max(0, (vadResult.startTimeOffsetMs || Date.now()) - sessionStart);
      const endMs = Math.max(startMs + 100, (vadResult.endTimeOffsetMs || Date.now()) - sessionStart);
      const formattedTs = formatTimestamp(startMs, endMs);

      const p = window.cluely.transcribeSegment({
        wavBase64,
        role: speakerInfo.role,
        speakerId: speakerInfo.speakerId,
        speakerLabel: speakerInfo.speakerLabel,
        durationMs: vadResult.durationMs,
        startTimeMs: startMs,
        endTimeMs: endMs,
        formattedTimestamp: formattedTs,
        speakerColor: speakerInfo.speakerColor,
        isPartial: vadResult.isPartial,
      });

      inFlightTranscriptionsRef.current.add(p);
      p.finally(() => {
        inFlightTranscriptionsRef.current.delete(p);
      });

      return p;
    },
    [meetingEnvironment, voiceProfiles]
  );

  /**
   * Force-flush pending speech from both Mic & System VAD instances and await
   * all in-flight ASR segment transcriptions. Used on Command+Enter before asking AI.
   */
  const flushAndWaitForTranscription = useCallback(async (): Promise<void> => {
    const promises: Promise<unknown>[] = [];

    // Flush microphone VAD
    const micFlushed = micVADRef.current.forceFlush();
    if (micFlushed) {
      const p = handleVADResult(micFlushed, 'mic');
      if (p) promises.push(p);
    }

    // Flush system loopback VAD
    const sysFlushed = sysVADRef.current.forceFlush();
    if (sysFlushed) {
      const p = handleVADResult(sysFlushed, 'system');
      if (p) promises.push(p);
    }

    // Await all local transcription promises and any ongoing in-flight ones
    const inFlight = Array.from(inFlightTranscriptionsRef.current);
    await Promise.allSettled([...promises, ...inFlight]);
  }, [handleVADResult]);

  const flushPendingSpeech = flushAndWaitForTranscription;

  // Listen to raw system PCM chunks from audiotee
  useEffect(() => {
    if (window.cluely && window.cluely.onSystemPcmChunk) {
      const unsub = window.cluely.onSystemPcmChunk(({ pcmBase64 }) => {
        if (!isSessionActive) return;

        try {
          const binaryStr = atob(pcmBase64);
          const numSamples = Math.floor(binaryStr.length / 2);
          if (numSamples === 0) return;
          const pcmInt16 = new Int16Array(numSamples);
          for (let i = 0; i < numSamples; i++) {
            const low = binaryStr.charCodeAt(i * 2);
            const high = binaryStr.charCodeAt(i * 2 + 1);
            let val = (high << 8) | low;
            if (val >= 0x8000) val -= 0x10000;
            pcmInt16[i] = val;
          }

          const vadResult = sysVADRef.current.processChunk(pcmInt16);
          if (vadResult) {
            handleVADResult(vadResult, 'system');
          }
        } catch (err) {
          console.warn('[useAudioPipeline] Error decoding system PCM chunk:', err);
        }
      });
      return unsub;
    }
  }, [isSessionActive, handleVADResult]);

  // Handle fallback desktop audio capture if audiotee is not available
  useEffect(() => {
    if (window.cluely && window.cluely.onUseDesktopAudioFallback) {
      const unsub = window.cluely.onUseDesktopAudioFallback(async () => {
        if (!isSessionActive || desktopLoopbackStreamRef.current) return;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              mandatory: {
                chromeMediaSource: 'desktop',
              },
            } as unknown as MediaTrackConstraints,
            video: false,
          });
          desktopLoopbackStreamRef.current = stream;

          const loopbackCtx = new (
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
          )();
          desktopLoopbackContextRef.current = loopbackCtx;

          const source = loopbackCtx.createMediaStreamSource(stream);
          const processor = loopbackCtx.createScriptProcessor(2048, 1, 1);
          source.connect(processor);

          // Route to muted gain node to prevent speaker screech / feedback loop
          const muteGain = loopbackCtx.createGain();
          muteGain.gain.value = 0;
          processor.connect(muteGain);
          muteGain.connect(loopbackCtx.destination);

          const loopbackResampler = new ContinuousResampler(loopbackCtx.sampleRate, 16000);

          processor.onaudioprocess = (e) => {
            if (!isSessionActive) return;
            const inputData = e.inputBuffer.getChannelData(0);
            const actualSampleRate = e.inputBuffer.sampleRate || loopbackCtx.sampleRate || 48000;
            loopbackResampler.setInputSampleRate(actualSampleRate);
            const pcmChunk = loopbackResampler.process(inputData);

            // Compute RMS for system loopback volume
            let sumSquare = 0;
            for (let i = 0; i < pcmChunk.length; i++) {
              const norm = pcmChunk[i] / 32768;
              sumSquare += norm * norm;
            }
            const rms = Math.min(1, Math.sqrt(sumSquare / (pcmChunk.length || 1)) * 2.8);
            setSystemLevel(rms);

            const vadResult = sysVADRef.current.processChunk(pcmChunk);
            if (vadResult) {
              handleVADResult(vadResult, 'system');
            }
          };
        } catch (err) {
          console.warn('[useAudioPipeline] Desktop loopback audio fallback failed:', err);
        }
      });
      return unsub;
    }
  }, [isSessionActive, handleVADResult]);

  // Start / Stop Microphone & Audio Analysis
  const startAudioCapture = useCallback(async () => {
    try {
      const micConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000,
      };
      if (state?.selectedMicDeviceId) {
        micConstraints.deviceId = { exact: state.selectedMicDeviceId };
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: micConstraints,
        video: false,
      });

      micStreamRef.current = stream;

      const audioCtx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      )();
      micContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      // ScriptProcessor for microphone VAD
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);
      source.connect(processor);

      // Route to muted gain node to prevent mic audio from looping back to speakers
      const muteGain = audioCtx.createGain();
      muteGain.gain.value = 0;
      processor.connect(muteGain);
      muteGain.connect(audioCtx.destination);

      const micResampler = new ContinuousResampler(audioCtx.sampleRate, 16000);

      processor.onaudioprocess = (e) => {
        if (!isSessionActive) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const actualSampleRate = e.inputBuffer.sampleRate || audioCtx.sampleRate || 48000;
        micResampler.setInputSampleRate(actualSampleRate);
        const pcmChunk = micResampler.process(inputData);

        const vadResult = micVADRef.current.processChunk(pcmChunk);
        if (vadResult) {
          handleVADResult(vadResult, 'mic');
        }
      };

      // Equalizer loop for floating HUD wave animation
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const updateEqualizer = () => {
        if (!micContextRef.current) return;
        analyser.getByteFrequencyData(freqData);

        const binCount = freqData.length;
        const b1 = freqData[Math.floor(binCount * 0.05)] / 255.0;
        const b2 = freqData[Math.floor(binCount * 0.15)] / 255.0;
        const b3 = freqData[Math.floor(binCount * 0.3)] / 255.0;
        const b4 = freqData[Math.floor(binCount * 0.5)] / 255.0;
        const b5 = freqData[Math.floor(binCount * 0.8)] / 255.0;

        const micAvg = (b1 + b2 + b3 + b4 + b5) / 5.0;
        setMicLevel(micAvg);

        const sysBoost = Math.min(1.0, (systemLevel || 0) * 1.5);
        setCombinedBands([
          Math.max(0.15, Math.min(1.0, b1 * 1.5 + sysBoost * 0.4)),
          Math.max(0.2, Math.min(1.0, b2 * 1.6 + sysBoost * 0.5)),
          Math.max(0.25, Math.min(1.0, b3 * 1.7 + sysBoost * 0.6)),
          Math.max(0.18, Math.min(1.0, b4 * 1.5 + sysBoost * 0.5)),
          Math.max(0.22, Math.min(1.0, b5 * 1.6 + sysBoost * 0.4)),
        ]);

        animationFrameRef.current = requestAnimationFrame(updateEqualizer);
      };

      animationFrameRef.current = requestAnimationFrame(updateEqualizer);
    } catch (err) {
      console.error('[useAudioPipeline] Failed to start microphone audio capture:', err);
    }
  }, [isSessionActive, handleVADResult]);

  const stopAudioCapture = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }

    if (desktopLoopbackStreamRef.current) {
      desktopLoopbackStreamRef.current.getTracks().forEach((t) => t.stop());
      desktopLoopbackStreamRef.current = null;
    }

    if (desktopLoopbackContextRef.current) {
      desktopLoopbackContextRef.current.close().catch(() => {});
      desktopLoopbackContextRef.current = null;
    }

    if (micContextRef.current) {
      micContextRef.current.close().catch(() => {});
      micContextRef.current = null;
    }

    micVADRef.current.reset();
    sysVADRef.current.reset();

    setMicLevel(0);
    setSystemLevel(0);
    setCombinedBands([0.15, 0.25, 0.35, 0.2, 0.3]);
  }, []);

  useEffect(() => {
    if (isSessionActive) {
      startAudioCapture();
    } else {
      stopAudioCapture();
    }

    return () => {
      stopAudioCapture();
    };
  }, [isSessionActive, startAudioCapture, stopAudioCapture]);

  const clearTranscript = useCallback(() => {
    setSegments([]);
    diarizerRef.current.reset();
  }, []);

  const renameSpeaker = useCallback((speakerId: string, newName: string) => {
    diarizerRef.current.renameSpeaker(speakerId, newName);
    setSegments((prev) =>
      prev.map((s) => (s.speakerId === speakerId ? { ...s, speakerLabel: newName } : s))
    );
  }, []);

  const enrollMyVoice = useCallback(
    async (durationSec: number = 4): Promise<boolean> => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { sampleRate: 16000 },
          video: false,
        });

        const ctx = new AudioContext({ sampleRate: 16000 });
        const source = ctx.createMediaStreamSource(stream);
        const processor = ctx.createScriptProcessor(4096, 1, 1);

        const chunks: Int16Array[] = [];

        processor.onaudioprocess = (e) => {
          const data = e.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(data.length);
          for (let i = 0; i < data.length; i++) {
            const s = Math.max(-1, Math.min(1, data[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          chunks.push(pcm);
        };

        source.connect(processor);
        processor.connect(ctx.destination);

        await new Promise((resolve) => setTimeout(resolve, durationSec * 1000));

        stream.getTracks().forEach((t) => t.stop());
        processor.disconnect();
        source.disconnect();
        await ctx.close();

        const totalSamples = chunks.reduce((acc, c) => acc + c.length, 0);
        if (totalSamples < 8000) return false;

        const merged = new Int16Array(totalSamples);
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.length;
        }

        const profile = enrollUserVoice(merged);

        if (window.cluely && window.cluely.patchState) {
          const currentProfiles = voiceProfiles.filter((p) => !p.isSelf);
          await window.cluely.patchState({
            voiceProfiles: [profile, ...currentProfiles],
          });
        }

        return true;
      } catch (err) {
        console.error('[useAudioPipeline] Error enrolling voice profile:', err);
        return false;
      }
    },
    [voiceProfiles]
  );

  return {
    micLevel,
    systemLevel,
    combinedBands,
    segments,
    clearTranscript,
    renameSpeaker,
    enrollMyVoice,
    flushPendingSpeech,
    flushAndWaitForTranscription,
  };
}
