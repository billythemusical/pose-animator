// Projection settings: canvas size, mirroring, background, and where the
// skeleton sits on the canvas. Saved to localStorage so a tuned setup
// survives reloads.

const STORAGE_KEY = 'pose-animator:projection';

// These defaults reproduce the original layout: an 800x1600 canvas with the
// (square) video stretched to fill it, 2x taller than wide.
export const DEFAULTS = {
  camera: {
    resolution: '640x360',
  },
  projection: {
    mirror: false,
    canvasWidth: 800,
    canvasHeight: 1600,
    background: 'image',
  },
  skeleton: {
    size: 1,
    stretch: 2,
    offsetX: 0,
    offsetY: 0,
  },
};

export function loadSettings() {
  const settings = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      Object.assign(settings.camera, saved.camera);
      Object.assign(settings.projection, saved.projection);
      Object.assign(settings.skeleton, saved.skeleton);
    }
  } catch (e) {
    // No storage (private window, blocked site data): use defaults.
  }
  return settings;
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      camera: settings.camera,
      projection: settings.projection,
      skeleton: settings.skeleton,
    }));
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
  canvas.classList.toggle('no-background', projection.background === 'black');
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
