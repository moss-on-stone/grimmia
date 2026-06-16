'use strict';

/**
 * adhoc-sign.js — electron-builder `afterPack` hook.
 *
 * Applies a clean AD-HOC code signature to the whole macOS .app bundle.
 *
 * Why: with no paid Developer ID, electron-builder skips signing on a CI runner.
 * That leaves the inner Electron binary ad-hoc-signed but the OUTER .app bundle
 * unsealed/inconsistent — which Gatekeeper reports as "is damaged and can't be
 * opened" (the harsh dialog with no "Open Anyway"). Re-signing the bundle with
 * `codesign --force --deep --sign -` makes it "satisfy its Designated
 * Requirement", which restores the friendlier "unidentified developer" prompt
 * (System Settings → Privacy & Security → Open Anyway) — no Terminal needed.
 *
 * This is a no-op on Windows/Linux packing and when a real signing identity is
 * configured (env CSC_LINK / a Developer ID), so it never overrides a proper
 * signature.
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  // Only sign the macOS bundle; skip win/linux packs.
  const platformName =
    context.electronPlatformName || (context.packager && context.packager.platform && context.packager.platform.name);
  if (platformName !== 'darwin' && process.platform !== 'darwin') return;
  if (platformName && platformName !== 'darwin') return;

  // Respect a real signing identity if one is configured — don't clobber it.
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  try {
    // --deep signs nested code; --force replaces the linker's partial signature;
    // "-" is the ad-hoc identity.
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    // Verify it now satisfies its Designated Requirement (fail the build if not).
    execFileSync('codesign', ['--verify', '--verbose', appPath], { stdio: 'inherit' });
    // eslint-disable-next-line no-console
    console.log(`[adhoc-sign] ad-hoc signed ${appName}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[adhoc-sign] failed to ad-hoc sign the app bundle:', err.message);
    throw err;
  }
};
