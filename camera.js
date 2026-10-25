/**
 * @license
 * Copyright 2020 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import * as paper from 'paper';
import Stats from 'stats.js';

import {drawKeypoints, drawSkeleton, isMobile, toggleLoadingUI, setStatusText} from './utils/demoUtils';
import {SVGUtils} from './utils/svgUtils'
import {Cast} from './illustrationGen/cast';
import {Skeleton} from './illustrationGen/skeleton';
import {FileUtils} from './utils/fileUtils';
import {PoseDetector} from './pose/poseDetector';
import {DEFAULTS, loadSettings, saveSettings, applyCanvasSettings, getSkeletonMatrix} from './settings';
import {PoseTracker} from './pose/tracker';
import {trackColor} from './pose/trackColor';
import {buildControls} from './controls';
import {connectBridge} from './sync/bridgeClient';
import {applyRemoteSettings} from './sync/settingsSync';

import * as bonesSVG from './resources/samples/my-bones-5-white.svg';
// import * as girlSVG from './resources/illustration/girl.svg';
// import * as boySVG from './resources/illustration/boy.svg';
// import * as abstractSVG from './resources/illustration/abstract.svg';
// import * as blathersSVG from './resources/illustration/blathers.svg';
// import * as tomNookSVG from './resources/illustration/tom-nook.svg';

// Camera stream video element. The size is replaced by whatever the camera
// actually delivers once it starts.
let video;
let videoWidth = 300;
let videoHeight = 300;

// Canvas
// One skeleton per tracked person (up to settings.pose.maxPeople).
let cast = null;
let tracker = null;
let canvasScope;
let illustrationCanvas;
// Canvas size, mirroring and skeleton placement; tuned from the GUI.
const settings = loadSettings();

// ML models
let poseDetector;
let minPoseConfidence = 0.15;
let minPartConfidence = 0.1;

// Misc
let mobile = false;
const stats = new Stats();
const avatarSvgs = {
  'bones': bonesSVG.default
};

/**
 * Points the hidden <video> element at the webcam. Replaces any source it
 * was already playing.
 */
async function setupCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
        'Browser API navigator.mediaDevices.getUserMedia not available');
  }

  const video = document.getElementById('video');
  video.style = "display: none"
  stopSource(video);

  // Ask for the camera's own aspect ratio rather than a square, so people at
  // the sides of the view aren't cropped out.
  const [width, height] = settings.camera.resolution.split('x').map(Number);
  const stream = await navigator.mediaDevices.getUserMedia({
    'audio': false,
    'video': {
      facingMode: 'user',
      width: {ideal: width},
      height: {ideal: height},
    },
  });
  video.srcObject = stream;

  return waitForVideoSize(video);
}

/**
 * Plays a recorded clip in place of the camera (test mode), so tracking and
 * framing can be tried repeatably without people in front of the camera.
 */
async function setupVideoFile(url) {
  const video = document.getElementById('video');
  video.style = "display: none"
  stopSource(video);

  video.loop = true;
  video.muted = true;
  video.src = url;

  return waitForVideoSize(video);
}

function stopSource(video) {
  if (video.srcObject) {
    video.srcObject.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
  video.removeAttribute('src');
}

function waitForVideoSize(video) {
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      videoWidth = video.videoWidth;
      videoHeight = video.videoHeight;
      video.width = videoWidth;
      video.height = videoHeight;
      resolve(video);
    };
    video.onerror = () => reject(new Error('Could not load the video source'));
  });
}

async function loadVideo() {
  const testVideoUrl = new URLSearchParams(location.search).get('video');
  const video = testVideoUrl ?
      await setupVideoFile(testVideoUrl) : await setupCamera();
  video.play();
  if (testVideoUrl) {
    status.source = 'video: ' + testVideoUrl.split('/').pop();
  }
  status.cameraGives = `${videoWidth}x${videoHeight}`;

  return video;
}

// Read-only values the controls display (also sent to the panel window).
const status = {source: 'camera', cameraGives: '-', fps: '-', people: '-'};
// Set when the source (and so the video size) changes, so the frame loop
// resizes its canvases and starts tracking fresh.
let sourceChanged = false;

// Test mode swaps a recorded clip in for the camera. Neither choice is saved,
// so a reload goes back to the camera.
async function switchSource(setup, label) {
  try {
    await setup();
  } catch (e) {
    console.warn(e);
    if (label !== 'camera') {
      await switchSource(setupCamera, 'camera');
      status.source = 'camera (could not load that video)';
    }
    return;
  }
  video.play();
  status.source = label;
  status.cameraGives = `${videoWidth}x${videoHeight}`;
  sourceChanged = true;
}

function chooseVideoFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/*';
  input.onchange = () => {
    const file = input.files[0];
    if (file) {
      switchSource(() => setupVideoFile(URL.createObjectURL(file)), 'video: ' + file.name);
    }
  };
  input.click();
}

let controls;
let bridge;

/** Reacts to one setting having a new value, wherever the change came from. */
function applySetting(section, key) {
  const value = settings[section][key];
  if (section === 'pose') {
    if (key === 'model') poseDetector.setOptions({model: value});
    if (key === 'maxPeople') {
      poseDetector.setOptions({numPoses: value});
      cast.resize(value);
    }
    if (key === 'minConfidence') poseDetector.setOptions({minConfidence: value});
  } else if (section === 'projection') {
    applyCanvasSettings(canvasScope, illustrationCanvas, settings.projection);
  } else if (section === 'camera') {
    // The camera stream has to restart.
    location.reload();
  }
}

function sendSettings() {
  bridge.send({type: 'settings', settings});
}

/** A control on this page changed. */
function onSettingChange(section, key) {
  saveSettings(settings);
  applySetting(section, key);
  sendSettings();
}

/** Something on this page changed several settings at once. */
function onSettingsReplaced(sections) {
  sections.forEach((section) => Object.keys(settings[section]).forEach((key) => applySetting(section, key)));
  saveSettings(settings);
  controls.refresh();
  sendSettings();
}

function runAction(name, value) {
  if (name === 'fillWindow') fillWindow();
  if (name === 'toggleFullscreen') toggleFullscreen();
  if (name === 'openPanel') {
    // A browser only opens a new window from a click or key press, which is
    // why this isn't done automatically on load.
    window.open('panel.html', 'pose-animator-panel', 'popup,width=440,height=900');
  }
  if (name === 'chooseVideoFile') chooseVideoFile();
  if (name === 'useCamera') switchSource(setupCamera, 'camera');
  if (name === 'playVideoUrl') switchSource(() => setupVideoFile(value), 'video: ' + decodeURIComponent(value.split('/').pop()));
  if (name === 'resetLayout') {
    Object.assign(settings.projection, DEFAULTS.projection);
    Object.assign(settings.skeleton, DEFAULTS.skeleton);
    onSettingsReplaced(['projection', 'skeleton']);
  }
}

/** A message from the control panel window. */
function onBridgeMessage(message) {
  if (message.type === 'settings') {
    const changed = applyRemoteSettings(settings, message.settings);
    saveSettings(settings);
    changed.forEach(([section, key]) => applySetting(section, key));
    controls.refresh();
  } else if (message.type === 'action') {
    runAction(message.name, message.value);
  } else if (message.type === 'peers') {
    panelConnected = message.panel;
    applyPanelPresence();
  } else if (message.type === 'wantFrames') {
    panelWantsFrames = message.on;
  }
}

// While a control panel window is connected, the show page hides its own
// controls and fps meter so only the skeletons are on the projector. If the
// panel closes they come back. Uses `visibility` because dat.gui's H key
// already toggles `display`.
let panelConnected = false;
// The panel draws the camera view itself when it can open the camera. It asks
// for JPEG frames only when it can't (a test clip, or a phone).
let panelWantsFrames = false;
function applyPanelPresence() {
  const visibility = panelConnected ? 'hidden' : '';
  controls.gui.domElement.style.visibility = visibility;
  stats.dom.style.visibility = visibility;
}

/**
 * Sets up the dat.gui controls on the top-right of the window, and connects
 * to the bridge so a separate panel window can drive the same controls.
 */
function setupGui() {
  controls = buildControls(settings, status, {
    onChange: onSettingChange,
    onAction: runAction,
  });

  const image = controls.gui.addFolder('Image');
  image.add({avatarSVG: Object.keys(avatarSvgs)[0]}, 'avatarSVG', Object.keys(avatarSvgs))
      .onChange((name) => parseSVG(avatarSvgs[name]));
  image.open();

  bridge = connectBridge('main', onBridgeMessage, (connected) => {
    // This page is the source of truth: a panel that connects gets our state.
    if (connected) sendSettings();
  });
  setInterval(() => {
    bridge.send({type: 'status', status: {
      source: status.source,
      cameraGives: status.cameraGives,
      fps: status.fps,
      people: status.people,
    }});
  }, 500);
}

/**
 * Sets up a frames per second panel on the top-left of the window
 */
function setupFPS() {
  stats.showPanel(0);  // 0: fps, 1: ms, 2: mb, 3+: custom
  document.getElementById('main').appendChild(stats.dom);
}

/**
 * Feeds each video frame to the pose detector - this is where the magic
 * happens. This function loops with a requestAnimationFrame method.
 */
