// Wraps MediaPipe Pose Landmarker behind a small interface so the rest of
// the app gets PoseNet-format poses and never touches MediaPipe directly.

import {FilesetResolver, PoseLandmarker} from '@mediapipe/tasks-vision';
import {toPoseNetFormat} from './toPoseNetFormat';

// Served from public/: the WASM is copied there on `yarn install`, and the
// models are committed to the repo, so nothing loads from the network.
const WASM_PATH = './mediapipe/wasm';
export const POSE_MODELS = {
  lite: './models/pose_landmarker_lite.task',
  full: './models/pose_landmarker_full.task',
};

export class PoseDetector {
  static async create({model = 'lite', numPoses = 1, minConfidence = 0.5} = {}) {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const options = (delegate) => ({
      baseOptions: {modelAssetPath: POSE_MODELS[model], delegate},
      runningMode: 'VIDEO',
      numPoses,
      minPoseDetectionConfidence: minConfidence,
      minPosePresenceConfidence: minConfidence,
    });
    let landmarker;
    let delegate = 'GPU';
    try {
      landmarker = await PoseLandmarker.createFromOptions(fileset, options('GPU'));
    } catch (e) {
      console.warn('GPU delegate unavailable, falling back to CPU', e);
      delegate = 'CPU';
      landmarker = await PoseLandmarker.createFromOptions(fileset, options('CPU'));
    }
    return new PoseDetector(landmarker, delegate);
  }

  constructor(landmarker, delegate) {
    this.landmarker = landmarker;
    this.delegate = delegate;
    this.lastTimestamp = -1;
  }

  async setOptions({model, numPoses, minConfidence}) {
    const options = {};
    if (model) {
      options.baseOptions = {modelAssetPath: POSE_MODELS[model], delegate: this.delegate};
    }
    if (numPoses) {
      options.numPoses = numPoses;
    }
    if (minConfidence) {
      options.minPoseDetectionConfidence = minConfidence;
      options.minPosePresenceConfidence = minConfidence;
    }
    await this.landmarker.setOptions(options);
  }

  /**
   * Returns PoseNet-format poses, mirrored, in `width` x `height` pixels.
   */
  detect(video, width, height) {
    // VIDEO mode requires strictly increasing timestamps.
    const timestamp = Math.max(performance.now(), this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;
    const result = this.landmarker.detectForVideo(video, timestamp);
    return result.landmarks.map(
        (landmarks) => toPoseNetFormat(landmarks, width, height, true));
  }
}
