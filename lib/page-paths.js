/** Canonical public page URL — extensionless with trailing slash. */
export function pagePath(slug) {
  if (!slug || slug === '/') return '/';
  const clean = String(slug).replace(/^\/+|\/+$/g, '').replace(/\.html$/i, '');
  return `/${clean}/`;
}
