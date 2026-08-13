# eGavel Full Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename every `cashu-auction` identifier in the codebase, configs, and docs to `egavel` (packages, imports, Worker, D1 binding, Vercel config) so the infrastructure matches the eGavel brand. GitHub/Vercel/Worker infrastructure renames happen after the code lands.

**Architecture:** Phase 1 is a mechanical rename across package.json files, import specifiers, config files, and the lockfile, followed by verification (tests/typecheck/build with the NEW package names). Phase 2 (infrastructure: GitHub rename, Worker deploy, Vercel rename + env update) is driven by the controller after the code is pushed.

**Tech Stack:** pnpm workspace (`@egavel/{server,web,shared}`), Next.js 15, Cloudflare Worker + D1, vitest.

## Global Constraints

- Rename mapping (exact):
  - root package `cashu-auction` → `egavel`
  - `@cashu-auction/server` → `@egavel/server`
  - `@cashu-auction/web` → `@egavel/web`
  - `@cashu-auction/shared` → `@egavel/shared`
  - Worker `cashu-auction-api` → `egavel-api`
  - D1 binding `cashu_auction_db` → `egavel_db`
  - D1 name `cashu-auction-db` → `egavel-db`
  - `cashu-auction-api.sktr1211.workers.dev` → `egavel-api.sktr1211.workers.dev`
- D1 `database_id` is UNCHANGED.
- Historical spec/plan filenames under `docs/superpowers/` are NOT renamed (dated artifacts); content references may be left as-is unless trivial.
- After the rename, ALL test/typecheck/build commands use the NEW package names (`--filter @egavel/...`).
- Verification gate: server 112/112, web 25/25, both typechecks, web build; grep shows no `cashu-auction` (case-insensitive) in `apps/`, `packages/`, `package.json`, `pnpm-workspace.yaml`, `vercel.json` (excluding `.next`, `node_modules`, `.git`, `.superpowers`, and the dated `docs/superpowers` filenames).
- pnpm is at `/Users/sktr/.local/share/mise/installs/node/22.22.3/bin/pnpm` (not on PATH) — use `corepack pnpm` or that absolute path.

---

### Task 1: Rename packages + imports + configs

**Files:**
- Modify: `package.json`, `apps/server/package.json`, `apps/web/package.json`, `packages/shared/package.json`
- Modify: `apps/web/vercel.json`, `apps/server/wrangler.jsonc`, `apps/server/src/worker.ts`
- Modify: `.vercel/project.json`, `apps/web/.vercel/project.json`
- Modify: 25 files with `@cashu-auction` imports (see list below)
- Regenerate: `pnpm-lock.yaml`

**Interfaces:**
- Produces: every package and import uses `@egavel/*`; Worker config names `egavel-api`/`egavel_db`/`egavel-db`; Vercel projectName `egavel`.

- [ ] **Step 1: Rename the package names**

Edit the four package.json files:

`package.json` line 2:
```json
  "name": "egavel",
```

`apps/server/package.json` line 2:
```json
  "name": "@egavel/server",
```

`apps/web/package.json` line 2:
```json
  "name": "@egavel/web",
```

`packages/shared/package.json` line 2:
```json
  "name": "@egavel/shared",
```

- [ ] **Step 2: Rename imports**

Replace `@cashu-auction/` with `@egavel/` in every `.ts`/`.tsx` file under `apps/` and `packages/`. Use a scripted replace:

```bash
cd /Users/sktr/repo/cashu-auction
grep -rl "@cashu-auction" apps packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".next" | xargs sed -i '' 's|@cashu-auction/|@egavel/|g'
```

(The files: `apps/server/src/claim.ts`, `db/d1.ts`, `db/index.ts`, `lib/public-bid.ts`, `lib/settle.ts`, `process-bid.ts`, `routes/auctions.ts`, `verify/index.ts`, `tests/{claim,db,images,process-bid,settle,verify}.test.ts`, `apps/web/app/{auction-card,auction-list}.tsx`, `apps/web/app/auctions/[id]/{bid-form,claim-panel,detail-bid-panel,gallery,live-bids,page}.tsx`, `apps/web/app/auctions/page.tsx`, `apps/web/app/{dashboard/page,page}.tsx`.)

- [ ] **Step 3: Update config files**

`apps/web/vercel.json`:
```json
{
  "buildCommand": "pnpm --filter @egavel/shared build && pnpm --filter @egavel/web build",
  "framework": "nextjs",
  "installCommand": "corepack pnpm install --frozen-lockfile"
}
```

`apps/server/wrangler.jsonc`:
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "egavel-api",
  "main": "src/worker.ts",
  "compatibility_date": "2025-11-18",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "egavel_db",
      "database_name": "egavel-db",
      "database_id": "6f10433e-7d40-4162-a973-55127e0d9f0a",
      "migrations_dir": "migrations",
    },
  ],
}
```

`apps/server/src/worker.ts`:
```ts
export interface Env {
  egavel_db: D1Database;
  SERVER_PRIVATE_KEY?: string;
  AUCTION_FEE_BPS?: string;
}

