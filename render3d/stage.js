// The 3D scene on the projector page: renderer, camera, lights, the balls and
// the physics that moves them. The characters are drawn by Cast3D, which adds
// itself to `stage.scene`.
//
// World units are meters. The sheet is the plane z = 0, with the view centered
// on the origin, x to the right and y up.

import {
  AmbientLight, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial,
  OrthographicCamera, PerspectiveCamera, Scene, SphereGeometry, WebGLRenderer, Color,
} from 'three';
import {Physics, initPhysics} from './physics.js';

const CAMERA_DISTANCE = 8;
const DROP_BALLS = 5;
const BALL_COLORS = ['#ff7a59', '#ffd23f', '#3bceac', '#4ea8de', '#c77dff', '#ffffff'];

export class Stage {
  /**
   * @param canvas The canvas to draw on.
   * @param settings The shared settings (reads stage3d, balls, projection, skeleton).
   */
  constructor(canvas, settings) {
    this.settings = settings;
    // Transparent, so the page's background image shows through like it does
    // behind the 2D skeletons.
    this.renderer = new WebGLRenderer({canvas, antialias: true, alpha: true});
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new Scene();
    this.scene.add(new HemisphereLight(0xffffff, 0x8a8f9c, 1.6));
    this.scene.add(new AmbientLight(0xffffff, 0.35));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(-2, 4, 6);
    this.scene.add(key);
    // A cool rim from behind, so a white character reads against the sheet.
    const rim = new DirectionalLight(0x9fc4ff, 1.4);
    rim.position.set(2, 3, -5);
    this.scene.add(rim);

    this.ballGeometry = new SphereGeometry(1, 24, 16);
    this.ballMeshes = new Map();
    this.physics = null;
    this.spawnCarry = 0;
    this.lastLimbKeys = new Set();
    this.camera = null;
    this.applyView();

    // Rapier is WebAssembly and has to load first. Everything else works
    // without it, so the characters show while it loads.
    initPhysics().then(() => {
      this.physics = new Physics(settings.balls);
      this.applyBounds();
    });
  }

  get aspect() {
    const {canvasWidth, canvasHeight} = this.settings.projection;
    return canvasWidth / canvasHeight;
  }

  get viewWidth() {
    return this.settings.stage3d.viewHeight * this.aspect;
  }

  /** Call when the canvas size, the camera or the view height changes. */
  applyView() {
    const {canvasWidth, canvasHeight} = this.settings.projection;
    const {camera, viewHeight} = this.settings.stage3d;
    this.renderer.setSize(canvasWidth, canvasHeight);
    if (camera === 'orthographic') {
      const halfHeight = viewHeight / 2;
      const halfWidth = halfHeight * this.aspect;
      this.camera = new OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 50);
    } else {
      // Aimed so the plane of the sheet shows exactly viewHeight tall, the same
      // framing as the orthographic camera; things off the plane get perspective.
      const fov = 2 * Math.atan(viewHeight / 2 / CAMERA_DISTANCE) * (180 / Math.PI);
      this.camera = new PerspectiveCamera(fov, this.aspect, 0.1, 50);
    }
    this.camera.position.set(0, 0, CAMERA_DISTANCE);
    this.applyBounds();
  }

  /** The floor line and the sides of the view become the floor and walls. */
  applyBounds() {
    if (!this.physics) return;
    const half = this.viewWidth / 2;
    this.physics.setBounds({
      left: -half,
      right: half,
      floor: this.floorY(),
    });
  }

  /** World y of the floor line, from the same setting that places the dancers. */
  floorY() {
    const {floorLine} = this.settings.skeleton;
    return (0.5 - floorLine / 100) * this.settings.stage3d.viewHeight;
  }

  /** Canvas pixels (the 2D show's coordinates) to world meters on the sheet. */
  canvasToWorld(x, y) {
    const {canvasWidth, canvasHeight} = this.settings.projection;
    const perPixel = this.settings.stage3d.viewHeight / canvasHeight;
    return {x: (x - canvasWidth / 2) * perPixel, y: (canvasHeight / 2 - y) * perPixel};
  }

  /** Call when any of the balls settings changed. */
  applyBallOptions() {
    if (!this.physics) return;
    this.physics.applyOptions();
    if (!this.settings.balls.enabled) this.clearBalls();
  }

  dropBalls() {
    if (!this.physics) return;
    for (let i = 0; i < DROP_BALLS; i++) this.spawnBall();
  }

  clearBalls() {
    if (this.physics) this.physics.clear();
  }

  spawnBall() {
    const {ballSize} = this.settings.balls;
    const half = this.viewWidth / 2 - ballSize * 2;
    const top = this.settings.stage3d.viewHeight / 2 + ballSize * 2;
    this.physics.spawn((Math.random() * 2 - 1) * half, top + Math.random() * 0.4, 0);
  }

  /**
   * Moves the dancers into the physics, steps it, and draws the balls.
   * @param {Map<id, Array|null>} limbs From Cast3D.limbs().
   * @param {number} dt Seconds since the last frame.
   */
  update(limbs, dt) {
    const physics = this.physics;
    if (!physics) return;
    const {enabled, spawnRate} = this.settings.balls;
    if (enabled) {
      this.spawnCarry += dt * spawnRate;
      while (this.spawnCarry >= 1) {
        this.spawnCarry -= 1;
        this.spawnBall();
      }
    }
    limbs.forEach((segments, id) => physics.setDancer(id, segments));
    // People who are gone take their bodies with them.
    this.lastLimbKeys.forEach((id) => !limbs.has(id) && physics.removeDancer(id));
    this.lastLimbKeys = new Set(limbs.keys());

    physics.step(dt);
    this.syncBalls();
  }

  syncBalls() {
    const seen = new Set();
    const {ballSize} = this.settings.balls;
    this.physics.balls.forEach((ball) => {
      seen.add(ball.id);
      let mesh = this.ballMeshes.get(ball.id);
      if (!mesh) {
        mesh = new Mesh(this.ballGeometry, new MeshStandardMaterial({
          color: new Color(BALL_COLORS[ball.id % BALL_COLORS.length]),
          roughness: 0.35,
          emissive: new Color(0xffffff),
          emissiveIntensity: 0,
        }));
        this.scene.add(mesh);
        this.ballMeshes.set(ball.id, mesh);
      }
      const p = ball.body.translation();
      mesh.position.set(p.x, p.y, p.z);
      mesh.scale.setScalar(ballSize);
      // A ball lights up for a moment when a dancer hits it.
      mesh.material.emissiveIntensity = ball.flash * 0.9;
    });
    this.ballMeshes.forEach((mesh, id) => {
      if (seen.has(id)) return;
      this.scene.remove(mesh);
      mesh.material.dispose();
      this.ballMeshes.delete(id);
    });
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
