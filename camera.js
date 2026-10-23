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

import * as facemesh_module from '@tensorflow-models/facemesh';
import * as tf from '@tensorflow/tfjs';
import * as paper from 'paper';
import dat from 'dat.gui';
import Stats from 'stats.js';

import {drawKeypoints, drawPoint, drawSkeleton, isMobile, toggleLoadingUI, setStatusText} from './utils/demoUtils';
import {SVGUtils} from './utils/svgUtils'
import {Cast} from './illustrationGen/cast';
import {Skeleton, facePartName2Index} from './illustrationGen/skeleton';
import {FileUtils} from './utils/fileUtils';
import {PoseDetector} from './pose/poseDetector';
import {DEFAULTS, loadSettings, saveSettings, applyCanvasSettings, getSkeletonMatrix} from './settings';
import {PoseTracker} from './pose/tracker';

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
let faceDetection = null;
// One skeleton per tracked person (up to settings.pose.maxPeople).
let cast = null;
let tracker = null;
let canvasScope;
let illustrationCanvas;
// Canvas size, mirroring and skeleton placement; tuned from the GUI.
const settings = loadSettings();

// ML models
let facemesh;
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
 * Loads a the camera to be used in the demo
 *
 */
async function setupCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
        'Browser API navigator.mediaDevices.getUserMedia not available');
  }

  const video = document.getElementById('video');
  video.style = "display: none"

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

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      videoWidth = video.videoWidth;
      videoHeight = video.videoHeight;
      video.width = videoWidth;
      video.height = videoHeight;
      resolve(video);
    };
  });
}

async function loadVideo() {
  const video = await setupCamera();
  video.play();

  return video;
}

const guiState = {
  avatarSVG: Object.keys(avatarSvgs)[0],
  pose: settings.pose,
  projection: settings.projection,
  skeleton: settings.skeleton,
  debug: {
    detectFaces: false,
    showDetectionDebug: false,
    showIllustrationDebug: false,
  },
};

/**
 * Sets up dat.gui controller on the top-right of the window
 */
