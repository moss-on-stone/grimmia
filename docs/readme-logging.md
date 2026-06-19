# readme-logging

Structured, file-based logging for the main process.

## What it does

The app writes one-line, ISO-timestamped, leveled entries to a log file **and**
mirrors them to the console:

```
2026-06-07T23:47:54.600Z INFO  app: ready version=0.1.6 isDev=true
2026-06-07T23:48:10.114Z INFO  download started items=1 files=3 format=pdf dest=/Users/me/Downloads
2026-06-07T23:48:12.880Z WARNING download: retrying file name=book.pdf attempt=1
2026-06-07T23:48:20.002Z ERROR download error reason="Connection dropped"
```

- **Location:** `<userData>/logs/grimmia.log`
  (macOS: `~/Library/Application Support/Grimmia/logs/`). Open it from
  **Preferences → Logs & diagnostics → Open logs folder**.
- **Levels:** DEBUG < INFO < WARNING < ERROR. The threshold is INFO in
  production and DEBUG when launched with `--dev`.
- **Rotation:** when the file passes ~2 MB it rolls to `grimmia.log.1`
  (one backup kept), so the log never grows unbounded.
- **Robust:** logging never throws — a formatting/IO failure is swallowed so it
  can't crash the app. Each entry is exactly one line (newlines escaped), so the
  log is greppable.

## What is logged

Auth (login ok/failed, logout), downloads (start, each file done, checksum
mismatches, retries, completion, errors), collection listing, single + bulk
uploads, CSV parse, and app lifecycle.

## How it's structured

- `src/main/log-format.js` — **pure** formatting + policy (formatLine,
  shouldRotate, levelEnabled). Unit-tested, deterministic (the timestamp is
  injected).
- `src/main/logger.js` — the file-writing logger (append + rotate + console
  mirror). Composes log-format. Has test seams (`__setLogDir`, `__setClock`,
  `__setMaxBytes`) so it's tested against a tmpdir with no Electron.
- Call sites: `src/main/main.js` (IPC handlers, lifecycle) and
  `src/main/ipc-handlers.js` (download orchestration, via an injected `log`).
