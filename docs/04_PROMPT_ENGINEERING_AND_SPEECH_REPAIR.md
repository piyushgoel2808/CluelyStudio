# 04. Prompt Engineering & Speech Repair

## Overview

Live meeting transcription introduces unique challenges:
1. **Multi-Turn Fragmentation**: Interviewers rarely ask complex questions in a single 3-second utterance. Questions span 3–6 sentences across multiple turns, often ending with conversational filler (*"right?"*, *"can you tell me?"*, *"thank you"*).
2. **Acoustic & Phonetic ASR Mismatches**: Fast speech, Indian/Hindi accents, technical acronyms, and project names are frequently mistranscribed by speech recognition models (*"noose lens"* instead of *NewsLens AI*, *"loosination"* instead of *hallucination*).
3. **Typed vs. Spoken Priority Collisions**: When a user types a manual query and later speaks in the meeting, stale typed text must never override fresh spoken speech.

---

## 1. Deterministic Spoken Segment Cursor Slicing

### The "Trailing Utterance" Anti-Pattern
Previous iterations isolated only the final spoken utterance:
```text
// ANTI-PATTERN:
LATEST UTTERANCE: "Can you tell me?" (spoken by Interviewer)
DIRECTIVE: Answer the latest spoken question...
```
Because the actual question (*"In NewsLens AI, what evaluation frameworks did you compare for hallucinations?"*) was spoken 15 seconds earlier across prior segments, the LLM received only *"Can you tell me?"* and answered with confused clarification requests.

### The Solution: `lastConsumedTranscriptId` Cursor
In [`aiRouter.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/aiRouter.ts#L320-L420), Cluely maintains a stateful cursor:
```typescript
let lastConsumedTranscriptId: string | null = null;
let lastConsumedTimestamp = 0;
```

#### Differentiating `triggerSource: 'typed' | 'voice'`

1. **Typed Query (`triggerSource === 'typed'`)**:
   - The user entered text into the input box and hit Enter/Send.
   - The LLM answers the typed `prompt` directly, enriched by active mode instructions and recent conversation.
   - **Crucial Rule**: The router **does not advance** `lastConsumedTranscriptId`. Any unanswered speech spoken in the room remains queued, ready for the next voice trigger.

2. **Voice Assist (`triggerSource === 'voice'`)**:
   - The user hit `⌘ ↵` (Command+Enter) or clicked a Quick Assist chip with an empty input box.
   - First, the router awaits `transcriptionService.waitForPendingTranscriptions(1500)` to ensure all in-flight ASR finishes writing to `store.transcripts`.
   - The router slices all transcript segments that arrived **after `lastConsumedTranscriptId`** (plus a 4-second safety overlap buffer so multi-part questions starting just as the previous answer concluded are never truncated).
   - The router updates `lastConsumedTranscriptId` to the latest segment ID **immediately at request start**.
   - **Zero Priority Collisions**: The router completely ignores previous typed inputs so typed text can never override live spoken questions.

---

## 2. Two-Step Phonetic Reconstruction & Question Synthesis

The sliced speech block is packaged inside an isolated XML block:
```text
<unanswered_live_speech_since_last_question>
[Interviewer (Them)]: In your project noose lens ai how did you handle loosinations
[Interviewer (Them)]: like what frameworks did you evaluate and what was the trade off with be m 25
[Interviewer (Them)]: can you walk me through the evaluation metrics
</unanswered_live_speech_since_last_question>
```

### Synthesis & Reconstruction Directives
1. **Identify the Core Inquiries**: The LLM reads the complete multi-sentence speech block to synthesize the overarching technical question, stripping conversational fillers (*"right?"*, *"can you speak on that?"*).
2. **Silent Phonetic Correction**: Automatically repair acoustic and phonetic errors using mode ground truth:
   - *"noose lens"* $\to$ **NewsLens AI**
   - *"loosination"* $\to$ **Hallucination**
   - *"be m 25"* $\to$ **BM25 (Best Match 25)**
   - *"rag as"* $\to$ **RAGAS**
   - *"cross in coder"* $\to$ **Cross-Encoder Reranker**
   - *"artikil chunks"* $\to$ **article_chunks / article_chunks_v2 (Qdrant MRL)**
3. **Mandated Output Structure**:
   The LLM is strictly instructed to format its response with the reconstructed question as the first line:
   ```markdown
   **Question:** In NewsLens AI, how did you evaluate hallucinations, what frameworks did you use, and what are the trade-offs of BM25 in your hybrid pipeline?
   In our NewsLens AI project, we tackled hallucination and retrieval precision through a two-stage evaluation setup...
   ```
4. **Clean Session Archival**:
   In `aiRouter.ts` (`sendDone`), the router parses `**Question:** <reconstructed question>` from the first line and records it as the clean, human-readable title in `store.recordAssistEvent(...)`. The teleprompter UI displays both the clean question and the instant answer.

---

## 3. Compact Session History Representation

To prevent historical conversations from confusing the LLM into answering old prompts while still maintaining conversational context:
- Previous turns from `sessionChat` are formatted as compact 1-line topic summaries:
  ```text
  ### PREVIOUS SESSION HISTORY (Past answered questions in this meeting for background context only - DO NOT RE-ANSWER):
  • Q: Walk me through your RRF hybrid search formula. | Ans: Fused MySQL FULLTEXT BM25 with Qdrant dense vectors using 60-rank smoothing.
  • Q: What model powers your Cross-Encoder? | Ans: ms-marco-MiniLM-L-6-v2 reranking top-50 candidates down to top-5.
  ```
- Positioned strictly at the bottom of the prompt payload, keeping the LLM's primary attention locked on the current live speech.
