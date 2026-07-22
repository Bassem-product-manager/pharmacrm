# PharmaCRM — Deployment (100% free stack)

Four surfaces go live: **web** (landing + pharmacy dashboard) and **admin** on
Vercel, **API** on Render, **Postgres** on Neon, **Redis** on Upstash, **backups**
via GitHub Actions.

Everything is pre-configured. Follow the steps in order — **one action each**.
Steps marked **[you]** need your account/keys; the rest I (Claude) run.

---

## Prerequisites (one-time)

1. **[you]** Create a GitHub account if you don't have one.
2. **[you]** Create an empty **private** repo named `pharmacrm` (no README/gitignore).
3. **[you]** From `G:\claude\pharmacrm-cowork\pharmacrm`, run the initial push:
   ```powershell
   git remote add origin https://github.com/<you>/pharmacrm.git
   git push -u origin main
   ```
   Tell me when it's pushed — I take over from here.

---

## Phase 2 — Database (Neon) + Cache (Upstash)

4. **[you]** Neon → https://neon.tech → **New Project** (region: EU/Frankfurt).
   Copy the **pooled** connection string (has `-pooler`, ends `?sslmode=require`).
5. **[you]** Upstash → https://upstash.com → **Redis → Create Database** (region
   near Frankfurt, TLS on). Copy the **`rediss://`** URL.
6. **[you]** Paste both here (POSTGRES_URL + REDIS_URL).
7. **[me]** `prisma migrate deploy` against Neon (applies all migrations incl. RLS),
   then `prisma db seed` (1 pharmacy صيدلية النور, 10 Arabic customers, sample
   sales, 2 refill rules, 1 admin). **Verify:** migrate status clean + a behavioral
   RLS probe + row counts.

---

## Phase 3 — API (Render)

8. **[you]** Render → https://render.com → sign up, connect your GitHub, grant
   access to the `pharmacrm` repo.
9. **[you]** Render → **New → Blueprint** → pick the `pharmacrm` repo. It reads
   `render.yaml` and proposes service **pharmacrm-api** (free, Frankfurt, Docker).
10. **[you]** In the Blueprint's Environment section, paste values for the
    `sync:false` keys:
    - `POSTGRES_URL` (Neon, from step 4)
    - `REDIS_URL` (Upstash, from step 5)
    - `JWT_SECRET` = run `openssl rand -hex 32`
    - `JWT_REFRESH_SECRET` = run `openssl rand -hex 32` **(different value)**
    - `WEB_ORIGIN` / `ADMIN_ORIGIN` → put `https://pharmacrm-web.vercel.app` /
      `https://pharmacrm-admin.vercel.app` for now; we correct them in Phase 5.
    (Leave WA_/SMS_ keys **unset** → MockProvider stays active, zero cost.)
11. **[you]** Click **Apply** — Render builds the Docker image and deploys.
12. **[me]** **Verify:** `GET https://pharmacrm-api.onrender.com/health` → `{"status":"ok"}`,
    then a live login via curl. (First request after idle takes ~30–60s — cold start.)

> **Service name matters.** The frontends are hard-wired to
> `https://pharmacrm-api.onrender.com/api/v1` (committed in `apps/*/.env.production`).
> If Render assigns a different name, tell me and I'll update those two files.

---

## Phase 4 — Frontends (Vercel)

13. **[you]** Vercel → https://vercel.com → sign up, **Add New → Project** → import
    the `pharmacrm` repo. Create **two** projects from the same repo:
    - **pharmacrm-web** → Root Directory `apps/web`
    - **pharmacrm-admin** → Root Directory `apps/admin`
    Each has a committed `vercel.json` (turbo build) + `.env.production`
    (the public API URL) — **no env vars to set in Vercel.** Deploy both.
    _(If you prefer, I can attempt the Vercel MCP deploy instead — tell me your
    Vercel team slug.)_
14. **[me]** **Verify:** landing page RTL Arabic loads; `/login` on web authenticates
    against the live API; admin BI console loads and logs in.

---

## Phase 5 — Wire origins + go live

15. **[you]** Copy the two real Vercel production URLs.
16. **[you]** Render → pharmacrm-api → Environment → set `WEB_ORIGIN` and
    `ADMIN_ORIGIN` to those exact URLs (no trailing slash) → save (redeploys).
17. **[me]** End-to-end smoke test across all four surfaces; hand you the live URLs.

---

## GitHub repo secrets (for CI + backups)

18. **[you]** GitHub → repo → Settings → Secrets and variables → Actions:
    - **Secret** `POSTGRES_URL` = your Neon string (nightly backup workflow).
    - **Variable** `API_HEALTH_URL` = `https://pharmacrm-api.onrender.com/health`
      (keep-awake cron; skip if the service name is unchanged — it's the default).

---

## What runs automatically after this

- **CI** (`.github/workflows/ci.yml`): typecheck + build + 48 e2e tests on every PR/push.
- **Backups** (`backup.yml`): nightly `pg_dump` → downloadable artifact (14-day retention).
- **Keep-awake** (`keepalive.yml`): pings `/health` every 10 min so Render doesn't
  sleep and the reminder queue keeps firing.

## Demo logins (after seed)

- Pharmacy app: owner `01001111111` / `Passw0rd!` · staff `01002222222` / `Passw0rd!`
- Admin console: `admin@pharmacrm.local` / `Admin123!`
  **→ change the admin password before real use.**

## Known limits of the free tier

- Render free sleeps after 15 min; first hit after idle is a ~30–60s cold start
  (keep-awake cron mitigates, doesn't eliminate).
- Neon free 0.5 GB (~50 pharmacies), Upstash 10k Redis commands/day.
- MockProvider means WhatsApp/SMS are logged, not sent, until you add Meta keys.
