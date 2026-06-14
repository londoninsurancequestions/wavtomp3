export const INPUT_WAV = {
  slug: 'wav',
  label: 'WAV',
  ext: 'wav',
  accept: '.wav,audio/wav,audio/x-wav',
  dropTitle: 'Drop your WAV files here',
  formatsHint: '.WAV · .WAVE · UP TO 2GB EACH · BATCH SUPPORTED',
  matches(file) {
    return /\.wave?$/i.test(file.name) || /wav/i.test(file.type);
  },
  stripExt(name) {
    return name.replace(/\.wave?$/i, '');
  },
};

export const INPUT_M4A = {
  slug: 'm4a',
  label: 'M4A',
  ext: 'm4a',
  accept: '.m4a,audio/mp4,audio/x-m4a',
  dropTitle: 'Drop your M4A files here',
  formatsHint: '.M4A · UP TO 2GB EACH · BATCH SUPPORTED',
  matches(file) {
    return /\.m4a$/i.test(file.name) || /m4a|audio\/mp4/i.test(file.type);
  },
  stripExt(name) {
    return name.replace(/\.m4a$/i, '');
  },
};

export const INPUT_AAC = {
  slug: 'aac',
  label: 'AAC',
  ext: 'aac',
  accept: '.aac,audio/aac,audio/aacp,audio/x-aac',
  dropTitle: 'Drop your AAC files here',
  formatsHint: '.AAC · UP TO 2GB EACH · BATCH SUPPORTED',
  matches(file) {
    return /\.aac$/i.test(file.name) || /aac/i.test(file.type);
  },
  stripExt(name) {
    return name.replace(/\.aac$/i, '');
  },
};

export const INPUT_MP3 = {
  slug: 'mp3',
  label: 'MP3',
  ext: 'mp3',
  accept: '.mp3,audio/mpeg,audio/mp3',
  dropTitle: 'Drop your MP3 files here',
  formatsHint: '.MP3 · UP TO 2GB EACH · BATCH SUPPORTED',
  matches(file) {
    return /\.mp3$/i.test(file.name) || /mpeg|mp3/i.test(file.type);
  },
  stripExt(name) {
    return name.replace(/\.mp3$/i, '');
  },
};

export const INPUT_OGG = {
  slug: 'ogg',
  label: 'OGG',
  ext: 'ogg',
  accept: '.ogg,audio/ogg,application/ogg,audio/vorbis',
  dropTitle: 'Drop your OGG files here',
  formatsHint: '.OGG · UP TO 2GB EACH · BATCH SUPPORTED',
  matches(file) {
    return /\.ogg$/i.test(file.name) || /ogg|vorbis/i.test(file.type);
  },
  stripExt(name) {
    return name.replace(/\.ogg$/i, '');
  },
};

export const INPUT_WMA = {
  slug: 'wma',
  label: 'WMA',
  ext: 'wma',
  accept: '.wma,audio/x-ms-wma,audio/wma',
  dropTitle: 'Drop your WMA files here',
  formatsHint: '.WMA · UP TO 2GB EACH · BATCH SUPPORTED',
  localSupported: false,
  matches(file) {
    return /\.wma$/i.test(file.name) || /wma|x-ms-wma/i.test(file.type);
  },
  stripExt(name) {
    return name.replace(/\.wma$/i, '');
  },
};

const INPUT_FORMATS = {
  wav: INPUT_WAV,
  m4a: INPUT_M4A,
  aac: INPUT_AAC,
  mp3: INPUT_MP3,
  ogg: INPUT_OGG,
  wma: INPUT_WMA,
};

export const INPUT_DETECTORS = [
  INPUT_WAV,
  INPUT_MP3,
  INPUT_M4A,
  INPUT_AAC,
  INPUT_OGG,
  INPUT_WMA,
];

export function getInputFormat(slug) {
  return INPUT_FORMATS[slug] || INPUT_WAV;
}

