# Grimmia — 20 Feature Enhancement Ideas

_A backlog of potential features, grounded in what the `ia` CLI / archive.org
APIs support and in where the app is today (v0.1.3: search, advanced search,
result selection, download with format/filename prefs, upload, grid/compact
views). Each idea has a short rationale, a rough effort estimate, and notes on
feasibility. Effort: **S** (a session), **M** (a few sessions), **L** (large)._

---

## Download & file handling

### 1. Download queue with concurrency control, pause/resume, and retries — **M** — ✅ DONE
Today downloads run one file at a time within a job, and a cancel discards
progress. Add a real queue: a configurable number of parallel transfers, a
per-item pause/resume (the resume plumbing already exists in `downloadFile`), and
automatic retry with backoff on transient failures (IA returns 503 SlowDown). A
persistent queue that survives app restart would make bulk grabs reliable.

_Implemented: `src/main/download-queue.js` (pure `runQueue` with bounded
concurrency + `isTransient`/`backoffDelay` retry). `handleDownloadStart` routes
files through it; a "Parallel downloads" preference (1–6) sets concurrency;
transient 503/reset failures retry with backoff (a `file-retry` phase shows in
the UI). Resume-on-restart already works via `downloadFile`'s partial-file
resume. (A manual per-item pause UI was left out in favor of auto-retry +
resume.)_

