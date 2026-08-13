# eGavel Full Rename Spec

Date: 2026-08-13
Status: accepted (design approved; implementation is based on this spec)

---

## 1. Background

The app was rebranded to **eGavel** (title, footer, header logo, wallet
memo — see `2026-08-13-egavel-branding-responsive-design.md`). The
infrastructure still carries the old name `cashu-auction`:

- GitHub repository: `sktr/cashu-auction`
- Vercel project: `cashu-auction` → URL `cashu-auction.vercel.app`
- npm package names: `cashu-auction`, `@cashu-auction/{server,web,shared}`
- Cloudflare Worker: `cashu-auction-api` (URL
  `cashu-auction-api.sktr1211.workers.dev`)
- D1 database: name `cashu-auction-db`, binding `cashu_auction_db`
- Documentation (README, docs/) references the old name

This spec renames everything to `egavel` so the brand and the infrastructure
align. `egavel.vercel.app` is confirmed available (404 response).

## 2. Decisions (agreed during brainstorming)

| Decision | Choice |
|----------|--------|
| Scope | Rename EVERYTHING (repo, Vercel, npm packages, Worker, D1, docs) |
| Execution order | Code/config rename → verify (tests/typecheck/build) → commit+push → GitHub repo rename → Worker deploy → Vercel rename + env update |
| New names | GitHub `sktr/egavel`; Vercel project `egavel`; packages `egavel` + `@egavel/{server,web,shared}`; Worker `egavel-api`; D1 name `egavel-db`, binding `egavel_db` |

## 3. Rename mapping

| Old | New |
|-----|-----|
| `cashu-auction` (root package) | `egavel` |
| `@cashu-auction/server` | `@egavel/server` |
| `@cashu-auction/web` | `@egavel/web` |
| `@cashu-auction/shared` | `@egavel/shared` |
| `cashu-auction-api` (Worker) | `egavel-api` |
| `cashu_auction_db` (D1 binding) | `egavel_db` |
| `cashu-auction-db` (D1 name) | `egavel-db` |
| `https://cashu-auction-api.sktr1211.workers.dev` | `https://egavel-api.sktr1211.workers.dev` |
| `cashu-auction.vercel.app` | `egavel.vercel.app` |
| GitHub `sktr/cashu-auction` | GitHub `sktr/egavel` |

The D1 `database_id` is unchanged (the binding/name are just identifiers).

## 4. Code & config changes (Phase 1, local)

### 4.1 Package names

- `package.json` (root): `"name": "cashu-auction"` → `"egavel"`
- `apps/server/package.json`: `"name": "@cashu-auction/server"` → `"@egavel/server"`
- `apps/web/package.json`: `"name": "@cashu-auction/web"` → `"@egavel/web"`
- `packages/shared/package.json`: `"name": "@cashu-auction/shared"` → `"@egavel/shared"`

### 4.2 Imports

Replace all `@cashu-auction/` import specifiers with `@egavel/` across
`apps/` and `packages/` (25 occurrences in `.ts`/`.tsx`, plus any in
`vercel.json`/configs). Use a scripted replace then verify with grep that
no `@cashu-auction` remains.

### 4.3 Config files

- `apps/web/vercel.json`: `buildCommand` — `pnpm --filter @cashu-auction/shared build` → `pnpm --filter @egavel/shared build`.
- `apps/server/wrangler.jsonc`: `name` → `"egavel-api"`; `binding` → `"egavel_db"`; `database_name` → `"egavel-db"`.
- `apps/server/src/worker.ts`: `cashu_auction_db` → `egavel_db` (interface field + `env.cashu_auction_db` usage).
- `.vercel/project.json` and `apps/web/.vercel/project.json`: `projectName: "cashu-auction"` → `"egavel"` (the projectId/orgId stay; Vercel-side rename happens in Phase 3 — these files are gitignored local aliases, update them for local CLI consistency).

### 4.4 Lockfile

