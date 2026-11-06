import {test} from 'node:test';
import assert from 'node:assert/strict';
import {worldJoints, imageJoints, jointsForPose} from '../render3d/poseJoints.js';

// 33 MediaPipe landmarks at the origin, then set the ones a test cares about.
function world(overrides = {}) {
  const landmarks = Array.from({length: 33}, () => ({x: 0, y: 0, z: 0, visibility: 1}));
  Object.entries(overrides).forEach(([index, lm]) => Object.assign(landmarks[index], lm));
  return landmarks;
}

test('x is flipped and left and right swap, like the 2D mirror', () => {
  // The dancer's own left shoulder, on the right of the raw image (+x).
  const joints = worldJoints(world({11: {x: 0.2}, 12: {x: -0.2}}));
  assert.equal(joints.rightShoulder.x, -0.2);
  assert.equal(joints.leftShoulder.x, 0.2);
});

test('y points up and z toward the viewer', () => {
  const joints = worldJoints(world({0: {y: -0.5, z: -0.3}}));
  assert.equal(joints.nose.y, 0.5);
  assert.equal(joints.nose.z, 0.3);
});

test('depthAmount 0 flattens z', () => {
  const joints = worldJoints(world({0: {z: -0.3}}), 0);
  assert.equal(joints.nose.z, 0);
});

test('a missing visibility counts as seen', () => {
  const landmarks = world();
  delete landmarks[0].visibility;
  assert.equal(worldJoints(landmarks).nose.score, 1);
});

// A tracked pose as the show makes it: 2D keypoints already mirrored and
// name-swapped, plus the raw world landmarks.
function trackedPose({elbowZ = 0, scale = 100} = {}) {
  const raw = {
    11: {x: 0.2, y: -0.45}, 12: {x: -0.2, y: -0.45},
    23: {x: 0.1, y: 0}, 24: {x: -0.1, y: 0},
    13: {x: 0.3, y: -0.2, z: elbowZ}, 15: {x: 0.3, y: 0.05, z: elbowZ * 2},
  };
  const w = world(raw);
  const toKeypoint = (part, index) => ({
    part, score: 1,
    // The 2D side: mirrored (x flipped), y down, in pixels, names swapped.
    position: {x: -w[index].x * scale, y: w[index].y * scale},
  });
  const names = {
    rightShoulder: 11, leftShoulder: 12, rightHip: 23, leftHip: 24,
    rightElbow: 13, rightWrist: 15,
  };
  const keypoints = Object.entries(names).map(([part, index]) => toKeypoint(part, index));
  // Everything else sits at the origin so the pose is complete.
  ['nose', 'leftEar', 'rightEar', 'leftElbow', 'leftWrist', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle']
      .forEach((part) => keypoints.push({part, score: 1, position: {x: 0, y: 0}}));
  return {world: w, keypoints};
}

test('limb length: a limb in the image plane gets no depth', () => {
  const joints = imageJoints(trackedPose(), 1, 1, {});
  assert.ok(Math.abs(joints.rightElbow.z - joints.rightShoulder.z) < 1e-6);
});

test('limb length: a foreshortened limb gets depth from the longest it has been', () => {
  const memory = {};
  imageJoints(trackedPose(), 1, 1, memory);
  assert.ok(memory.rightElbow > 0);
  const short = trackedPose();
  // The elbow now looks much closer to the shoulder in the image.
  short.keypoints.find((k) => k.part === 'rightElbow').position = {x: -0.2 * 100, y: -0.4 * 100 + 0};
  Object.assign(short.world[13], {x: 0.2, y: -0.4, z: -0.2});
  const joints = imageJoints(short, 1, 1, memory);
  assert.ok(Math.abs(joints.rightElbow.z - joints.rightShoulder.z) > 5, 'depth recovered from the length');
  assert.ok(joints.rightElbow.z > joints.rightShoulder.z, 'MediaPipe says it points toward the camera');
});

test('limb length: depthAmount 0 flattens', () => {
  const joints = imageJoints(trackedPose({elbowZ: -0.2}), 1, 0, {});
  Object.values(joints).forEach((j) => assert.ok(j.z === 0));  // -0 counts
});

test('jointsForPose follows the depth setting', () => {
  const pose = trackedPose({elbowZ: -0.2});
  const mediapipe = jointsForPose(pose, {depth: 'MediaPipe', depthAmount: 1}, 1, {});
  assert.ok(Math.abs(mediapipe.rightElbow.z - 0.2) < 1e-9);
  const fallback = jointsForPose(pose, {depth: 'limb length', depthAmount: 1}, 1, {});
  assert.notEqual(fallback.rightElbow.z, mediapipe.rightElbow.z);
});
