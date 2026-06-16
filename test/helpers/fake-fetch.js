'use strict';

/**
 * fake-fetch helper for ia-client JSON ops (T1).
 *
 * Swaps globalThis.fetch for a stub that matches requests by method+URL
 * (substring or RegExp) and returns a fake Response-like object with the same
 * surface ia-client's `request()` uses: ok, status, headers.get, text().
 *
 * No real network. Restore with the returned `restore()`.
 */

function makeResponse({ status = 200, json, text, headers = {} } = {}) {
  const body = text != null ? text : json != null ? JSON.stringify(json) : '';
  const hdrs = { 'content-type': json != null ? 'application/json' : 'text/plain', ...headers };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => hdrs[String(name).toLowerCase()],
    },
    text: async () => body,
  };
}

/**
 * Install a fake fetch. `routes` is an array of
 * `{ method?, url (string|RegExp), response (object) | (req)=>object }`.
 * The first matching route wins. Records calls on `.calls`.
 */
function installFakeFetch(routes = []) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ url: String(url), method, opts });
    for (const r of routes) {
      const methodOk = !r.method || r.method.toUpperCase() === method;
      const urlOk =
        r.url instanceof RegExp ? r.url.test(String(url)) : String(url).includes(r.url);
      if (methodOk && urlOk) {
        const spec = typeof r.response === 'function' ? r.response({ url, opts }) : r.response;
        return makeResponse(spec);
      }
    }
    throw new Error(`fake-fetch: no route matched ${method} ${url}`);
  };

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

module.exports = { installFakeFetch, makeResponse };
