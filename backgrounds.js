// Background images for the projection, picked up from resources/backgrounds/.
// Drop a png, jpg or webp in that folder and it shows up in the controls.

const files = import.meta.glob('./resources/backgrounds/*.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});

// File name -> URL.
const urlsByName = {};
Object.entries(files).forEach(([path, url]) => {
  urlsByName[path.split('/').pop()] = url;
});

export const BACKGROUND_NAMES = ['black', ...Object.keys(urlsByName).sort()];

/** URL for a background name, or null for black / an unknown name. */
export function backgroundUrl(name) {
  return urlsByName[name] || null;
}
