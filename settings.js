import {backgroundUrl} from './backgrounds';

// Settings tuned from the control panel: pose detection, camera, canvas size,
// mirroring, background, and where the skeleton sits on the canvas. Saved to
// localStorage so a tuned setup survives reloads.

// The key predates pose/camera settings; kept so saved setups still load.
const STORAGE_KEY = 'pose-animator:projection';

// These defaults reproduce the original layout: an 800x1600 canvas with the
// (square) video stretched to fill it, 2x taller than wide.
export const DEFAULTS = {
  pose: {
    model: 'lite',
    // 1 = the original single-skeleton behavior; extra skeletons only exist
    // when this is raised.
    maxPeople: 1,
    // Lower finds people more easily; raise to ignore passers-by.
    minConfidence: 0.5,
  },
  camera: {
    resolution: '640x360',
  },
  projection: {
    mirror: false,
    canvasWidth: 800,
    canvasHeight: 1600,
    // A file name from resources/backgrounds/, or 'black'.
    background: 'background.png',
    // How an image fills the canvas: cover, stretch or tile.
    backgroundFit: 'cover',
  },
  skeleton: {
    size: 1,
    stretch: 2,
    offsetX: 0,
    offsetY: 0,
  },
  // Not saved: these always start off.
  debug: {
    showIllustrationDebug: false,
  },
};

export function loadSettings() {
  const settings = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      Object.keys(DEFAULTS).forEach((section) => Object.assign(settings[section], saved[section]));
      // Saved before backgrounds were a list: 'image' meant the one image.
      if (settings.projection.background === 'image') {
        settings.projection.background = DEFAULTS.projection.background;
      }
    }
    settings.debug = {...DEFAULTS.debug};
  } catch (e) {
    // No storage (private window, blocked site data): use defaults.
  }
  return settings;
}

export function saveSettings(settings) {
  try {
    const {debug, ...saved} = settings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch (e) {
    // Settings just won't persist.
  }
}

/** Applies size, mirroring and background to the illustration canvas. */
export function applyCanvasSettings(canvasScope, canvas, projection) {
  canvasScope.view.viewSize =
      new canvasScope.Size(projection.canvasWidth, projection.canvasHeight);
  // Mirroring is display-only, for rear projection through a sheet.
  canvas.style.transform = projection.mirror ? 'scaleX(-1)' : '';
  const url = backgroundUrl(projection.background);
  canvas.style.backgroundImage = url ? `url('${url}')` : 'none';
  canvas.style.backgroundColor = 'black';
  const fit = projection.backgroundFit;
  canvas.style.backgroundSize = fit === 'cover' ? 'cover' : fit === 'stretch' ? '100% 100%' : 'auto';
  canvas.style.backgroundRepeat = fit === 'tile' ? 'repeat' : 'no-repeat';
  canvas.style.backgroundPosition = 'center';
}

/**
 * Matrix that maps the video-space drawing onto the canvas. The center of
 * the video lands at the center of the canvas (plus the offsets). At size 1,
 * the central square of the video fills the canvas width. That matches the
 * old square camera crop, so a wider camera view extends past the sides of
 * the canvas until you lower the size.
 */
export function getSkeletonMatrix(canvasScope, settings, videoWidth, videoHeight) {
  const {canvasWidth, canvasHeight, mirror} = settings.projection;
  const {size, stretch, offsetY} = settings.skeleton;
  // The canvas is mirrored with CSS after drawing, so flip the offset to keep
  // "right" meaning right on screen.
  const offsetX = mirror ? -settings.skeleton.offsetX : settings.skeleton.offsetX;
  const scaleX = (canvasWidth / Math.min(videoWidth, videoHeight)) * size;
  const scaleY = scaleX * stretch;
  return new canvasScope.Matrix()
      .translate(
          canvasWidth / 2 + (offsetX / 100) * canvasWidth,
          canvasHeight / 2 + (offsetY / 100) * canvasHeight)
      .scale(scaleX, scaleY)
      .translate(-videoWidth / 2, -videoHeight / 2);
}
