// Keeps a person's skeleton on the floor. An overhead camera sees bodies
// foreshortened and sliding around the frame, so instead of following the
// body's height in the image, each pose is shifted vertically until its feet
// sit on a floor line.

const FOOT_PARTS = ['leftAnkle', 'rightAnkle'];

/**
 * The y (in video pixels) of a person's feet: the average of the ankles it
 * can see, or else the lowest point it can see. Null if nothing is visible.
 */
export function footY(pose, minScore = 0.3) {
  const seen = pose.keypoints.filter((kp) => kp.score >= minScore);
  const ankles = seen.filter((kp) => FOOT_PARTS.includes(kp.part));
  if (ankles.length) {
    return ankles.reduce((sum, kp) => sum + kp.position.y, 0) / ankles.length;
  }
  return seen.length ? Math.max(...seen.map((kp) => kp.position.y)) : null;
}

/** A copy of `pose` moved down by `dy` pixels. */
export function shiftPose(pose, dy) {
  return {
    ...pose,
    keypoints: pose.keypoints.map((kp) => ({...kp, position: {x: kp.position.x, y: kp.position.y + dy}})),
  };
}

/** The x (in video pixels) of the middle of a person's visible body. */
export function centerX(pose, minScore = 0.3) {
  const seen = pose.keypoints.filter((kp) => kp.score >= minScore);
  return seen.length ? seen.reduce((sum, kp) => sum + kp.position.x, 0) / seen.length : null;
}

/** A copy of `pose` grown or shrunk by `factor` around the point (x, y). */
export function scalePose(pose, factor, x, y) {
  return {
    ...pose,
    keypoints: pose.keypoints.map((kp) => ({
      ...kp,
      position: {x: x + (kp.position.x - x) * factor, y: y + (kp.position.y - y) * factor},
    })),
  };
}
