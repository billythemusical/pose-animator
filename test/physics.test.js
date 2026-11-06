import {test, before} from 'node:test';
import assert from 'node:assert/strict';
import {Physics, initPhysics} from '../render3d/physics.js';

before(() => initPhysics());

const options = (extra = {}) => ({gravity: 9.8, ballSize: 0.1, bounciness: 0.5, maxBalls: 10, flat: true, ...extra});

function makeWorld(extra) {
  const physics = new Physics(options(extra));
  physics.setBounds({left: -2, right: 2, floor: 0});
  return physics;
}

function run(physics, seconds) {
  for (let t = 0; t < seconds; t += 1 / 60) physics.step(1 / 60);
}

test('a ball dropped from above comes to rest on the floor', () => {
  const physics = makeWorld();
  const ball = physics.spawn(0, 2);
  run(physics, 6);
  const {y} = ball.body.translation();
  assert.ok(Math.abs(y - 0.1) < 0.02, `resting on the floor, got y=${y}`);
});

test('flat balls never leave the plane of the sheet', () => {
  const physics = makeWorld();
  const ball = physics.spawn(0, 2, 0.5);
  ball.body.setLinvel({x: 1, y: 0, z: 3}, true);
  run(physics, 3);
  assert.equal(ball.body.translation().z, 0);
});

test('balls stay inside the side walls', () => {
  const physics = makeWorld({bounciness: 0.9});
  const ball = physics.spawn(0, 1);
  ball.body.setLinvel({x: 8, y: 2, z: 0}, true);
  run(physics, 5);
  assert.ok(Math.abs(ball.body.translation().x) < 2, `inside the walls, got x=${ball.body.translation().x}`);
});

test('the oldest ball is recycled past the limit', () => {
  const physics = makeWorld({maxBalls: 3});
  const ids = [1, 2, 3, 4, 5].map((i) => physics.spawn(i * 0.1, 1).id);
  assert.equal(physics.balls.length, 3);
  assert.deepEqual(physics.balls.map((b) => b.id), ids.slice(2));
});

test('a swinging limb bats a ball away and counts as a hit', () => {
  const physics = makeWorld({gravity: 0});
  const ball = physics.spawn(0.3, 1);
  // A forearm sweeping to the right through the ball.
  const forearm = (x) => [{a: {x, y: 0.8, z: 0}, b: {x, y: 1.2, z: 0}, radius: 0.06}];
  physics.setDancer('a', forearm(-0.2));
  for (let i = 0; i < 20; i++) {
    physics.setDancer('a', forearm(-0.2 + i * 0.03));
    physics.step(1 / 60);
  }
  run(physics, 0.5);
  assert.ok(physics.hits >= 1, 'a hit was counted');
  assert.ok(ball.body.translation().x > 0.5, `ball was knocked right, x=${ball.body.translation().x}`);
});

test('a ball cannot push a dancer', () => {
  const physics = makeWorld({gravity: 0});
  const ball = physics.spawn(0.5, 1);
  ball.body.setLinvel({x: -5, y: 0, z: 0}, true);
  const limb = [{a: {x: 0, y: 0.8, z: 0}, b: {x: 0, y: 1.2, z: 0}, radius: 0.06}];
  physics.setDancer('a', limb);
  run(physics, 1);
  const body = physics.dancers.get('a').limbs[0].body;
  assert.ok(Math.abs(body.translation().x) < 1e-6);
});

test('a fast ball does not tunnel through a thin limb', () => {
  const physics = makeWorld({gravity: 0, bounciness: 0.3});
  const ball = physics.spawn(1.5, 1);
  ball.body.setLinvel({x: -9, y: 0, z: 0}, true);
  physics.setDancer('a', [{a: {x: 0, y: 0.8, z: 0}, b: {x: 0, y: 1.2, z: 0}, radius: 0.02}]);
  run(physics, 1);
  assert.ok(ball.body.translation().x > 0, `bounced back, x=${ball.body.translation().x}`);
});

test('a dancer set to null stops colliding', () => {
  const physics = makeWorld({gravity: 0});
  const limb = [{a: {x: 0, y: 0.8, z: 0}, b: {x: 0, y: 1.2, z: 0}, radius: 0.1}];
  physics.setDancer('a', limb);
  physics.setDancer('a', null);
  const ball = physics.spawn(0.5, 1);
  ball.body.setLinvel({x: -3, y: 0, z: 0}, true);
  run(physics, 1);
  assert.ok(ball.body.translation().x < 0, 'passed through where the dancer was');
});