export default {
  async fetch(request: Request, env: Env) {
    const db = createD1Db(env.egavel_db);
    ...
```

`.vercel/project.json` and `apps/web/.vercel/project.json` — change `projectName`:
```json
{"projectId":"prj_p1Xx5RDBoqOfgrBDEMXx73aCLJpr","orgId":"team_MhxyVjph5iORXyhhlRXuNz8f","projectName":"egavel"}
```

- [ ] **Step 4: Update the worker.ts comment if it references the old URL**

In `apps/web/app/dashboard/page.tsx` line ~14, the comment references the old Worker URL — update it:

```tsx
// Root (no /api suffix) — the code below adds "/api" explicitly. This matches
// the convention in lib/claim.ts and checkout.tsx so NEXT_PUBLIC_API_URL can
// point at the Worker origin (https://egavel-api.sktr1211.workers.dev).
```

- [ ] **Step 5: Regenerate the lockfile**

```bash
cd /Users/sktr/repo/cashu-auction
/Users/sktr/.local/share/mise/installs/node/22.22.3/bin/pnpm install --lockfile-only
```

(The workspace package names changed; the lockfile must be regenerated so imports resolve to `@egavel/*`.)

- [ ] **Step 6: Verify no stale references**

```bash
grep -rn "cashu-auction" apps packages package.json pnpm-workspace.yaml apps/web/vercel.json --include="*.ts" --include="*.tsx" --include="*.json" --include="*.jsonc" | grep -v node_modules | grep -v ".next"
```

Expected: no matches (all renamed).

- [ ] **Step 7: Verify tests/typecheck/build with NEW names**

```bash
cd /Users/sktr/repo/cashu-auction
export PNPM=/Users/sktr/.local/share/mise/installs/node/22.22.3/bin/pnpm
$PNPM install
$PNPM test                                            # server via @egavel/server
$PNPM --filter @egavel/server run test
$PNPM --filter @egavel/web run test
$PNPM --filter @egavel/server run typecheck
$PNPM --filter @egavel/web run typecheck
$PNPM --filter @egavel/web run build
```

Expected: server 112/112, web 25/25, typechecks clean, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rename packages/imports/configs from cashu-auction to egavel"
```

---

### Task 2: Documentation references

**Files:**
- Modify: `README.md`, `docs/serverless-migration.md`, `docs/agents/*` (only where they name the repo/app)

**Interfaces:**
- Produces: docs refer to `egavel`; the historical `docs/superpowers/` filenames are untouched.

- [ ] **Step 1: Update README**

- `# Cashu Auction` → `# eGavel`
- `pnpm --filter @cashu-auction/server test` → `pnpm --filter @egavel/server test`
- Any other `cashu-auction` / `Cashu Auction` brand references → `egavel` / `eGavel` (protocol references to "Cashu" stay).

- [ ] **Step 2: Update docs references**

In `docs/serverless-migration.md` and `docs/agents/*.md`, replace `cashu-auction` repo/app references with `egavel` where they name the current project. Do NOT rename filenames under `docs/superpowers/`.

- [ ] **Step 3: Verify**

```bash
grep -rn "cashu-auction\|Cashu Auction" README.md docs/ | grep -v "docs/superpowers/specs/2026-08-11\|docs/superpowers/plans/2026-08-11"
```

Expected: no matches (or only intentional protocol references).

- [ ] **Step 4: Commit**

```bash
git add README.md docs/
git commit -m "docs: update references from cashu-auction to egavel"
```

---

### Task 3: Push and verify CI

**Files:**
- No code changes.

- [ ] **Step 1: Push to the (still old-named) repo**

```bash
git push origin main
```

- [ ] **Step 2: Confirm CI passes**

Watch the GitHub Actions run — the server tests, web tests, typechecks, and build must all pass with the new package names. If any step fails, fix and re-push.

---

### Task 4 (controller-run, after code is pushed): Infrastructure rename

**Files:**
- No code changes.

- [ ] **Step 1: Rename the GitHub repo**

```bash
gh repo rename egavel
git remote set-url origin https://github.com/sktr/egavel.git
```

- [ ] **Step 2: Deploy the Worker**

```bash
cd apps/server
npx wrangler deploy   # deploys as egavel-api
```

Confirm the new URL: `https://egavel-api.sktr1211.workers.dev`.

- [ ] **Step 3: Rename the Vercel project**

Rename the project to `egavel` (Vercel dashboard or CLI) → URL `egavel.vercel.app`.

- [ ] **Step 4: Update Vercel env vars (production)**

- `NEXT_PUBLIC_API_URL` → `https://egavel-api.sktr1211.workers.dev`
- `SSR_API_URL` → `https://egavel-api.sktr1211.workers.dev`

- [ ] **Step 5: Verify production**

- `https://egavel.vercel.app` loads with the eGavel header/title/footer.
- Dashboard loads (API reaches the renamed Worker).

---

### Task 5: Full verification

**Files:**
- No code changes.

- [ ] **Step 1: Full suites with new names**

Run: `$PNPM test && $PNPM --filter @egavel/web run test`
Expected: server 112/112, web 25/25.

- [ ] **Step 2: Typecheck + build**

Run: `$PNPM --filter @egavel/server run typecheck && $PNPM --filter @egavel/web run typecheck && $PNPM --filter @egavel/web run build`
Expected: clean.

- [ ] **Step 3: Commit any fixups**

```bash
git status
git add -A
git commit -m "fix: final verification fixes"
```

(Only commit if there are actual changes.)