function detectPoseInRealTime(video) {
  // Starts tracking fresh. Runs at startup and again whenever the source
  // changes.
  function applyVideoSize() {
    // A torso can move a quarter of the frame width between frames and still
    // count as the same person.
    tracker = new PoseTracker({maxDistance: videoWidth * 0.25});
  }
  applyVideoSize();

  let frames = 0;
  let fpsStart = performance.now();

  async function poseDetectionFrame() {
    // Nothing to detect until the source has delivered a frame.
    if (video.readyState < 2) {
      requestAnimationFrame(poseDetectionFrame);
      return;
    }
    if (sourceChanged) {
      sourceChanged = false;
      applyVideoSize();
    }

    // Begin monitoring code for frames per second
    stats.begin();

    const __t0 = performance.now();
    const poses = poseDetector.detect(video, videoWidth, videoHeight);
    const __t1 = performance.now();
    // Swap left/right part names to match the mirrored display. Done once per
    // detection, here: the tracker can return the same pose object on later
    // frames, and flipping twice would undo it.
    poses.forEach((pose) => Skeleton.flipPose(pose));
    const tracked = tracker.update(poses);

    // The camera view with the detected points goes to the panel window
    // whenever one is open, never to the projector.
    // The panel comes second to the show: 'light' sends points less often,
    // 'off' sends nothing.
    const cameraView = settings.debug.cameraView;
    if (panelConnected && cameraView !== 'off') {
      sendPoses(tracked, cameraView === 'live');
      if (panelWantsFrames) sendDebugFrame(video, tracked);
    }

    canvasScope.project.clear();

    // No face tracking: the head follows the pose model's nose and ear points.
    cast.update(tracked, null);
    cast.draw(settings.debug.showIllustrationDebug);
    const __t2 = performance.now();
    const W = window; W.__a = W.__a || {d: 0, u: 0, n: 0, p: 0, s: 0, ids: new Set(), start: performance.now()};
    W.__a.d += __t1 - __t0; W.__a.u += __t2 - __t1; W.__a.n++; W.__a.p += poses.length; W.__a.s += cast.byTrackId.size;
    tracked.forEach((t) => W.__a.ids.add(t.id));
    if (W.__a.n === 90) {
      const a = W.__a;
      console.log(`DBG detect ${(a.d / 90).toFixed(1)}ms  skeletons ${(a.u / 90).toFixed(1)}ms  fps ${(90000 / (performance.now() - a.start)).toFixed(1)}  poses/frame ${(a.p / 90).toFixed(2)}  drawn/frame ${(a.s / 90).toFixed(2)}  ids so far ${[...a.ids].join(',')}`);
      W.__a = {d: 0, u: 0, n: 0, p: 0, s: 0, ids: a.ids, start: performance.now()};
    }

    canvasScope.project.activeLayer.transform(
        getSkeletonMatrix(canvasScope, settings, videoWidth, videoHeight));

    // End monitoring code for frames per second
    stats.end();

    frames++;
    const now = performance.now();
    if (now - fpsStart >= 500) {
      status.fps = String(Math.round((frames * 1000) / (now - fpsStart)));
      status.people = String(cast.byTrackId.size);
      frames = 0;
      fpsStart = now;
    }

    requestAnimationFrame(poseDetectionFrame);
  }

  poseDetectionFrame();
}

/** Sends the tracked people's points; the panel draws them over its own camera view. */
let lastPoseSend = 0;
function sendPoses(tracked, everyFrame) {
  const now = performance.now();
  if (!everyFrame && now - lastPoseSend < DEBUG_VIEW_INTERVAL_MS) return;
  lastPoseSend = now;
  const poses = tracked
      .filter(({pose, missed}) => missed === 0 && pose.score >= minPoseConfidence)
      .map(({id, pose}) => ({id, keypoints: pose.keypoints}));
  bridge.send({type: 'poses', width: videoWidth, height: videoHeight, poses});
}

const DEBUG_VIEW_WIDTH = 480;
const DEBUG_VIEW_INTERVAL_MS = 100;
const debugCanvas = document.createElement('canvas');
let lastDebugFrame = 0;
let debugFrameEncoding = false;

/**
 * Draws the mirrored camera image with each tracked person's points on top,
 * at a small size, and sends it to the panel as a JPEG about 10 times a second.
 */