export function detectInputFormat(file) {
  return INPUT_DETECTORS.find((fmt) => fmt.matches(file)) || null;
}

function route(input, spec) {
  const inputFmt = getInputFormat(input);
  return {
    inputSlug: input,
    inputLabel: inputFmt.label,
    slug: spec.slug,
    label: spec.label,
    path: `/${input}-to-${spec.slug}/`,
    ...spec,
  };
}

const wavCopy = {
  mp3: {
    homeBlurb: 'Universal playback — the format everything plays.',
    tagline: 'without the wait.',
    footerBlurb: 'The fast, private way to turn WAV files into MP3 — in your browser or on our servers.',
    ctaText: 'Just clean MP3s the way you want them.',
    faqBitrate:
      'For music you want to keep, <code>320k</code> or <code>VBR V0</code> is effectively indistinguishable from the source. For spoken word and podcasts, <code>96k–128k mono</code> sounds great and keeps files small. When in doubt, 256k is a safe middle ground.',
  },
  aac: {
    homeBlurb: 'Efficient quality for Apple devices and streaming.',
    tagline: 'smaller files, still great quality.',
    footerBlurb: 'Convert WAV to AAC locally in your browser or on our servers — ideal for Apple devices and streaming.',
    ctaText: 'Clean AAC files, ready to share.',
    faqBitrate:
      'AAC is more efficient than MP3 at the same bitrate. <code>256k</code> is excellent for music; <code>128k</code> works well for most listening.',
  },
  flac: {
    homeBlurb: 'Lossless compression — archive without compromise.',
    tagline: 'lossless, bit-perfect quality.',
    footerBlurb: 'Turn WAV into FLAC without quality loss — compress archives while keeping every sample intact.',
    ctaText: 'Lossless FLAC exports, on your terms.',
    faqBitrate:
      'FLAC is lossless — there is no bitrate trade-off. File size depends on how compressible your audio is, but you keep the full fidelity of the source.',
  },
  m4a: {
    homeBlurb: 'AAC in an MP4 container — native on iPhone and iTunes.',
    tagline: 'perfect for Apple & modern players.',
    footerBlurb: 'Convert WAV to M4A for iTunes, iPhone, and anywhere AAC-in-MP4 is the native format.',
    ctaText: 'M4A files that just work everywhere Apple does.',
    faqBitrate:
      'M4A uses AAC audio. <code>256k</code> is a safe choice for music; <code>128k</code> is fine for voice and podcasts.',
  },
  m4r: {
    homeBlurb: 'Custom iPhone ringtones — trim, fade, and sync.',
    tagline: 'iPhone ringtones, ready to sync.',
    footerBlurb: 'Turn WAV clips into M4R ringtones — trim, fade, and export without leaving your browser.',
    ctaText: 'Custom ringtones, exported in seconds.',
    faqBitrate:
      'Ringtones are short clips — <code>192k–256k</code> AAC is plenty. Use trim and fade to nail the perfect loop.',
  },
  mp4: {
    homeBlurb: 'Audio-only MP4 tracks for video editors and platforms.',
    tagline: 'audio tracks for video workflows.',
    footerBlurb: 'Export WAV as MP4 audio for editors, social platforms, and anywhere an .mp4 container is expected.',
    ctaText: 'MP4 audio tracks, ready for your timeline.',
    faqBitrate:
      'For MP4 audio-only exports, <code>192k–256k</code> AAC is standard. Match your video project sample rate when resampling.',
  },
  ogg: {
    homeBlurb: 'Open Vorbis format for games, Linux, and the web.',
    tagline: 'open, web-ready audio.',
    footerBlurb: 'Convert WAV to OGG Vorbis for games, Linux, and open-source projects that prefer royalty-free codecs.',
    ctaText: 'OGG files built for the open web.',
    faqBitrate:
      'Vorbis quality scales with bitrate. <code>192k–256k</code> is great for music; lower bitrates suit speech.',
  },
  wma: {
    homeBlurb: 'Windows Media Audio for legacy players and workflows.',
    tagline: 'Windows-friendly audio.',
    footerBlurb: 'Convert WAV to WMA for legacy Windows players and workflows that still expect Microsoft formats.',
    ctaText: 'WMA exports via our servers when you need them.',
    faqBitrate:
      'WMA bitrates behave like other lossy codecs — <code>192k</code> is a solid default for music, <code>128k</code> for voice.',
  },
};

