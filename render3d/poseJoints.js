// Turns one detected pose into named 3D joints for the retargeter, in the
// character's space: x toward the character's left, y up, z toward the viewer.
//
// The show is a mirror, the same as the 2D skeleton: the dancer's own left arm
// is on the left of the screen, which makes it the character's right arm. So
// x is flipped and the left and right names are swapped. That is what
// toPoseNetFormat plus Skeleton.flipPose do to the 2D points.

const LANDMARKS = {
  nose: 0,
  leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftPinky: 17, rightPinky: 18,
  leftIndex: 19, rightIndex: 20,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
  leftToe: 31, rightToe: 32,
};

const SWAPPED = Object.fromEntries(Object.keys(LANDMARKS).map((name) => [
  name,
  name.startsWith('left') ? 'right' + name.slice(4) :
      name.startsWith('right') ? 'left' + name.slice(5) : name,
]));

const LIMB_SEGMENTS = ['left', 'right'].flatMap((side) => [
  [`${side}Shoulder`, `${side}Elbow`],
  [`${side}Elbow`, `${side}Wrist`],
  [`${side}Hip`, `${side}Knee`],
  [`${side}Knee`, `${side}Ankle`],
]);

// Hands and toes aren't in the 2D points: [joint, the 2D joint it hangs off].
const EXTRAS = ['left', 'right'].flatMap((side) => [
  [`${side}Pinky`, `${side}Wrist`],
  [`${side}Index`, `${side}Wrist`],
  [`${side}Toe`, `${side}Ankle`],
]);

/**
 * MediaPipe's 3D joints. They're in meters, centered on the hips, with x to
 * the right of the raw image, y down and z away from the camera.
 * @param {Array} world One pose from PoseLandmarkerResult.worldLandmarks.
 * @param {number} depthAmount Multiplies z: 1 keeps the depth, 0 flattens it.
 */
export function worldJoints(world, depthAmount = 1) {
  const joints = {};
  Object.entries(LANDMARKS).forEach(([name, index]) => {
    const lm = world[index];
    joints[SWAPPED[name]] = {
      x: -lm.x,
      y: -lm.y,
      z: -lm.z * depthAmount,
      score: lm.visibility == null ? 1 : lm.visibility,
    };
  });
  return joints;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function midpoint(a, b) {
  return {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2};
}

/**
 * The fallback for when MediaPipe's depth doesn't hold up, as it may looking
 * straight down: x and y come from the 2D points (what the 2D show uses), and
 * each limb's z from how much shorter than its full length it looks. A limb
 * pointing at the camera looks short. MediaPipe still says which way it points.
 *
 * @param {object} pose A tracked pose with keypoints and `world`.
 * @param {number} stretch The 2D show's vertical stretch, which makes up for
 *     an overhead camera seeing people foreshortened.
 * @param {number} depthAmount Multiplies z: 1 keeps the depth, 0 flattens it.
 * @param {object} memory Longest length seen per limb, kept for each person.
 */
export function imageJoints(pose, stretch, depthAmount, memory) {
  const world = worldJoints(pose.world);
  const flat = {};
  pose.keypoints.forEach((kp) => {
    flat[kp.part] = {x: kp.position.x, y: -kp.position.y * stretch, score: kp.score};
  });

  // Both sets of joints have the same left and right by now, so they can be
  // compared. This factor converts meters to pixels.
  const flatDistance = (a, b) => Math.hypot(flat[a].x - flat[b].x, flat[a].y - flat[b].y);
  const scale = (flatDistance('leftShoulder', 'leftHip') + flatDistance('rightShoulder', 'rightHip')) /
      Math.max(1e-6, distance(world.leftShoulder, world.leftHip) + distance(world.rightShoulder, world.rightHip));

  const joints = {};
  Object.keys(world).forEach((name) => {
    joints[name] = flat[name] ?
        {...flat[name], z: world[name].z * scale * depthAmount} :
        {x: 0, y: 0, z: 0, score: world[name].score};
  });

  // The longest a limb has been seen stands in for its real length, fading
  // slowly because the person's distance from the camera changes it too.
  LIMB_SEGMENTS.forEach(([from, to]) => {
    const a = joints[from];
    const b = joints[to];
    const seen = Math.hypot(a.x - b.x, a.y - b.y);
    const longest = Math.max(seen, (memory[to] || 0) * 0.9995);
    memory[to] = longest;
    const direction = world[to].z >= world[from].z ? 1 : -1;
    b.z = a.z + direction * Math.sqrt(longest * longest - seen * seen) * depthAmount;
  });

  EXTRAS.forEach(([name, base]) => {
    joints[name].x = joints[base].x + (world[name].x - world[base].x) * scale;
    joints[name].y = joints[base].y + (world[name].y - world[base].y) * scale;
    joints[name].z = joints[base].z + (world[name].z - world[base].z) * scale * depthAmount;
  });
  return joints;
}

/** Which joints to use, following the 3D stage's depth setting. */
export function jointsForPose(pose, {depth, depthAmount}, stretch, memory) {
  return depth === 'limb length' ?
      imageJoints(pose, stretch, depthAmount, memory) :
      worldJoints(pose.world, depthAmount);
}
