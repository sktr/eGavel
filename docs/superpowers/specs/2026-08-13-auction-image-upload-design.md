# Auction Image Upload & Placeholder Redesign Spec

Date: 2026-08-13
Status: accepted (design approved; implementation is based on this spec)

---

## 1. Background and Problems

UI review surfaced two related problems:

1. **Debug placeholders are shown as UI.** The top hero shows a static
   `[ Featured Auction ]` box even when there are no listings; auction cards
   render `[ {a.item} ]` in the image area; the detail page hardcodes four
   thumbnail boxes labelled `[ 1 ]`, `[ 2 ]`, `[ 3 ]`, `[ 4 ]`; and the create
   page preview shows `[ First Image ]` / `[ No Image ]` text. These read as
   unfinished development artifacts, not designed UI.

2. **Real images are never uploaded or displayed.** The create page collects
   only **file names** (`f.name`) into the `images` state and sends
   `body.image = images[0]` (a filename string) to the API. The `image` TEXT
   column therefore stores a filename that can never be rendered. Even when a
   user attaches an image, no image is shown anywhere in the app.

This spec makes image upload actually work (client-side compressed data URLs
stored in D1) and replaces all debug placeholders with a designed, category-based
placeholder component.

## 2. Decisions (agreed during brainstorming)

| Decision | Choice |
|----------|--------|
| Scope | Real image upload + placeholder redesign (no R2) |
| Image count | Max **4** per listing (was 10 in the UI) |
| Storage | Client-compressed **data URLs** in D1 (new `images` TEXT column) |
| List API | Returns only the **first image** per auction (light response) |
| Detail API | Returns **all** images |
| Placeholder | **Category-based** icon + tinted background, falls back to item-name initial |
| Hero box | Shows the latest active auction's first image; **hidden when no active auctions** |

Rationale for D1 storage: D1 Free gives 500 MB per database. Compressed to
~800 px WebP (q0.8), one image is roughly 40–107 KB as base64, so ≈10,000
images fit in the free tier. The 2 MB per-row limit is comfortably met
(4 images ≈ 430 KB max). Row read/write quotas count rows, not bytes, so
images do not affect daily query quotas. Migrating to R2 later is a column
format change only (`images` stores URLs instead of data URLs).

## 3. Data Model & API

### 3.1 Shared type (`packages/shared/src/index.ts`)

```ts
// before
image?: string

// after
images?: string[]   // data URLs, max 4
```

### 3.2 D1 schema

Keep the legacy `image TEXT` column untouched for backward compatibility and
**add** an `images TEXT` column storing a JSON array of data URLs.

Idempotent migrations (both `apps/server/src/db/index.ts` for better-sqlite3
and `apps/server/src/db/d1.ts` for D1, plus `apps/server/migrations/` for
fresh deploys):

```sql
ALTER TABLE auctions ADD COLUMN images TEXT;  -- already-exists → ignore
```

Read path: parse `images` when present; otherwise fall back to legacy
`image` — but **only when the value is renderable** (starts with `data:` or
`http://`/`https://`). Legacy rows store bare filenames (e.g. `photo.jpg`)
that must be treated as "no image" rather than rendered as a broken `<img>`.
Write path: store `images` as JSON; also keep writing legacy `image` = first
element for backward compatibility with old clients.

### 3.3 API endpoints

| Endpoint | Change |
|----------|--------|
| `POST /api/auctions` | Accept `body.images: string[]`. Validate: array, max 4 entries, each a string ≤ 2 MB. Keep `body.image` (first image) as backward-compatible alias. |
| `GET /api/auctions` (list) | Map each auction to `{ ...a, images: a.images?.slice(0, 1) }` so the list stays light (card display needs one image only). |
| `GET /api/auctions/:id` (detail) | Return all images. No change needed beyond the DB read path. |

The truncation happens in the route handler (`apps/server/src/routes/auctions.ts`),
not in the DB layer, so DB reads always return the full data.

## 4. Client Image Pipeline (create page)

### 4.1 New compression helper (`apps/web/lib/image.ts`)

```ts
/** Read a File, downscale to maxEdge px, return a WebP data URL (or null on failure). */
export async function compressImage(file: File, maxEdge = 800): Promise<string | null>
```

Behavior:
- Load the file via `FileReader` → `Image`.
- If the longer edge exceeds `maxEdge`, downscale on a canvas preserving
  aspect ratio; otherwise draw at native size.
- Export `canvas.toDataURL("image/webp", 0.8)`.
- Non-image formats (PNG/JPEG/WebP allowed; everything else) and decode
  failures return `null` (the file is skipped).
- `image/webp` support is universal in the browsers this app targets; a
  `toDataURL` fallback to `image/jpeg` is acceptable if webp encoding fails.

### 4.2 `create/page.tsx` changes

1. `handleFileChange`: replace `f.name` collection with
   `Promise.all([...files].map((f) => compressImage(f)))`, filter out `null`s,
   and keep at most 4 (`slice(0, 4)`).
