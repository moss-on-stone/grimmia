# New goals (2026-06-16) — ✅ ALL DONE (v0.1.17)

A batch of UX, preferences, and search/detail-view improvements. All work used
strict **red/green TDD** (test first, show red, implement to green). Final
state: 466 unit tests + 41 selftest assertions all green.

Status: every item below is implemented. Key files touched —
`src/shared/view-prefs.js` (#1,#5,#6,#10,#16 prefs), `src/main/ia-query.js`
(#11), `src/shared/item-view.js` (#12 canEditItem, #13 relatedSearches),
`src/shared/selection.js` (#11 month input), `src/main/logger.js` (#1 gate),
`src/main/ipc-handlers.js` (#5 subfolders, #16 delay), `src/main/main.js` (#1
wiring), `src/renderer/{renderer.js,index.html,styles.css}` (all UI),
`src/renderer/selftest.js` (#12/#13/#14 live checks).

## Preferences / settings

1. **Logs & diagnostics off by default.** Add a Preferences toggle to turn them
   on, alongside the existing "Open logs folder" button.
2. **Credential security audit.** Confirm login credentials are saved securely
   (encrypted / salted). Document findings; fix if not.
4. **Clear search caches.** In Preferences add "Clear search cache" (clears
   recent searches) and "Clear saved" (clears saved searches).
5. **Per-download subfolder toggle.** Preferences toggle: a directory per
   download or not. If off, files download straight into the download folder
   (no per-item folders). **Off (flat) is the default** — wait, re-read: "The
   latter should be default" → default = NO separate folders (flat).
6. **Default results view = Compact list** (no previews).
16. **Inter-download delay.** Preferences: default 5-second wait between
    downloading items; user-customizable to any integer 0–99.

## Transfers

7. **Clear button on Transfers** to clear transfers that are done.

## Favorites / search-list UI

8. **Center the star** in the favorites button (currently off-center — see
   Image #1).
9. **Title tooltip on hover.** Mousing over a search-list item shows the full
   title as a tooltip (esp. useful when truncated at small window sizes).
10. **Facet toggles.** We already toggle subject tags; also add toggles for
    "creator" and "type".
17. **Clickable subject tags** under search-hit titles → run a search on that
    tag.
18. **Clickable creators** in search-hit view → run a search on that creator.
19. **Right-click context menu** on search hits: "Copy Title" and
    "Copy Creator".
6.  (view) default = Compact list (see #6 above).

## Search options

11. **Month-precision year search.** Allow `1940-09` or `1940-9` in the
    year-to-year search options (document in Help). Do NOT change the visual
    appearance of the YYYY search.

## Detail view

12. **Gate "Edit Metadata" and "Tasks"** buttons — only active when the item's
    uploader matches the currently logged-in account.
13. **In-app "More by [creator]"** → run the creator search inside the app, not
    the website. Same for **Collection:** buttons → in-app collection search.
14. **Remove file-type bubbles** in detail view (they duplicate the list
    below).
15. **Collection download button** — only show the "[download arrow]
    collection" button when the current search is a `collection:` search (and
    drop the "Download a whole collection" search box).

## Help tab

3. **Spreadsheet upload instructions** added to the Help tab.
11. (Help) document the month-precision year search (see #11).

## Layout / spacing (left facet panel)

20. **Expand the subject/collection list** on the left to the full available
    height on larger window sizes (see Image #2).
21. **Reduce top buffer/margin** between the lists to make them more compact
    (see Image #3).

---

### Notes on ambiguous items
- #5 default: flat (no per-item subfolders) per "the latter should be default".
- #11: parse `YYYY-MM` / `YYYY-M` in date-range fields without altering the
  visual YYYY input.
