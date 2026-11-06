// Run with `yarn test`. Needs the characters: node scripts/build-characters.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {BONES} from '../render3d/rigContract.js';
import {Retargeter} from '../render3d/retarget.js';
import {loadCharacter, hasModel} from './helpers/loadCharacter.js';

const MODELS = ['skeleton', 'marshmallow-man'].filter(hasModel);

// A standing, front-facing person in the character's space (y up, +x is the
// character's left), with every joint fully visible.
function standingJoints() {
  const at = (x, y, z = 0) => ({x, y, z, score: 1});
  return {
    nose: at(0, 1.62, 0.1),
    leftEar: at(0.07, 1.65), rightEar: at(-0.07, 1.65),
    leftShoulder: at(0.2, 1.45), rightShoulder: at(-0.2, 1.45),
    leftElbow: at(0.25, 1.15), rightElbow: at(-0.25, 1.15),
    leftWrist: at(0.28, 0.9), rightWrist: at(-0.28, 0.9),
    leftPinky: at(0.28, 0.82), rightPinky: at(-0.28, 0.82),
    leftIndex: at(0.29, 0.82), rightIndex: at(-0.29, 0.82),
    leftHip: at(0.1, 0.95), rightHip: at(-0.1, 0.95),
    leftKnee: at(0.1, 0.5), rightKnee: at(-0.1, 0.5),
    leftAnkle: at(0.1, 0.1), rightAnkle: at(-0.1, 0.1),
    leftToe: at(0.1, 0.02, 0.15), rightToe: at(-0.1, 0.02, 0.15),
  };
}

const worldPosition = (bone) => bone.getWorldPosition(new Vector3());

function pose(character, retargeter, joints) {
  retargeter.solve(joints);
  BONES.forEach(({name}) => character.bones[name].quaternion.copy(retargeter.target[name]));
  character.scene.updateMatrixWorld(true);
}

test('the character models follow the bone contract', async () => {
  assert.ok(MODELS.length > 0, 'run node scripts/build-characters.mjs first');
  for (const name of MODELS) {
    const {bones} = await loadCharacter(name);
    BONES.forEach(({name: bone}) => assert.ok(bones[bone], `${name} is missing bone ${bone}`));
  }
});

for (const model of MODELS) {
  test(`${model}: a raised arm in the pose raises the matching arm`, async () => {
    const character = await loadCharacter(model);
    const retargeter = new Retargeter(character.bones);
    const joints = standingJoints();
    // The character's left arm straight up.
    joints.leftElbow = {x: 0.2, y: 1.75, z: 0, score: 1};
    joints.leftWrist = {x: 0.2, y: 2.05, z: 0, score: 1};
    joints.leftIndex = {x: 0.2, y: 2.12, z: 0, score: 1};
    joints.leftPinky = {x: 0.2, y: 2.12, z: 0, score: 1};
    pose(character, retargeter, joints);

    const hand = worldPosition(character.bones.LeftHand);
    const shoulder = worldPosition(character.bones.LeftUpperArm);
    const direction = hand.sub(shoulder).normalize();
    assert.ok(direction.y > 0.95, `left arm should point up, got ${direction.toArray()}`);
    // The other arm hasn't moved from hanging... it follows its own joints.
    const rightHand = worldPosition(character.bones.RightHand);
    assert.ok(rightHand.y < worldPosition(character.bones.RightUpperArm).y, 'right arm stays down');
  });

  test(`${model}: a pose of straight limbs puts each bone where the joints are`, async () => {
    const character = await loadCharacter(model);
    const retargeter = new Retargeter(character.bones);
    const joints = standingJoints();
    // Right arm forward (toward the viewer), knee up.
    joints.rightElbow = {x: -0.2, y: 1.45, z: 0.3, score: 1};
    joints.rightWrist = {x: -0.2, y: 1.45, z: 0.6, score: 1};
    joints.rightIndex = {x: -0.2, y: 1.45, z: 0.68, score: 1};
    joints.rightPinky = {x: -0.2, y: 1.45, z: 0.68, score: 1};
    pose(character, retargeter, joints);
    const upper = worldPosition(character.bones.RightLowerArm).sub(worldPosition(character.bones.RightUpperArm)).normalize();
    assert.ok(upper.z > 0.95, `right arm should point at the viewer, got ${upper.toArray()}`);
  });

  test(`${model}: low-confidence joints keep the last rotation`, async () => {
    const character = await loadCharacter(model);
    const retargeter = new Retargeter(character.bones);
    const joints = standingJoints();
    joints.leftElbow = {x: 0.2, y: 1.75, z: 0, score: 1};
    joints.leftWrist = {x: 0.2, y: 2.05, z: 0, score: 1};
    pose(character, retargeter, joints);
    const before = retargeter.target.LeftUpperArm.clone();
    joints.leftElbow = {x: 0.9, y: 0.2, z: 0, score: 0.05};
    retargeter.solve(joints);
    assert.ok(retargeter.target.LeftUpperArm.angleTo(before) < 1e-6);
    assert.equal(retargeter.confidence.LeftUpperArm, 0);
  });

  test(`${model}: a standing pose leaves a neutral figure`, async () => {
    const character = await loadCharacter(model);
    const retargeter = new Retargeter(character.bones);
    pose(character, retargeter, standingJoints());
    const head = worldPosition(character.bones.HeadTop);
    const hips = worldPosition(character.bones.Hips);
    assert.ok(head.y > hips.y + 0.5, 'the head stays above the hips');
    assert.ok(Math.abs(head.x - hips.x) < 0.1, 'and over them');
  });
}