function sendDebugFrame(video, tracked) {
  const now = performance.now();
  if (debugFrameEncoding || now - lastDebugFrame < DEBUG_VIEW_INTERVAL_MS) return;
  lastDebugFrame = now;

  const scale = DEBUG_VIEW_WIDTH / videoWidth;
  const height = Math.round(videoHeight * scale);
  if (debugCanvas.width !== DEBUG_VIEW_WIDTH || debugCanvas.height !== height) {
    debugCanvas.width = DEBUG_VIEW_WIDTH;
    debugCanvas.height = height;
  }
  const ctx = debugCanvas.getContext('2d');
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -DEBUG_VIEW_WIDTH, 0, DEBUG_VIEW_WIDTH, height);
  ctx.restore();
  tracked.forEach(({id, pose, missed}) => {
    if (missed === 0 && pose.score >= minPoseConfidence) {
      const color = trackColor(id);
      drawKeypoints(pose.keypoints, minPartConfidence, ctx, scale, color);
      drawSkeleton(pose.keypoints, minPartConfidence, ctx, scale, color);
    }
  });

  debugFrameEncoding = true;
  debugCanvas.toBlob(async (blob) => {
    debugFrameEncoding = false;
    if (blob) bridge.sendBinary(await blob.arrayBuffer());
  }, 'image/jpeg', 0.6);
}

function setupCanvas() {
  mobile = isMobile();

  canvasScope = paper.default;
  illustrationCanvas = document.querySelector('.illustration-canvas');
  canvasScope.setup(illustrationCanvas);
  applyCanvasSettings(canvasScope, illustrationCanvas, settings.projection);
}

// Sizes the canvas to the window: in fullscreen, that's the projector.
function fillWindow() {
  settings.projection.canvasWidth = window.innerWidth;
  settings.projection.canvasHeight = window.innerHeight;
  onSettingsReplaced(['projection']);
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else if (navigator.userActivation.isActive) {
    document.documentElement.requestFullscreen();
  } else {
    armFullscreen();
  }
}

// Going fullscreen is the moment the window becomes the projector, so size the
// canvas to it. The window's size settles a moment after the change.
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) setTimeout(fillWindow, 500);
});

// A browser only allows fullscreen in response to a click or key press in
// that same window. When the request comes from the control panel there is
// none, so show a prompt and take the next click or key press on this page.
function armFullscreen() {
  if (document.getElementById('fullscreen-prompt')) return;
  const prompt = document.createElement('div');
  prompt.id = 'fullscreen-prompt';
  prompt.textContent = 'Click here for fullscreen';
  Object.assign(prompt.style, {
    position: 'fixed', inset: '0', zIndex: '10', display: 'flex',
    alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    background: 'rgba(0, 0, 0, 0.6)', color: 'white', font: '32px sans-serif',
  });
  const finish = (e) => {
    prompt.remove();
    document.removeEventListener('keydown', finish);
    // Escape just dismisses the prompt.
    if (e.key !== 'Escape') document.documentElement.requestFullscreen();
  };
  prompt.addEventListener('pointerdown', finish);
  document.addEventListener('keydown', finish);
  document.body.appendChild(prompt);
}

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  if (e.key === 'p' || e.key === 'P') runAction('openPanel');
  // dat.gui already hides itself on H; hide the FPS meter with it.
  if (e.key === 'h' || e.key === 'H') {
    stats.dom.style.display = stats.dom.style.display === 'none' ? '' : 'none';
  }
});

/**
 * Kicks off the demo by loading the pose model, finding and loading
 * available camera devices, and setting off the detectPoseInRealTime function.
 */
export async function bindPage() {
  setupCanvas();

  toggleLoadingUI(true);
  setStatusText('Loading pose model...');
  poseDetector = await PoseDetector.create({
    model: settings.pose.model,
    numPoses: settings.pose.maxPeople,
    minConfidence: settings.pose.minConfidence,
  });

  setStatusText('Loading Avatar file...');
  let t0 = new Date();
  await parseSVG(Object.values(avatarSvgs)[0]);

  setStatusText('Setting up camera...');
  try {
    video = await loadVideo();
  } catch (e) {
    let info = document.getElementById('info');
    info.textContent = 'this device type is not supported yet, ' +
      'or this browser does not support video capture: ' + e.toString();
    info.style.display = 'block';
    throw e;
  }

  setupGui();
  setupFPS();
  
  toggleLoadingUI(false);
  detectPoseInRealTime(video);
}

navigator.getUserMedia = navigator.getUserMedia ||
    navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
FileUtils.setDragDropHandler((result) => {parseSVG(result)});

async function parseSVG(target) {
  let svgScope = await SVGUtils.importSVG(target /* SVG string or file path */);
  if (!cast) {
    cast = new Cast(canvasScope);
  }
  const __b = performance.now();
  cast.setCharacter(svgScope, settings.pose.maxPeople);
  console.log(`DBG built ${settings.pose.maxPeople} skeleton(s) in ${(performance.now() - __b).toFixed(0)}ms`);
}
    
bindPage();