const aacCopy = {
  flac: {
    homeBlurb: 'Archive AAC masters as lossless FLAC.',
    tagline: 'lossless archives from AAC.',
    footerBlurb: 'Turn AAC into FLAC for editing pipelines and archival storage — decode once, keep every sample.',
    ctaText: 'Lossless FLAC from your AAC files.',
    faqBitrate:
      'FLAC is lossless. Converting from lossy AAC cannot restore data lost in the original encode — but FLAC avoids further degradation in your workflow.',
  },
  m4r: {
    homeBlurb: 'Turn AAC clips into iPhone ringtones.',
    tagline: 'ringtones, ready to sync.',
    footerBlurb: 'Convert AAC to M4R for iPhone — trim to the hook, fade the edges, and sync via Finder or iTunes.',
    ctaText: 'M4R ringtones from any AAC source.',
    faqBitrate:
      'Ringtones are short — <code>192k–256k</code> is plenty. Use trim and fade for a polished loop.',
  },
  mp3: {
    homeBlurb: 'Universal MP3s from your AAC library.',
    tagline: 'plays everywhere.',
    footerBlurb: 'Convert AAC to MP3 for maximum device compatibility — in your browser or on our servers.',
    ctaText: 'MP3 files that work on anything.',
    faqBitrate:
      'For music, <code>256k–320k</code> is a safe target. For voice, <code>128k mono</code> keeps files small.',
  },
  mp4: {
    homeBlurb: 'AAC to MP4 audio for video timelines.',
    tagline: 'editor-friendly audio tracks.',
    footerBlurb: 'Export AAC as MP4 audio for Premiere, DaVinci, and social platforms that expect .mp4 containers.',
    ctaText: 'MP4 audio tracks from AAC sources.',
    faqBitrate:
      '<code>192k–256k</code> AAC in MP4 is standard for video workflows. Match your project sample rate when resampling.',
  },
  m4a: {
    homeBlurb: 'Wrap AAC in an M4A container for Apple.',
    tagline: 'iTunes & iPhone ready.',
    footerBlurb: 'Convert standalone AAC to M4A for iTunes, iPhone, and anywhere AAC-in-MP4 is the native format.',
    ctaText: 'M4A files from your AAC sources.',
    faqBitrate:
      'M4A uses AAC audio. <code>256k</code> is a safe choice for music; <code>128k</code> is fine for voice.',
  },
  ogg: {
    homeBlurb: 'Open OGG Vorbis from AAC sources.',
    tagline: 'royalty-free output.',
    footerBlurb: 'Convert AAC to OGG for games, Linux apps, and open-source projects that prefer Vorbis.',
    ctaText: 'OGG files from your AAC library.',
    faqBitrate:
      'Vorbis at <code>192k–256k</code> suits music; lower bitrates work for speech.',
  },
  wav: {
    homeBlurb: 'Uncompressed WAV from AAC — for editing.',
    tagline: 'PCM audio, ready to edit.',
    footerBlurb: 'Decode AAC to WAV for DAWs, sample editors, and anywhere uncompressed PCM is required.',
    ctaText: 'Full WAV exports from AAC.',
    faqBitrate:
      'WAV is uncompressed PCM — there is no bitrate setting. File size reflects duration, sample rate, and channels.',
  },
  wma: {
    homeBlurb: 'Windows-friendly WMA from AAC.',
    tagline: 'legacy Windows formats.',
    footerBlurb: 'Convert AAC to WMA for older Windows players and enterprise workflows via our servers.',
    ctaText: 'WMA exports when you need them.',
    faqBitrate:
      '<code>192k</code> is a solid default for music; <code>128k</code> for voice.',
  },
};

