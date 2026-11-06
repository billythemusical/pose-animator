// The core of the 3D show. The pose gives joint positions, a skinned rig needs
// bone rotations. For each bone this works out its rotation away from the rest
// pose ("delta") in the character's space, from the hips outward, and converts
// that to the local rotation the bone actually stores.

import {Matrix4, Quaternion, Vector3} from 'three';
import {BONES} from './rigContract.js';
import {midpoint} from './poseJoints.js';

// Below this, a joint isn't believed and its bone holds its last rotation.
const MIN_SCORE = 0.3;
const IDENTITY = new Quaternion();

const vector = (a, b) => new Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
const scoreOf = (joints, names) => Math.min(...names.map((name) => joints[name].score));

// The rotation of an (x axis, roughly-up) pair. Null if the axes are too close
// to tell, like a hip line seen end-on when the depth is flat.
function frameRotation(x, up) {
  if (x.length() < 1e-4) return null;
  const xAxis = x.clone().normalize();
  const zAxis = new Vector3().crossVectors(xAxis, up);
  if (zAxis.length() < 1e-4) return null;
  zAxis.normalize();
  const yAxis = new Vector3().crossVectors(zAxis, xAxis);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(xAxis, yAxis, zAxis));
}

const shoulderMid = (j) => midpoint(j.leftShoulder, j.rightShoulder);
const hipMid = (j) => midpoint(j.leftHip, j.rightHip);
const earMid = (j) => midpoint(j.leftEar, j.rightEar);
const handMid = (j, side) => midpoint(j[`${side}Index`], j[`${side}Pinky`]);

// Each bone that points at a joint: [the bone it points at in the rig, the
// joints its confidence comes from, its live direction].
function limbRules(side, Side) {
  return {
    [`${Side}UpperArm`]: [`${Side}LowerArm`, [`${side}Shoulder`, `${side}Elbow`],
      (j) => vector(j[`${side}Shoulder`], j[`${side}Elbow`])],
    [`${Side}LowerArm`]: [`${Side}Hand`, [`${side}Elbow`, `${side}Wrist`],
      (j) => vector(j[`${side}Elbow`], j[`${side}Wrist`])],
    [`${Side}Hand`]: [`${Side}HandTip`, [`${side}Wrist`, `${side}Index`, `${side}Pinky`],
      (j) => vector(j[`${side}Wrist`], handMid(j, side))],
    [`${Side}UpperLeg`]: [`${Side}LowerLeg`, [`${side}Hip`, `${side}Knee`],
      (j) => vector(j[`${side}Hip`], j[`${side}Knee`])],
    [`${Side}LowerLeg`]: [`${Side}Foot`, [`${side}Knee`, `${side}Ankle`],
      (j) => vector(j[`${side}Knee`], j[`${side}Ankle`])],
    [`${Side}Foot`]: [`${Side}Toe`, [`${side}Ankle`, `${side}Toe`],
      (j) => vector(j[`${side}Ankle`], j[`${side}Toe`])],
  };
}

const DIRECTION_RULES = {
  Neck: ['Head', ['leftShoulder', 'rightShoulder', 'leftEar', 'rightEar'],
    (j) => vector(shoulderMid(j), earMid(j))],
  ...limbRules('left', 'Left'),
  ...limbRules('right', 'Right'),
};

export class Retargeter {
  /** @param {Object<string, THREE.Bone>} bones The contract's bones, in the rest pose. */
  constructor(bones) {
    this.bones = bones;
    this.rest = {};
    const at = (name) => bones[name].getWorldPosition(new Vector3());
    bones.Hips.parent.updateWorldMatrix(true, true);

    BONES.forEach(({name, parent}) => {
      this.rest[name] = {
        parent,
        worldRotation: bones[name].getWorldQuaternion(new Quaternion()),
        // Only the hips use this: what they sit under, outside the contract.
        outerRotation: bones[name].parent.getWorldQuaternion(new Quaternion()),
      };
    });
    Object.entries(DIRECTION_RULES).forEach(([name, [child]]) => {
      this.rest[name].direction = at(child).sub(at(name)).normalize();
    });

    const shoulderLine = at('LeftUpperArm').sub(at('RightUpperArm'));
    const torsoUp = at('Neck').sub(at('Hips'));
    this.restHips = frameRotation(at('LeftUpperLeg').sub(at('RightUpperLeg')), torsoUp).invert();
    this.restChest = frameRotation(shoulderLine, torsoUp).invert();
    this.restHead = frameRotation(shoulderLine, at('HeadTop').sub(at('Head'))).invert();

    this.target = {};
    this.confidence = {};
    BONES.forEach(({name}) => {
      this.target[name] = bones[name].quaternion.clone();
      this.confidence[name] = 0;
    });
  }

