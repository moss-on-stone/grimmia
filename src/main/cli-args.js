'use strict';

/**
 * cli-args.js
 *
 * Pure parsing of the process argv into app flags. No Electron, no I/O, so it
 * is unit-testable. The point of extracting this is H3: the `--screenshot=`
 * file-write must be honored ONLY in dev, never in a packaged production build
 * where arbitrary argv could otherwise drive an arbitrary-path file write.
 */

/**
 * Whether the app was started in development mode (`--dev`). A PACKAGED build
 * NEVER counts as dev (L6): a shipped .app/.exe can be relaunched with arbitrary
 * argv by any local process, so every dev-only primitive (relaxed selftest
 * window, the --screenshot file-write) must be unreachable regardless of argv.
 * `isPackaged` is injected (main.js passes app.isPackaged) to keep this pure.
 */
function isDevFromArgv(argv = [], isPackaged = false) {
  if (isPackaged) return false;
  return argv.includes('--dev');
}

/**
 * Resolve the screenshot output path, or null. Returns a non-null path ONLY in
 * dev mode — in production / packaged the `--screenshot=` flag is ignored.
 */
function resolveScreenshotPath(argv = [], isPackaged = false) {
  if (!isDevFromArgv(argv, isPackaged)) return null;
  const arg = argv.find((a) => a.startsWith('--screenshot='));
  if (!arg) return null;
  const path = arg.split('=').slice(1).join('='); // tolerate '=' inside the path
  return path || null;
}

/**
 * Whether the app should run its headless self-test (--selftest). Gated behind
 * --dev (and never when packaged) so it can't be triggered in production.
 */
function isSelfTest(argv = [], isPackaged = false) {
  return isDevFromArgv(argv, isPackaged) && argv.includes('--selftest');
}

/**
 * Resolve a `--demo=<query>` value (dev-only). When set, the renderer auto-runs
 * that search so a screenshot can capture a populated UI. Returns null outside
 * dev / when packaged / when absent.
 */
function resolveDemo(argv = [], isPackaged = false) {
  if (!isDevFromArgv(argv, isPackaged)) return null;
  const arg = argv.find((a) => a.startsWith('--demo='));
  if (!arg) return null;
  const q = arg.split('=').slice(1).join('=');
  return q || null;
}

module.exports = { isDevFromArgv, resolveScreenshotPath, isSelfTest, resolveDemo };
