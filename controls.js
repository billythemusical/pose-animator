// The control panel, built the same way for the main page and for the
// separate panel window. Controls edit `settings` in place and report each
// change through `onChange(section, key)`; buttons go through
// `onAction(name, value)`. What those do is up to the page: the main page
// applies them, the panel window sends them to the main page.

import dat from 'dat.gui';
import {BACKGROUND_NAMES} from './backgrounds';

/**
 * @param settings the shared settings object (see settings.js)
 * @param status   read-only values shown in the controls: {source,
 *                 cameraGives, fps, people, mainWindow}
 * @param videos   (panel only) file names in test/fixtures to offer in test mode
 * @param isPanel  true in the separate panel window
 * @returns {gui, refresh} - call refresh() after settings change elsewhere
 */
export function buildControls(settings, status, {onChange, onAction, isPanel = false, videos = []}) {
  const gui = new dat.GUI({width: isPanel ? 400 : 300, autoPlace: !isPanel});
  if (isPanel) {
    document.getElementById('controls').appendChild(gui.domElement);
  } else {
    gui.closed = true;
  }

  const bind = (folder, section, key, ...args) =>
      folder.add(settings[section], key, ...args).onChange(() => onChange(section, key));
  const readOnly = (folder, key, name) => {
    const controller = folder.add(status, key).name(name).listen();
    controller.domElement.querySelector('input').readOnly = true;
    return controller;
  };

  const info = gui.addFolder('Status');
  if (!isPanel) info.add({openPanel: () => onAction('openPanel')}, 'openPanel').name('open control panel (P)');
  if (isPanel) readOnly(info, 'mainWindow', 'main window');
  readOnly(info, 'fps', 'fps');
  readOnly(info, 'people', 'people drawn');
  info.open();

  const pose = gui.addFolder('Pose detection');
  bind(pose, 'pose', 'model', ['lite', 'full']);
  // Set to 1 for the original single-skeleton show. Extra skeletons are only
  // built, detected and drawn when this is raised.
  bind(pose, 'pose', 'maxPeople', 1, 6, 1);
  bind(pose, 'pose', 'minConfidence', 0.1, 0.9, 0.05).name('min confidence');
  pose.open();

  const projection = gui.addFolder('Projection');
  bind(projection, 'projection', 'mirror');
  bind(projection, 'projection', 'canvasWidth', 200, 3840, 10);
  bind(projection, 'projection', 'canvasHeight', 200, 3840, 10);
  bind(projection, 'projection', 'background', BACKGROUND_NAMES);
  bind(projection, 'projection', 'backgroundFit', ['cover', 'stretch', 'tile']).name('background fit');
  projection.add({fillWindow: () => onAction('fillWindow')}, 'fillWindow')
      .name(isPanel ? 'fill projector window' : 'fill window');
  projection.add({toggleFullscreen: () => onAction('toggleFullscreen')}, 'toggleFullscreen')
      .name(isPanel ? 'fullscreen projector window' : 'fullscreen (F)');
  projection.open();

  const skeleton = gui.addFolder('Skeleton');
  bind(skeleton, 'skeleton', 'size', 0.2, 4, 0.01);
  bind(skeleton, 'skeleton', 'stretch', 0.5, 4, 0.01);
  bind(skeleton, 'skeleton', 'offsetX', -100, 100, 0.5).name('left / right');
  bind(skeleton, 'skeleton', 'offsetY', -100, 100, 0.5).name('up / down');
  skeleton.add({resetLayout: () => onAction('resetLayout')}, 'resetLayout').name('reset layout');
  skeleton.open();

  // Takes effect on reload, since the camera stream has to restart.
  const camera = gui.addFolder('Camera');
  bind(camera, 'camera', 'resolution', ['640x360', '640x480', '1280x720']).name('resolution (reloads)');
  readOnly(camera, 'cameraGives', 'camera gives');

  // Test mode: play a recorded clip instead of the live camera.
  const test = gui.addFolder('Test mode');
  readOnly(test, 'source', 'source');
  if (isPanel) {
    // A file picker can't reach the show page from another window, so the
    // panel lists the clips in test/fixtures that its server can serve.
    const options = {};
    videos.forEach((name) => {
      options[name] = `/api/video/${encodeURIComponent(name)}`;
    });
    const video = {file: videos.length ? options[videos[0]] : ''};
    test.add(video, 'file', videos.length ? options : {'(no videos in test/fixtures)': ''}).name('video');
    test.add({play: () => video.file && onAction('playVideoUrl', video.file)}, 'play').name('play this video');
  } else {
    test.add({chooseVideoFile: () => onAction('chooseVideoFile')}, 'chooseVideoFile')
        .name('play a video file...');
  }
  test.add({useCamera: () => onAction('useCamera')}, 'useCamera').name('use camera');
  test.open();

  const debug = gui.addFolder('Debug control');
  bind(debug, 'debug', 'detectFaces');
  bind(debug, 'debug', 'showDetectionDebug');
  bind(debug, 'debug', 'showIllustrationDebug');
  debug.open();

  const allControllers = () => [gui, ...Object.values(gui.__folders)]
      .flatMap((g) => g.__controllers);
  return {
    gui,
    /** Re-reads every control from `settings` and `status`. */
    refresh: () => allControllers().forEach((c) => c.updateDisplay()),
  };
}
