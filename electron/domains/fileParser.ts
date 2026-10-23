import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { dialog } from 'electron';
import { store } from './store';
import { CluelyModeFile } from '../../src/types/ipc';

const MAX_EXTRACTED_CHARS = 40000;

export class FileParser {
  /**
   * Main text extractor supporting .docx, .pdf, code files, and plain text
   */
  public async extractText(filePath: string, fileBuffer?: Buffer): Promise<string> {
    const buffer = fileBuffer || (await fs.promises.readFile(filePath));
    const ext = path.extname(filePath).toLowerCase();

    let rawText = '';

    if (ext === '.docx') {
      rawText = this.extractFromDocx(buffer);
    } else if (ext === '.pdf') {
      rawText = this.extractFromPdf(buffer);
    } else {
      // Plain text, markdown, source code, json, csv, etc.
      rawText = buffer.toString('utf-8');
    }

    // Clean whitespace and enforce 40,000 char cap
    const cleaned = rawText
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (cleaned.length > MAX_EXTRACTED_CHARS) {
      return (
        cleaned.slice(0, MAX_EXTRACTED_CHARS) +
        `\n\n[... Truncated: File exceeded ${MAX_EXTRACTED_CHARS} character context limit ...]`
      );
    }

    return cleaned;
  }

  /**
   * Native ZIP & XML parser for Word (.docx) files without third-party native binaries
   */
  private extractFromDocx(buffer: Buffer): string {
    try {
      // Find 'word/document.xml' within the zip local file headers
      let offset = 0;
      const len = buffer.length;

      while (offset < len - 30) {
        // Look for local file header signature: 0x04034b50 (PK\x03\x04)
        if (
          buffer[offset] === 0x50 &&
          buffer[offset + 1] === 0x4b &&
          buffer[offset + 2] === 0x03 &&
          buffer[offset + 3] === 0x04
        ) {
          const compressionMethod = buffer.readUInt16LE(offset + 8);
          const compressedSize = buffer.readUInt32LE(offset + 18);
          const fileNameLen = buffer.readUInt16LE(offset + 26);
          const extraFieldLen = buffer.readUInt16LE(offset + 28);

          const fileNameStart = offset + 30;
          const fileName = buffer.toString('utf8', fileNameStart, fileNameStart + fileNameLen);
          const dataStart = fileNameStart + fileNameLen + extraFieldLen;

          if (fileName === 'word/document.xml') {
            const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);
            let xmlContent = '';

            if (compressionMethod === 8) {
              const decompressed = zlib.inflateRawSync(compressedData);
              xmlContent = decompressed.toString('utf8');
            } else if (compressionMethod === 0) {
              xmlContent = compressedData.toString('utf8');
            }

            if (xmlContent) {
              // Extract text inside <w:t>...</w:t> tags
              const matches = xmlContent.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
              if (matches) {
                return matches
                  .map((tag) => tag.replace(/<w:t[^>]*>|<\/w:t>/g, ''))
                  .join(' ');
              }
            }
          }

          offset = dataStart + compressedSize;
        } else {
          offset++;
        }
      }
    } catch (err) {
      console.warn('[FileParser] Error parsing .docx file:', err);
    }

