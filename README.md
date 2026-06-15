<div align="center">

# OmniMind

**An autonomous AI platform. RAG-powered knowledge engine in Phase 1. Autonomous email agent in Phase 2.**


[Live Demo](https://omnimind-woad.vercel.app) · [Email Agent Server](https://omnimind-6ub9.onrender.com) ·



</div>

---

## What is OmniMind?

OmniMind is a personal AI platform I've been building in phases as a learning project. The idea is simple: instead of using five different AI tools for five different tasks, everything lives in one place — and the agents actually do work autonomously, not just answer questions.

**Phase 1** — RAG-powered knowledge engine. Upload PDFs and documents, ask questions, get answers grounded in your actual files using vector search.

**Phase 2** — Autonomous email agent. Connects to Gmail, triages your inbox using Groq LLMs, auto-replies to routine mail, surfaces important emails to a live attention queue, and cleans up old unread messages automatically.

More agents are coming.

---

## Table of Contents

- [Phase 1 — RAG Knowledge Engine](#phase-1--rag-knowledge-engine)
- [Phase 2 — Email Agent](#phase-2--email-agent)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)

---

## Phase 1 — RAG Knowledge Engine

The foundation of OmniMind. A full-stack RAG (Retrieval-Augmented Generation) implementation that lets you have grounded conversations with your own documents.

### What it does

- **Document upload** — PDF and DOCX support with automatic chunking and embedding
- **Vector search** — Pinecone-backed semantic search across all uploaded documents  
- **Grounded answers** — Groq LLM responses cite the exact source chunks they used
- **Citation sidebar** — Click any citation to see the exact passage from the source PDF
- **Conversation memory** — Multi-turn chat that maintains context across messages
- **Document management** — Upload, view, and delete documents from your knowledge base

### How RAG works here

```
User question
     ↓
Embed question → Pinecone similarity search → Top-K relevant chunks
     ↓
Groq LLM (qwen/qwen3-32b) + chunks + conversation history
     ↓
Grounded answer with source citations
```

Documents are never sent to the LLM wholesale — only the relevant chunks are retrieved per query, keeping responses fast and costs low.

---

## Phase 2 — Email Agent

An autonomous Gmail agent that triages, responds to, and manages your inbox without you having to touch it for routine mail.

### What it does

```
New email arrives (Gmail Push or 15-min cron)
         ↓
Seen registry check — already processed? Skip.
         ↓
Hard drop? (no-reply address, spam classifier) → Label Processed, done
         ↓
Groq triage → category + priority + needs_manual_review
         ↓
┌─────────────────────────────────────────────────────┐
│  Tier 1: Routine mail    → Auto-reply + label done  │
│  Tier 2: Risk/financial  → Silent ack, no reply     │
│  Tier 3: High priority   → Attention queue (you)    │
└─────────────────────────────────────────────────────┘
         ↓
Log event → Increment daily metric → Broadcast WS metrics_updated
```

### Key features

**Autonomous pipeline**
- Gmail Push via GCP Pub/Sub for instant delivery (seconds, not minutes)
- 15-minute cron safety net catches anything Push missed
- Deduplication registry prevents double-processing when both paths catch the same email
- 3-tier decision engine powered by Groq structured JSON output

**Live attention queue**
- Only emails that need your actual attention surface here
- Real-time updates via WebSocket — no polling, no refresh
- AI-generated draft replies with tone regeneration
- Resizable split panel — drag the divider between list and detail

**Metrics & observability**
- Every pipeline outcome logged as an audit event
- Daily metric rollups: auto-resolved, spam blocked, attention queued, inbox cleaned
- Live stat bar driven by WebSocket `metrics_updated` broadcasts
- 3 scheduled email digests: 8AM (yesterday), 6PM (workday), 11:30PM IST (final tally)

**Inbox cleanup engine**
- Moves old unread mail to Gmail Trash automatically
- Per-user retention settings: 30 / 60 / 90 / 180 days or custom (7–365)
- Safety guaranteed: only `is:unread`, never touches Attention queue
- Toggle on/off per user, updates live on dashboard

**localStorage-first frontend**
- Attention queue and stat bar seed from localStorage instantly on page load
- No loading flash on return visits
- Toast notifications when new emails arrive in the attention queue

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Frontend                         │
│  page.tsx → EmailDashboard → EmailCard / EmailDetail            │
│  automationApi.ts · attentionStorage.ts · metricsStorage.ts     │
└─────────────────────┬───────────────────────────────────────────┘
                      │ REST + WebSocket
┌─────────────────────▼───────────────────────────────────────────┐
│                     FastAPI Backend                              │
│                                                                  │
│  routes/                                                         │
│    auth.py       — OAuth2 + session management                  │
│    emails.py     — Attention queue CRUD + WebSocket stream      │
│    agent.py      — Overview metrics + cleanup settings          │
│    webhooks.py   — Gmail Push Pub/Sub receiver                  │
│    cron.py       — Manual ingest trigger                        │
│                                                                  │
│  services/                                                       │
│    email_pipeline.py      — Core triage + action pipeline       │
│    auto_reply_policy.py   — 3-tier decision logic               │
│    ingest_scheduler.py    — 15-min cron + 3 notification slots  │
│    cleanup_engine.py      — Hourly old-unread trash daemon      │
│    bootstrap_ingest.py    — First-session batch on OAuth        │
│    gmail_watch.py         — Push watch registration + renewal   │
│    gmail_push_handler.py  — Pub/Sub message → pipeline          │
│                                                                  │
│  models/                                                         │
│    seen.py           — Deduplication registry                   │
│    metrics_daily.py  — Atomic daily counter rollups             │
│    event.py          — Audit trail + auto metric increment      │
│    user.py           — User + OAuth token + cleanup settings    │
└─────────────────────┬───────────────────────────────────────────┘
                      │
        ┌─────────────┼──────────────┐
        ▼             ▼              ▼
    MongoDB        Gmail API      Groq API
   (Atlas)       (GCP Pub/Sub)  (qwen3-32b)
```

---

## Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| Next.js 15 (App Router) | Framework |
| TypeScript | Type safety |
| Tailwind CSS | Styling |
| NextAuth.js | OmniMind account auth |
| WebSocket (native) | Live email stream |

### Backend (OmniMind Core — RAG)
| Technology | Purpose |
|---|---|
| Next.js API Routes | RAG endpoints |
| Pinecone | Vector database |
| Groq (`qwen/qwen3-32b`) | LLM for RAG answers |
| MongoDB Atlas | Document + vector metadata |

### Backend (Email Agent Server — FastAPI)
| Technology | Purpose |
|---|---|
| FastAPI | API framework |
| Motor (async MongoDB) | Database driver |
| Groq (`qwen/qwen3-32b`) | Email triage + draft generation |
| Gmail API | Email fetch, label, send, trash |
| GCP Pub/Sub | Gmail Push notifications |
| Fernet | OAuth token encryption |

---

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+
- MongoDB Atlas account (free tier works)
- Google Cloud project with Gmail API enabled
- Groq API key (free tier works)
- Pinecone account (free tier works)

### 1. Clone the repository

```bash
git clone https://github.com/[yourhandle]/omnimind.git
cd omnimind
```

### 2. Install frontend dependencies

```bash
npm install
```

### 3. Install email agent server dependencies

```bash
cd email-agent-server
pip install -r requirements.txt
```

### 4. Set up environment variables

See [Environment Variables](#environment-variables) below.

### 5. Run the development servers

**Frontend (Next.js):**
```bash
npm run dev
# http://localhost:3000
```

**Email Agent Server (FastAPI):**
```bash
cd email-agent-server
python main.py
# http://localhost:8000
```

### 6. Connect Gmail

Navigate to `/dashboard/agents/email` and click **Connect Gmail**. The OAuth flow will:
1. Request Gmail read/write/send permissions
2. Provision `OmniMind/Attention` and `OmniMind/Processed` labels in your Gmail
3. Register a Gmail Push watch (if Pub/Sub is configured)
4. Run a bootstrap ingest of today's unread emails

---

## Environment Variables

### Frontend (`.env.local`)

```env
# OmniMind auth
NEXTAUTH_SECRET=your_nextauth_secret
NEXTAUTH_URL=http://localhost:3000

# MongoDB (RAG phase)
MONGODB_URI=mongodb+srv://...

# Pinecone (RAG phase)
PINECONE_API_KEY=your_pinecone_key
PINECONE_INDEX=your_index_name

# Groq (RAG phase)
GROQ_API_KEY=your_groq_key

# Email agent server URL
NEXT_PUBLIC_EMAIL_AGENT_SERVER_URL=http://localhost:8000
```

### Email Agent Server (`.env`)

```env
# MongoDB
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=email_agent

# Google OAuth (Gmail)
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:8000/auth/callback

# Groq
GROQ_API_KEY=your_groq_key

# Security
SECRET_KEY=your_fernet_encryption_key

# Frontend
FRONTEND_URL=http://localhost:3000

# Gmail Push (optional — cron works without this)
GMAIL_PUSH_ENABLED=false
GMAIL_PUBSUB_TOPIC=projects/your-project/topics/your-topic

# Pipeline behaviour
AUTO_SEND_ENABLED=false      # set true when ready for live replies
LLM_CONCURRENCY=3
INGEST_BATCH_SIZE=20
CLEANUP_BATCH_SIZE=50
CLEANUP_INTERVAL_SECONDS=3600
```

> **Note:** Keep `AUTO_SEND_ENABLED=false` until you've tested the pipeline end-to-end with your own inbox. The agent will silently ack (Tier 2) instead of sending replies in dry-run mode.

---

## Project Structure

```
omnimind/
├── app/                          # Next.js app (RAG + dashboard)
│   ├── api/                      # RAG API routes
│   ├── dashboard/
│   │   └── agents/
│   │       └── email/
│   │           └── page.tsx      # Email agent overview page
│   └── components/
│       └── email-agents/
│           ├── EmailDashboard.tsx
│           ├── EmailDetail.tsx
│           ├── EmailCard.tsx
│           ├── EmailStats.tsx
│           ├── AttentionToast.tsx
│           └── CleanupSettingsPanel.tsx
├── lib/
│   ├── automationApi.ts          # Email agent API client
│   ├── attentionStorage.ts       # localStorage queue persistence
│   └── metricsStorage.ts         # localStorage metrics cache
│
└── email-agent-server/           # FastAPI email agent backend
    ├── main.py
    ├── config.py
    ├── models/
    │   ├── seen.py               # Deduplication registry
    │   ├── metrics_daily.py      # Daily metric rollups
    │   ├── event.py              # Audit event log
    │   └── user.py               # User + cleanup settings
    ├── services/
    │   ├── email_pipeline.py     # Core triage pipeline
    │   ├── auto_reply_policy.py  # 3-tier decision engine
    │   ├── ingest_scheduler.py   # 15-min cron + notifications
    │   ├── cleanup_engine.py     # Hourly inbox cleanup
    │   ├── bootstrap_ingest.py   # First-session batch
    │   ├── gmail_watch.py        # Push registration
    │   └── gmail_push_handler.py # Push → pipeline
    ├── routes/
    │   ├── auth.py
    │   ├── emails.py
    │   ├── agent.py
    │   ├── webhooks.py
    │   ├── cron.py
    │   └── notifications.py
    └── lib/
        ├── gmail_client.py       # Gmail API wrapper
        └── google_client.py      # OAuth credential management
```

---

## Roadmap

- [x] Phase 1 — RAG knowledge engine (PDF/DOCX upload, Pinecone, grounded answers)
- [x] Phase 2 — Autonomous email agent (triage, auto-reply, attention queue, cleanup)
- [ ] Phase 3 — Calendar agent (meeting scheduling, conflict detection)
- [ ] Phase 4 — Document agent (contract review, summarization pipelines)
- [ ] Phase 5 — Unified agent orchestration layer

---

## A Note on This Project

This is a learning project built by a CSE student who wanted to understand how real AI systems are architected — not just how to call an API.

Every design decision in here came from hitting a problem and solving it. The deduplication registry exists because I learned what happens when two concurrent processes handle the same email. The dry-run flag exists because I almost sent AI-generated replies to real people while testing. The localStorage-first rendering exists because I got tired of the dashboard flashing a skeleton on every visit.

If you're building something similar and want to talk architecture, open an issue or reach out on LinkedIn.

---

<div align="center">




</div>
