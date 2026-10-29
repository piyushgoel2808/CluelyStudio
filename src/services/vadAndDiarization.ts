import { NvidiaLatencyProfile, SpeakerVoiceProfile } from '../types/ipc';

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : Math.max(-1, Math.min(1, dot / denom));
}

export function formatTimeMs(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSec = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const hundredths = Math.floor((safeMs % 1000) / 10);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${hundredths
    .toString()
    .padStart(2, '0')}`;
}

export function formatTimestamp(startMs: number, endMs: number): string {
  return `[${formatTimeMs(startMs)} - ${formatTimeMs(endMs)}]`;
}

export const SPEAKER_TRACK_COLORS = [
  '#22c55e', // Track 0 (Speaker-0 / Me) - Emerald
  '#38bdf8', // Track 1 (Speaker-1) - Sky Blue
  '#a3a3a3', // Track 2 (Speaker-2) - Neutral Gray
  '#f43f5e', // Track 3 (Speaker-3) - Rose
];

export function getSpeakerColor(trackIndex: number): string {
  const index = Math.abs(trackIndex) % SPEAKER_TRACK_COLORS.length;
  return SPEAKER_TRACK_COLORS[index];
}

export function encodePcmToWavBase64Client(pcmInt16: Int16Array, sampleRate: number = 16000): string {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmInt16.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  view.setUint8(0, 'R'.charCodeAt(0));
  view.setUint8(1, 'I'.charCodeAt(0));
  view.setUint8(2, 'F'.charCodeAt(0));
  view.setUint8(3, 'F'.charCodeAt(0));
  view.setUint32(4, 36 + dataSize, true);
  view.setUint8(8, 'W'.charCodeAt(0));
  view.setUint8(9, 'A'.charCodeAt(0));
  view.setUint8(10, 'V'.charCodeAt(0));
  view.setUint8(11, 'E'.charCodeAt(0));

  view.setUint8(12, 'f'.charCodeAt(0));
  view.setUint8(13, 'm'.charCodeAt(0));
  view.setUint8(14, 't'.charCodeAt(0));
  view.setUint8(15, ' '.charCodeAt(0));
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  view.setUint8(36, 'd'.charCodeAt(0));
  view.setUint8(37, 'a'.charCodeAt(0));
  view.setUint8(38, 't'.charCodeAt(0));
  view.setUint8(39, 'a'.charCodeAt(0));
  view.setUint32(40, dataSize, true);

  const pcmBytes = new Uint8Array(pcmInt16.buffer, pcmInt16.byteOffset, pcmInt16.byteLength);
  const targetBytes = new Uint8Array(buffer, 44);
  targetBytes.set(pcmBytes);

  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

export function extractVoiceprintAndPitch(
  pcmInt16: Int16Array,
  sampleRate: number = 16000
): { voiceprint: number[]; pitchMeanHz: number } {
  const n = pcmInt16.length;
  if (n < 512) {
    return { voiceprint: new Array(24).fill(0), pitchMeanHz: 130 };
  }

  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    samples[i] = pcmInt16[i] / 32768.0;
  }

  const minLag = Math.floor(sampleRate / 350);
  const maxLag = Math.floor(sampleRate / 75);
  const frameSize = 1024;
  let totalPitch = 0;
  let pitchCount = 0;

  for (let offset = 0; offset + frameSize <= n; offset += frameSize) {
    let bestLag = -1;
    let maxCorr = -1;
    let energy0 = 0;

    for (let i = 0; i < frameSize - maxLag; i++) {
      energy0 += samples[offset + i] * samples[offset + i];
    }

    if (energy0 > 0.001) {
      for (let lag = minLag; lag <= maxLag; lag++) {
        let corr = 0;
        for (let i = 0; i < frameSize - maxLag; i++) {
          corr += samples[offset + i] * samples[offset + i + lag];
        }
        const normCorr = corr / energy0;
        if (normCorr > maxCorr) {
          maxCorr = normCorr;
          bestLag = lag;
        }
      }

      if (maxCorr > 0.35 && bestLag > 0) {
        const pitch = sampleRate / bestLag;
        if (pitch >= 75 && pitch <= 350) {
          totalPitch += pitch;
          pitchCount++;
        }
      }
    }
  }

  const pitchMeanHz = pitchCount > 0 ? totalPitch / pitchCount : 135;

  const fftSize = 512;
  const numFilters = 20;
  const numCoeffs = 16;
  const melEnergies = new Float32Array(numFilters);
  const magSpectrum = new Float32Array(fftSize / 2);
  let numFftFrames = 0;

  for (let offset = 0; offset + fftSize <= n; offset += fftSize / 2) {
    for (let k = 0; k < fftSize / 2; k++) {
      let real = 0;
      let imag = 0;
      for (let t = 0; t < fftSize; t += 2) {
        const hann = 0.5 * (1 - Math.cos((2 * Math.PI * t) / (fftSize - 1)));
        const sample = samples[offset + t] * hann;
        const angle = (2 * Math.PI * k * t) / fftSize;
        real += sample * Math.cos(angle);
        imag -= sample * Math.sin(angle);
      }
      magSpectrum[k] += Math.sqrt(real * real + imag * imag);
    }
    numFftFrames++;
  }

  if (numFftFrames > 0) {
    for (let k = 0; k < magSpectrum.length; k++) {
      magSpectrum[k] /= numFftFrames;
    }
  }

  let sumFreqMag = 0;
  let sumMag = 0;
  for (let k = 0; k < magSpectrum.length; k++) {
    const freq = (k * sampleRate) / fftSize;
    sumFreqMag += freq * magSpectrum[k];
    sumMag += magSpectrum[k];
  }
  const spectralCentroid = sumMag > 0 ? sumFreqMag / sumMag : 1200;

  const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
  const melToHz = (mel: number) => 700 * (Math.pow(10, mel / 2595) - 1);
  const melMin = hzToMel(200);
  const melMax = hzToMel(7500);
  const melStep = (melMax - melMin) / (numFilters + 1);

  const binPoints = new Int32Array(numFilters + 2);
  for (let i = 0; i < numFilters + 2; i++) {
    const hz = melToHz(melMin + i * melStep);
    binPoints[i] = Math.floor(((fftSize + 1) * hz) / sampleRate);
  }

  for (let m = 1; m <= numFilters; m++) {
    let energy = 0;
    const start = binPoints[m - 1];
    const center = binPoints[m];
    const stop = binPoints[m + 1];

    for (let k = start; k < center && k < magSpectrum.length; k++) {
      const weight = (k - start) / Math.max(1, center - start);
      energy += magSpectrum[k] * weight;
    }
    for (let k = center; k < stop && k < magSpectrum.length; k++) {
      const weight = (stop - k) / Math.max(1, stop - center);
      energy += magSpectrum[k] * weight;
    }
    melEnergies[m - 1] = Math.log(Math.max(1e-5, energy));
  }

  const mfcc = new Array(numCoeffs);
  for (let i = 0; i < numCoeffs; i++) {
    let sum = 0;
    for (let j = 0; j < numFilters; j++) {
      sum += melEnergies[j] * Math.cos((Math.PI * i * (j + 0.5)) / numFilters);
    }
    mfcc[i] = sum;
  }

  const subbands = [
    melEnergies[0] + melEnergies[1],
    melEnergies[2] + melEnergies[3] + melEnergies[4],
    melEnergies[5] + melEnergies[6] + melEnergies[7],
    melEnergies[8] + melEnergies[9] + melEnergies[10],
    melEnergies[11] + melEnergies[12] + melEnergies[13],
    melEnergies[14] + melEnergies[15] + melEnergies[16],
  ];

  const rawVector = [
    ...mfcc,
    pitchMeanHz / 350.0,
    spectralCentroid / 5000.0,
    ...subbands,
  ];

  let norm = 0;
  for (const v of rawVector) norm += v * v;
  const l2 = Math.sqrt(norm) || 1;
  const voiceprint = rawVector.map((v) => v / l2);

  return { voiceprint, pitchMeanHz };
}

export interface VADSegmentResult {
  pcmInt16: Int16Array;
  durationMs: number;
  voiceprint: number[];
  pitchMeanHz: number;
  isPartial?: boolean;
  startTimeOffsetMs?: number;
  endTimeOffsetMs?: number;
}

export class RealTimeVAD {
  private bufferChunks: Int16Array[] = [];
  private preRollChunks: Int16Array[] = [];
  private readonly maxPreRollSamples: number = 9600; // 600ms at 16kHz

  // Rolling 6-second continuous backup ring buffer (96,000 samples at 16kHz)
  // Ensures forceFlush (⌘↵) can ALWAYS grab recent audio even if VAD threshold wasn't crossed
  private rollingBackupChunks: Int16Array[] = [];
  private readonly maxRollingBackupSamples: number = 96000;
  private lastFlushedTimestamp: number = 0;

  private speechStartTimestamp: number | null = null;
  private lastVoicedTimestamp: number | null = null;
  private adaptiveNoiseFloor: number = 0.002;
  private consecutiveVoicedFrames: number = 0;
  private isSpeaking: boolean = false;

  private readonly minSpeechDurationMs = 160;
  private readonly maxSegmentMs = 18000;

  private silenceHangoverMs: number = 600;

  constructor(profile: NvidiaLatencyProfile = 'balanced') {
    this.setLatencyProfile(profile);
  }

  public setLatencyProfile(profile: NvidiaLatencyProfile): void {
    if (profile === 'ultra-low') {
      this.silenceHangoverMs = 420;
    } else if (profile === 'high-accuracy') {
      this.silenceHangoverMs = 900;
    } else {
      this.silenceHangoverMs = 600;
    }
  }

  public processChunk(
    pcmChunk: Int16Array,
    timestamp: number = Date.now()
  ): VADSegmentResult | null {
    const n = pcmChunk.length;
    if (n === 0) return null;

    // Always append to rolling 6s backup buffer
    this.rollingBackupChunks.push(new Int16Array(pcmChunk));
    let rollingSamples = this.rollingBackupChunks.reduce((acc, c) => acc + c.length, 0);
    while (
      this.rollingBackupChunks.length > 1 &&
      rollingSamples - this.rollingBackupChunks[0].length >= this.maxRollingBackupSamples
    ) {
      const dropped = this.rollingBackupChunks.shift();
      if (dropped) rollingSamples -= dropped.length;
    }

    let sumSquares = 0;
    for (let i = 0; i < n; i++) {
      const norm = pcmChunk[i] / 32768.0;
      sumSquares += norm * norm;
    }
    const rms = Math.sqrt(sumSquares / n);

    if (!this.isSpeaking && rms < 0.005) {
      this.adaptiveNoiseFloor = 0.95 * this.adaptiveNoiseFloor + 0.05 * Math.max(0.0006, rms);
    }
    // Sensitive threshold (0.0018) so quiet mic speech and laptop loopback audio trigger reliably
    const threshold = Math.max(0.0018, this.adaptiveNoiseFloor * 1.3);

    const isVoiced = rms > threshold;

    if (isVoiced) {
      this.consecutiveVoicedFrames++;
      this.lastVoicedTimestamp = timestamp;

      if (!this.isSpeaking && this.consecutiveVoicedFrames >= 1) {
        this.isSpeaking = true;
        this.speechStartTimestamp = timestamp - 300;

        this.bufferChunks = [...this.preRollChunks];
        this.preRollChunks = [];
      }
    } else {
      this.consecutiveVoicedFrames = Math.max(0, this.consecutiveVoicedFrames - 1);
    }

    if (!this.isSpeaking) {
      this.preRollChunks.push(new Int16Array(pcmChunk));
      let currentPreRollSamples = this.preRollChunks.reduce((acc, c) => acc + c.length, 0);
      while (
        this.preRollChunks.length > 1 &&
        currentPreRollSamples - this.preRollChunks[0].length >= this.maxPreRollSamples
      ) {
        const removed = this.preRollChunks.shift();
        if (removed) currentPreRollSamples -= removed.length;
      }
      return null;
    }

    this.bufferChunks.push(pcmChunk);

    const speechStart = this.speechStartTimestamp || timestamp;
    const speechDuration = timestamp - speechStart;
    const silenceDuration = timestamp - (this.lastVoicedTimestamp || timestamp);

    if (silenceDuration >= this.silenceHangoverMs || speechDuration >= this.maxSegmentMs) {
      const totalSamples = this.bufferChunks.reduce((acc, c) => acc + c.length, 0);
      if (totalSamples > 1600 && speechDuration >= this.minSpeechDurationMs) {
        const merged = new Int16Array(totalSamples);
        let offset = 0;
        for (const c of this.bufferChunks) {
          merged.set(c, offset);
          offset += c.length;
        }

        const { voiceprint, pitchMeanHz } = extractVoiceprintAndPitch(merged, 16000);

        this.isSpeaking = false;
        this.speechStartTimestamp = null;
        this.lastVoicedTimestamp = null;
        this.consecutiveVoicedFrames = 0;
        this.bufferChunks = [];
        this.rollingBackupChunks = [];
        this.lastFlushedTimestamp = timestamp;

        return {
          pcmInt16: merged,
          durationMs: speechDuration,
          voiceprint,
          pitchMeanHz,
          isPartial: false,
          startTimeOffsetMs: speechStart,
          endTimeOffsetMs: timestamp,
        };
      } else {
        this.isSpeaking = false;
        this.bufferChunks = [];
      }
    }

    return null;
  }

  /**
   * Immediately flush any buffered speech samples when ⌘↵ or Assist is triggered.
   * If active bufferChunks is empty and no segment was flushed in the last 1.8s,
   * falls back to the rolling 6s backup buffer if it contains audible energy!
   */
  public forceFlush(): VADSegmentResult | null {
    const now = Date.now();
    let chunksToFlush = this.bufferChunks;

    let totalSamples = chunksToFlush.reduce((acc, c) => acc + c.length, 0);
    if (totalSamples < 1600 && now - this.lastFlushedTimestamp > 1800) {
      // Check if rollingBackupChunks has audible speech energy
      const backupSamples = this.rollingBackupChunks.reduce((acc, c) => acc + c.length, 0);
      if (backupSamples >= 3200) {
        let sumSq = 0;
        for (const c of this.rollingBackupChunks) {
          for (let i = 0; i < c.length; i++) {
            const norm = c[i] / 32768.0;
            sumSq += norm * norm;
          }
        }
        const backupRms = Math.sqrt(sumSq / backupSamples);
        if (backupRms > 0.0012) {
          chunksToFlush = this.rollingBackupChunks;
          totalSamples = backupSamples;
        }
      }
    }

    if (totalSamples >= 1600) {
      const merged = new Int16Array(totalSamples);
      let offset = 0;
      for (const c of chunksToFlush) {
        merged.set(c, offset);
        offset += c.length;
      }

      const { voiceprint, pitchMeanHz } = extractVoiceprintAndPitch(merged, 16000);
      const speechDuration = Math.round((totalSamples / 16000) * 1000);
      const speechStart = this.speechStartTimestamp || now - speechDuration;

      this.isSpeaking = false;
      this.bufferChunks = [];
      this.preRollChunks = [];
      this.rollingBackupChunks = [];
      this.speechStartTimestamp = null;
      this.lastVoicedTimestamp = null;
      this.consecutiveVoicedFrames = 0;
      this.lastFlushedTimestamp = now;

      return {
        pcmInt16: merged,
        durationMs: speechDuration,
        voiceprint,
        pitchMeanHz,
        isPartial: false,
        startTimeOffsetMs: speechStart,
        endTimeOffsetMs: now,
      };
    }

    this.reset();
    return null;
  }

  public reset(): void {
    this.bufferChunks = [];
    this.preRollChunks = [];
    this.rollingBackupChunks = [];
    this.speechStartTimestamp = null;
    this.lastVoicedTimestamp = null;
    this.isSpeaking = false;
    this.consecutiveVoicedFrames = 0;
  }
}

export interface SpeakerCluster {
  id: string;
  label: string;
  centroid: number[];
  count: number;
  trackIndex: number;
}

export interface ResolvedSpeaker {
  role: 'me' | 'them';
  speakerId: string;
  speakerLabel: string;
  trackIndex: number;
  speakerColor: string;
}

export class SpeakerDiarizer {
  private remoteSpeakers: SpeakerCluster[] = [];
  private roomParticipants: SpeakerCluster[] = [];
  private remoteCounter: number = 1;
  private participantCounter: number = 0;

  public resolveSpeaker(
    voiceprint: number[],
    sourceChannel: 'mic' | 'system',
    meetingEnvironment: 'online' | 'offline',
    savedProfiles: SpeakerVoiceProfile[]
  ): ResolvedSpeaker {
    const userProfile = savedProfiles.find((p) => p.isSelf);

    if (sourceChannel === 'mic') {
      return {
        role: 'me',
        speakerId: 'me',
        speakerLabel: userProfile?.name || 'Me',
        trackIndex: 0,
        speakerColor: getSpeakerColor(0),
      };
    }

    if (meetingEnvironment === 'online') {
      return this.clusterThemSpeaker(voiceprint, savedProfiles);
    }

    if (userProfile && userProfile.mfccCentroid.length === voiceprint.length) {
      const simWithSelf = cosineSimilarity(voiceprint, userProfile.mfccCentroid);
      if (simWithSelf >= 0.78) {
        return {
          role: 'me',
          speakerId: 'me',
          speakerLabel: userProfile.name || 'Me',
          trackIndex: 0,
          speakerColor: getSpeakerColor(0),
        };
      }
    }

    return this.clusterRoomParticipant(voiceprint);
  }

  private clusterThemSpeaker(
    voiceprint: number[],
    savedProfiles: SpeakerVoiceProfile[]
  ): ResolvedSpeaker {
    for (let idx = 0; idx < savedProfiles.length; idx++) {
      const profile = savedProfiles[idx];
      if (!profile.isSelf && profile.mfccCentroid.length === voiceprint.length) {
        const sim = cosineSimilarity(voiceprint, profile.mfccCentroid);
        if (sim >= 0.82) {
          const trackIndex = (idx % 3) + 1;
          return {
            role: 'them',
            speakerId: profile.id,
            speakerLabel: profile.name,
            trackIndex,
            speakerColor: getSpeakerColor(trackIndex),
          };
        }
      }
    }

    let bestMatch: SpeakerCluster | null = null;
    let highestSim = -1;

    for (const speaker of this.remoteSpeakers) {
      const sim = cosineSimilarity(voiceprint, speaker.centroid);
      if (sim > highestSim) {
        highestSim = sim;
        bestMatch = speaker;
      }
    }

    if (bestMatch && highestSim >= 0.82) {
      for (let i = 0; i < bestMatch.centroid.length; i++) {
        bestMatch.centroid[i] =
          (bestMatch.centroid[i] * bestMatch.count + voiceprint[i]) / (bestMatch.count + 1);
      }
      bestMatch.count++;
      return {
        role: 'them',
        speakerId: bestMatch.id,
        speakerLabel: bestMatch.label,
        trackIndex: bestMatch.trackIndex,
        speakerColor: getSpeakerColor(bestMatch.trackIndex),
      };
    }

    const trackIndex = (this.remoteSpeakers.length % 3) + 1;
    const newId = `speaker_${this.remoteCounter}`;
    const newLabel = `Speaker ${this.remoteCounter}`;
    this.remoteCounter++;

    const newCluster: SpeakerCluster = {
      id: newId,
      label: newLabel,
      centroid: [...voiceprint],
      count: 1,
      trackIndex,
    };
    this.remoteSpeakers.push(newCluster);

    return {
      role: 'them',
      speakerId: newId,
      speakerLabel: newLabel,
      trackIndex,
      speakerColor: getSpeakerColor(trackIndex),
    };
  }

  private clusterRoomParticipant(voiceprint: number[]): ResolvedSpeaker {
    let bestMatch: SpeakerCluster | null = null;
    let highestSim = -1;

    for (const participant of this.roomParticipants) {
      const sim = cosineSimilarity(voiceprint, participant.centroid);
      if (sim > highestSim) {
        highestSim = sim;
        bestMatch = participant;
      }
    }

    if (bestMatch && highestSim >= 0.76) {
      for (let i = 0; i < bestMatch.centroid.length; i++) {
        bestMatch.centroid[i] =
          (bestMatch.centroid[i] * bestMatch.count + voiceprint[i]) / (bestMatch.count + 1);
      }
      bestMatch.count++;
      return {
        role: 'them',
        speakerId: bestMatch.id,
        speakerLabel: bestMatch.label,
        trackIndex: bestMatch.trackIndex,
        speakerColor: getSpeakerColor(bestMatch.trackIndex),
      };
    }

    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const letter = letters[this.participantCounter % letters.length];
    const trackIndex = (this.roomParticipants.length % 3) + 1;
    const newId = `participant_${letter.toLowerCase()}`;
    const newLabel = `Participant ${letter}`;
    this.participantCounter++;

    const newCluster: SpeakerCluster = {
      id: newId,
      label: newLabel,
      centroid: [...voiceprint],
      count: 1,
      trackIndex,
    };
    this.roomParticipants.push(newCluster);

    return {
      role: 'them',
      speakerId: newId,
      speakerLabel: newLabel,
      trackIndex,
      speakerColor: getSpeakerColor(trackIndex),
    };
  }

  public renameSpeaker(speakerId: string, newName: string): void {
    const rMatch = this.remoteSpeakers.find((s) => s.id === speakerId);
    if (rMatch) rMatch.label = newName;

    const pMatch = this.roomParticipants.find((s) => s.id === speakerId);
    if (pMatch) pMatch.label = newName;
  }

  public reset(): void {
    this.remoteSpeakers = [];
    this.roomParticipants = [];
    this.remoteCounter = 1;
    this.participantCounter = 0;
  }
}

export function enrollUserVoice(pcmInt16: Int16Array): SpeakerVoiceProfile {
  const { voiceprint, pitchMeanHz } = extractVoiceprintAndPitch(pcmInt16, 16000);
  return {
    id: 'self',
    name: 'Me',
    isSelf: true,
    mfccCentroid: voiceprint,
    pitchMeanHz,
    createdAt: Date.now(),
  };
}
