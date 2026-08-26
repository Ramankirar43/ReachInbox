# ReachInbox Scheduler

Production-oriented email scheduling monorepo: Express + TypeScript, BullMQ/Redis, PostgreSQL, Ethereal SMTP, and a React dashboard matching the supplied Outbox design.



## DEPLOYED LINK - 
https://reachinbox-1frontend.onrender.com


## Run locally

1. Install Node 20+, Docker, and npm.
2. Copy `backend/.env.example` to `backend/.env` and fill Google OAuth and Ethereal credentials.
3. Run `docker compose up -d`.
4. Run `npm install`, `npm install --prefix backend`, and `npm install --prefix frontend`.
5. Run `npm run db:migrate` and then `npm run dev`.
6. Open http://localhost:5173.

Google OAuth must include `http://localhost:4000/api/auth/google/callback` as an authorized redirect URI. Ethereal credentials can be generated at https://ethereal.email/create.

## Architecture

Each recipient becomes one durable Postgres `emails` row and one BullMQ delayed job. BullMQ stores delayed jobs in Redis, so restart recovery is automatic. A worker claims the row transactionally, reserves a Redis-backed hourly sender slot with an atomic Lua script, waits for the configured minimum send delay, and sends through Ethereal. If capacity is exhausted, the same job is delayed to the next hour; it is never dropped. The unique job ID is the email UUID, and row state transitions make processing idempotent across retries. Lead lists are parsed in the browser and attachments are uploaded as multipart data, stored once in Postgres, and reused by each recipient job.

`WORKER_CONCURRENCY`, `MIN_SEND_DELAY_MS` (default 2000), and `MAX_EMAILS_PER_HOUR` (default 200) are configurable. A burst of 1000 messages is retained in Redis/Postgres and drains in order as capacity becomes available.

## Features

- Google OAuth session login with name, email, avatar, and logout.
- Compose modal with CSV/text email extraction, start time, per-email delay, and hourly limit.
- Separate CSV/TXT lead-list upload and optional email attachment upload, each capped at 5 MB. Extracted addresses are shown in `To`; the authenticated Google email is shown in `From`.
- Scheduled and sent views with loading, empty, error, and status states.
- Dockerized Postgres and Redis, durable delayed jobs, concurrent workers, Redis atomic rate limiting, and Ethereal message URLs.

For production, place the API behind HTTPS, use a managed Postgres/Redis instance, set a strong session secret, and configure a shared session store.