const mp3Copy = {
  aac: {
    homeBlurb: 'Efficient AAC from your MP3 library.',
    tagline: 'smaller or higher-quality re-encodes.',
    footerBlurb: 'Convert MP3 to AAC for Apple devices, streaming, and workflows that prefer AAC — locally or on our servers.',
    ctaText: 'Clean AAC exports from MP3.',
    faqBitrate:
      'AAC is efficient at <code>256k</code> for music and <code>128k</code> for speech. Re-encoding lossy MP3 cannot recover lost quality — choose a bitrate for your target platform.',
  },
  flac: {
    homeBlurb: 'Archive MP3 masters as FLAC.',
    tagline: 'lossless containers from MP3.',
    footerBlurb: 'Convert MP3 to FLAC for editing pipelines — note this cannot restore quality lost in the original MP3 encode.',
    ctaText: 'FLAC archives from your MP3 files.',
    faqBitrate:
      'FLAC is lossless but cannot recover data removed during MP3 compression. Use FLAC when you need a lossless container for further editing.',
  },
  m4r: {
    homeBlurb: 'Turn MP3 clips into iPhone ringtones.',
    tagline: 'ringtones, ready to sync.',
    footerBlurb: 'Convert MP3 to M4R for iPhone — trim to the hook, fade the edges, and sync via Finder or iTunes.',
    ctaText: 'M4R ringtones from MP3 sources.',
    faqBitrate:
      'Ringtones are short — <code>192k–256k</code> is plenty. Use trim and fade for a polished loop.',
  },
  m4a: {
    homeBlurb: 'MP3 to M4A for Apple ecosystems.',
    tagline: 'iTunes & iPhone ready.',
    footerBlurb: 'Convert MP3 to M4A for iTunes, iPhone, and anywhere AAC-in-MP4 is the native format.',
    ctaText: 'M4A files from your MP3 collection.',
    faqBitrate:
      'M4A uses AAC audio. <code>256k</code> is a safe choice for music; <code>128k</code> is fine for voice.',
  },
  mp4: {
    homeBlurb: 'MP3 to MP4 audio for video timelines.',
    tagline: 'editor-friendly audio tracks.',
    footerBlurb: 'Export MP3 as MP4 audio for Premiere, DaVinci, and social platforms that expect .mp4 containers.',
    ctaText: 'MP4 audio tracks from MP3 sources.',
    faqBitrate:
      '<code>192k–256k</code> AAC in MP4 is standard for video workflows. Match your project sample rate when resampling.',
  },
  ogg: {
    homeBlurb: 'Open OGG Vorbis from MP3 sources.',
    tagline: 'royalty-free output.',
    footerBlurb: 'Convert MP3 to OGG for games, Linux apps, and open-source projects that prefer Vorbis.',
    ctaText: 'OGG files from your MP3 library.',
    faqBitrate:
      'Vorbis at <code>192k–256k</code> suits music; lower bitrates work for speech.',
  },
  wav: {
    homeBlurb: 'Uncompressed WAV from MP3 — for editing.',
    tagline: 'PCM audio, ready to edit.',
    footerBlurb: 'Decode MP3 to WAV for DAWs and sample editors — expands to PCM without recovering lost MP3 quality.',
    ctaText: 'Full WAV exports from MP3.',
    faqBitrate:
      'WAV is uncompressed PCM — there is no bitrate setting. File size reflects duration, sample rate, and channels.',
  },
  wma: {
    homeBlurb: 'Windows-friendly WMA from MP3.',
    tagline: 'legacy Windows formats.',
    footerBlurb: 'Convert MP3 to WMA for older Windows players and enterprise workflows via our servers.',
    ctaText: 'WMA exports when you need them.',
    faqBitrate:
      '<code>192k</code> is a solid default for music; <code>128k</code> for voice.',
  },
};

