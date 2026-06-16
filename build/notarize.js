'use strict';

/**
 * notarize.js — electron-builder `afterSign` hook (H4).
 *
 * Notarizes the macOS app with Apple, but ONLY when the required credentials
 * are present in the environment. This keeps unsigned local builds working:
 * with no credentials set, the hook is a no-op and electron-builder produces an
 * (unsigned, un-notarized) DMG exactly as before.
 *
 * Required env vars to actually notarize:
 *   APPLE_API_KEY      path to the App Store Connect API key (.p8)
 *   APPLE_API_KEY_ID   the key's ID
 *   APPLE_API_ISSUER   the issuer ID
 *
 * `@electron/notarize` is an OPTIONAL dependency — it is only require()d when
 * credentials exist, so a default `npm install` (which does not pull it) still
 * builds fine.
 */

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = process.env;
  if (!APPLE_API_KEY || !APPLE_API_KEY_ID || !APPLE_API_ISSUER) {
    // eslint-disable-next-line no-console
    console.log('[notarize] Apple API credentials not set — skipping notarization (unsigned build).');
    return;
  }

  let notarize;
  try {
    ({ notarize } = require('@electron/notarize'));
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      '[notarize] @electron/notarize is not installed; run `npm i -D @electron/notarize` to notarize. Skipping.'
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  // eslint-disable-next-line no-console
  console.log(`[notarize] Submitting ${appPath} to Apple…`);
  await notarize({
    appPath,
    appleApiKey: APPLE_API_KEY,
    appleApiKeyId: APPLE_API_KEY_ID,
    appleApiIssuer: APPLE_API_ISSUER,
  });
  // eslint-disable-next-line no-console
  console.log('[notarize] Done.');
};
