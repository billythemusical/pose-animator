// The balls and what they bounce off, in Rapier. This knows nothing about
// drawing: the stage draws whatever `balls` says.
//
// Dancers are kinematic: each limb is a capsule that follows its bone, so a
// dancer pushes balls around but a ball can't push a dancer.
//
// With `flat` on, everything happens in the plane of the sheet: limbs are
// squashed onto it and balls can't leave it. An audience can't see depth on a
// sheet, so what looks like a hit always is one.

import RAPIER from '@dimforge/rapier3d-compat';
import {Quaternion, Vector3} from 'three';

const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 4;
const WALL_THICKNESS = 1;
const WALL_HEIGHT = 40;
const ROOM_DEPTH = 0.6;
// A jittery limb can move fast enough to fling a ball out of sight.
const MAX_BALL_SPEED = 9;
const CAPSULE_AXIS = new Vector3(0, 1, 0);

let initialized = null;
/** Rapier is WebAssembly and has to load once before use. */
export function initPhysics() {
  initialized = initialized || RAPIER.init();
  return initialized;
}

export class Physics {
  /**
   * Call initPhysics() first.
   * @param options {gravity, ballSize, bounciness, maxBalls, flat}. Read again
   *     by applyOptions() and spawn(), so it can be the live settings section.
   */
  constructor(options) {
    this.options = options;
    this.world = new RAPIER.World({x: 0, y: -options.gravity, z: 0});
    this.world.timestep = STEP;
    this.events = new RAPIER.EventQueue(true);
    this.walls = [];
    this.balls = [];
    this.nextBallId = 1;
    // Per dancer (any key): the bodies for each limb.
    this.dancers = new Map();
    this.dancerColliders = new Set();
    this.leftover = 0;
    this.hits = 0;
  }

