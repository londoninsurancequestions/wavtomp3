export const TESTIMONIALS = [
  {
    quote:
      'I hand off rough mixes to clients all day. Knowing the WAVs never leave my laptop in local mode is the whole reason I switched. The 320k exports are instant.',
    initials: 'MR',
    avatar: 'm1',
    name: 'Mara Reyes',
    role: 'Mixing engineer, Lisbon',
    featured: true,
  },
  {
    quote:
      'I batch-convert a season of interviews at once. Server mode chewed through 240 files with R128 loudness while I made coffee. The podcast preset alone saves me an hour an episode.',
    initials: 'TO',
    avatar: 'm2',
    name: 'Theo Okafor',
    role: 'Podcast producer',
    featured: true,
  },
  {
    quote:
      "Finally a converter that doesn't hide the settings or slap a watermark on everything. VBR V0, keep my tags, drag, done. It just respects that I know what I want.",
    initials: 'JL',
    avatar: 'm3',
    name: 'Jin Lee',
    role: 'Indie game audio',
    featured: true,
  },
  {
    quote:
      'We archive field recordings from documentary shoots. FLAC to MP3 for review cuts, WAV for deliverables — same tool, no account required for quick jobs.',
    initials: 'SK',
    avatar: 'm4',
    name: 'Sofia Kovács',
    role: 'Documentary sound recordist',
  },
  {
    quote:
      'Switched our whole newsroom off a clunky desktop app. Reporters drop M4A voice memos and get MP3s back before the edit meeting starts.',
    initials: 'DW',
    avatar: 'm5',
    name: 'Daniel Wu',
    role: 'Audio producer, public radio',
  },
  {
    quote:
      'The local preview limit is fair — I heard 30 seconds, subscribed, and never looked back. Unlimited batch on server mode paid for itself the first week.',
    initials: 'AP',
    avatar: 'm2',
    name: 'Aisha Patel',
    role: 'Audiobook narrator',
  },
  {
    quote:
      'I teach intro audio and send students here instead of sketchy adware converters. Browser-based FFmpeg is a great demo of what the web can do.',
    initials: 'RC',
    avatar: 'm3',
    name: 'Ryan Cho',
    role: 'Music technology lecturer',
  },
  {
    quote:
      'OGG to AAC for game builds, MP3 for marketing clips — one bookmark covers every format our pipeline throws at it.',
    initials: 'EM',
    avatar: 'm1',
    name: 'Elena Morales',
    role: 'Technical sound designer',
  },
  {
    quote:
      'WMA support saved me when a client sent ancient Windows Media files. Server mode handled formats my DAW refuses to touch.',
    initials: 'BH',
    avatar: 'm4',
    name: 'Ben Hartley',
    role: 'Post-production supervisor',
  },
  {
    quote:
      'Tag preservation actually works. I convert hundreds of library stems and the ISRCs stay put — rare for a free tool.',
    initials: 'NF',
    avatar: 'm5',
    name: 'Nina Fontaine',
    role: 'Music librarian',
  },
  {
    quote:
      'Clean UI, no signup wall for basic work, and the privacy toggle is right there. Exactly what I wanted for client confidentiality.',
    initials: 'GT',
    avatar: 'm2',
    name: 'Greg Tanaka',
    role: 'Forensic audio consultant',
  },
  {
    quote:
      'Our church livestream team converts sermon WAVs to MP3 every Sunday. Drag, drop, zip download — volunteers get it immediately.',
    initials: 'LM',
    avatar: 'm3',
    name: 'Laura Mitchell',
    role: 'Volunteer media director',
  },
];

export function testimonialCardHtml(t) {
  const avatarClass = t.avatar && t.avatar !== 'm1' ? ` ${t.avatar}` : '';
  return `<div class="tst">
      <div class="quote-mark">"</div>
      <p>${t.quote}</p>
      <div class="who">
        <div class="av${avatarClass}">${t.initials}</div>
        <div><div class="nm">${t.name}</div><div class="rl">${t.role}</div></div>
      </div>
    </div>`;
}

export function modalTestimonialHtml(t) {
  const avatarClass = t.avatar && t.avatar !== 'm1' ? ` ${t.avatar}` : '';
  return `<blockquote class="modal-tst">
      <p>${t.quote}</p>
      <footer class="modal-tst-who">
        <div class="av${avatarClass}">${t.initials}</div>
        <cite class="nm">${t.name}</cite>
      </footer>
    </blockquote>`;
}

export function modalTestimonialsHtml() {
  const picks = [
    TESTIMONIALS.find((t) => t.name === 'Aisha Patel'),
    TESTIMONIALS.find((t) => t.name === 'Theo Okafor'),
    TESTIMONIALS.find((t) => t.name === 'Mara Reyes'),
  ].filter(Boolean);
  return picks.map(modalTestimonialHtml).join('');
}

export function featuredTestimonialsHtml() {
  return TESTIMONIALS.filter((t) => t.featured).map(testimonialCardHtml).join('\n    ');
}