const oggCopy = {
  aac: {
    homeBlurb: 'AAC from your OGG Vorbis library.',
    tagline: 'Apple & streaming ready.',
    footerBlurb: 'Convert OGG to AAC for Apple devices, streaming platforms, and workflows that prefer AAC.',
    ctaText: 'Clean AAC exports from OGG.',
    faqBitrate:
      'AAC at <code>256k</code> suits music; <code>128k</code> works for speech. Re-encoding lossy OGG cannot recover lost quality.',
  },
  flac: {
    homeBlurb: 'Archive OGG masters as FLAC.',
    tagline: 'lossless containers from OGG.',
    footerBlurb: 'Convert OGG to FLAC for editing — note this cannot restore quality lost in the original Vorbis encode.',
    ctaText: 'FLAC archives from your OGG files.',
    faqBitrate:
      'FLAC is lossless but cannot recover data removed during Vorbis compression. Use FLAC when you need a lossless container for editing.',
  },
  m4r: {
    homeBlurb: 'Turn OGG clips into iPhone ringtones.',
    tagline: 'ringtones, ready to sync.',
    footerBlurb: 'Convert OGG to M4R for iPhone — trim to the hook, fade the edges, and sync via Finder or iTunes.',
    ctaText: 'M4R ringtones from OGG sources.',
    faqBitrate:
      'Ringtones are short — <code>192k–256k</code> is plenty. Use trim and fade for a polished loop.',
  },
  mp3: {
    homeBlurb: 'Universal MP3s from your OGG collection.',
    tagline: 'plays everywhere.',
    footerBlurb: 'Convert OGG to MP3 for maximum device compatibility — in your browser or on our servers.',
    ctaText: 'MP3 files from your OGG library.',
    faqBitrate:
      'For music, <code>256k–320k</code> is a safe target. For voice, <code>128k mono</code> keeps files small.',
  },
  m4a: {
    homeBlurb: 'OGG to M4A for Apple ecosystems.',
    tagline: 'iTunes & iPhone ready.',
    footerBlurb: 'Convert OGG to M4A for iTunes, iPhone, and anywhere AAC-in-MP4 is the native format.',
    ctaText: 'M4A files from your OGG sources.',
    faqBitrate:
      'M4A uses AAC audio. <code>256k</code> is a safe choice for music; <code>128k</code> is fine for voice.',
  },
  mp4: {
    homeBlurb: 'OGG to MP4 audio for video timelines.',
    tagline: 'editor-friendly audio tracks.',
    footerBlurb: 'Export OGG as MP4 audio for Premiere, DaVinci, and social platforms that expect .mp4 containers.',
    ctaText: 'MP4 audio tracks from OGG sources.',
    faqBitrate:
      '<code>192k–256k</code> AAC in MP4 is standard for video workflows. Match your project sample rate when resampling.',
  },
  wav: {
    homeBlurb: 'Uncompressed WAV from OGG — for editing.',
    tagline: 'PCM audio, ready to edit.',
    footerBlurb: 'Decode OGG to WAV for DAWs and sample editors — expands to PCM without recovering lost Vorbis quality.',
    ctaText: 'Full WAV exports from OGG.',
    faqBitrate:
      'WAV is uncompressed PCM — there is no bitrate setting. File size reflects duration, sample rate, and channels.',
  },
  wma: {
    homeBlurb: 'Windows-friendly WMA from OGG.',
    tagline: 'legacy Windows formats.',
    footerBlurb: 'Convert OGG to WMA for older Windows players and enterprise workflows via our servers.',
    ctaText: 'WMA exports when you need them.',
    faqBitrate:
      '<code>192k</code> is a solid default for music; <code>128k</code> for voice.',
  },
};

