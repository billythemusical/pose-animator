// Run with `yarn test`.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PoseTracker} from '../pose/tracker.js';

// A pose whose torso is centered at (x, y).
function poseAt(x, y) {
  const parts = {
    leftShoulder: [x - 10, y - 20], rightShoulder: [x + 10, y - 20],
    leftHip: [x - 8, y + 20], rightHip: [x + 8, y + 20],
  };
  return {
    score: 0.9,
    keypoints: Object.entries(parts).map(([part, [px, py]]) => ({part, position: {x: px, y: py}, score: 0.9})),
  };
}

const ids = (tracked) => tracked.filter((t) => t.missed === 0).map((t) => t.id);

test('keeps IDs when the detector reorders people', () => {
  const tracker = new PoseTracker({maxDistance: 100});
  const [a, b] = ids(tracker.update([poseAt(100, 200), poseAt(400, 200)]));
  const tracked = tracker.update([poseAt(405, 200), poseAt(102, 200)]);
  assert.equal(tracked.find((t) => t.pose.keypoints[0].position.x < 200).id, a);
  assert.equal(tracked.find((t) => t.pose.keypoints[0].position.x > 200).id, b);
});

test('two people crossing paths keep their own IDs', () => {
  const tracker = new PoseTracker({maxDistance: 100});
  // A walks right, B walks left, 40px per frame; they pass at x=250.
  let [a, b] = [null, null];
  for (let frame = 0; frame <= 10; frame++) {
    const ax = 50 + frame * 40;
    const bx = 450 - frame * 40;
    // Shuffle the order each frame, like the detector might.
    const poses = frame % 2 ? [poseAt(bx, 200), poseAt(ax, 200)] : [poseAt(ax, 200), poseAt(bx, 200)];
    const tracked = tracker.update(poses);
    const idAt = (x) => tracked.find((t) => t.missed === 0 && Math.abs(t.pose.keypoints[0].position.x + 10 - x) < 1).id;
    if (frame === 0) {
      [a, b] = [idAt(ax), idAt(bx)];
    } else if (ax !== bx) {
      assert.equal(idAt(ax), a, `frame ${frame}: A swapped`);
      assert.equal(idAt(bx), b, `frame ${frame}: B swapped`);
    }
  }
});

test('holds a lost person for a few frames, then drops them', () => {
  const tracker = new PoseTracker({maxDistance: 100, holdFrames: 2});
  const [a] = ids(tracker.update([poseAt(100, 200)]));
  assert.deepEqual(tracker.update([]).map((t) => [t.id, t.missed]), [[a, 1]]);
  assert.deepEqual(tracker.update([]).map((t) => [t.id, t.missed]), [[a, 2]]);
  assert.deepEqual(tracker.update([]), []);
});

test('a person who reappears within the hold keeps their ID', () => {
  const tracker = new PoseTracker({maxDistance: 100, holdFrames: 5});
  const [a] = ids(tracker.update([poseAt(100, 200)]));
  tracker.update([]);
  tracker.update([]);
  assert.deepEqual(ids(tracker.update([poseAt(110, 200)])), [a]);
});

test('someone far away is a new person, not a jump', () => {
  const tracker = new PoseTracker({maxDistance: 100});
  const [a] = ids(tracker.update([poseAt(100, 200)]));
  const [b] = ids(tracker.update([poseAt(500, 200)]));
  assert.notEqual(a, b);
});