  /** The floor and side walls. Sizes are in world units. */
  setBounds({left, right, floor}) {
    this.walls.forEach((body) => this.world.removeRigidBody(body));
    this.walls = [];
    const middle = (left + right) / 2;
    const width = (right - left) / 2 + WALL_THICKNESS * 2;
    const depth = ROOM_DEPTH + WALL_THICKNESS * 2;
    const wall = (x, y, z, hx, hy, hz) => {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setRestitution(0.6).setFriction(0.5), body);
      this.walls.push(body);
    };
    wall(middle, floor - WALL_THICKNESS, 0, width, WALL_THICKNESS, depth);
    wall(left - WALL_THICKNESS, floor + WALL_HEIGHT, 0, WALL_THICKNESS, WALL_HEIGHT, depth);
    wall(right + WALL_THICKNESS, floor + WALL_HEIGHT, 0, WALL_THICKNESS, WALL_HEIGHT, depth);
    wall(middle, floor + WALL_HEIGHT, -ROOM_DEPTH - WALL_THICKNESS, width, WALL_HEIGHT, WALL_THICKNESS);
    wall(middle, floor + WALL_HEIGHT, ROOM_DEPTH + WALL_THICKNESS, width, WALL_HEIGHT, WALL_THICKNESS);
    // Anything resting against an old wall has to notice the new ones.
    this.balls.forEach((ball) => ball.body.wakeUp());
  }

  /** Adds a ball. Past the limit, the oldest one is recycled. */
  spawn(x, y, z = 0) {
    const {ballSize, bounciness, flat, maxBalls} = this.options;
    while (this.balls.length >= maxBalls) this.removeBall(this.balls[0]);
    const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y, flat ? 0 : z)
            .setCcdEnabled(true)
            .enabledTranslations(true, true, !flat));
    const collider = this.world.createCollider(
        RAPIER.ColliderDesc.ball(ballSize)
            .setRestitution(bounciness)
            .setFriction(0.2)
            .setDensity(0.5)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body);
    const ball = {body, collider, flash: 0, id: this.nextBallId++};
    this.balls.push(ball);
    return ball;
  }

  removeBall(ball) {
    this.world.removeRigidBody(ball.body);
    this.balls.splice(this.balls.indexOf(ball), 1);
  }

  clear() {
    this.balls.slice().forEach((ball) => this.removeBall(ball));
  }

  /** Applies a change to any of the options. */
  applyOptions() {
    const {gravity, ballSize, bounciness, maxBalls, flat} = this.options;
    this.world.gravity = {x: 0, y: -gravity, z: 0};
    while (this.balls.length > maxBalls) this.removeBall(this.balls[0]);
    this.balls.forEach((ball) => {
      ball.collider.setRadius(ballSize);
      ball.collider.setRestitution(bounciness);
      if (flat) {
        const p = ball.body.translation();
        ball.body.setTranslation({x: p.x, y: p.y, z: 0}, true);
      }
      ball.body.setEnabledTranslations(true, true, !flat, true);
      ball.body.wakeUp();
    });
  }

  /**
   * Where a dancer's limbs are now.
   * @param key Anything that identifies this dancer.
   * @param {Array<{a, b, radius}>|null} segments Limb ends and thickness, in
   *     world units. Null takes the dancer out of the physics.
   */
  setDancer(key, segments) {
    let dancer = this.dancers.get(key);
    if (!segments) {
      if (dancer) this.setDancerEnabled(dancer, false);
      return;
    }
    if (!dancer) {
      dancer = {limbs: segments.map(() => this.createLimb()), enabled: false};
      this.dancers.set(key, dancer);
    }
    segments.forEach((segment, i) => {
      dancer.limbs[i].radius = segment.radius;
      dancer.limbs[i].to = this.limbPose(segment);
    });
    if (!dancer.enabled) {
      // Appearing: go straight there. A kinematic move would count as a very
      // fast swing and fling whatever is nearby.
      this.setDancerEnabled(dancer, true);
      dancer.limbs.forEach((limb) => {
        limb.from = limb.to;
        limb.body.setTranslation(limb.to.center, true);
        limb.body.setRotation(limb.to.rotation, true);
        limb.collider.setHalfHeight(limb.to.halfHeight);
        limb.collider.setRadius(limb.radius);
      });
    }
  }

  createLimb() {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const collider = this.world.createCollider(
        RAPIER.ColliderDesc.capsule(0.1, 0.05).setRestitution(0.5).setFriction(0.3), body);
    this.dancerColliders.add(collider.handle);
    return {body, collider, radius: 0.05, from: null, to: null};
  }

  setDancerEnabled(dancer, enabled) {
    if (dancer.enabled === enabled) return;
    dancer.enabled = enabled;
    dancer.limbs.forEach((limb) => limb.body.setEnabled(enabled));
  }

  limbPose({a, b}) {
    const depth = this.options.flat ? 0 : 1;
    const start = new Vector3(a.x, a.y, a.z * depth);
    const end = new Vector3(b.x, b.y, b.z * depth);
    const axis = end.clone().sub(start);
    const length = axis.length();
    return {
      center: start.add(end).multiplyScalar(0.5),
      rotation: length > 1e-5 ?
          new Quaternion().setFromUnitVectors(CAPSULE_AXIS, axis.divideScalar(length)) :
          new Quaternion(),
      halfHeight: Math.max(0.001, length / 2),
    };
  }

  /** Runs the physics for `dt` seconds of show time. */
  step(dt) {
    this.leftover = Math.min(this.leftover + dt, STEP * MAX_STEPS_PER_FRAME);
    const steps = Math.floor(this.leftover / STEP);
    this.leftover -= steps * STEP;
    for (let i = 1; i <= steps; i++) {
      this.moveDancers(i / steps);
      this.world.step(this.events);
      this.events.drainCollisionEvents((one, two, started) => {
        if (started && (this.dancerColliders.has(one) || this.dancerColliders.has(two))) {
          this.hits++;
          const ball = this.balls.find((b) => b.collider.handle === one || b.collider.handle === two);
          if (ball) ball.flash = 1;
        }
      });
    }
    if (steps) {
      this.dancers.forEach((dancer) => {
        if (dancer.enabled) dancer.limbs.forEach((limb) => {
          limb.from = limb.to;
        });
      });
      this.limitSpeeds();
    }
    this.balls.forEach((ball) => {
      ball.flash = Math.max(0, ball.flash - dt * 2.5);
    });
  }

  // The pose updates once a frame and physics steps more often, so a limb moves
  // part of the way each step. It would otherwise make the whole move in the
  // first step, at several times its real speed.
  moveDancers(progress) {
    this.dancers.forEach((dancer) => {
      if (!dancer.enabled) return;
      dancer.limbs.forEach((limb) => {
        const {from, to} = limb;
        limb.body.setNextKinematicTranslation(new Vector3().lerpVectors(from.center, to.center, progress));
        limb.body.setNextKinematicRotation(new Quaternion().slerpQuaternions(from.rotation, to.rotation, progress));
        limb.collider.setHalfHeight(from.halfHeight + (to.halfHeight - from.halfHeight) * progress);
        limb.collider.setRadius(limb.radius);
      });
    });
  }

  limitSpeeds() {
    this.balls.forEach((ball) => {
      const v = ball.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed > MAX_BALL_SPEED) {
        const k = MAX_BALL_SPEED / speed;
        ball.body.setLinvel({x: v.x * k, y: v.y * k, z: v.z * k}, true);
      }
    });
  }
}