const wmaCopy = {
  aac: {
    homeBlurb: 'AAC from your WMA library.',
    tagline: 'modern, widely supported.',
    footerBlurb: 'Convert WMA to AAC for Apple devices, streaming, and modern players — via our servers.',
    ctaText: 'Clean AAC exports from WMA.',
    faqBitrate:
      'AAC at <code>256k</code> suits music; <code>128k</code> works for speech.',
  },
  flac: {
    homeBlurb: 'Archive WMA files as FLAC.',
    tagline: 'lossless archives from WMA.',
    footerBlurb: 'Convert WMA to FLAC for editing pipelines — cannot restore quality lost in the original WMA encode.',
    ctaText: 'FLAC archives from your WMA files.',
    faqBitrate:
      'FLAC is lossless but cannot recover data removed during WMA compression.',
  },
  m4r: {
    homeBlurb: 'Turn WMA clips into iPhone ringtones.',
    tagline: 'ringtones, ready to sync.',
    footerBlurb: 'Convert WMA to M4R for iPhone — trim, fade, and sync via Finder or iTunes.',
    ctaText: 'M4R ringtones from WMA sources.',
    faqBitrate:
      'Ringtones are short — <code>192k–256k</code> is plenty. Use trim and fade for a polished loop.',
  },
  mp3: {
    homeBlurb: 'Universal MP3s from your WMA collection.',
    tagline: 'plays everywhere.',
    footerBlurb: 'Convert WMA to MP3 for maximum device compatibility on our servers.',
    ctaText: 'MP3 files from your WMA library.',
    faqBitrate:
      'For music, <code>256k–320k</code> is a safe target. For voice, <code>128k mono</code> keeps files small.',
  },
  m4a: {
    homeBlurb: 'WMA to M4A for Apple ecosystems.',
    tagline: 'iTunes & iPhone ready.',
    footerBlurb: 'Convert WMA to M4A for iTunes, iPhone, and anywhere AAC-in-MP4 is the native format.',
    ctaText: 'M4A files from your WMA sources.',
    faqBitrate:
      'M4A uses AAC audio. <code>256k</code> is a safe choice for music; <code>128k</code> is fine for voice.',
  },
  mp4: {
    homeBlurb: 'WMA to MP4 audio for video timelines.',
    tagline: 'editor-friendly audio tracks.',
    footerBlurb: 'Export WMA as MP4 audio for Premiere, DaVinci, and social platforms.',
    ctaText: 'MP4 audio tracks from WMA sources.',
    faqBitrate:
      '<code>192k–256k</code> AAC in MP4 is standard for video workflows.',
  },
  ogg: {
    homeBlurb: 'Open OGG Vorbis from WMA sources.',
    tagline: 'royalty-free output.',
    footerBlurb: 'Convert WMA to OGG for games, Linux apps, and open-source projects.',
    ctaText: 'OGG files from your WMA library.',
    faqBitrate:
      'Vorbis at <code>192k–256k</code> suits music; lower bitrates work for speech.',
  },
  wav: {
    homeBlurb: 'Uncompressed WAV from WMA — for editing.',
    tagline: 'PCM audio, ready to edit.',
    footerBlurb: 'Decode WMA to WAV for DAWs and sample editors.',
    ctaText: 'Full WAV exports from WMA.',
    faqBitrate:
      'WAV is uncompressed PCM — there is no bitrate setting. File size reflects duration, sample rate, and channels.',
  },
};

