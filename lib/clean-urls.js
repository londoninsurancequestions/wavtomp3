import fs from 'fs';
import path from 'path';

const SKIP_PREFIXES = ['/api/', '/public/', '/vendor/'];

function shouldSkip(pathname) {
  if (pathname === '/favicon.ico') return true;
  return SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function querySuffix(req) {
  const i = req.url.indexOf('?');
  return i >= 0 ? req.url.slice(i) : '';
}

function resolveHtmlPath(rootDir, slug) {
  const htmlPath = path.join(rootDir, `${slug}.html`);
  if (!fs.existsSync(htmlPath) || !fs.statSync(htmlPath).isFile()) return null;
  return htmlPath;
}

/** Serve /page/ URLs and 301-redirect .html variants to trailing-slash paths. */
export function cleanUrlMiddleware(rootDir) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const pathname = req.path;
    if (shouldSkip(pathname)) return next();

    const qs = querySuffix(req);

    if (/^\/index\.html$/i.test(pathname)) {
      return res.redirect(301, `/${qs}`);
    }

    if (/\.html$/i.test(pathname)) {
      const slug = pathname.slice(1, -5);
      if (resolveHtmlPath(rootDir, slug)) {
        return res.redirect(301, `/${slug}/${qs}`);
      }
      return next();
    }

    const match = pathname.match(/^\/([\w-]+)\/?$/);
    if (!match) return next();

    const slug = match[1];
    const htmlPath = resolveHtmlPath(rootDir, slug);
    if (!htmlPath) return next();

    if (!pathname.endsWith('/')) {
      return res.redirect(301, `/${slug}/${qs}`);
    }

    return res.sendFile(htmlPath);
  };
}
