import { initPdfToEpub } from './pdf-to-epub-shared.js';

const PRESETS = {
  kindle: {
    profile: 'kindle',
    textSize: 'default',
    layout: 'reflow',
    chapters: 'headings',
    heuristics: true,
    embedFonts: false,
    removePageNumbers: true,
    blankLineParagraphs: false,
  },
  kobo: {
    profile: 'kobo',
    textSize: 'default',
    layout: 'reflow',
    chapters: 'headings',
    heuristics: true,
    embedFonts: false,
    removePageNumbers: true,
    blankLineParagraphs: false,
  },
  apple: {
    profile: 'ipad',
    textSize: 'default',
    layout: 'reflow',
    chapters: 'headings',
    heuristics: true,
    embedFonts: false,
    removePageNumbers: true,
    blankLineParagraphs: true,
  },
  academic: {
    profile: 'generic',
    textSize: 'default',
    layout: 'reflow',
    chapters: 'headings',
    heuristics: true,
    embedFonts: true,
    removePageNumbers: true,
    blankLineParagraphs: true,
  },
  'fixed-layout': {
    profile: 'generic',
    textSize: 'default',
    layout: 'preserve',
    chapters: 'pages',
    heuristics: false,
    embedFonts: true,
    removePageNumbers: false,
    blankLineParagraphs: false,
  },
};

initPdfToEpub({
  presets: PRESETS,
  defaultPreset: 'kindle',
  emptySummary: '<b>No file yet</b> — drop a PDF above to begin.',
});
