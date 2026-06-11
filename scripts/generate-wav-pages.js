import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  WAV_ROUTES,
  M4A_ROUTES,
  AAC_ROUTES,
  MP3_ROUTES,
  OGG_ROUTES,
  WMA_ROUTES,
  getInputFormat,
  relatedFormatsHtml,
  formatCtasHtml,
} from '../public/conversion-formats.js';
import { featuredTestimonialsHtml } from '../public/testimonials.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const convertTemplatePath = path.join(root, 'templates/convert.html');
const homeTemplatePath = path.join(root, 'templates/home.html');
const testimonialsTemplatePath = path.join(root, 'templates/testimonials.html');
const termsTemplatePath = path.join(root, 'templates/terms.html');
const privacyTemplatePath = path.join(root, 'templates/privacy.html');
const posthogSnippetPath = path.join(root, 'templates/partials/posthog-snippet.html');
const faviconSnippetPath = path.join(root, 'templates/partials/favicon.html');

const STANDALONE_PAGES = [
  'login.html',
  'account.html',
  'create-account.html',
  'my-files.html',
  'wavtomp3.html',
];

const posthogSnippet = fs.readFileSync(posthogSnippetPath, 'utf8');
const faviconSnippet = fs.readFileSync(faviconSnippetPath, 'utf8');

function injectFavicon(html) {
  if (html.includes('{{FAVICON}}')) {
    return html.replace('{{FAVICON}}', faviconSnippet);
  }
  if (html.includes('rel="icon"')) {
    return html;
  }
  return html.replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">\n${faviconSnippet}`
  );
}

function injectHeadExtras(html) {
  return injectPosthog(injectFavicon(html));
}

function injectPosthog(html) {
  if (html.includes('{{POSTHOG_SNIPPET}}')) {
    return html.replace('{{POSTHOG_SNIPPET}}', posthogSnippet);
  }
  if (html.includes('posthog.init(')) {
    return html.replace(
      /<script>\s*!function\(t,e\)\{var o,n,p,r;e\.__SV[\s\S]*?<\/script>\s*/,
      posthogSnippet + '\n'
    );
  }
  return html.replace('</head>', `${posthogSnippet}\n</head>`);
}

function buildConvertPage(template, route) {
  const input = getInputFormat(route.inputSlug);

  const replacements = {
    '{{PAGE_TITLE}}': `YouConvert.com — Convert ${input.label} to ${route.label}, in your browser or on our servers`,
    '{{EYEBROW}}': `⎯⎯ ${input.label} → ${route.label} ⎯⎯`,
    '{{H1_LINE1}}': `Convert ${input.label} to ${route.label}`,
    '{{TAGLINE}}': route.tagline,
    '{{CTA_TEXT}}': route.ctaText,
    '{{FOOTER_BLURB}}': route.footerBlurb,
    '{{FAQ_BITRATE}}': route.faqBitrate,
    '{{RELATED_FORMATS}}': relatedFormatsHtml(route.inputSlug, route.slug),
    '{{INPUT_ACCEPT}}': input.accept,
    '{{DROP_TITLE}}': input.dropTitle,
    '{{INPUT_HINT}}': input.formatsHint,
    '{{INPUT_LABEL}}': input.label,
    '{{FORMATS_SECTION_TITLE}}': `Other ${input.label} conversions`,
    '{{FORMATS_FOOTER_LINK}}': `${input.label} conversions`,
    '{{FAQ_BATCH}}': `Absolutely — drag in as many ${input.label} files as you like, or drop a whole folder. Your chosen options apply to the entire batch, and you can download everything as a single zip.`,
    '{{TESTIMONIALS_PREVIEW}}': featuredTestimonialsHtml(),
  };

  let html = template.replace(
    /data-input-format="[^"]*"/,
    `data-input-format="${route.inputSlug}"`
  );
  html = html.replace(/data-output-format="[^"]*"/, `data-output-format="${route.slug}"`);

  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(key, value);
  }

  return injectHeadExtras(html);
}

function buildHomePage(template) {
  return injectHeadExtras(
    template
    .replace('{{WAV_CTAS}}', formatCtasHtml('wav'))
    .replace('{{M4A_CTAS}}', formatCtasHtml('m4a'))
    .replace('{{AAC_CTAS}}', formatCtasHtml('aac'))
    .replace('{{MP3_CTAS}}', formatCtasHtml('mp3'))
    .replace('{{OGG_CTAS}}', formatCtasHtml('ogg'))
    .replace('{{WMA_CTAS}}', formatCtasHtml('wma'))
  );
}

const convertTemplate = fs.readFileSync(convertTemplatePath, 'utf8');
const homeTemplate = fs.readFileSync(homeTemplatePath, 'utf8');

for (const route of [...WAV_ROUTES, ...M4A_ROUTES, ...AAC_ROUTES, ...MP3_ROUTES, ...OGG_ROUTES, ...WMA_ROUTES]) {
  const outPath = path.join(root, `${route.inputSlug}-to-${route.slug}.html`);
  fs.writeFileSync(outPath, buildConvertPage(convertTemplate, route));
  console.log(`Wrote ${route.inputSlug}-to-${route.slug}.html`);
}

fs.writeFileSync(path.join(root, 'index.html'), buildHomePage(homeTemplate));
console.log('Wrote index.html (home)');

const testimonialsTemplate = fs.readFileSync(testimonialsTemplatePath, 'utf8');
fs.writeFileSync(path.join(root, 'testimonials.html'), injectHeadExtras(testimonialsTemplate));
console.log('Wrote testimonials.html');

const termsTemplate = fs.readFileSync(termsTemplatePath, 'utf8');
fs.writeFileSync(path.join(root, 'terms.html'), injectHeadExtras(termsTemplate));
console.log('Wrote terms.html');

const privacyTemplate = fs.readFileSync(privacyTemplatePath, 'utf8');
fs.writeFileSync(path.join(root, 'privacy.html'), injectHeadExtras(privacyTemplate));
console.log('Wrote privacy.html');

for (const page of STANDALONE_PAGES) {
  const pagePath = path.join(root, page);
  if (!fs.existsSync(pagePath)) continue;
  fs.writeFileSync(pagePath, injectHeadExtras(fs.readFileSync(pagePath, 'utf8')));
  console.log(`Wrote ${page}`);
}