### 2. "Download entire collection" — **M** — ✅ DONE
The `ia` CLI's most-loved bulk operation. Given a collection identifier (e.g.
`prelinger`), page through every member via the scraping API and enqueue them all,
respecting the current format/filename prefs. Pairs naturally with the queue (#1)
and saved searches (#9).

_Implemented: `core.buildScrapeUrl` + `ia.scrapeAll` (cursor-paged
`/services/search/v1/scrape`, injectable page-fetch, tested with fake-fetch); a
`collection:download` IPC scrapes all members then runs them through the normal
download pipeline. A "Download a whole collection" input + button in the search
bar._

### 3. Glob / regex file filters per download — **S→M** — ✅ DONE
Beyond the format presets, let power users include/exclude by filename pattern
(e.g. `*.pdf` but not `*_bw.pdf`, or "only files matching `chapter_\d+`"). The
`ia download --glob` flag is widely used. The filtering already happens in
`download-prefs.planDownload`, so this is mostly a UI + a matcher.

_Implemented: `globToRegExp`/`matchesFilters`/`parsePatterns` in
`download-prefs.js`, threaded through `planDownload` and `handleDownloadStart`;
include/exclude glob inputs in Preferences._

### 4. Checksum verification after download — **S** — ✅ DONE
IA metadata includes `md5`/`sha1`/`crc32` per file. Verify downloaded files
against the published checksum and flag/re-download mismatches. This also fixes
the integrity gap noted in the code review (resume can resolve a short file as
"done"). High trust value for archival users.

_Implemented: `src/main/checksum.js` (pickChecksum/hashFile/verifyFile, md5+sha1);
`handleDownloadStart` verifies each fresh file and emits `verified` on
`file-done`; the Downloads UI warns on mismatch._


---

## Search & discovery

### 6. Saved searches & search history — **S→M** — ✅ DONE
Persist named queries (basic or advanced) and a recent-search dropdown. One click
re-runs them. Foundation for "watch a search" (#7) and collection downloads (#2).

_Implemented: `src/shared/search-store.js` (addRecent/addSaved/removeSaved/
renameSaved/searchSignature/searchLabel). Recent + saved dropdowns and a Save
button in the search bar, persisted via settings._


### 8. Faceted filtering of results — **M** — ✅ DONE
archive.org's advancedsearch returns facet data (mediatype, year, collection,
language, creator). Show clickable facet counts in a sidebar so users can narrow a
result set without re-typing the query. Turns the flat result grid into real
browsing.

_Implemented: `src/shared/facets.js` (computeFacets derives mediatype/year/
language/collection buckets from the result docs; applyFacetToSearch folds a
clause into the active search). A clickable facet sidebar + removable active-
filter chips. (Derived client-side from the fetched docs rather than a server
facet response.)_

### 10. Sort/column options in compact list view — **S** — ✅ DONE
The compact list is already dense; add sortable columns (title, date, downloads,
size, mediatype) and a few more fields. Cheap, and makes the list view a genuine
power tool vs. the grid.

_Implemented: `src/shared/sort-docs.js` (pure `sortDocs`, stable, numeric-aware);
a sort dropdown + direction toggle in the compact list, client-side over the
current page._

---

## Item view & reading

### 12. Rich item metadata view with related items — **S→M** — ✅ DONE
The current modal dumps raw metadata. Add a curated view (cover, description,
formatted fields, file-type summary), links to the creator's other items and the
collection, and download counts/ratings. Mostly presentation over data already
fetched.

_Implemented: `src/shared/item-view.js` (fileTypeSummary, curatedFields,
relatedLinks). The item modal now shows a cover, curated fields, a file-type
summary, and "more from creator/collection" links._

### 13. Favorites / bookmarks / reading list — **S→M** — ✅ DONE
Let users star items into local lists (and optionally sync to their archive.org
favorites via the API). Combine with offline notes per item. A lightweight local
store; later upgradeable to server-synced lists.

_Implemented: `src/shared/favorites.js` (add/remove/has/toggle, deduped by
identifier). A star on each result card and in the modal, plus a Favorites tab,
persisted via settings. (Local store; server sync left for later.)_

---

## Upload & contribution

### 14. Bulk / spreadsheet upload — **M** — ✅ DONE
The `ia upload --spreadsheet` flow: pick a folder or a CSV mapping files →
identifiers + metadata, and upload many items in one batch with per-item progress.
The single-item upload form already exists; this generalizes it and is a core CLI
capability. Do not test this on the live server. Let the user test this themselves.

_Implemented: `src/main/csv.js` (RFC-4180-ish parseCsv + buildUploadPlan, fully
unit-tested — never contacts the server). A "Bulk upload from a spreadsheet"
panel: choose a CSV, preview the plan (items / files / missing-on-disk / errors),
then "Upload all items" reuses the upload pipeline. **The live upload itself was
NOT run during development — test it yourself.**_

### 15. Drag-and-drop upload with metadata templates — **S→M** — ✅ DONE
Drag files/folders onto the window to start an upload; remember reusable metadata
templates (e.g. a default collection, creator, license, subjects) so repeat
uploaders don't re-type everything. Improves the existing upload tab's UX.

_Implemented: `src/shared/upload-templates.js` (addTemplate/removeTemplate/
applyTemplate fills only blank fields; extractDroppedFiles). The files-box is now
a drag-&-drop zone; a template bar saves/applies/deletes named metadata
templates, persisted via settings._

### 16. Manage your items: edit metadata, replace/delete files, view tasks — **M** — ✅ DONE (partial)
Finish the dormant metadata-write path (currently dead code) into a real "My
Items" area: edit metadata with proper JSON-Patch, rename/move/delete files
(`ia mv`/`ia rm`), and show derive/task status (`ia tasks`). Rounds out the app to
full CLI parity for item owners.

_Implemented: `src/main/json-patch.js` (buildMetadataPatch → RFC 6902 array,
parseTasks). The item modal (when logged in) gains "Edit metadata" (diffs to a
JSON Patch and writes via the M1-fixed `modifyMetadata`) and a read-only "Tasks"
view. **Destructive file rename/delete (`ia mv`/`ia rm`) were intentionally left
out** to avoid accidental live data loss; the metadata-edit write was not run
against the live server during development — test it yourself._

---

## App quality & reach

### 17. Light theme + appearance settings — **S** — ✅ DONE
The UI is dark-only. Add a light theme and a system/auto option. The CSS already
uses CSS custom properties, so this is mostly a second variable set plus a toggle
in Preferences.

_Implemented: `resolveTheme` + `theme` pref in `view-prefs.js`; a
`:root[data-theme="light"]` variable set; a Theme selector (System/Light/Dark)
in Preferences that also follows live OS appearance changes._

