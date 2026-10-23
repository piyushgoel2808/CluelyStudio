import { store } from './store';
import { MemoryItem, TranscriptSegment } from '../../src/types/ipc';

export class MemoryBrain {
  /**
   * Add a new memory item and persist to store
   */
  public async addMemory(
    input: Omit<MemoryItem, 'id' | 'createdAt'>
  ): Promise<MemoryItem> {
    const memory: MemoryItem = {
      ...input,
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      createdAt: Date.now(),
    };

    const current = store.getState().personalMemories;
    store.patchState({ personalMemories: [memory, ...current] });
    return memory;
  }

  /**
   * Update an existing memory
   */
  public async updateMemory(
    id: string,
    updates: Partial<MemoryItem>
  ): Promise<MemoryItem | null> {
    const current = store.getState().personalMemories;
    const index = current.findIndex((m) => m.id === id);
    if (index === -1) return null;

    const updatedItem = { ...current[index], ...updates };
    const nextList = [...current];
    nextList[index] = updatedItem;

    store.patchState({ personalMemories: nextList });
    return updatedItem;
  }

  /**
   * Delete a memory by ID
   */
  public async deleteMemory(id: string): Promise<boolean> {
    const current = store.getState().personalMemories;
    const filtered = current.filter((m) => m.id !== id);
    if (filtered.length === current.length) return false;

    store.patchState({ personalMemories: filtered });
    return true;
  }

  /**
   * Get all personal memories
   */
  public async getMemories(): Promise<MemoryItem[]> {
    return store.getState().personalMemories;
  }

  /**
   * Keyword / full-text search across title, content, and tags
   */
  public async searchMemories(query: string): Promise<MemoryItem[]> {
    const term = query.trim().toLowerCase();
    if (!term) return store.getState().personalMemories;

    const current = store.getState().personalMemories;
    return current.filter((m) => {
      const matchTitle = m.title.toLowerCase().includes(term);
      const matchContent = m.content.toLowerCase().includes(term);
      const matchTags = m.tags.some((t) => t.toLowerCase().includes(term));
      return matchTitle || matchContent || matchTags;
    });
  }

  /**
   * BM25 / keyword scoring for RAG memory retrieval:
   * 1. Always includes core personal 'bio' and 'preference' items
   * 2. Scores 'project', 'meeting_fact', and 'person' memories against current prompt + recent transcript
   */
  public async retrieveRelevantMemories(
    prompt: string,
    recentTranscripts: TranscriptSegment[] = [],
    limit: number = 8
  ): Promise<MemoryItem[]> {
    const allMemories = store.getState().personalMemories;
    if (allMemories.length === 0) return [];

    // Core bio and preference memories are always prioritized
    const alwaysInclude = allMemories.filter(
      (m) => m.category === 'bio' || m.category === 'preference'
    );

    const candidates = allMemories.filter(
      (m) => m.category !== 'bio' && m.category !== 'preference'
    );

    // Build context query string from user prompt + most recent 8 transcript segments
    const transcriptText = recentTranscripts
      .slice(0, 8)
      .map((s) => `${s.speakerLabel}: ${s.text}`)
      .join(' ');

    const contextQuery = `${prompt} ${transcriptText}`.toLowerCase();
    const queryTokens = Array.from(
      new Set(contextQuery.match(/\b[a-z0-9_-]{3,}\b/g) || [])
    );

    if (queryTokens.length === 0) {
      return [...alwaysInclude, ...candidates.slice(0, Math.max(0, limit - alwaysInclude.length))];
    }

    // Score candidates based on term frequency
    const scored = candidates.map((memory) => {
      const docText = `${memory.title} ${memory.content} ${memory.tags.join(' ')}`.toLowerCase();
      let score = 0;

      for (const token of queryTokens) {
        if (docText.includes(token)) {
          score += 1.0;
          if (memory.title.toLowerCase().includes(token)) {
            score += 2.0; // Boost title matches
          }
        }
      }

      return { memory, score };
    });

    const relevantCandidates = scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.memory);

    const combined = [...alwaysInclude, ...relevantCandidates];

    // Deduplicate by ID and enforce limit
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

  /**
   * Extract permanent facts, commitments, and user details from meeting transcript
   * via LLM call and add to memory store
   */
  public async extractMemoriesFromTranscript(
    segments: TranscriptSegment[]
  ): Promise<MemoryItem[]> {
    if (!segments || segments.length === 0) return [];

    const state = store.getState();
    const apiKey = state.aiConfig.apiKeys.gemini;
    if (!apiKey) {
      console.warn('[MemoryBrain] Cannot extract memories: No Gemini API Key configured');
      return [];
    }

    const transcriptFormatted = segments
      .map((s) => `${s.formattedTimestamp || ''} ${s.speakerLabel} (${s.role}): ${s.text}`)
      .join('\n');

    const prompt = `Analyze this conversation transcript. Extract permanent facts, decisions, preferences, and commitments about the speaker labeled "Me" or other participants.
Return ONLY a valid JSON array of objects with the following schema:
[
  {
    "title": "Short descriptive title",
    "category": "bio" | "project" | "preference" | "meeting_fact" | "person",
    "content": "Specific actionable fact or decision extracted",
    "tags": ["tag1", "tag2"]
  }
]
If nothing notable or permanent is mentioned, return an empty array [].

TRANSCRIPT:
${transcriptFormatted}`;

    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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

      if (!res.ok) {
        throw new Error(`Gemini memory extraction failed: ${res.statusText}`);
      }

      interface ExtractResult {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
            }>;
          };
        }>;
      }

      const json = (await res.json()) as ExtractResult;
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return [];

      const rawItems = JSON.parse(text) as Array<{
        title: string;
        category: 'bio' | 'project' | 'preference' | 'meeting_fact' | 'person';
        content: string;
        tags?: string[];
      }>;

      const addedMemories: MemoryItem[] = [];
      for (const item of rawItems) {
        if (item.title && item.content) {
          const mem = await this.addMemory({
            title: item.title,
            category: item.category || 'meeting_fact',
            content: item.content,
            tags: item.tags || [],
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
}

export const memoryBrain = new MemoryBrain();
