'use strict';

/**
 * Tiny loopback HTTP server helper for streaming-download/upload tests.
 *
 * Binds to 127.0.0.1:0 (an OS-assigned free port) and dispatches each request
 * to a user-supplied handler. No real archive.org traffic; everything stays on
 * the loopback interface (T5: network-test discipline).
 */

const http = require('node:http');

/**
 * Start a loopback server. `handler(req, res)` is the normal Node http handler.
 * Resolves to `{ url, port, close() }`.
 */
function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((res) => server.close(() => res())),
      });
    });
  });
}

module.exports = { startServer };
