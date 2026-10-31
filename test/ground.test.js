// Run with `yarn test`.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {footY, shiftPose, scalePose, centerX} from '../pose/ground.js';

const kp = (part, y, score = 0.9) => ({part, position: {x: 0, y}, score});

test('footY averages the visible ankles', () => {
  const pose = {keypoints: [kp('nose', 10), kp('leftAnkle', 100), kp('rightAnkle', 110)]};
  assert.equal(footY(pose), 105);
});

test('footY falls back to the lowest confident point', () => {
  const pose = {keypoints: [kp('nose', 10), kp('leftWrist', 80), kp('leftAnkle', 200, 0.1)]};
  assert.equal(footY(pose), 80);
});

test('footY is null when nothing is visible', () => {
  assert.equal(footY({keypoints: [kp('nose', 10, 0.1)]}), null);
});

test('shiftPose moves every point and leaves the original alone', () => {
  const pose = {score: 1, keypoints: [kp('nose', 10)]};
  const moved = shiftPose(pose, 5);
  assert.equal(moved.keypoints[0].position.y, 15);
  assert.equal(pose.keypoints[0].position.y, 10);
  assert.equal(moved.score, 1);
});

test('scalePose keeps the anchor point fixed', () => {
  const pose = {keypoints: [{part: 'nose', position: {x: 10, y: 0}, score: 1}, {part: 'leftAnkle', position: {x: 10, y: 100}, score: 1}]};
  const small = scalePose(pose, 0.5, 10, 100);
  assert.deepEqual(small.keypoints[1].position, {x: 10, y: 100});
  assert.deepEqual(small.keypoints[0].position, {x: 10, y: 50});
});

test('centerX averages the visible points', () => {
  const pose = {keypoints: [{part: 'nose', position: {x: 10, y: 0}, score: 1}, {part: 'leftAnkle', position: {x: 30, y: 0}, score: 1}, {part: 'rightAnkle', position: {x: 900, y: 0}, score: 0.1}]};
  assert.equal(centerX(pose), 20);
});
