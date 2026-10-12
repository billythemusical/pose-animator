// Converts MediaPipe Pose Landmarker output into the PoseNet pose format that
// the rest of the app (Skeleton, debug drawing) was written against:
//   {score, keypoints: [{part, position: {x, y}, score}]}

// MediaPipe landmark index -> PoseNet part name. Both use the person's own
// left/right, so "left" maps to "left".
// https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker#pose_landmarker_model
const LANDMARK_PARTS = [
  [0, 'nose'],
  [2, 'leftEye'],
  [5, 'rightEye'],
  [7, 'leftEar'],
  [8, 'rightEar'],
  [11, 'leftShoulder'],
  [12, 'rightShoulder'],
  [13, 'leftElbow'],
  [14, 'rightElbow'],
  [15, 'leftWrist'],
  [16, 'rightWrist'],
  [23, 'leftHip'],
  [24, 'rightHip'],
  [25, 'leftKnee'],
  [26, 'rightKnee'],
  [27, 'leftAnkle'],
  [28, 'rightAnkle'],
];

/**
 * @param {Array<{x, y, visibility}>} landmarks One pose from
 *     PoseLandmarkerResult.landmarks, normalized to [0, 1].
 * @param {number} width Pixel width to scale x into.
 * @param {number} height Pixel height to scale y into.
 * @param {boolean} flipHorizontal Mirror x, matching PoseNet's
 *     `flipHorizontal: true` option.
 */
export function toPoseNetFormat(landmarks, width, height, flipHorizontal) {
  let totalScore = 0;
  const keypoints = LANDMARK_PARTS.map(([index, part]) => {
    const lm = landmarks[index];
    // Treat a missing visibility as fully visible rather than dropping the
    // joint.
    const score = lm.visibility == null ? 1 : lm.visibility;
    totalScore += score;
    const x = flipHorizontal ? (1 - lm.x) * width : lm.x * width;
    return {part, position: {x, y: lm.y * height}, score};
  });
  return {score: totalScore / keypoints.length, keypoints};
}
