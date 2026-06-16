'use strict';

/**
 * favorites.js (shared, pure)
 *
 * List operations for local favorites / bookmarks (#13). Favorites are stored
 * via settings and rendered in a Favorites tab; these helpers keep the list
 * de-duplicated (by identifier) and most-recently-added first. Non-mutating.
 *
 * CommonJS (tests/main) and plain <script> (window.favorites).
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.favoritesApi = api;
})(typeof window !== 'undefined' ? window : null, function () {
  function hasFavorite(list, identifier) {
    return (list || []).some((f) => f.identifier === identifier);
  }

  /** Add (or replace) a favorite, newest first. `savedAt` is optional. */
  function addFavorite(list, item, savedAt) {
    const without = (list || []).filter((f) => f.identifier !== item.identifier);
    const entry = savedAt != null ? { ...item, savedAt } : { ...item };
    return [entry, ...without];
  }

  function removeFavorite(list, identifier) {
    return (list || []).filter((f) => f.identifier !== identifier);
  }

  /** Add the item if absent, remove it if present. */
  function toggleFavorite(list, item, savedAt) {
    return hasFavorite(list, item.identifier)
      ? removeFavorite(list, item.identifier)
      : addFavorite(list, item, savedAt);
  }

  return { hasFavorite, addFavorite, removeFavorite, toggleFavorite };
});