const m4aCopy = {
  aac: {
    homeBlurb: 'Re-encode or extract AAC from your M4A tracks.',
    tagline: 'lean, modern audio.',
    footerBlurb: 'Convert M4A to standalone AAC — great for streaming, editing, and non-Apple workflows.',
    ctaText: 'Clean AAC exports from your M4A library.',
    faqBitrate:
      'AAC is efficient at <code>256k</code> for music and <code>128k</code> for speech. Re-encoding lossy sources cannot improve quality — pick a bitrate that matches your use case.',
  },
  flac: {
    homeBlurb: 'Archive M4A masters as lossless FLAC.',
    tagline: 'lossless archives from M4A.',
    footerBlurb: 'Turn M4A into FLAC for editing pipelines and archival storage — decode once, keep every sample.',
    ctaText: 'Lossless FLAC from your M4A files.',
    faqBitrate:
      'FLAC is lossless. Note that converting from lossy M4A cannot restore data lost in the original encode — but FLAC is ideal for editing without further degradation.',
  },
  m4r: {
    homeBlurb: 'Turn M4A clips into iPhone ringtones.',
    tagline: 'ringtones, ready to sync.',
    footerBlurb: 'Convert M4A to M4R for iPhone — trim to the hook, fade the edges, and sync via Finder or iTunes.',
    ctaText: 'M4R ringtones from any M4A source.',
    faqBitrate:
      'Ringtones are short — <code>192k–256k</code> is plenty. Use trim and fade for a polished loop.',
  },
  mp3: {
    homeBlurb: 'Universal MP3s from your M4A collection.',
    tagline: 'plays everywhere.',
    footerBlurb: 'Convert M4A to MP3 for maximum device compatibility — in your browser or on our servers.',
    ctaText: 'MP3 files that work on anything.',
    faqBitrate:
      'For music, <code>256k–320k</code> is a safe target. For voice, <code>128k mono</code> keeps files small.',
  },
  mp4: {
    homeBlurb: 'M4A to MP4 audio for video timelines.',
    tagline: 'editor-friendly audio tracks.',
    footerBlurb: 'Export M4A as MP4 audio for Premiere, DaVinci, and social platforms that expect .mp4 containers.',
    ctaText: 'MP4 audio tracks from M4A sources.',
    faqBitrate:
      '<code>192k–256k</code> AAC in MP4 is standard for video workflows. Match your project sample rate when resampling.',
  },
  ogg: {
    homeBlurb: 'Open OGG Vorbis from M4A sources.',
    tagline: 'royalty-free output.',
    footerBlurb: 'Convert M4A to OGG for games, Linux apps, and open-source projects that prefer Vorbis.',
    ctaText: 'OGG files from your M4A library.',
    faqBitrate:
      'Vorbis at <code>192k–256k</code> suits music; lower bitrates work for speech.',
  },
  wav: {
    homeBlurb: 'Uncompressed WAV from M4A — for editing.',
    tagline: 'PCM audio, ready to edit.',
    footerBlurb: 'Decode M4A to WAV for DAWs, sample editors, and anywhere uncompressed PCM is required.',
    ctaText: 'Full WAV exports from M4A.',
    faqBitrate:
      'WAV is uncompressed PCM — there is no bitrate setting. File size reflects duration, sample rate, and channels.',
  },
  wma: {
    homeBlurb: 'Windows-friendly WMA from M4A.',
    tagline: 'legacy Windows formats.',
    footerBlurb: 'Convert M4A to WMA for older Windows players and enterprise workflows via our servers.',
    ctaText: 'WMA exports when you need them.',
    faqBitrate:
      '<code>192k</code> is a solid default for music; <code>128k</code> for voice.',
  },
};

const OUTPUT_SPECS = {
  mp3: { label: 'MP3', ext: 'mp3', mime: 'audio/mpeg', codec: 'libmp3lame', zamzar: 'mp3', lossless: false, localSupported: true },
  aac: { label: 'AAC', ext: 'aac', mime: 'audio/aac', codec: 'aac', zamzar: 'aac', lossless: false, localSupported: true },
  flac: { label: 'FLAC', ext: 'flac', mime: 'audio/flac', codec: 'flac', zamzar: 'flac', lossless: true, localSupported: true },
  m4a: { label: 'M4A', ext: 'm4a', mime: 'audio/mp4', codec: 'aac', zamzar: 'm4a', lossless: false, localSupported: true, container: 'm4a' },
  m4r: { label: 'M4R', ext: 'm4r', mime: 'audio/mp4', codec: 'aac', zamzar: 'm4r', lossless: false, localSupported: true, container: 'm4r' },
  mp4: { label: 'MP4', ext: 'mp4', mime: 'audio/mp4', codec: 'aac', zamzar: 'mp4', lossless: false, localSupported: true, container: 'mp4', audioOnly: true },
  ogg: { label: 'OGG', ext: 'ogg', mime: 'audio/ogg', codec: 'libvorbis', zamzar: 'ogg', lossless: false, localSupported: true },
  wma: { label: 'WMA', ext: 'wma', mime: 'audio/x-ms-wma', codec: 'wmav2', zamzar: 'wma', lossless: false, localSupported: false },
  wav: { label: 'WAV', ext: 'wav', mime: 'audio/wav', codec: 'pcm_s16le', zamzar: 'wav', lossless: true, localSupported: true, isPcm: true },
};

