# Acronyms & Terms — Plain-English Legend

A quick reference for every abbreviation used across this spec. For full term definitions
see [glossary.md](spec/00-foundations/glossary.md); for the ID system see
[id-conventions.md](spec/00-foundations/id-conventions.md).

## The ID system (you'll see these on every spec item)

These are labels stamped on each piece of the spec so anything can be traced back to where
it came from.

| Tag | Stands for | Plain English |
|---|---|---|
| **ADR** | Architecture Decision Record | "We decided X, and here's why" — a documented structural choice. |
| **OD** | Open Decision | A question not yet answered. Blocks a requirement until resolved. |
| **FR** | Functional Requirement | One thing the system must *do*, written to be testable. |
| **NFR** | Non-Functional Requirement | A quality it must *have* (security, speed, cost) — not a feature. |
| **CFG** | Config key | A tunable setting. |
| **UI** | User Interface | A screen, panel, modal, or banner. |
| **DATA** | Data | A database table or field. |
| **PERM** | Permission | A capability a role is or isn't allowed. |
| **AC** | Acceptance Criteria | The pass/fail test that proves an FR was built correctly. |

## Architecture & infrastructure

| Term | Meaning |
|---|---|
| **RBAC** | Role-Based Access Control — who can do what, based on their role. |
| **RLS** | Row-Level Security — the database enforcing access on individual rows, as a backstop. |
| **Silo** | Each client gets their own separate database. (Our chosen model — see ADR-001.) |
| **Pooled** | All clients share one database, separated by a tag. (Rejected — see ADR-001.) |
| **Management plane** | The operator's own dashboard deployment that monitors all clients. |
| **CI/CD** | The automated pipeline that tests and deploys code when you push a change. |
| **opex** | Operating expenses — ongoing running costs (hosting, API bills). |
| **COGS** | Cost Of Goods Sold — the direct cost of delivering the service. |
| **TOCTOU** | "Time-Of-Check To Time-Of-Use" — a bug where two things run at once and collide. |
| **MoSCoW** | Must / Should / Could / Won't — a way to rank requirement priority. |

## From the design doc (tech the system is built on)

| Term | Meaning |
|---|---|
| **OAuth** | The "log in with Google/Microsoft" standard; also how connectors authenticate. |
| **JWT** | JSON Web Token — the signed token that proves you're logged in. |
| **2FA** | Two-Factor Authentication — a second login step (e.g. an authenticator code). |
| **RAG** | Retrieval-Augmented Generation — fetching relevant memories to feed the AI before it answers. |
| **pgvector** | A PostgreSQL extension that stores and searches AI "embeddings" (vectors). |
| **Embedding** | A numeric fingerprint of text that lets the system find similar content. |
| **HNSW / IVFFlat** | Two ways to index vectors for fast similarity search (we use HNSW). |
| **HMAC** | A signature that proves an incoming webhook is genuine and untampered. |
| **DLQ** | Dead Letter Queue — where repeatedly-failing tasks go for human review. |
| **Inngest** | The service that runs background jobs, loops, and retries reliably. |
| **Supabase** | The hosted PostgreSQL database + auth + storage platform. |
| **Railway** | The hosting platform the app runs on. |
| **GHL** | GoHighLevel — the CRM connector. |
| **SOP** | Standard Operating Procedure — a documented how-to (stored as "procedural" memory). |
| **OKR** | Objectives & Key Results — a goal-setting format (one of the entity types). |

> Add a row here the first time any new abbreviation appears in the spec.
