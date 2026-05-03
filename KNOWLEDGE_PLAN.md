# Knowledge Power-Up: Action Plan for RAG Perfection

This document outlines the architectural and algorithmic enhancements to transform OpenClaude's Knowledge system into a high-performance, enterprise-grade RAG engine.

## 🎯 Objective
Move from a "RAG-Lite" (JSON-based, keyword-only) system to a robust, scalable, and semantically-aware Knowledge Engine.

---

## 🛠 Phase 1: Storage & Scalability (Persistence Layer) [COMPLETED ✅]
- **Migration to SQLite**: Replaced `knowledge_graph.json` with `knowledge.db` using `bun:sqlite`.
- **Atomic Updates**: Learning new facts now performs row-level inserts/updates instead of full file rewrites.
- **Lazy Loading**: Data is queried on-demand from SQLite, reducing memory pressure.
- **CWD-Awareness**: Knowledge is strictly partitioned by project root path.

## 🧠 Phase 2: Retrieval Intelligence (Search Algorithm) [IN PROGRESS 🏗️]
- **Hybrid Search Engine**:
    - **BM25 Refinement**: Implemented keyword-based scoring in `src/utils/knowledgeGraph.ts`.
    - **Semantic Embeddings**: Integrate `voy-search` (WASM-based vector engine) for meaning-based retrieval.
- **Re-ranking Logic**: Combine SQLite keyword matches with Vector similarity scores.

## 🧹 Phase 3: Noise Reduction (Passive Learning)
- **LLM-Based Fact Consolidation**: Periodically use a small model (e.g., Haiku or Flash) to synthesize raw extracted facts.
- **Smart Deduplication**: Automatically merge entities that represent the same concept.
- **Heuristic Filtering**: Refine regex extraction to ignore common noise.

## 📏 Phase 4: Context Management (Efficiency)
- **Token-Budgeting**: Implement a strict token limit for RAG injection into the system prompt.
- **Dynamic Compression**: Summarize or truncate low-relevance knowledge fragments to fit the budget.

---

## ✅ Success Metrics
- **Performance**: < 50ms retrieval time on projects with 5,000+ facts.
- **Accuracy**: Significant improvement in "architectural awareness" during multi-file refactors.
- **Stability**: Zero WASM/RAM bloat during long-running sessions.