function buildRoutes(inputSlug, outputSlugs, copyMap) {
  return outputSlugs.map((slug) =>
    route(inputSlug, { slug, ...OUTPUT_SPECS[slug], ...copyMap[slug] })
  );
}

export const WAV_ROUTES = buildRoutes(
  'wav',
  ['mp3', 'aac', 'flac', 'm4a', 'm4r', 'mp4', 'ogg', 'wma'],
  wavCopy
);

export const M4A_ROUTES = buildRoutes(
  'm4a',
  ['aac', 'flac', 'm4r', 'mp3', 'mp4', 'ogg', 'wav', 'wma'],
  m4aCopy
);

export const AAC_ROUTES = buildRoutes(
  'aac',
  ['flac', 'm4r', 'mp3', 'mp4', 'm4a', 'ogg', 'wav', 'wma'],
  aacCopy
);

export const MP3_ROUTES = buildRoutes(
  'mp3',
  ['aac', 'flac', 'm4r', 'm4a', 'mp4', 'ogg', 'wav', 'wma'],
  mp3Copy
);

export const OGG_ROUTES = buildRoutes(
  'ogg',
  ['aac', 'flac', 'm4r', 'mp3', 'm4a', 'mp4', 'wav', 'wma'],
  oggCopy
);

export const WMA_ROUTES = buildRoutes(
  'wma',
  ['aac', 'flac', 'm4r', 'mp3', 'm4a', 'mp4', 'ogg', 'wav'],
  wmaCopy
);

const ROUTES_BY_INPUT = {
  wav: WAV_ROUTES,
  m4a: M4A_ROUTES,
  aac: AAC_ROUTES,
  mp3: MP3_ROUTES,
  ogg: OGG_ROUTES,
  wma: WMA_ROUTES,
};

export function getRoutes(inputSlug) {
  return ROUTES_BY_INPUT[inputSlug] || WAV_ROUTES;
}

export function getRoute(inputSlug, outputSlug) {
  const routes = getRoutes(inputSlug);
  return routes.find((r) => r.slug === outputSlug) || routes[0];
}

export function findRoute(inputSlug, outputSlug) {
  return getRoutes(inputSlug).find((r) => r.slug === outputSlug) || null;
}

export function relatedFormatsHtml(inputSlug, currentSlug) {
  const routes = getRoutes(inputSlug);
  const inputLabel = getInputFormat(inputSlug).label;
  return routes
    .map((f) => {
      const current = f.slug === currentSlug ? ' class="current"' : '';
      return `<a href="${f.path}"${current}>${inputLabel} to ${f.label}</a>`;
    })
    .join('\n        ');
}

export function formatCtasHtml(inputSlug) {
  const routes = getRoutes(inputSlug);
  const inputLabel = getInputFormat(inputSlug).label;
  return routes
    .map(
      (f) => `<a href="${f.path}" class="format-cta" data-input="${inputSlug}">
      <div class="format-route"><span class="from">${inputLabel}</span><span class="arrow">→</span><span class="to">${f.label}</span></div>
      <p>${f.homeBlurb}</p>
      <span class="format-go">Convert <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
    </a>`
    )
    .join('\n      ');
}