function setupGui(cameras) {

  if (cameras.length > 0) {
    guiState.camera = cameras[0].deviceId;
  }

  const gui = new dat.GUI({width: 300});
  gui.closed = true;

  let multi = gui.addFolder('Image');
  multi.add(guiState, 'avatarSVG', Object.keys(avatarSvgs)).onChange(() => parseSVG(avatarSvgs[guiState.avatarSVG]));
  multi.open();

  let pose = gui.addFolder('Pose detection');
  pose.add(settings.pose, 'model', ['lite', 'full'])
      .onChange((model) => {
        poseDetector.setOptions({model});
        saveSettings(settings);
      });
  // Set to 1 for the original single-skeleton show. Extra skeletons are only
  // built, detected and drawn when this is raised.
  pose.add(settings.pose, 'maxPeople', 1, 6, 1)
      .onChange((maxPeople) => {
        poseDetector.setOptions({numPoses: maxPeople});
        cast.resize(maxPeople);
        saveSettings(settings);
      });
  pose.add(settings.pose, 'minConfidence', 0.1, 0.9, 0.05)
      .name('min confidence')
      .onChange((minConfidence) => {
        poseDetector.setOptions({minConfidence});
        saveSettings(settings);
      });
  pose.open();

  // Everything in these two folders is saved, so a tuned projection setup
  // survives reloads.
  const onProjectionChange = () => {
    applyCanvasSettings(canvasScope, illustrationCanvas, settings.projection);
    saveSettings(settings);
  };
  let projection = gui.addFolder('Projection');
  projection.add(settings.projection, 'mirror').onChange(onProjectionChange);
  projection.add(settings.projection, 'canvasWidth', 200, 3840, 10).onChange(onProjectionChange);
  projection.add(settings.projection, 'canvasHeight', 200, 3840, 10).onChange(onProjectionChange);
  projection.add(settings.projection, 'background', ['image', 'black']).onChange(onProjectionChange);
  projection.add({fillWindow}, 'fillWindow').name('fill window');
  projection.add({toggleFullscreen}, 'toggleFullscreen').name('fullscreen (F)');
  projection.open();

  let skeleton = gui.addFolder('Skeleton');
  skeleton.add(settings.skeleton, 'size', 0.2, 4, 0.01).onChange(() => saveSettings(settings));
  skeleton.add(settings.skeleton, 'stretch', 0.5, 4, 0.01).onChange(() => saveSettings(settings));
  skeleton.add(settings.skeleton, 'offsetX', -100, 100, 0.5).name('left / right').onChange(() => saveSettings(settings));
  skeleton.add(settings.skeleton, 'offsetY', -100, 100, 0.5).name('up / down').onChange(() => saveSettings(settings));
  skeleton.add({resetLayout: () => {
    Object.assign(settings.projection, DEFAULTS.projection);
    Object.assign(settings.skeleton, DEFAULTS.skeleton);
    onProjectionChange();
    gui.__folders['Projection'].__controllers.forEach((c) => c.updateDisplay());
    gui.__folders['Skeleton'].__controllers.forEach((c) => c.updateDisplay());
  }}, 'resetLayout').name('reset layout');
  skeleton.open();

  // Keep the controls in sync when "fill window" changes the size.
  fillWindowListeners.push(() => {
    gui.__folders['Projection'].__controllers.forEach((c) => c.updateDisplay());
    onProjectionChange();
  });

  // Takes effect on reload, since the camera stream has to restart.
  let camera = gui.addFolder('Camera');
  camera.add(settings.camera, 'resolution', ['640x360', '640x480', '1280x720'])
      .name('resolution (reloads)')
      .onChange(() => {
        saveSettings(settings);
        location.reload();
      });
  camera.add({actual: `${videoWidth}x${videoHeight}`}, 'actual').name('camera gives');

  let output = gui.addFolder('Debug control');
  output.add(guiState.debug, 'detectFaces');
  output.add(guiState.debug, 'showDetectionDebug').onChange(hideShowCamera);
  output.add(guiState.debug, 'showIllustrationDebug');
  output.open();

  // initially hide the camera
  hideShowCamera();
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
  const canvas = document.getElementById('output');
  const keypointCanvas = document.getElementById('keypoints');
  const videoCtx = canvas.getContext('2d');
  const keypointCtx = keypointCanvas.getContext('2d');

  canvas.width = videoWidth;
  canvas.height = videoHeight;
  keypointCanvas.width = videoWidth;
  keypointCanvas.height = videoHeight;

  // A torso can move a quarter of the frame width between frames and still
  // count as the same person.
  tracker = new PoseTracker({maxDistance: videoWidth * 0.25});

  async function poseDetectionFrame() {
    // Begin monitoring code for frames per second
    stats.begin();

   
    // The mirrored video copy is only needed as facemesh input or to show
    // the debug camera view, so skip it otherwise.
    if (guiState.debug.detectFaces || guiState.debug.showDetectionDebug) {
      videoCtx.clearRect(0, 0, videoWidth, videoHeight);
      videoCtx.save();
      videoCtx.scale(-1, 1);
      videoCtx.translate(-videoWidth, 0);
      videoCtx.drawImage(video, 0, 0, videoWidth, videoHeight);
      videoCtx.restore();
    }

    if (guiState.debug.detectFaces) {
      // Only build the tensor when facemesh needs it.
      const input = tf.browser.fromPixels(canvas);
      faceDetection = await facemesh.estimateFaces(input, false, false);
      input.dispose();
    } else {
      faceDetection = null;
    }
    const __t0 = performance.now();
    const poses = poseDetector.detect(video, videoWidth, videoHeight);
    const __t1 = performance.now();
    // Swap left/right part names to match the mirrored display. Done once per
    // detection, here: the tracker can return the same pose object on later
    // frames, and flipping twice would undo it.
    poses.forEach((pose) => Skeleton.flipPose(pose));
    const tracked = tracker.update(poses);

    keypointCtx.clearRect(0, 0, videoWidth, videoHeight);
    if (guiState.debug.showDetectionDebug) {
      tracked.forEach(({id, pose, missed}) => {
        if (missed === 0 && pose.score >= minPoseConfidence) {
          const color = trackColor(id);
          drawKeypoints(pose.keypoints, minPartConfidence, keypointCtx, 1, color);
          drawSkeleton(pose.keypoints, minPartConfidence, keypointCtx, 1, color);
        }
      });
      if(guiState.debug.detectFaces) {
        faceDetection.forEach(face => {
          Object.values(facePartName2Index).forEach(index => {
              let p = face.scaledMesh[index];
              drawPoint(keypointCtx, p[1], p[0], 2, 'red');
          });
        });
      }
    }

    canvasScope.project.clear();

    const face = faceDetection && faceDetection.length > 0 ?
        Skeleton.toFaceFrame(faceDetection[0]) : null;
    cast.update(tracked, face);
    cast.draw(guiState.debug.showIllustrationDebug);
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

    requestAnimationFrame(poseDetectionFrame);
  }

  poseDetectionFrame();
}

const TRACK_COLORS = ['aqua', 'yellow', 'magenta', 'lime', 'orange', 'white'];

function trackColor(id) {
  return TRACK_COLORS[id % TRACK_COLORS.length];
}

function setupCanvas() {
  mobile = isMobile();

  canvasScope = paper.default;
  illustrationCanvas = document.querySelector('.illustration-canvas');
  canvasScope.setup(illustrationCanvas);
  applyCanvasSettings(canvasScope, illustrationCanvas, settings.projection);
}

const fillWindowListeners = [];

// Sizes the canvas to the window: in fullscreen, that's the projector.
function fillWindow() {
  settings.projection.canvasWidth = window.innerWidth;
  settings.projection.canvasHeight = window.innerHeight;
  fillWindowListeners.forEach((listener) => listener());
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
}

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  // dat.gui already hides itself on H; hide the FPS meter with it.
  if (e.key === 'h' || e.key === 'H') {
    stats.dom.style.display = stats.dom.style.display === 'none' ? '' : 'none';
  }
});

const output = document.getElementById('output')

function hideShowCamera() {
  console.log('running hideSHowCamera')
  if(guiState.debug.showDetectionDebug == false) {
    output.style.display = "none"
  } else {
    output.style.display = "block"
    console.log('hiding camera')
  }
}

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
  setStatusText('Loading FaceMesh model...');
  facemesh = await facemesh_module.load();

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

  setupGui([]);
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
