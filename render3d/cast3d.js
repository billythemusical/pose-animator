// One 3D character per tracked person, the 3D version of illustrationGen/cast.js.
// Characters are cloned up front into a pool and reused as people come and go.

import {Group, Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {BONES, LIMBS} from './rigContract.js';
import {Retargeter} from './retarget.js';
import {jointsForPose} from './poseJoints.js';
import {CHARACTERS, modelUrl} from './characters.js';

// How long a character takes to fade in or out.
const FADE_MS = 400;
// How fast placement eases toward its target each frame, so a flickering
// detection doesn't make the character jump.
const EASE = 0.3;
// Below this a fading character no longer hits balls.
const SOLID_ALPHA = 0.3;

export class Cast3D {
  constructor(scene) {
    this.scene = scene;
    this.template = null;
    this.config = CHARACTERS['skeleton'];
    this.pool = [];
    this.byTrackId = new Map();
    // People who just left, fading out: {entry, alpha}.
    this.leaving = [];
    this.lastTime = null;
    this.loadId = 0;
  }

  async setCharacter(name, size) {
    const loadId = ++this.loadId;
    const gltf = await new GLTFLoader().loadAsync(modelUrl(name));
    // A newer choice came in while this one was loading.
    if (loadId !== this.loadId) return;
    this.pool.forEach((entry) => this.scene.remove(entry.root));
    this.pool = [];
    this.byTrackId.clear();
    this.leaving = [];
    this.template = gltf.scene;
    this.config = CHARACTERS[name] || CHARACTERS['skeleton'];
    this.resize(size);
  }

  /** The number of people that can be shown at once. */
  resize(size) {
    if (!this.template) return;
    while (this.pool.length < size) this.pool.push(this.build());
    if (this.pool.length > size) {
      const removed = new Set(this.pool.splice(size));
      removed.forEach((entry) => this.scene.remove(entry.root));
      [...this.byTrackId].forEach(([id, entry]) => removed.has(entry) && this.byTrackId.delete(id));
      this.leaving = this.leaving.filter(({entry}) => !removed.has(entry));
    }
  }

  build() {
    const root = new Group();
    const model = clone(this.template);
    root.add(model);
    root.visible = false;
    this.scene.add(root);
    const bones = {};
    const materials = [];
    model.traverse((object) => {
      if (object.isBone) bones[object.name] = object;
      if (object.isMesh) {
        // A skinned mesh is posed outside its rest bounds, so never cull it.
        object.frustumCulled = false;
        // Each character fades on its own.
        object.material = object.material.clone();
        materials.push(object.material);
      }
    });
    return {root, bones, materials, retargeter: new Retargeter(bones), memory: {}, state: null};
  }

  setAlpha(entry, alpha) {
    entry.root.visible = alpha > 0.01;
    entry.materials.forEach((material) => {
      material.transparent = alpha < 0.999;
      material.opacity = alpha;
    });
  }

  /**
   * @param tracked Output of PoseTracker.update(); poses carry `world`.
   * @param placeFor (pose) => {x, y, scale, presence} in world units, or null.
   * @param {object} stage3d The stage3d settings.
   * @param {number} stretch The 2D show's vertical stretch (for limb-length depth).
   */
  update(tracked, placeFor, stage3d, stretch) {
    const now = performance.now();
    const dt = this.lastTime === null ? 0 : Math.min(now - this.lastTime, 100);
    this.lastTime = now;

    const active = tracked
        .filter(({pose}) => pose.world && pose.world.length >= 33)
        .sort((a, b) => a.missed - b.missed)
        .slice(0, this.pool.length);
    const activeIds = new Set(active.map(({id}) => id));
    [...this.byTrackId].forEach(([id, entry]) => {
      if (activeIds.has(id)) return;
      this.byTrackId.delete(id);
      this.leaving.push({entry, alpha: entry.state ? entry.state.alpha : 1});
    });
    this.leaving.forEach((l) => {
      l.alpha -= dt / FADE_MS;
      this.setAlpha(l.entry, Math.max(0, l.alpha));
    });
    this.leaving = this.leaving.filter((l) => l.alpha > 0);

    const inUse = new Set(this.byTrackId.values());
    const leavingEntries = new Set(this.leaving.map(({entry}) => entry));
    const free = this.pool.filter((entry) => !inUse.has(entry) && !leavingEntries.has(entry));

    active.forEach(({id, pose, missed}) => {
      let entry = this.byTrackId.get(id);
      if (!entry) {
        // With every character busy, take over the one fading out longest.
        entry = free.shift() || (this.leaving.shift() || {}).entry;
        if (!entry) return;
        entry.memory = {};
        entry.state = {alpha: 0, x: undefined, y: undefined, scale: undefined, fresh: true};
        this.byTrackId.set(id, entry);
      }
      // Held people keep their last pose.
      if (missed === 0) this.pose(entry, pose, placeFor, stage3d, stretch, dt);
      this.setAlpha(entry, entry.state.alpha);
    });
  }

  pose(entry, pose, placeFor, stage3d, stretch, dt) {
    const {state, root} = entry;
    const placement = placeFor(pose);
    if (placement) {
      const ease = (previous, target) => previous === undefined ? target : previous + (target - previous) * EASE;
      state.x = ease(state.x, placement.x);
      state.y = ease(state.y, placement.y);
      state.scale = ease(state.scale, placement.scale);
      state.alpha += Math.max(-dt / FADE_MS, Math.min(dt / FADE_MS, placement.presence - state.alpha));
      root.position.set(state.x, state.y, 0);
      root.scale.setScalar(state.scale);
    }
    const joints = jointsForPose(pose, stage3d, stretch, entry.memory);
    entry.retargeter.solve(joints);
    // A person who just appeared starts in their pose rather than sliding to it.
    const follow = state.fresh ? 1 : stage3d.follow;
    state.fresh = false;
    BONES.forEach(({name}) => entry.bones[name].quaternion.slerp(entry.retargeter.target[name], follow));
  }

  /**
   * Where each person's limbs are now, for the physics.
   * @return {Map<id, Array<{a, b, radius}>|null>} Null for people fading out.
   */
  limbs(thickness) {
    const result = new Map();
    this.byTrackId.forEach((entry, id) => {
      if (!entry.root.visible || entry.state.alpha < SOLID_ALPHA) {
        result.set(id, null);
        return;
      }
      entry.root.updateMatrixWorld(true);
      const scale = entry.root.scale.x * this.config.limbScale * thickness;
      result.set(id, LIMBS.map(([from, to, radius]) => ({
        a: entry.bones[from].getWorldPosition(new Vector3()),
        b: entry.bones[to].getWorldPosition(new Vector3()),
        radius: radius * scale,
      })));
    });
    return result;
  }
}
