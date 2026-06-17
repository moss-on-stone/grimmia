'use strict';

/**
 * selftest.js — headless E2E driver (dev-only).
 *
 * Loaded FIRST (before ui-util/renderer). When the page is opened with
 * `#selftest` in the URL hash, it installs a FAKE `window.ia` backed by static
 * fixtures — so the real renderer runs against deterministic data with NO
 * network, NO credentials, and NO uploads. It then drives the actual DOM
 * (search, sort, facets, favorites, saved searches, item modal, view toggle,
 * theme) and asserts outcomes, finally printing `SELFTEST_RESULT <json>` which
 * the main process reads to set its exit code.
 *
 * In normal launches (`#selftest` absent) this file does nothing.
 */

(function () {
  if (typeof location === 'undefined' || !/(^|[#&])selftest/.test(location.hash)) return;

  /* ------------------------------ fixtures ------------------------------- */
  const DOCS = [
    { identifier: 'alpha', title: 'Alpha Book', creator: 'Aaron', date: '1999-01-01', mediatype: 'texts', downloads: 50, item_size: 300, language: 'English', collection: ['shared'] },
    { identifier: 'beta', title: 'beta audio', creator: 'Bea', date: '2005-06-06', mediatype: 'audio', downloads: 200, item_size: 100, language: 'French', collection: ['shared', 'music'] },
    { identifier: 'gamma', title: 'Gamma Movie', creator: 'Cleo', date: '2012-12-12', mediatype: 'movies', downloads: 10, item_size: 200, language: 'English', collection: ['film'] },
  ];
  // A second page of docs, for cross-page selection tests (#9).
  const PAGE2 = [
    { identifier: 'delta', title: 'Delta Doc', mediatype: 'texts', downloads: 5 },
    { identifier: 'epsilon', title: 'Epsilon Doc', mediatype: 'texts', downloads: 4 },
  ];

  const settings = { destRoot: '/tmp/ia-selftest', theme: 'dark' };

  const fakeIa = {
    auth: {
      status: async () => ({ loggedIn: true, screenname: 'SelfTest' }),
      login: async () => ({ loggedIn: true }),
      logout: async () => ({ loggedIn: false }),
    },
    search: {
      // Page-aware so cross-page selection (#9) can be tested. numFound is large
      // so the pager shows; page 2 returns different docs.
      query: async (q, opts) => {
        const page = (opts && opts.page) || 1;
        return { numFound: 120, start: 0, docs: page >= 2 ? PAGE2 : DOCS };
      },
      advanced: async (fields, opts) => {
        const page = (opts && opts.page) || 1;
        let docs = page >= 2 ? PAGE2 : DOCS;
        if (fields && fields.mediatype) docs = docs.filter((d) => d.mediatype === fields.mediatype);
        return { numFound: docs.length, start: 0, docs, query: '*:*' };
      },
      buildQuery: async () => '*:*',
      parseInput: async (input) => {
        const fields = {};
        String(input || '').split(/\s+/).forEach((tok) => {
          const m = /^(title|subject|creator):(.+)$/.exec(tok);
          if (m) fields[m[1]] = m[2];
          else if (tok) fields.text = (fields.text ? fields.text + ' ' : '') + tok;
        });
        return { fields };
      },
    },
    item: {
      metadata: async (id) => ({
        // uploader matches the logged-in screenname so the owner-only actions
        // (Edit metadata / Tasks) are exercised (#12).
        metadata: { title: id, creator: 'Aaron', mediatype: 'texts', description: 'A test item.', collection: 'shared', uploader: 'SelfTest' },
        files: [{ name: 'a.pdf', format: 'Text PDF', size: 100 }, { name: 'b.txt', format: 'DjVuTXT', size: 5 }],
      }),
      tasks: async () => [],
    },
    prefs: { formatPresets: async () => [{ key: 'pdf', label: 'PDF only' }, { key: 'all', label: 'All files' }] },
    download: { start: async () => ({ ok: true }), collection: async () => ({ ok: true }), cancel: async () => ({}), onProgress: () => () => {} },
    upload: { chooseFiles: async () => [{ path: '/tmp/My Great Book.pdf', name: 'My Great Book.pdf', size: 1234 }], start: async () => ({ ok: true }), cancel: async () => ({}), onProgress: () => () => {} },
    bulk: { choose: async () => null, upload: async () => ({ ok: true }) },
    transfer: {
      // Capture the renderer's handler so the harness can push a fake snapshot.
      onQueue: (h) => { fakeIa.transfer._onQueue = h; return () => {}; },
      _onQueue: null,
      reorder: async (jobId, toIndex) => { fakeIa.transfer._lastReorder = { jobId, toIndex }; return { ok: true }; },
      _lastReorder: null,
    },
    metadata: { modify: async () => ({ ok: true }), edit: async () => ({ ok: true }) },
    settings: {
      get: async () => ({ ...settings }),
      update: async (patch) => {
        Object.assign(settings, patch);
        return { ...settings };
      },
    },
    dialog: { chooseFolder: async () => '/tmp/ia-selftest' },
    shell: { openPath: async () => '', openExternal: async () => '' },
    logs: { open: async () => '' },
    view: { zoom: async () => 0 },
  };

  window.ia = fakeIa;

  /* ------------------------------ harness -------------------------------- */
  const results = [];
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function check(name, cond) {
    results.push({ name, ok: !!cond });
  }

  async function waitFor(predicate, timeout = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (predicate()) return true;
      await sleep(30);
    }
    return false;
  }

  async function run() {
    try {
      // App should be shown (logged in via fake auth).
      await waitFor(() => !$('#app').hidden);
      check('app shown after login', !$('#app').hidden);

      // Run a basic search.
      $('#search-input').value = 'test';
      $('#search-btn').click();
      await waitFor(() => document.querySelectorAll('#results .card').length === DOCS.length);
      const cards = document.querySelectorAll('#results .card');
      check('search renders all result cards', cards.length === DOCS.length);
      check('results meta shows the count', /120 results/.test($('#results-meta').textContent));

      // Facet sidebar should appear with mediatype buckets.
      await waitFor(() => !$('#facets').hidden);
      check('facet sidebar is shown', !$('#facets').hidden);
      const facetButtons = [...document.querySelectorAll('#facets .facet-item')];
      const audioFacet = facetButtons.find((b) => /audio/.test(b.textContent));
      check('an audio mediatype facet exists', !!audioFacet);

      // Click the audio facet → advanced search filters to 1 doc.
      if (audioFacet) {
        audioFacet.click();
        await waitFor(() => document.querySelectorAll('#results .card').length === 1, 4000);
        check('clicking a facet narrows results to audio (1)', document.querySelectorAll('#results .card').length === 1);
        check('an active-facet chip is shown', document.querySelectorAll('#active-facets .chip').length >= 1);
        // Remove the mediatype filter via the chip's × → back to all docs.
        // (Clicking the chip BODY now searches just that term, not removes it.)
        const chips = [...document.querySelectorAll('#active-facets .chip')];
        const mtChip = chips.find((c) => /mediatype/.test(c.textContent));
        const mtX = mtChip && mtChip.querySelector('.chip-x');
        if (mtX) mtX.click();
        await waitFor(() => document.querySelectorAll('#results .card').length === DOCS.length, 4000);
        check('removing the mediatype chip via × restores all results', document.querySelectorAll('#results .card').length === DOCS.length);
      }

      // Favorite the first result, then check the Favorites tab.
      const firstStar = $('#results .card .fav-star');
      check('result cards have a favorite star', !!firstStar);
      if (firstStar) {
        firstStar.click();
        await sleep(50);
        document.querySelector('.tab[data-tab="favorites"]').click();
        await waitFor(() => document.querySelectorAll('#favorites-list .card').length === 1);
        check('favorited item appears in the Favorites tab', document.querySelectorAll('#favorites-list .card').length === 1);
      }

      // Switch to compact view → the list-sort control appears.
      document.querySelector('.tab[data-tab="search"]').click();
      $('#view-compact').click();
      await waitFor(() => !$('#list-sort').hidden);
      check('compact view reveals the sort control', !$('#list-sort').hidden);

      // Sort by downloads desc → first card should be the 200-download "beta".
      $('#sort-key').value = 'downloads';
      $('#sort-key').dispatchEvent(new Event('change'));
      $('#sort-dir').click(); // toggle to desc
      await sleep(80);
      const firstTitle = $('#results .card .title') && $('#results .card .title').textContent;
      check('sort by downloads desc puts beta (200) first', /beta/i.test(firstTitle || ''));

      // Open the item modal for the first result.
      const detailsBtn = [...document.querySelectorAll('#results .card .actions button')].find((b) => b.textContent === 'Details');
      if (detailsBtn) {
        detailsBtn.click();
        await waitFor(() => !$('#item-modal').hidden && /file-table/.test($('#item-body').innerHTML));
        check('item modal opens with a file table', /file-table/.test($('#item-body').innerHTML));
        // #14: the file-type bubble chips were removed (they duplicated the list).
        check('item modal no longer shows file-type bubbles (#14)', !/type-summary/.test($('#item-body').innerHTML));
        // #13: "more from…" buttons run in-app searches (related-links container).
        check('item modal shows in-app related-search buttons (#13)', $('#item-body .related-links .link-btn') != null);
        // #12: owner-only actions show because the uploader matches the account.
        const itemBtns = [...document.querySelectorAll('#item-body button')].map((b) => b.textContent);
        check('owner-only Edit metadata button is shown when uploader matches (#12)', itemBtns.includes('Edit metadata'));
        $('#item-close').click();
      }

      // Save the current search, then confirm it appears in the saved dropdown.
      const before = $('#saved-select').options.length;
      window.prompt = undefined; // ensure our modal prompt is used, not native
      $('#save-search').click();
      await waitFor(() => !$('#prompt-modal').hidden);
      $('#prompt-input').value = 'My Saved';
      $('#prompt-ok').click();
      await waitFor(() => $('#saved-select').options.length === before + 1);
      check('saving a search adds it to the saved dropdown', $('#saved-select').options.length === before + 1);

      // Theme switch to light applies data-theme.
      $('#pref-theme').value = 'light';
      $('#pref-theme').dispatchEvent(new Event('change'));
      await sleep(50);
      check('theme switch sets data-theme=light', document.documentElement.dataset.theme === 'light');

      // --- selection / filter behaviors (back to grid on the live results) --
      document.querySelector('.tab[data-tab="search"]').click();
      $('#view-grid').click();
      await waitFor(() => document.querySelectorAll('#results .pick-box').length >= 1, 4000);
      const boxes = () => [...document.querySelectorAll('#results .pick-box')];

      // #6: checkboxes must NOT be pre-checked (guards the el() bool-attr bug).
      check('#6 result checkboxes start unchecked', boxes().length >= 1 && boxes().every((b) => !b.checked));

      // #6: checkboxes must NOT be pre-checked (guards the el() bool-attr bug).
      // (Selection range / cross-page logic is covered by selection.test.js.)

      // #10: live title filter narrows the visible cards to title matches.
      const visBefore = document.querySelectorAll('#results .card').length;
      $('#results-filter').value = 'zzzznomatch';
      $('#results-filter').dispatchEvent(new Event('input'));
      await sleep(40);
      check('#10 live filter hides non-matching cards', document.querySelectorAll('#results .card').length === 0 && visBefore > 0);
      $('#results-filter').value = '';
      $('#results-filter').dispatchEvent(new Event('input'));
      await sleep(30);
      check('#10 clearing the filter restores cards', document.querySelectorAll('#results .card').length === visBefore);

      // Structural checks for the new controls (#7/#8/#11/#12).
      check('#8 per-page offers 50/100/200', [...$('#per-page').options].map((o) => o.value).join(',') === '50,100,200');
      check('#7 pager has a jump-to-page input', !!$('#jump-page'));
      check('#11 subject-tags toggle exists', !!$('#toggle-subjects'));
      check('#12 from/to year inputs are present', !!$('#quick-date-from') && !!$('#quick-date-to'));

      // ----- Transfers tab: two sections + upload auto-fill + Clear All -----
      check('Transfers tab is labelled "Transfers"', /Transfers/.test($('.tab[data-tab="downloads"]').textContent));
      check('Transfers tab has a Downloads list', !!$('#downloads-list'));
      check('Transfers tab has an Uploads list', !!$('#uploads-list'));

      // Choosing a file should auto-fill the title + identifier (#1/#2).
      document.querySelector('.tab[data-tab="upload"]').click();
      $('#up-title').value = '';
      $('#up-identifier').value = '';
      $('#up-choose-files').click();
      await waitFor(() => $('#up-title').value !== '', 2000);
      check('#1 choosing a file fills the title from the filename', $('#up-title').value === 'My Great Book');
      check('#2 choosing a file fills the identifier (lowercased, hyphenated)', $('#up-identifier').value === 'my-great-book');
      check('a "Clear All" button exists on the upload form', !!$('#up-clear'));
      $('#up-clear').click();
      check('Clear All empties the identifier + title', $('#up-identifier').value === '' && $('#up-title').value === '');
      check('a preserve-upload-metadata preference toggle exists', !!$('#pref-preserve-upload-meta'));

      // ----- upload language dropdown + BookReader option checkboxes -----
      const langCodes = [...$('#up-language').options].map((o) => o.value);
      check('upload language dropdown is populated (incl. jpn/chi/kor)',
        langCodes.includes('jpn') && langCodes.includes('chi') && langCodes.includes('kor'));
      check('upload language dropdown lists 15 languages + the none option', $('#up-language').options.length === 16);
      check('upload has a right-to-left (page-progression) checkbox', !!$('#up-rtl'));
      check('upload has a single-page (bookreader-defaults) checkbox', !!$('#up-1up'));

      // ----- transfer queue: active pinned on top, queued cards draggable -----
      const dl = $('#downloads-list');
      dl.innerHTML = '';
      for (const id of ['job-x-wait', 'job-x-active']) {
        // Append in the "wrong" order (waiting first) so reordering is observable.
        const c = document.createElement('div');
        c.className = 'job job-download';
        c.id = id;
        c.innerHTML = '<div class="job-top"><div class="job-head"><div><div class="job-title">x</div></div></div></div>';
        dl.appendChild(c);
      }
      if (fakeIa.transfer._onQueue) {
        fakeIa.transfer._onQueue({
          downloads: 2, uploads: 0,
          active: { jobId: 'job-x-active', kind: 'download', label: 'a' },
          waiting: [{ jobId: 'job-x-wait', kind: 'download', label: 'w' }],
        });
      }
      const order = [...dl.querySelectorAll('.job')].map((c) => c.id);
      check('queue: the active transfer is pinned to the top', order[0] === 'job-x-active');
      check('queue: the active card is not draggable', document.getElementById('job-x-active').draggable === false);
      check('queue: a waiting card is draggable', document.getElementById('job-x-wait').draggable === true);
      check('queue: a Transfers tab badge reflects the count', /^[0-9]/.test($('#downloads-badge').textContent));
    } catch (err) {
      results.push({ name: 'harness threw: ' + err.message + ' @ ' + (err.stack || '').split('\n')[1], ok: false });
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    // eslint-disable-next-line no-console
    console.log('SELFTEST_RESULT ' + JSON.stringify({ passed, total: results.length, failures: failed.map((f) => f.name) }));
  }

  // Run once the renderer has booted (DOM + listeners ready).
  if (document.readyState === 'complete') setTimeout(run, 300);
  else window.addEventListener('load', () => setTimeout(run, 300));
})();