    return '';
  }

  /**
   * PDF Text extractor using Flate stream decompression and PDF text operators
   */
  private extractFromPdf(buffer: Buffer): string {
    const textPieces: string[] = [];
    const bufString = buffer.toString('binary');

    try {
      // Find all stream / endstream segments
      const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
      let match: RegExpExecArray | null;

      while ((match = streamRegex.exec(bufString)) !== null) {
        const streamData = Buffer.from(match[1], 'binary');
        let decompressed: Buffer | null = null;

        try {
          decompressed = zlib.inflateSync(streamData);
        } catch {
          try {
            decompressed = zlib.inflateRawSync(streamData);
          } catch {
            decompressed = streamData;
          }
        }

        if (decompressed) {
          const str = decompressed.toString('latin1');

          // Extract text from (text) Tj
          const tjMatches = str.match(/\((.*?)\)\s*Tj/g);
          if (tjMatches) {
            for (const item of tjMatches) {
              const textOnly = item.replace(/^\(/, '').replace(/\)\s*Tj$/, '');
              textPieces.push(textOnly);
            }
          }

          // Extract text from [(t1)(t2)] TJ
          const bigTjMatches = str.match(/\[(.*?)\]\s*TJ/g);
          if (bigTjMatches) {
            for (const item of bigTjMatches) {
              const inner = item.replace(/^\[/, '').replace(/\]\s*TJ$/, '');
              const strings = inner.match(/\((.*?)\)/g);
              if (strings) {
                const joined = strings.map((s) => s.slice(1, -1)).join('');
                textPieces.push(joined);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[FileParser] Error parsing PDF text:', err);
    }

    if (textPieces.length > 0) {
      return textPieces.join(' ');
    }

    // Fallback: search for readable ASCII sequences in the buffer
    const asciiMatches = bufString.match(/[A-Za-z0-9\s.,!?:;\-_'"()]{6,}/g);
    return asciiMatches ? asciiMatches.slice(0, 500).join(' ') : '';
  }

  /**
   * Attach files to a specific Cluely mode and persist in store
   */
  public async attachFilesToMode(
    modeId: string,
    incomingFiles: Array<{ name: string; path?: string; base64Data?: string }>
  ): Promise<CluelyModeFile[]> {
    const state = store.getState();
    const mode = state.modes.find((m) => m.id === modeId);
    if (!mode) {
      throw new Error(`Mode '${modeId}' not found`);
    }

    const createdModeFiles: CluelyModeFile[] = [];

    for (const file of incomingFiles) {
      let extractedText = '';
      let fileSize = 0;

      if (file.path && fs.existsSync(file.path)) {
        const stats = await fs.promises.stat(file.path);
        fileSize = stats.size;
        extractedText = await this.extractText(file.path);
      } else if (file.base64Data) {
        const buffer = Buffer.from(file.base64Data, 'base64');
        fileSize = buffer.length;
        extractedText = await this.extractText(file.name, buffer);
      }

      const modeFile: CluelyModeFile = {
        id: `file_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        name: file.name,
        path: file.path || '',
        size: fileSize,
        extractedText,
        addedAt: Date.now(),
      };

      createdModeFiles.push(modeFile);
    }

    const updatedModes = state.modes.map((m) => {
      if (m.id === modeId) {
        return {
          ...m,
          files: [...m.files, ...createdModeFiles],
        };
      }
      return m;
    });

    store.patchState({ modes: updatedModes });
    return createdModeFiles;
  }

  /**
   * Remove a file from a mode
   */
  public async removeFileFromMode(modeId: string, fileId: string): Promise<boolean> {
    const state = store.getState();
    const mode = state.modes.find((m) => m.id === modeId);
    if (!mode) return false;

    const updatedModes = state.modes.map((m) => {
      if (m.id === modeId) {
        return {
          ...m,
          files: m.files.filter((f) => f.id !== fileId),
        };
      }
      return m;
    });

    store.patchState({ modes: updatedModes });
    return true;
  }

  /**
   * Show native file picker dialog and attach chosen files to mode
   */
  public async pickFilesDialog(modeId: string): Promise<CluelyModeFile[]> {
    const result = await dialog.showOpenDialog({
      title: 'Select Knowledge Files for Mode',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Documents & Code',
          extensions: [
            'pdf',
            'docx',
            'txt',
            'md',
            'json',
            'csv',
            'ts',
            'tsx',
            'js',
            'py',
            'java',
            'go',
            'rs',
            'cpp',
            'sql',
            'yaml',
            'yml',
            'html',
            'css',
          ],
        },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    const incoming = result.filePaths.map((p) => ({
      name: path.basename(p),
      path: p,
    }));

    return this.attachFilesToMode(modeId, incoming);
  }
}

export const fileParser = new FileParser();
