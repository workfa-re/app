<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:0ea5e9,100:020617&height=300&section=header&text=JobBridge&fontSize=80&fontAlignY=30&desc=Sicher%20%E2%80%A2%20Lokal%20%E2%80%A2%20Fair%20%7C%20Die%20sichere%20Taschengeldb%C3%B6rse%20der%20Zukunft&descAlignY=55&descSize=18&animation=twinkling&fontColor=ffffff&descColor=ffffff" width="100%" alt="JobBridge Header" />
</div>

> [!CAUTION]
> **PROPRIETARY AND STRICTLY CONFIDENTIAL**
> This repository, including all source code, assets, UI/UX designs, and documentation, is the exclusive intellectual property of Rezan Aaron Yalçin. Unauthorized copying, modification, distribution, or commercial use is strictly prohibited. By accessing this repository, you agree to be bound by the proprietary license terms outlined at the bottom of this document.

---

## ✦ System Overview

Welcome to the **JobBridge Web Platform**. 

JobBridge is a high-end platform connecting job seekers (14-18 years old) with private individuals and companies for everyday tasks and pocket-money jobs. This repository specifically houses our **Web Application**—a highly optimized, PWA-ready Next.js 15 environment that delivers a native, app-like experience directly in the browser. *(Note: Our native iOS and Android applications are maintained in separate, dedicated repositories).*

Our engineering philosophy prioritizes three pillars: **Uncompromising Security**, **Cinematic UX/UI**, and **Scalable Architecture**.

---

## ⚡️ TrustScore: Predictive Security Algorithm

Beyond classic reporting systems, JobBridge utilizes a sophisticated, proprietary **TrustScore Algorithm (0-10)** functioning dynamically in the background. 

This is **not a public rating system**. It is an internal, multi-signal risk evaluation matrix designed to detect suspicious patterns early and protect our community proactively.

```mermaid
flowchart TD
    classDef signals fill:#1e1b4b,stroke:#818cf8,stroke-width:2px,color:#fff
    classDef engine fill:#312e81,stroke:#6366f1,stroke-width:2px,color:#fff
    classDef action fill:#7f1d1d,stroke:#f87171,stroke-width:2px,color:#fff
    classDef human fill:#14532d,stroke:#4ade80,stroke-width:2px,color:#fff

    subgraph Evaluation Vectors
        P[Profile Plausibility]:::signals
        I[Information Consistency]:::signals
        T[Technical & Temporal Anomalies]:::signals
        C[Communication Patterns]:::signals
        H[Interaction History]:::signals
    end

    Score{Algorithmic\\nTrustScore Engine}:::engine

    P --> Score
    I --> Score
    T --> Score
    C --> Score
    H --> Score

    Score -- "Score > Threshold" --> Pass[Normal Platform Access]:::human
    Score -- "Score < Threshold" --> Flag[Internal System Flag]:::action

    Flag --> Review{Human-in-the-Loop\\nModerator Review}:::human

    Review -- "Suspicion Confirmed" --> Ban[Account Restricted / Banned]:::action
    Review -- "Inconclusive" --> Proof[Request Verification Proof]:::action
    Review -- "False Positive" --> Restore[Restore Trust Level]:::human
```

### Core Principles
1. **Protection by Design:** Highly sensitive actions require sufficient baseline trust.
2. **Hidden Weights:** To prevent exploitation or "gaming" of the algorithm, the precise calculation weights, specific triggers, and thresholds remain strictly internal and continuously optimized.
3. **Role-Specific Logic:** Youth accounts and Provider accounts are evaluated against different risk vectors.
4. **Human-in-the-Loop:** The algorithm surfaces threats; human moderators make the final call (requesting further proof or restricting access).

---

## 🛡️ The Guardian Consent Flow

We ensure absolute legal compliance and safety for minors on the platform. Youth accounts operate under a strict "Gate" and cannot apply to jobs until a legal guardian has cryptographically verified the connection.