2. Upload thumbnails: render the actual `<img src={dataUrl}>` preview instead
   of the filename + `image` icon. Keep the remove (×) button.
3. Sidebar preview card: replace `"[ First Image ]"` / `"[ No Image ]"` with
   the real first image, or the category placeholder when there are none.
4. API payload: send `body.images = images` (and `body.image = images[0]` for
   backward compatibility).
5. Copy: "(max 10)" → "(max 4)".

## 5. Display Components

### 5.1 New shared placeholder (`apps/web/components/item-placeholder.tsx`)

Category → icon + tinted background map:

| Category | Material icon | Tint |
|----------|---------------|------|
| Art | `palette` | pink |
| Collectibles | `diamond` | purple |
| Digital | `bolt` | blue |
| Hardware | `memory` | grey |
| Books | `menu_book` | amber |
| (none/other) | `inventory_2` | neutral |

- When the category is unknown/empty, show the **item-name initial**
  (e.g. "Rolex" → "R") as the primary visual instead of a generic icon.
- Props: `category?: string`, `name?: string`, `size?: number` (controls icon
  font size), `style?` (for background override).

### 5.2 Card (`apps/web/app/auction-card.tsx`)

Image area: render `a.images?.[0]` as an `<img>` with `object-fit: cover`
when present; otherwise render `ItemPlaceholder` with the auction's category
and item name. Remove the `[ {a.item} ]` text.

### 5.3 Detail page (`apps/web/app/auctions/[id]/page.tsx`)

- Main image: `auction.images?.[0]` as `<img>` (`object-fit: cover`), else
  `ItemPlaceholder`.
- Thumbnails row: replace the hardcoded `[ 1 ] [ 2 ] [ 3 ] [ 4 ]` boxes with
  dynamic rendering:
  - With images: one `<img>` thumbnail per image (max 4, matching the DB
    limit), click to swap the main image; selected thumbnail keeps the accent
    border (existing structure preserved).
  - Without images: hide the thumbnails row entirely.
- The "Similar items" placeholder section (line ~509) is left as-is unless it
  is trivial to fix; it is out of scope for this spec.

### 5.4 Top hero (`apps/web/app/page.tsx`)

- Fetch the latest active auction (ACTIVE/EXTENDED, earliest end_time first).
- Show its first image (or `ItemPlaceholder`) plus a small item-name label in
  the hero box; the box links to `/auctions/{id}`.
- When there are **no active auctions**: hide the hero box entirely and keep
  the left column (title + CTA) as a single-column hero.

### 5.5 List pages (`auctions/page.tsx`, `auction-list.tsx`)

Improve automatically via `AuctionCard`. Empty-state copy is unchanged.

## 6. Error Handling

| Case | Behavior |
|------|----------|
| Image decode failure / unsupported format | Skipped in `handleFileChange`. If none succeed, `images` stays empty and listing proceeds without images. |
| More than 4 files selected | Truncated to 4 (`slice(0, 4)`), same pattern as the current 10-cap. |
| Server-side size/count validation | `POST /api/auctions` rejects > 4 images or any image string > 2 MB with `400`. |
| Oversized originals | Prevented client-side by the 800 px downscale; unsupported formats are re-encoded to WebP. |

## 7. Testing

### 7.1 Server (`apps/server/tests/`)

- `POST /api/auctions` accepts an `images` array and persists it.
- `POST /api/auctions` with 5 images → `400`.
- `GET /api/auctions` returns only the first image per auction.
- `GET /api/auctions/:id` returns all images.
- Legacy fallback: an auction with only `image` set reads back correctly
  (data/http URLs are used; bare filenames are treated as no image).

### 7.2 Client

- Unit tests for `compressImage` (`apps/web/lib/image.ts`): downscales an
  over-800 px input, returns a `data:image/webp` string, returns `null` for
  non-image input (using canvas mock / jsdom as the existing test setup
  allows).
- UI verified manually in the browser: card with/without image, detail
  gallery, hero with/without active auctions, create-page preview.

## 8. Files Touched

| File | Change |
|------|--------|
| `packages/shared/src/index.ts` | `image?: string` → `images?: string[]` |
| `apps/server/src/db/index.ts` | migration + read/write `images` (better-sqlite3) |
| `apps/server/src/db/d1.ts` | migration + read/write `images` (D1) |
| `apps/server/migrations/` | add `images` column for fresh deploys |
| `apps/server/src/routes/auctions.ts` | accept `images`, truncate list to 1 |
| `apps/web/lib/image.ts` | new `compressImage` helper |
| `apps/web/components/item-placeholder.tsx` | new placeholder component |
| `apps/web/app/create/page.tsx` | upload pipeline + preview |
| `apps/web/app/auction-card.tsx` | image vs placeholder |
| `apps/web/app/auctions/[id]/page.tsx` | main image + dynamic thumbnails |
| `apps/web/app/page.tsx` | dynamic hero, hidden when empty |
| `apps/server/tests/*` | server tests |
| `apps/web` tests | `compressImage` tests |
