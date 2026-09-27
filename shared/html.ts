/**
 * Escaping for the documents the apps print (challans, statements). It lives apart from
 * reports.ts because that file reaches for react-native to save files, and pulling that in
 * made every module downstream — data.ts and the whole credit calculation — impossible to
 * load in a plain Node test.
 */
export const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
