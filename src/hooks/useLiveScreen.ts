import { useState, useEffect, useRef, useCallback } from 'react';
import { ScreenCaptureResult, ScreenSourceInfo } from '../types/ipc';

export interface AttachedScreenshot {
  id: string;
  dataUrl: string;
  sourceName: string;
  timestamp: number;
}

export function useLiveScreen(isLiveScreenActive: boolean, selectedSourceId: string | null) {
  const [sources, setSources] = useState<ScreenSourceInfo[]>([]);
  const [selectedSource, setSelectedSource] = useState<ScreenSourceInfo | null>(null);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [latestFrameDataUrl, setLatestFrameDataUrl] = useState<string | null>(null);
  const [attachedScreenshots, setAttachedScreenshots] = useState<AttachedScreenshot[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sampleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const refreshSources = useCallback(async () => {
    if (window.cluely && window.cluely.getScreenSources) {
      const list = await window.cluely.getScreenSources();
      setSources(list);
      if (selectedSourceId) {
        const found = list.find((s) => s.id === selectedSourceId);
        if (found) setSelectedSource(found);
      } else if (list.length > 0 && !selectedSource) {
        setSelectedSource(list[0]);
      }
      return list;
    }
    return [];
  }, [selectedSourceId, selectedSource]);

  useEffect(() => {
    refreshSources();
  }, [refreshSources]);

  const stopLiveStream = useCallback(() => {
    if (sampleTimerRef.current) {
      clearInterval(sampleTimerRef.current);
      sampleTimerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsStreaming(false);
  }, []);

  const sampleFrameFromVideo = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      return null;
    }

    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
    }

    const canvas = offscreenCanvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
    setLatestFrameDataUrl(dataUrl);
    return dataUrl;
  }, []);

  const startLiveStream = useCallback(
    async (targetSourceId?: string) => {
      stopLiveStream();

      const sourceIdToUse = targetSourceId || selectedSourceId || sources[0]?.id;
      if (!sourceIdToUse) {
        console.warn('[useLiveScreen] No screen source available to stream');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceIdToUse,
              maxWidth: 1920,
              maxHeight: 1080,
              maxFrameRate: 15,
            },
          } as unknown as MediaTrackConstraints,
        });

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch((err) => {
            console.error('[useLiveScreen] Video playback failed:', err);
          });
        }

        setIsStreaming(true);

        // Start 2000ms offscreen canvas frame sampler
        sampleTimerRef.current = setInterval(() => {
          sampleFrameFromVideo();
        }, 2000);
      } catch (error) {
        console.error('[useLiveScreen] Failed to acquire desktop media stream:', error);
        setIsStreaming(false);
      }
    },
    [selectedSourceId, sources, stopLiveStream, sampleFrameFromVideo]
  );

  // Sync stream with isLiveScreenActive
  useEffect(() => {
    if (isLiveScreenActive && !isStreaming) {
      startLiveStream();
    } else if (!isLiveScreenActive && isStreaming) {
      stopLiveStream();
    }
  }, [isLiveScreenActive, isStreaming, startLiveStream, stopLiveStream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopLiveStream();
    };
  }, [stopLiveStream]);

  const captureCurrentFrame = useCallback(async (): Promise<AttachedScreenshot | null> => {
    // If video is streaming, sample directly from video element
    const sampled = sampleFrameFromVideo();
    if (sampled) {
      const newSnap: AttachedScreenshot = {
        id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        dataUrl: sampled,
        sourceName: selectedSource?.name || 'Live Screen',
        timestamp: Date.now(),
      };
      setAttachedScreenshots((prev) => [newSnap, ...prev]);
      return newSnap;
    }

    // Otherwise, capture via desktopCapturer IPC
    if (window.cluely && window.cluely.captureScreen) {
      const res: ScreenCaptureResult | null = await window.cluely.captureScreen(
        selectedSource?.id
      );
      if (res && (res.dataUrl || res.data)) {
        const url = res.dataUrl || `data:${res.mimeType};base64,${res.data}`;
        const newSnap: AttachedScreenshot = {
          id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          dataUrl: url,
          sourceName: res.sourceName || selectedSource?.name || 'Screen Snapshot',
          timestamp: res.timestamp || Date.now(),
        };
        setAttachedScreenshots((prev) => [newSnap, ...prev]);
        return newSnap;
      }
    }
    return null;
  }, [sampleFrameFromVideo, selectedSource]);

  const snapManualScreenshot = useCallback(async (): Promise<AttachedScreenshot | null> => {
    if (window.cluely && window.cluely.captureScreen) {
      const res: ScreenCaptureResult | null = await window.cluely.captureScreen(
        selectedSource?.id
      );
      if (res && (res.dataUrl || res.data)) {
        const url = res.dataUrl || `data:${res.mimeType};base64,${res.data}`;
        const newSnap: AttachedScreenshot = {
          id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          dataUrl: url,
          sourceName: res.sourceName || selectedSource?.name || 'Screen Snapshot',
          timestamp: res.timestamp || Date.now(),
        };
        setAttachedScreenshots((prev) => [newSnap, ...prev]);
        return newSnap;
      }
    }
    return null;
  }, [selectedSource]);

  const removeScreenshot = useCallback((id: string) => {
    setAttachedScreenshots((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const clearScreenshots = useCallback(() => {
    setAttachedScreenshots([]);
  }, []);

  return {
    sources,
    selectedSource,
    setSelectedSource,
    refreshSources,
    isStreaming,
    videoRef,
    latestFrameDataUrl,
    attachedScreenshots,
    startLiveStream,
    stopLiveStream,
    captureCurrentFrame,
    snapManualScreenshot,
    removeScreenshot,
    clearScreenshots,
  };
}
