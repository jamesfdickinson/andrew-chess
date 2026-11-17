import artwork from '../public/coach/jimmy/artwork.json' with { type: 'json' };

// Only metadata is bundled. Image files are served from the coach's public folder.
export const sheetFiles = artwork.sheets;
export const sheetUrl = filename => `${artwork.base}/${filename}`;
export const defaultStyleImage = artwork.styleImage;
