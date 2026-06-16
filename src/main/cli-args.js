'use strict';

/**
 * cli-args.js
 *
 * Pure parsing of the process argv into app flags. No Electron, no I/O, so it
 * is unit-testable. The point of extracting this is H3: the `--screenshot=`
 * file-write must be honored ONLY in dev, never in a packaged production build
 * where arbitrary argv could otherwise drive an arbitrary-path file write.
 */

/** Whether the app was started in development mode (`--dev`). */
function isDevFromArgv(argv = []) {
  return argv.includes('--dev');
}

/**
 * Resolve the screenshot output path, or null. Returns a non-null path ONLY in
 * dev mode — in production the `--screenshot=` flag is ignored entirely.
 */
function resolveScreenshotPath(argv = []) {
  if (!isDevFromArgv(argv)) return null;
  const arg = argv.find((a) => a.startsWith('--screenshot='));
  if (!arg) return null;
  const path = arg.split('=').slice(1).join('='); // tolerate '=' inside the path
  return path || null;
}

/**
 * Whether the app should run its headless self-test (--selftest). Gated behind
 * --dev so it can never be triggered in a packaged production launch.
 */
function isSelfTest(argv = []) {
  return isDevFromArgv(argv) && argv.includes('--selftest');
}

/**
 * Resolve a `--demo=<query>` value (dev-only). When set, the renderer auto-runs
 * that search so a screenshot can capture a populated UI. Returns null outside
 * dev or when absent.
 */
function resolveDemo(argv = []) {
  if (!isDevFromArgv(argv)) return null;
  const arg = argv.find((a) => a.startsWith('--demo='));
  if (!arg) return null;
  const q = arg.split('=').slice(1).join('=');
  return q || null;
}

module.exports = { isDevFromArgv, resolveScreenshotPath, isSelfTest, resolveDemo };