**The Workflow:**
1. **Initiation:** The minor registers and generates a secure, one-time invitation link within the JobBridge app.
2. **Transmission:** The minor shares this unique link directly with their legal guardian.
3. **Guardian Registration:** The parent clicks the link and is prompted to create their *own* JobBridge account, passing our standard basic verification.
4. **Official Approval:** Using their verified account, the parent officially grants consent for the minor.
5. **Cryptographic Linking:** The system redeems the SHA-256 hashed token, linking the two accounts (`guardian_status = linked`). The parent retains administrative oversight, and the minor is granted full platform access.

---

## 🔄 Application Lifecycle & Waitlist Mechanics

JobBridge utilizes a highly efficient **Single Hiring Mode** designed to eliminate application frustration.

Instead of allowing 50 people to apply for a job that is already promised to someone else, we use an automated reservation and waitlist system:

1. **Application & Reservation:** When the first user applies, the job is immediately marked as `reserved`. It is instantly removed from the active, open job marketplace for everyone else.
2. **The Waitlist Market:** The reserved job transitions into the specialized "Waitlist Marketplace".
3. **Joining the Queue:** Other interested users can view the job in the Waitlist Market and explicitly join the queue (taking 2nd, 3rd, or 4th place).
4. **Automatic Promotion:** If the primary applicant withdraws, or if the job provider cancels the arrangement because an agreement wasn't reached, the system automatically promotes the 2nd place user to the active slot, instantly notifying all parties.

---

## 🏗️ High-Level System Architecture

```mermaid
flowchart TB
    classDef account fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#fff
    classDef role fill:#312e81,stroke:#818cf8,stroke-width:2px,color:#fff
    classDef frontend fill:#1e1b4b,stroke:#818cf8,stroke-width:2px,color:#fff
    classDef core fill:#14532d,stroke:#4ade80,stroke-width:2px,color:#fff
    classDef data fill:#451a03,stroke:#fbbf24,stroke-width:2px,color:#fff
    classDef security fill:#7f1d1d,stroke:#f87171,stroke-width:2px,color:#fff

    subgraph Accounts ["Account Types"]
        direction LR
        Seeker(["Job Seeker\\n(Youth, Adult, Senior)"]):::account
        Provider(["Job Provider\\n(Private / Company)"]):::account
    end

    subgraph Client ["Web Platform (Next.js 15 / React 19)"]
        direction TB
        UI["React UI\\n(Tailwind v4, Framer Motion)"]:::frontend
        Edge{"Edge Middleware\\n(Route Protection)"}:::security
    end

    subgraph Server ["Server Actions & RPCs"]
        direction TB
        Jobs["Job Engine\\ncreate_job_atomic"]:::core
        GuardianFlow["Guardian Consent\\nSHA-256 Tokens"]:::security
        Verify["Verification\\nOTP Checks"]:::core
    end

    subgraph Data ["Data Layer (Supabase)"]
        direction TB
        Auth["GoTrue Auth\\n(JWT)"]:::security
        RLS{"Row Level Security\\n(Zero-Trust)"}:::security
        DB[("PostgreSQL + PostGIS\\n20+ Tables")]:::data
    end

    Seeker & Provider --> UI
    UI --> Edge
    Edge -->|"Authenticated"| Server
    Jobs & GuardianFlow & Verify --> RLS
    RLS --> DB
    Auth --> DB
```

---

## 🛠️ Database Schema Hierarchy

Our PostgreSQL Database (managed via Supabase) operates under strict Row Level Security (RLS). No query bypasses the policy checks.

| Table | Purpose | Security Concept |
| :--- | :--- | :--- |
| `profiles` | Name, city, account type, guardian status. | RLS: Users can only mutate their own ID. |
| `jobs` | Public listing data (title, category, wage). | RLS: Public read, Author mutate only. |
| `job_private_details` | Sensitive location data (full address, private lat/lng). | Revealed strictly based on `address_reveal_policy` (e.g., post-acceptance). |
| `applications` | Status engine (reserved, waitlisted, accepted). | Links `jobs` to applicant `profiles`. |
| `guardian_invitations` | SHA-256 hashed cryptographic consent tokens. | Written ONLY via `SECURITY DEFINER` RPCs. |
| `guardian_relationships` | Active links binding minors to verified guardians. | Managed exclusively by secure server flows. |
| `system_roles` | Role definitions (admin, moderator, analyst). | Static seed data globally read-only. |
| `user_system_roles` | Admin, Moderator, and Analyst assignments. | Used globally in RLS `has_system_role()` checks. |
| `security_events` | Security audit logging (IP, user agent actions). | Append-only. Visible to analysts/admins. |
| `reports` | User moderation reports against jobs or messages. | Target-type specific. |
| `moderation_actions` | Audit trail for human-in-the-loop decisions. | Traceable back to specific staff ID. |
| `notification_preferences` | Per-user control for email digests/quiet hours. | RLS: Users manage their own preferences. |
| `notifications` | In-app automated alert system. | Private notification feed. |
| `messages` | Escrowed communication within active job applications. | Only accessible per application participants. |
| `regions_live` | Geographic boundaries for active service markets. | Managed by admins. |

