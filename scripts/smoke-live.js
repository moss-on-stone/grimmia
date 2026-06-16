'use strict';

/**
 * smoke-live.js — OPT-IN live smoke test against archive.org.
 *
 * Runs a REAL search and (optionally) a single small file download through the
 * actual ia-client — to confirm the live network path works end-to-end. This is
 * NOT part of `npm test` (the suite stays network-free, per T5); run it manually:
 *
 *   node scripts/smoke-live.js              # search only
 *   node scripts/smoke-live.js --download   # also download one small file
 *
 * It never uploads and never downloads a whole collection.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ia = require('../src/main/ia-client');

async function main() {
  const wantDownload = process.argv.includes('--download');
  let failures = 0;

  // 1) Real search.
  process.stdout.write('[smoke] searching archive.org for "grateful dead 1977"… ');
  const res = await ia.search('grateful dead 1977', { rows: 5, page: 1 });
  if (res && res.numFound > 0 && Array.isArray(res.docs) && res.docs.length) {
    console.log(`OK (${res.numFound.toLocaleString()} hits, ${res.docs.length} shown)`);
  } else {
    console.log('FAIL (no results)');
    failures++;
  }

  // 2) Real metadata for the first hit.
  const first = res.docs[0] && res.docs[0].identifier;
  if (first) {
    process.stdout.write(`[smoke] fetching metadata for "${first}"… `);
    const md = await ia.getMetadata(first);
    const files = (md.files || []).filter((f) => f.name);
    console.log(`OK (${files.length} files)`);

    // 3) Optional: download the single smallest real file (kept tiny).
    if (wantDownload) {
      const small = files
        .filter((f) => Number(f.size) > 0 && Number(f.size) < 2_000_000)
        .sort((a, b) => Number(a.size) - Number(b.size))[0];
      if (small) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-smoke-'));
        const dest = path.join(dir, small.name.replace(/[^\w.\-]/g, '_'));
        process.stdout.write(`[smoke] downloading "${small.name}" (${small.size} bytes)… `);
        const r = await ia.downloadFile({
          url: ia.downloadUrl(first, small.name),
          destPath: dest,
          expectedSize: small.size,
        });
        const ok = fs.existsSync(dest) && fs.statSync(dest).size === Number(small.size);
        console.log(ok ? `OK (${r.bytes} bytes)` : 'FAIL (size mismatch)');
        if (!ok) failures++;
        fs.rmSync(dir, { recursive: true, force: true });
      } else {
        console.log('[smoke] no small file to download; skipping.');
      }
    }
  }

  console.log(failures ? `[smoke] FAILED (${failures})` : '[smoke] PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('[smoke] ERROR', err.message);
  process.exit(1);
});
