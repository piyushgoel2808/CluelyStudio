import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { windowManager } from './windowManager';

export function resolveSidecarPath(sidecarRelPath: string): string | null {
  const isPackaged = app.isPackaged;
  const candidates = isPackaged
    ? [
        path.join(process.resourcesPath, 'extra-resources', sidecarRelPath),
        path.join(app.getAppPath(), 'extra-resources', sidecarRelPath),
      ]
    : [
        path.join(process.cwd(), 'extra-resources', sidecarRelPath),
        path.join(__dirname, '../../extra-resources', sidecarRelPath),
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Continue checking other candidates
      }
    }
  }
  return null;
}

export function encodePcmToWavBase64(pcmInt16: Int16Array, sampleRate: number = 16000): string {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataByteLength = pcmInt16.byteLength;
  const totalBufferSize = 44 + dataByteLength;

  const buffer = Buffer.alloc(totalBufferSize);

  // RIFF Chunk Descriptor
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write('WAVE', 8, 'ascii');

  // "fmt " sub-chunk
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // Subchunk1Size for PCM
  buffer.writeUInt16LE(1, 20); // AudioFormat = 1 (Linear PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // "data" sub-chunk
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataByteLength, 40);

  // Copy Int16 PCM samples
  const pcmBuffer = Buffer.from(pcmInt16.buffer, pcmInt16.byteOffset, pcmInt16.byteLength);
  pcmBuffer.copy(buffer, 44);

  return buffer.toString('base64');
}

export class AudioEngine {
  private audioteeProcess: child_process.ChildProcess | null = null;
  private isActive: boolean = false;

  public start(): { success: boolean; error?: string } {
    if (this.isActive) {
      return { success: true };
    }

    if (process.platform === 'darwin') {
      const audioteeBin = resolveSidecarPath('audiotee-0.0.7/audiotee');
      if (audioteeBin) {
        try {
          this.audioteeProcess = child_process.spawn(audioteeBin, [
            '--sample-rate',
            '16000',
            '--chunk-duration',
            '0.2',
          ]);

          this.isActive = true;

          this.audioteeProcess.stdout?.on('data', (data: Buffer) => {
            if (!this.isActive) return;

            // Raw 16000Hz 16-bit signed PCM from audiotee
            const sampleCount = Math.floor(data.length / 2);
            if (sampleCount === 0) return;

            const samples = new Int16Array(
              data.buffer,
              data.byteOffset,
              sampleCount
            );

            // Calculate real-time RMS
            let sumSquare = 0;
            for (let i = 0; i < samples.length; i++) {
              const norm = samples[i] / 32768;
              sumSquare += norm * norm;
            }
            const rms = Math.min(1, Math.sqrt(sumSquare / sampleCount) * 2.8);

            // Broadcast level and PCM chunk to renderers
            windowManager.broadcastToAllWindows('audio:system-level', { rms });
            windowManager.broadcastToAllWindows('audio:system-pcm-chunk', {
              pcmBase64: data.toString('base64'),
              rms,
            });
          });

          this.audioteeProcess.stderr?.on('data', (errData: Buffer) => {
            const msg = errData.toString();
            if (msg.includes('"message_type":"error"')) {
              console.warn('[AudioEngine] audiotee error:', msg);
            }
          });

          this.audioteeProcess.on('exit', (code) => {
            console.log(`[AudioEngine] audiotee exited with code ${code}`);
            this.audioteeProcess = null;
            if (this.isActive) {
              this.isActive = false;
              // Fallback to Chromium loopback audio
              windowManager.broadcastToAllWindows('audio:use-desktop-audio-fallback');
            }
          });

          this.audioteeProcess.on('error', (err) => {
            console.error('[AudioEngine] Failed to spawn audiotee:', err);
            this.audioteeProcess = null;
            this.isActive = false;
            windowManager.broadcastToAllWindows('audio:use-desktop-audio-fallback');
          });

          return { success: true };
        } catch (error) {
          console.error('[AudioEngine] Spawn exception for audiotee:', error);
          windowManager.broadcastToAllWindows('audio:use-desktop-audio-fallback');
          return { success: false, error: String(error) };
        }
      } else {
        console.warn('[AudioEngine] audiotee binary not found, utilizing desktop loopback fallback');
        windowManager.broadcastToAllWindows('audio:use-desktop-audio-fallback');
        this.isActive = true;
        return { success: true };
      }
    } else {
      // Windows / Linux: Instruct renderer to use Chromium loopback audio capture
      windowManager.broadcastToAllWindows('audio:use-desktop-audio-fallback');
      this.isActive = true;
      return { success: true };
    }
  }

  public stop(): { success: boolean } {
    this.isActive = false;
    if (this.audioteeProcess) {
      try {
        this.audioteeProcess.kill('SIGTERM');
        const proc = this.audioteeProcess;
        setTimeout(() => {
          if (proc && !proc.killed) {
            proc.kill('SIGKILL');
          }
        }, 300);
      } catch (err) {
        console.error('[AudioEngine] Error killing audiotee:', err);
      }
      this.audioteeProcess = null;
    }
    return { success: true };
  }

  public isRunning(): boolean {
    return this.isActive;
  }
}

export const audioEngine = new AudioEngine();