---

## 📚 Engineering Documentation

- **[Major platform foundation release](./docs/releases/2026-07-15-platform-foundation.md):** Complete, human-readable change record from `c9aa5b0`, including product impact, breaking changes, validation and deployment requirements.
- **[Activities domain architecture](./docs/architecture/activities-domain.md):** Job, application, queue, conversation, appointment, Realtime and authorization contracts.
- **[Database rollout runbook](./docs/operations/database-rollout.md):** Migration-ledger verification, deployment gates, smoke tests and rollback strategy.
- **[Canonical database migrations](./infrastructure/database/README.md):** Ordered migration list, checksums and protected-data rules.

---

## 💻 Elite Technology Stack

JobBridge leverages the absolute pinnacle of modern web development frameworks to ensure enterprise-level scalability and a flawless user experience.

<div align="center">
  <br />
  
  [![Next.js](https://img.shields.io/badge/Next.js-15.0-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
  [![React](https://img.shields.io/badge/React-19.2-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
  [![Supabase](https://img.shields.io/badge/Supabase-Database-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4.0-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
  [![Framer Motion](https://img.shields.io/badge/Framer_Motion-UI-FF0055?style=for-the-badge&logo=framer)](https://www.framer.com/motion/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Vercel](https://img.shields.io/badge/Vercel-Edge-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/)
</div>

<br />

---

## 🚀 Local Development Setup

> [!IMPORTANT]
> **Authorized Access Only**
> While this repository is public for transparency and portfolio purposes, the source code remains strictly proprietary. Attempting to run this platform locally without authorized access to the JobBridge staging database and environment will fail.

To boot the JobBridge Web Platform locally (authorized contributors only):

### 1. Prerequisites
- **Node.js**: `v20.x` LTS minimum.
- **Backend**: You require authorized access to the JobBridge Supabase staging environment.

### 2. Initialization

```bash
git clone https://github.com/workfa-re/app.git
cd app
npm install
```

### 3. Environment Configuration
> [!TIP]
> **Mini-Hint:** Without these exact keys in a `.env.local` file at the root of the project, the Edge Middleware will instantly reject connections.

```env
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 4. Boot Engine

```bash
npm run dev
```

The platform compiles and boots at **[http://localhost:3000](http://localhost:3000)**. Enjoy the cinematic experience.

---

## License and Legal Terms

> [!CAUTION]
> **STRICTLY PROPRIETARY AND CONFIDENTIAL**
> 
> **Copyright (c) 2026 Rezan Aaron Yalçin. All rights reserved.**
> 
> This software is governed by the **JOBBRIDGE PROPRIETARY LICENSE**. No license is granted under any copyright, patent, trademark, trade secret, or other intellectual property right.
> 
> You are explicitly forbidden to:
> - Copy, clone, mirror, or archive the Software.
> - Modify, adapt, or create derivative works.
> - Distribute, publish, sell, or use the Software in any commercial product or AI training dataset.
> 
> **ENFORCEMENT**: The Licensor reserves the right to pursue all available legal remedies under the laws of the Federal Republic of Germany for any breach of these terms.

<br/>

<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:020617,100:0ea5e9&height=120&section=footer" width="100%" alt="Footer" />
</div>

<div align="center">
  <sub>JobBridge Web Platform &copy; 2026 Rezan Aaron Yalçin — All Rights Reserved.</sub>
</div>
