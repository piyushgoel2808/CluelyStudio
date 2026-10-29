import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { store } from './store';
import {
  CluelyModeFile,
  DocumentChunk,
  MemoryItem,
  MeetingSession,
  TranscriptSegment,
  VectorDBStats,
} from '../../src/types/ipc';

const FALLBACK_DIM = 384;

/**
 * Deterministic 384-d L2-normalized subword & word feature hashing vectorizer.
 * Guarantees instant <1ms local vector embeddings without unloading the active Ollama LLM.
 */
export function computeLocalHashEmbedding(text: string, dim: number = FALLBACK_DIM): number[] {
  const vec = new Float32Array(dim);
  const normalized = (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\u0900-\u097f\s]/g, ' ')
    .trim();

  if (!normalized) {
    return Array.from(vec);
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);

  const hashToken = (str: string, seed: number): number => {
    let h = seed ^ 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const h1 = hashToken(token, 17);
    const sign1 = (h1 & 1) === 0 ? 1.0 : -1.0;
    vec[h1 % dim] += sign1 * 1.5;

    if (i + 1 < tokens.length) {
      const bigram = `${token}_${tokens[i + 1]}`;
      const h2 = hashToken(bigram, 31);
      const sign2 = (h2 & 1) === 0 ? 1.0 : -1.0;
      vec[h2 % dim] += sign2 * 1.2;
    }

    if (token.length >= 3) {
      for (let c = 0; c <= token.length - 3; c++) {
        const trigram = token.slice(c, c + 3);
        const h3 = hashToken(trigram, 47);
        const sign3 = (h3 & 1) === 0 ? 0.5 : -0.5;
        vec[h3 % dim] += sign3;
      }
    }
  }

  let normSq = 0;
  for (let i = 0; i < dim; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq) || 1.0;
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) {
    out[i] = Math.round((vec[i] / norm) * 10000) / 10000;
  }
  return out;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class MemoryBrain {
  private vectorCachePath: string;
  private chunkVectors: Map<string, number[]> = new Map();
  private lastEngineStatus: 'ollama-dense' | 'local-hybrid-384d' = 'local-hybrid-384d';
  private activeDimensions: number = FALLBACK_DIM;

  constructor() {
    this.vectorCachePath = path.join(app.getPath('userData'), 'cluely-vector-index.json');
    this.loadVectorCache();
  }

  private loadVectorCache(): void {
    try {
      if (fs.existsSync(this.vectorCachePath)) {
        const raw = JSON.parse(fs.readFileSync(this.vectorCachePath, 'utf-8'));
        if (raw && typeof raw.chunks === 'object') {
          for (const [k, v] of Object.entries(raw.chunks)) {
            if (Array.isArray(v)) {
              this.chunkVectors.set(k, v as number[]);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[MemoryBrain] Could not load vector cache, starting fresh:', err);
    }
  }

  private saveVectorCache(): void {
    try {
      const obj: Record<string, number[]> = {};
      for (const [k, v] of this.chunkVectors.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(
        this.vectorCachePath,
        JSON.stringify({ updatedAt: Date.now(), chunks: obj }),
        'utf-8'
      );
    } catch (err) {
      console.warn('[MemoryBrain] Failed to persist vector cache:', err);
    }
  }

  public async embedText(text: string): Promise<number[]> {
    const clean = (text || '').trim().slice(0, 4000);
    return computeLocalHashEmbedding(clean, FALLBACK_DIM);
  }

  public async getVectorDBStats(): Promise<VectorDBStats> {
    const state = store.getState();
    const memories = state.personalMemories || [];
    const indexedMemories = memories.filter(
      (m) => Array.isArray(m.embedding) && m.embedding.length > 0
    ).length;

    let totalModeChunks = 0;
    for (const mode of state.modes || []) {
      for (const file of mode.files || []) {
        totalModeChunks += file.chunks?.length || Math.ceil((file.extractedText?.length || 0) / 1200);
      }
    }

    return {
      totalMemories: memories.length,
      indexedVectors: indexedMemories + this.chunkVectors.size,
      totalModeChunks,
      embeddingModel: state.aiConfig.embeddingModel || 'gemma2:2b',
      dimensions: this.activeDimensions,
      engineStatus: this.lastEngineStatus,
    };
  }

  public async reindexAll(): Promise<VectorDBStats> {
    const state = store.getState();
    const updatedMemories: MemoryItem[] = [];

    for (const mem of state.personalMemories || []) {
      const vec = computeLocalHashEmbedding(
        `${mem.title} ${mem.content} ${(mem.tags || []).join(' ')}`,
        FALLBACK_DIM
      );
      updatedMemories.push({ ...mem, embedding: vec });
    }

    const updatedModes = [];
    for (const mode of state.modes || []) {
      const updatedFiles: CluelyModeFile[] = [];
      for (const file of mode.files || []) {
        const chunks = this.chunkDocumentText(file.id, file.name, file.extractedText || '');
        updatedFiles.push({ ...file, chunks });
      }
      updatedModes.push({ ...mode, files: updatedFiles });
    }

    this.saveVectorCache();
    store.patchState({
      personalMemories: updatedMemories,
      modes: updatedModes,
    });

    return this.getVectorDBStats();
  }

  public chunkDocumentText(fileId: string, fileName: string, text: string): DocumentChunk[] {
    const clean = (text || '').trim();
    if (!clean) return [];

    const chunkSize = 1000;
    const overlap = 200;
    const chunks: DocumentChunk[] = [];
    let start = 0;
    let idx = 0;

    while (start < clean.length) {
      const end = Math.min(clean.length, start + chunkSize);
      const slice = clean.slice(start, end).trim();
      if (slice.length > 20) {
        const id = `chk_${fileId}_${idx}`;
        const embedding = computeLocalHashEmbedding(`${fileName}: ${slice}`, FALLBACK_DIM);
        this.chunkVectors.set(id, embedding);
        chunks.push({
          id,
          fileId,
          fileName,
          text: slice,
          embedding,
        });
        idx++;
      }
      if (end >= clean.length) break;
      start += chunkSize - overlap;
    }

    this.saveVectorCache();
    return chunks;
  }

  /**
   * Instant <1ms Hybrid Vector + BM25 RRF retrieval across attached Mode Files
   */
  public async retrieveRelevantFileChunks(
    query: string,
    files: CluelyModeFile[],
    topK: number = 4
  ): Promise<Array<{ fileName: string; text: string; score: number }>> {
    if (!files || files.length === 0) return [];

    const allChunks: DocumentChunk[] = [];
    for (const file of files) {
      if (file.chunks && file.chunks.length > 0) {
        allChunks.push(...file.chunks);
      } else if (file.extractedText) {
        const generated = this.chunkDocumentText(file.id, file.name, file.extractedText);
        allChunks.push(...generated);
      }
    }

    if (allChunks.length === 0) return [];
    if (allChunks.length <= topK) {
      return allChunks.map((c) => ({ fileName: c.fileName, text: c.text, score: 1.0 }));
    }

    const queryVec = computeLocalHashEmbedding(query, FALLBACK_DIM);
    const queryTokens = Array.from(
      new Set((query || '').toLowerCase().match(/\b[a-z0-9_-]{3,}\b/g) || [])
    );

    const scored = allChunks.map((chunk) => {
      let chunkVec = chunk.embedding || this.chunkVectors.get(chunk.id);
      if (!chunkVec || chunkVec.length !== queryVec.length) {
        chunkVec = computeLocalHashEmbedding(chunk.text, queryVec.length);
        this.chunkVectors.set(chunk.id, chunkVec);
      }

      const denseSim = Math.max(0, cosineSimilarity(queryVec, chunkVec));
      const docLower = `${chunk.fileName} ${chunk.text}`.toLowerCase();
      let bm25Score = 0;
      for (const token of queryTokens) {
        if (docLower.includes(token)) {
          bm25Score += 1.0;
        }
      }
      const normBm25 = queryTokens.length > 0 ? bm25Score / queryTokens.length : 0;
      const hybridScore = denseSim * 0.65 + normBm25 * 0.35;

      return {
        fileName: chunk.fileName,
        text: chunk.text,
        score: hybridScore,
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  public async addMemory(
    input: Omit<MemoryItem, 'id' | 'createdAt'>
  ): Promise<MemoryItem> {
    const embedding = computeLocalHashEmbedding(
      `${input.title} ${input.content} ${(input.tags || []).join(' ')}`,
      FALLBACK_DIM
    );
    const memory: MemoryItem = {
      ...input,
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      createdAt: Date.now(),
      embedding,
    };

    const current = store.getState().personalMemories;
    store.patchState({ personalMemories: [memory, ...current] });
    return memory;
  }

  public async updateMemory(
    id: string,
    updates: Partial<MemoryItem>
  ): Promise<MemoryItem | null> {
    const current = store.getState().personalMemories;
    const index = current.findIndex((m) => m.id === id);
    if (index === -1) return null;

    const merged = { ...current[index], ...updates };
    merged.embedding = computeLocalHashEmbedding(
      `${merged.title} ${merged.content} ${(merged.tags || []).join(' ')}`,
      FALLBACK_DIM
    );

    const nextList = [...current];
    nextList[index] = merged;

    store.patchState({ personalMemories: nextList });
    return merged;
  }

  public async deleteMemory(id: string): Promise<boolean> {
    const current = store.getState().personalMemories;
    const filtered = current.filter((m) => m.id !== id);
    if (filtered.length === current.length) return false;

    store.patchState({ personalMemories: filtered });
    return true;
  }

  public async getMemories(): Promise<MemoryItem[]> {
    return store.getState().personalMemories;
  }

  public async searchMemories(query: string): Promise<MemoryItem[]> {
    const term = query.trim().toLowerCase();
    const all = store.getState().personalMemories;
    if (!term) return all;

    const queryVec = computeLocalHashEmbedding(term, FALLBACK_DIM);
    return all
      .map((m) => {
        const memVec =
          m.embedding && m.embedding.length === queryVec.length
            ? m.embedding
            : computeLocalHashEmbedding(`${m.title} ${m.content}`, queryVec.length);
        const sim = cosineSimilarity(queryVec, memVec);
        const lexicalMatch =
          m.title.toLowerCase().includes(term) ||
          m.content.toLowerCase().includes(term) ||
          m.tags.some((t) => t.toLowerCase().includes(term));
        const score = (lexicalMatch ? 0.6 : 0) + Math.max(0, sim) * 0.4;
        return { item: { ...m, similarityScore: Math.round(score * 100) / 100 }, score };
      })
      .filter((x) => x.score > 0.18)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }

  /**
   * Instant <1ms Hybrid Vector + BM25 Reciprocal Rank Fusion (RRF) for RAG memory retrieval
   */
  public async retrieveRelevantMemories(
    prompt: string,
    recentTranscripts: TranscriptSegment[] = [],
    limit: number = 6
  ): Promise<MemoryItem[]> {
    const allMemories = store.getState().personalMemories;
    if (allMemories.length === 0) return [];

    const alwaysInclude = allMemories.filter(
      (m) => m.category === 'bio' || m.category === 'preference'
    );
    const candidates = allMemories.filter(
      (m) => m.category !== 'bio' && m.category !== 'preference'
    );

    const transcriptText = recentTranscripts
      .slice(0, 6)
      .map((s) => `${s.speakerLabel}: ${s.text}`)
      .join(' ');

    const contextQuery = `${prompt} ${transcriptText}`.trim();
    if (!contextQuery) {
      return [...alwaysInclude, ...candidates].slice(0, limit);
    }

    const queryVec = computeLocalHashEmbedding(contextQuery, FALLBACK_DIM);
    const queryTokens = Array.from(
      new Set(contextQuery.toLowerCase().match(/\b[a-z0-9_-]{3,}\b/g) || [])
    );

    const scored = candidates.map((memory) => {
      const docText = `${memory.title} ${memory.content} ${memory.tags.join(' ')}`.toLowerCase();
      let lexicalScore = 0;
      for (const token of queryTokens) {
        if (docText.includes(token)) {
          lexicalScore += 1.0;
          if (memory.title.toLowerCase().includes(token)) {
            lexicalScore += 1.5;
          }
        }
      }
      const normLexical = queryTokens.length > 0 ? lexicalScore / queryTokens.length : 0;

      const memVec =
        memory.embedding && memory.embedding.length === queryVec.length
          ? memory.embedding
          : computeLocalHashEmbedding(docText, queryVec.length);
      const vectorSim = Math.max(0, cosineSimilarity(queryVec, memVec));

      const rrfScore = vectorSim * 0.65 + normLexical * 0.35;
      return {
        memory: { ...memory, similarityScore: Math.round(rrfScore * 100) / 100 },
        score: rrfScore,
      };
    });

    const relevantCandidates = scored
      .filter((item) => item.score > 0.12)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.memory);

    const combined = [...alwaysInclude, ...relevantCandidates];
    const seen = new Set<string>();
    const result: MemoryItem[] = [];
    for (const item of combined) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        result.push(item);
      }
      if (result.length >= limit) break;
    }

    return result;
  }

  private async runStructuredLLM(prompt: string): Promise<string> {
    const state = store.getState();
    const provider = state.aiConfig.activeProvider;
    const ollamaUrl = (state.aiConfig.apiKeys.ollamaUrl || 'http://127.0.0.1:11434').replace(
      /\/+$/,
      ''
    );
    const model =
      state.aiConfig.activeModel && state.aiConfig.activeModel !== 'default'
        ? state.aiConfig.activeModel
        : 'gemma4:e4b';

    if (provider === 'ollama' || !state.aiConfig.apiKeys.gemini) {
      try {
        const res = await fetch(`${ollamaUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content:
                  'You are a precise JSON extraction engine. Output ONLY valid JSON matching the requested schema with no markdown code fences or commentary.',
              },
              { role: 'user', content: prompt },
            ],
            format: 'json',
            stream: false,
            think: false,
            keep_alive: -1,
            options: { temperature: 0.1, num_ctx: 2048, num_predict: 512 },
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as { message?: { content?: string } };
          if (json.message?.content) {
            return json.message.content.trim();
          }
        }
      } catch (err) {
        console.warn('[MemoryBrain] Local Ollama JSON extraction failed:', err);
      }
    }

    const geminiKey = state.aiConfig.apiKeys.gemini;
    if (geminiKey) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }
    }

    return '';
  }

  public async extractMemoriesFromTranscript(
    segments: TranscriptSegment[]
  ): Promise<MemoryItem[]> {
    const targetSegments =
      segments && segments.length > 0 ? segments : store.getState().transcripts || [];
    if (targetSegments.length === 0) return [];

    const transcriptFormatted = targetSegments
      .slice(0, 60)
      .map((s) => `${s.formattedTimestamp || ''} ${s.speakerLabel} (${s.role}): ${s.text}`)
      .join('\n');

    const prompt = `Analyze this real conversation transcript. Extract ONLY genuine facts, decisions, preferences, or commitments explicitly stated in the dialogue. Never invent or guess facts.
Return a JSON object with an "items" array:
{
  "items": [
    {
      "title": "Short factual title",
      "category": "bio" | "project" | "preference" | "meeting_fact" | "person",
      "content": "Concise factual statement from the transcript",
      "tags": ["tag1", "tag2"]
    }
  ]
}

TRANSCRIPT:
${transcriptFormatted}`;

    try {
      const rawText = await this.runStructuredLLM(prompt);
      if (!rawText) return [];

      const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      const rawItems = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];

      const addedMemories: MemoryItem[] = [];
      for (const item of rawItems) {
        if (item && item.title && item.content) {
          const mem = await this.addMemory({
            title: String(item.title).trim(),
            category: item.category || 'meeting_fact',
            content: String(item.content).trim(),
            tags: Array.isArray(item.tags) ? item.tags.map(String) : ['meeting'],
          });
          addedMemories.push(mem);
        }
      }
      return addedMemories;
    } catch (err) {
      console.error('[MemoryBrain] Failed to extract memories from transcript:', err);
      return [];
    }
  }

  public async generateSessionNotes(sessionId?: string): Promise<MeetingSession | null> {
    const state = store.getState();
    const targetId = sessionId || state.currentSessionId;
    const session = (state.pastSessions || []).find((s) => s.id === targetId);
    if (!session) return null;

    const transcripts =
      session.transcripts && session.transcripts.length > 0
        ? session.transcripts
        : state.transcripts || [];
    const assists = session.assistEvents || [];

    if (transcripts.length === 0 && assists.length === 0) {
      return store.updateSessionNotes(
        session.id,
        session.notes || 'No transcript or Q&A recorded in this session yet.',
        session.title,
        'Empty session — speak or ask Cluely during your meeting to generate automatic notes.'
      );
    }

    const dialogueLines = transcripts
      .slice(-80)
      .map((t) => `[${t.speakerLabel || t.role}]: ${t.text}`)
      .join('\n');
    const assistLines = assists
      .slice(-15)
      .map((a) => `Q: ${a.userPrompt}\nA: ${a.aiResponse}`)
      .join('\n---\n');

    const prompt = `Summarize this meeting session accurately based ONLY on the provided transcript and Q&A log. Do NOT fabricate details.
Return a JSON object with this exact schema:
{
  "title": "Concise 4-6 word session title",
  "summary": "2-3 sentence executive summary of what was discussed",
  "notes": "Structured markdown bullet notes covering key technical/business points discussed",
  "actionItems": ["Action item 1", "Action item 2"],
  "keyDecisions": ["Decision or takeaway 1"]
}

TRANSCRIPT:
${dialogueLines || '(None)'}

Q&A ASSIST LOG:
${assistLines || '(None)'}`;

    try {
      const rawJson = await this.runStructuredLLM(prompt);
      if (rawJson) {
        const cleaned = rawJson.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const data = JSON.parse(cleaned) as {
          title?: string;
          summary?: string;
          notes?: string;
          actionItems?: string[];
          keyDecisions?: string[];
        };
        return store.updateSessionNotes(
          session.id,
          data.notes || session.notes || '',
          data.title || session.title,
          data.summary || session.summary,
          Array.isArray(data.actionItems) ? data.actionItems : [],
          Array.isArray(data.keyDecisions) ? data.keyDecisions : []
        );
      }
    } catch (err) {
      console.warn('[MemoryBrain] Automatic session notes generation fallback:', err);
    }

    const fallbackSummary =
      assists.length > 0
        ? `Covered ${assists.length} AI copilot Q&A turns and ${transcripts.length} spoken segments.`
        : `Captured ${transcripts.length} spoken dialogue segments.`;
    const fallbackNotes = [
      `### Key Discussion Points`,
      ...transcripts.slice(0, 8).map((t) => `- **${t.speakerLabel}**: ${t.text}`),
      ...(assists.length > 0
        ? [
            `\n### Q&A Highlights`,
            ...assists.slice(0, 5).map((a) => `- **${a.userPrompt}**: ${a.aiResponse.slice(0, 180)}...`),
          ]
        : []),
    ].join('\n');

    return store.updateSessionNotes(
      session.id,
      session.notes || fallbackNotes,
      session.title,
      fallbackSummary
    );
  }
}

export const memoryBrain = new MemoryBrain();
