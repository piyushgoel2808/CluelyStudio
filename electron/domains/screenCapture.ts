import { desktopCapturer } from 'electron';
import { windowManager } from './windowManager';
import { ScreenCaptureResult, ScreenSourceInfo } from '../../src/types/ipc';

export class ScreenCaptureService {
  public async listScreenSources(): Promise<ScreenSourceInfo[]> {
    try {
      const rawSources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 240, height: 135 },
        fetchWindowIcons: true,
      });

      const excludedTitlePrefixes = [
        'Cluely',
        'CluelyStudio',
        'Cluely Settings',
        'Cluely Studio Settings',
        'Terminal ',
      ];

      const filtered = rawSources.filter((source) => {
        const name = source.name.trim();
        if (!name) return false;
        return !excludedTitlePrefixes.some((prefix) => name.startsWith(prefix));
      });

      return filtered.map((source) => {
        const isScreen = source.id.startsWith('screen:');
        const thumb = source.thumbnail.toDataURL();
        const icon = source.appIcon ? source.appIcon.toDataURL() : undefined;
        return {
          id: source.id,
          name: source.name || (isScreen ? 'Full Screen' : 'Application Window'),
          type: isScreen ? 'screen' : 'window',
          thumbnail: thumb,
          thumbnailDataUrl: thumb,
          appIconDataUrl: icon,
          displayId: source.display_id,
        };
      });
    } catch (err) {
      console.warn('[ScreenCapture] Could not retrieve screen sources (grant Screen Recording in macOS System Settings if prompted):', err);
      return [];
    }
  }

  public async captureSelfExcludedSnapshot(
    sourceId?: string
  ): Promise<ScreenCaptureResult | null> {
    windowManager.applyContentProtection(true);

    // Compositor flush: give macOS Quartz / Windows DWM 35ms to commit window exclusion
    await new Promise((resolve) => setTimeout(resolve, 35));

    try {
      // Only query 'window' if sourceId explicitly specifies a window to prevent OOM
      const isWindowSource = sourceId && sourceId.startsWith('window:');
      const types: ('screen' | 'window')[] = isWindowSource ? ['window'] : ['screen'];

      const sources = await desktopCapturer.getSources({
        types,
        thumbnailSize: { width: 1280, height: 720 },
      });

      let target = sourceId ? sources.find((s) => s.id === sourceId) : undefined;
      if (!target) {
        target = sources.find((s) => s.id.startsWith('screen:')) || sources[0];
      }

      if (!target || target.thumbnail.isEmpty()) {
        return null;
      }

      const imageSize = target.thumbnail.getSize();
      // Use efficient JPEG compression to conserve memory
      const jpegBuffer = target.thumbnail.toJPEG(80);
      const base64Data = jpegBuffer.toString('base64');
      const dataUrl = `data:image/jpeg;base64,${base64Data}`;

      return {
        data: base64Data,
        mimeType: 'image/jpeg',
        dataUrl,
        width: imageSize.width,
        height: imageSize.height,
        sourceName: target.name || 'Screen',
        timestamp: Date.now(),
      };
    } catch (err) {
      console.warn('[ScreenCapture] captureSelfExcludedSnapshot failed (Screen Recording permission may be required):', err);
      return null;
    } finally {
      windowManager.applyContentProtection(false);
    }
  }
}

export const screenCaptureService = new ScreenCaptureService();