Regenerate `pnpm-lock.yaml` after the package renames:
`pnpm install --lockfile-only` (or the equivalent with corepack).

### 4.5 Documentation

- `README.md`: title `# Cashu Auction` → `# eGavel`; the `pnpm --filter @cashu-auction/server test` example → `@egavel/server`; any other `cashu-auction` references → `egavel`.
- `docs/`: update references where they name the repo/app (`docs/serverless-migration.md`, `docs/agents/*`, etc.). **Do NOT rename historical spec/plan filenames** (`docs/superpowers/specs/2026-08-11-cashu-auction-redesign-design.md` etc.) — they are dated artifacts; update their *content* references only if trivial, otherwise leave them (they are historical records).

## 5. Verification (Phase 2)

- `pnpm test` (server 112/112) and `pnpm --filter @cashu-auction/web run test` (25/25) — note: the filter flag must use the NEW names after the package renames (`@egavel/server`, `@egavel/web`).
- `pnpm --filter @egavel/server run typecheck` and `pnpm --filter @egavel/web run typecheck`.
- `pnpm --filter @egavel/web run build`.
- grep: no `cashu-auction` (case-insensitive) remains in `apps/`, `packages/`, `package.json`, `pnpm-workspace.yaml`, `vercel.json` (excluding `.next`, `node_modules`, `.git`, `.superpowers`, and the dated spec/plan filenames under `docs/superpowers/`).

## 6. Infrastructure changes (Phase 3)

### 6.1 GitHub

```bash
gh repo rename egavel   # sktr/cashu-auction → sktr/egavel
git remote set-url origin https://github.com/sktr/egavel.git
```

### 6.2 Cloudflare Worker

```bash
# from apps/server
pnpm exec wrangler deploy   # deploys as egavel-api per wrangler.jsonc
```

After deploy, the Worker URL becomes `https://egavel-api.sktr1211.workers.dev`.

### 6.3 Vercel

1. Rename the project to `egavel` (Vercel dashboard or `vercel project rename`) → URL becomes `egavel.vercel.app`.
2. Update env vars for production:
   - `NEXT_PUBLIC_API_URL` → `https://egavel-api.sktr1211.workers.dev`
   - `SSR_API_URL` → `https://egavel-api.sktr1211.workers.dev`
3. Push to the renamed GitHub repo triggers a fresh Vercel deployment.

### 6.4 D1

- The database itself is untouched (same `database_id`). The `database_name`
  in `wrangler.jsonc` is cosmetic for local tooling; no remote action needed
  unless a rename is desired in the Cloudflare dashboard (optional).

## 7. Risk & rollback

- The Worker URL change (6.2) breaks the old env values until 6.3 updates
  them — do 6.2 then 6.3 immediately, and verify the site loads after.
- `egavel.vercel.app` is confirmed free; if the Vercel rename fails (name
  taken between now and then), fall back to `egavel-app.vercel.app` and note
  it here.
- Git history is preserved by `gh repo rename` (redirects old URL).

## 8. Files touched (Phase 1 summary)

| File | Change |
|------|--------|
| `package.json` | name → `egavel` |
| `apps/server/package.json` | name → `@egavel/server` |
| `apps/web/package.json` | name → `@egavel/web` |
| `packages/shared/package.json` | name → `@egavel/shared` |
| `apps/web/vercel.json` | buildCommand filter |
| `apps/server/wrangler.jsonc` | Worker/binding/DB names |
| `apps/server/src/worker.ts` | binding references |
| `apps/web/*` + `apps/server/*` imports | `@cashu-auction/` → `@egavel/` |
| `.vercel/project.json`, `apps/web/.vercel/project.json` | projectName → `egavel` |
| `pnpm-lock.yaml` | regenerated |
| `README.md`, `docs/*` | name references |

## 9. Testing

- Server suite (112), web suite (25), typechecks, production build — all
  green with the new package names.
- Post-deploy: `egavel.vercel.app` loads; API calls hit the renamed Worker;
  header/title/footer show eGavel.
