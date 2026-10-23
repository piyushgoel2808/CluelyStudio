# 05. Modes & Interview Copilot

## Overview

Cluely Studio includes a specialized **Copilot Modes Framework** that dynamically injects persona rules, evaluation rubrics, codebase references, and personal memory facts into every inference turn.

---

## 1. Copilot Modes Architecture

Modes are defined in [`store.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/store.ts#L60-L150) and can be toggled via the 1-click dropdown on the stealth card or customized in Settings:

| Mode ID | Name | Category | Primary Purpose |
|---|---|---|---|
| `general` | **Smart / General** | General | Balanced executive assistant for team meetings and discussions. |
| `interview` | **Interview** | Work | Comprehensive job interview copilot across behavioral, technical, and product questions. |
| `gen-ai` | **Gen AI** | Work | Specialized deep-dive for Generative AI interviews, featuring full NewsLens AI project grounding. |
| `behavioral-interview` | **Behavioral** | Work | STAR-format storytelling (Situation, Task, Action, Result). |
| `coding-interview` | **Coding** | Work | Algorithms, optimal time/space complexity, and clean production code. |
| `system-design` | **System Design** | Work | Scalability trade-offs, microservices, distributed caches, and failure domains. |
| `case-interview` | **Case Interview** | Work | MECE frameworks, unit economics, and hypothesis-driven business breakdowns. |

---

## 2. Integrated Mode Prompts

When a mode is selected, its custom instructions are automatically integrated into the LLM system prompt along with default performance rules:
- **Maximum Speed**: Sub-150ms teleprompt responses.
- **No Thinking Displayed**: Bypasses internal thinking tokens (`think: false`) so the teleprompter immediately begins streaming candidate-facing answers.
- **Spoken First-Person Tone**: Answers are calibrated to be spoken aloud naturally by the user.

### A. General Interview Mode Prompt
```text
I am a candidate in a job interview. Help me perform well across behavioral, technical, product, role-fit, and follow-up questions.

Use the job description, resume, notes, and any attached files as ground truth when available. Do not fabricate experience, credentials, companies, numbers, or project details. If context is missing, give me an answer structure that I can quickly fill in.

For behavioral questions, help me choose a strong example and shape it with situation, task, action, and result. For technical or role-specific questions, explain the concept clearly, state tradeoffs, and answer at the right depth for an interview.

When the interviewer asks something vague, infer what they are evaluating and give me a direct answer that addresses that signal. Keep answers confident but not arrogant, polished but not robotic.

If I get stuck, help me recover: ask a clarifying question, state a reasonable assumption, think aloud, and move toward a useful answer. Also suggest thoughtful questions I can ask about the role, team, success criteria, product, and company.

Make responses concise enough to say out loud in the moment unless I explicitly ask for a deeper explanation.
```

### B. Gen AI Interview Mode Prompt
```text
I am in a Gen AI interview. ans every ques 

try also giving real world example. have to show and explain the project newslens ai , when asked which file does a particular work , give me the specific path of the file from cadebase directory and also explain the file like to do in in the interview,
if asked to perform something give me step wise instruction to do that .

When the interviewer drills in, help me go deeper on bottlenecks, evaluaition ,hallucination , frameworks and edge cases if needed . Keep ans realistic and appropriately scoped for an interview.
When code is needed, provide clean, idiomatic code with meaningful variable names.

keep the ans short and to the point also give example to explain
```

---

## 3. Verified NewsLens AI Codebase Ground Truth

The `Gen AI` mode contains explicit, verified ground truth mapped to the real **NewsLens-AI** repository:

### Core File & Module Map

| Subsystem | Exact Codebase Path | Interview Explanation & Architectural Function |
|---|---|---|
| **Document Ingestion** | `backend/app/ingestion/parsers/docling.py` | Extracts high-fidelity text, layout metadata, and hierarchical bounding boxes from PDF news articles using Docling parser. |
| **Layout Segmentation** | `backend/app/ingestion/layout/segmenter.py` | Partitions parsed articles into semantic layout blocks (headers, captions, columns) while preserving document reading order. |
| **Multimodal VLM** | `backend/app/ingestion/parsers/vlm.py` | Uses **Qwen3-VL** (Vision-Language Model) to generate dense structured descriptions and OCR extraction for embedded images, charts, and infographics. |
| **Metadata Ingestion** | `backend/app/ingestion/metadata.py` | Normalizes publication timestamps, article sources, author credits, and license data into uniform schemas. |
| **Vector Storage (Dual Collections)** | `backend/app/storage/qdrant.py` | Implements Qdrant vector indexing with dual collections: `article_chunks_v2` for 768d Matryoshka Representation Learning (MRL) embeddings and `article_chunks` for 1024d dense embeddings. |
| **Lexical Keyword Storage** | `backend/app/storage/mysql.py` | MySQL schema with `FULLTEXT` indexing on article tokens for instant sub-millisecond lexical keyword retrieval. |
| **Raw Asset Storage** | `backend/app/storage/minio.py` | S3-compatible MinIO object store housing raw PDF documents, high-res page snapshots, and visual figure assets. |
| **Caching & Locking** | `backend/app/storage/redis.py` | Redis cluster caching intermediate embedding vectors, deduplicating search requests, and managing distributed pipeline locks. |
| **Stage 1 Hybrid Retrieval** | `backend/app/retrieval/hybrid.py` | Fuses lexical candidate scores (MySQL FULLTEXT BM25) and dense semantic vectors (Qdrant) using **Reciprocal Rank Fusion (RRF)**: $RRF(d) = \sum \frac{1}{60 + \text{rank}(d)}$. |
| **Stage 2 Cross-Encoder Reranker** | `backend/app/retrieval/reranker.py` | Reranks top-50 RRF candidates down to top-5 using `cross-encoder/ms-marco-MiniLM-L-6-v2`, scoring query-document pairs jointly with full attention cross-interaction. |
| **Web Fallback Retrieval** | `backend/app/retrieval/web.py` | Fallback search connector querying external live news APIs when local repository coverage falls below confidence thresholds. |
| **Agentic Planner** | `backend/app/agent/planner.py` | Stateful multi-step reasoning graph powered by **LangGraph**, planning iterative retrieval sub-goals and decomposing complex temporal queries. |
| **Corrective RAG Evaluator** | `backend/app/agent/evaluator.py` | Evaluates document retrieval quality (**CRAG** paradigm); triggers query rewriting or web search fallback if semantic ambiguity or insufficient coverage is detected. |
| **ToolCritic & AST Sandbox** | `backend/app/agent/tool_maker.py` & `backend/app/agent/sandbox.py` | Dynamically authors custom runtime Python analysis scripts on demand, verifying safety via Python AST parsing and executing inside a restricted execution sandbox. |
| **Answer Synthesizer** | `backend/app/agent/synthesizer.py` | Generates final responses structured with `AnswerBlueprint`, enforcing strict inline citation tags referencing specific chunk IDs. |
| **Evaluation Framework** | `backend/app/evaluation/metrics.py` | Computes quantitative RAG benchmarks: Context Recall@K, Mean Reciprocal Rank (MRR), Context Precision, Faithfulness/Hallucination score, and Coverage F1. |
| **Temporal Contamination Test** | `backend/app/evaluation/test_cross_date_contamination.py` | Verification suite validating strict date boundary filters to guarantee historical news articles never contaminate breaking news queries. |
| **Reader UI & Canvas** | `frontend/` & `frontend-v2/` | React 18 + Vite frontend providing a 300 DPI high-resolution canvas PDF reader, live chunk highlight overlays, and `src/components/ModelSettingsStudio.jsx`. |

---

## 4. Personal Memory Brain (`memoryBrain.ts`)

The **Personal Memory Brain** ([`memoryBrain.ts`](file:///Users/piyushgoel/Downloads/Projects/Cluely/CluelyStudio/electron/domains/memoryBrain.ts)) provides semantic recall of user facts, project experience, and preferences:
1. **Local Embeddings**: Embeds memories using `all-minilm:latest` via local Ollama.
2. **Cosine Similarity Retrieval**: Matches memory vectors against live speech transcripts and prompt queries.
3. **Automatic Grounding**: Top-6 most relevant memories are automatically injected into the system prompt:
   ```text
   ### PERSONAL MEMORY BRAIN (Facts, Preferences & User Context):
   • [PROJECT] NewsLens AI: Full-stack multimodal news summarizer using RAG, Qdrant MRL, Docling, and LangGraph.
   • [BIO] Education: Master's in Computer Science specializing in NLP.
   ```