  /** The hips, chest and head rotations, or null for any it can't work out. */
  torsoDeltas(j) {
    const up = vector(hipMid(j), shoulderMid(j));
    const delta = (frame, rest, names) =>
      (frame && scoreOf(j, names) >= MIN_SCORE) ? frame.multiply(rest) : null;
    const earLine = vector(j.rightEar, j.leftEar);
    const headUp = new Vector3().crossVectors(vector(earMid(j), j.nose), earLine);
    const torsoJoints = ['leftHip', 'rightHip', 'leftShoulder', 'rightShoulder'];
    return {
      Hips: delta(frameRotation(vector(j.rightHip, j.leftHip), up), this.restHips, torsoJoints),
      Chest: delta(frameRotation(vector(j.rightShoulder, j.leftShoulder), up), this.restChest, torsoJoints),
      Head: delta(frameRotation(earLine, headUp), this.restHead, ['leftEar', 'rightEar', 'nose']),
    };
  }

  /**
   * Knees only bend one way. Depth noise can say otherwise, which reads as a
   * leg snapping backward, so the forward part of the shin is taken out.
   */
  keepKneeBendingBack(shin, thigh, hipsDelta) {
    const forward = new Vector3(0, 0, 1).applyQuaternion(hipsDelta);
    const thighDirection = thigh.clone().normalize();
    forward.addScaledVector(thighDirection, -forward.dot(thighDirection));
    if (forward.length() < 1e-4) return shin;
    forward.normalize();
    const wrongWay = shin.dot(forward);
    return wrongWay > 0 ? shin.clone().addScaledVector(forward, -wrongWay) : shin;
  }

  /**
   * Works out this frame's target rotations. Results are in `this.target`
   * (local rotations) and `this.confidence` (0 to 1, per bone).
   */
  solve(joints) {
    const torso = this.torsoDeltas(joints);
    const deltas = {};

    BONES.forEach(({name, parent}) => {
      const rest = this.rest[name];
      const parentDelta = parent ? deltas[parent] : IDENTITY;
      const parentWorld = parent ?
          parentDelta.clone().multiply(this.rest[parent].worldRotation) :
          rest.outerRotation.clone();
      let delta = null;
      let confidence = 1;

      if (name === 'Hips' || name === 'Chest' || name === 'Head') {
        delta = torso[name];
      } else if (name === 'Spine') {
        // Halfway between the hips and the chest, so the back curves.
        delta = parentDelta.clone().slerp(torso.Chest || parentDelta, 0.5);
      } else if (DIRECTION_RULES[name]) {
        const [, scoreJoints, liveDirection] = DIRECTION_RULES[name];
        confidence = scoreOf(joints, scoreJoints);
        if (confidence >= MIN_SCORE) {
          let live = liveDirection(joints);
          if (name.endsWith('LowerLeg')) {
            const side = name.startsWith('Left') ? 'left' : 'right';
            live = this.keepKneeBendingBack(live, vector(joints[`${side}Hip`], joints[`${side}Knee`]), deltas.Hips);
          }
          if (live.length() > 1e-4) {
            const inherited = rest.direction.clone().applyQuaternion(parentDelta);
            delta = new Quaternion().setFromUnitVectors(inherited, live.normalize()).multiply(parentDelta);
          }
        }
      } else {
        // Shoulders and tips ride along with their parent.
        delta = parentDelta.clone();
      }

      if (delta) {
        this.target[name] = parentWorld.clone().invert().multiply(delta).multiply(rest.worldRotation);
        this.confidence[name] = confidence;
      } else {
        // Can't see it: keep the rotation it had, relative to its parent.
        delta = parentWorld.clone().multiply(this.target[name]).multiply(rest.worldRotation.clone().invert());
        this.confidence[name] = 0;
      }
      deltas[name] = delta;
    });
  }
}
