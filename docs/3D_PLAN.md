# 3D Plan

Goal: replace the flat paper.js skeleton with a rigged 3D character that
copies the dancer's pose, and bounce physics balls off it.

Branch: `3d`, forked from `halloween-2026-final`. The 2D show on
`halloween-2026` stays untouched and working.

**How to use this file:** same as the Halloween plan. Tick a box when its
**Done when** check passes on the real setup, and add a dated line to the
[Log](#log) when you finish a phase or make a decision.

## Stack

| Job | Choice | Why |
|---|---|---|
| Rendering | **Three.js** (`three`) | The default for web 3D: `SkinnedMesh`, `GLTFLoader` and lights are all built in, plenty of examples. |
| Physics | **Rapier** (`@dimforge/rapier3d-compat`) | Small, fast WASM engine with kinematic bodies and continuous collision detection, so a fast ball can't tunnel through a thin limb. Alternative: `cannon-es` (pure JS, simpler, slower). |
| Character | **glTF/GLB** with a humanoid skeleton | Authored in Blender or taken from Mixamo. Loaded with `GLTFLoader`. |
| Pose | Keep **MediaPipe Pose Landmarker** | It also returns `worldLandmarks`: 3D joint positions in meters, which the 2D adapter currently throws away. |
| Everything else | Keep | Tracker, cast, bridge, panel, settings, presets and Vite are renderer-independent. |

## What carries over

- `pose/poseDetector.js`, `pose/tracker.js`: unchanged. The detector will
  also hand back `worldLandmarks`.
- `sync/`, `panel.*`, `settings*`, the bridge and presets: unchanged. New 3D
  controls are added to the same settings tree.
- `illustrationGen/` (paper.js) is replaced by a 3D cast. Keep it on this
  branch until the 3D version matches it, then delete.

## Phases

| Phase | What | Status |
|---|---|---|
| 0 | Three.js scene on the projector page, camera and black background | ☐ |
| 1 | Load and show a rigged character | ☐ |
| 2 | Drive the rig from the pose | ☐ |
| 3 | Multiple people, ground, fades (parity with the 2D show) | ☐ |
| 4 | Physics balls | ☐ |
| 5 | Show polish | ☐ |

### Phase 0: Three.js scene

- [ ] Add `three`; create a `render3d/` folder with scene, camera, lights
      and a render loop. Keep it behind a `?3d` flag so the 2D page still
      works while this is built.
- [ ] Match the projector setup: black background, mirror for rear
      projection, fullscreen and canvas sizing from the existing settings.
- [ ] Decide camera: orthographic (closest to the flat look) or a mild
      perspective (more depth for the balls). Make it a setting.

**Done when:** `/?3d` shows a lit cube on black that mirrors and fills the
window like the 2D page.

### Phase 1: A rigged character

- [ ] Pick the character. Fastest: a free Mixamo humanoid (check the
      license for projected shows). Better: a skeleton model rigged in
      Blender with the standard humanoid bone names (hips, spine, neck,
      upper arms, forearms, thighs, shins, feet).
- [ ] Export as GLB, put it in `resources/models/`, load with `GLTFLoader`.
- [ ] Write down the bone-name contract (like the SVG layer names in
      HOW_IT_WORKS.md): which bone is which joint.
- [ ] Rest pose: a T-pose or A-pose, so bone directions are known.

**Done when:** the character stands on the floor, lit, and an idle loop or
T-pose plays.

### Phase 2: Drive the rig from the pose

The core problem: the pose gives joint **positions**, but a skinned rig
needs bone **rotations**.

- [ ] Extend the adapter to pass `worldLandmarks` (x, y, z in meters, hip
      centered) alongside the 2D points.
- [ ] For each bone, compute the rotation that takes its rest direction to
      the live direction (parent joint to child joint) with
      `Quaternion.setFromUnitVectors`, applied in the parent's space. Start
      with the arms and legs.
- [ ] Hips/root: position from the 2D tracked point, facing from the
      shoulder and hip line.
- [ ] Head and spine from nose, ears, shoulders.
- [ ] Smooth rotations with slerp (the 2D version blends by confidence;
      reuse the same idea). Low-visibility joints hold their last value.
- [ ] Depth from a single camera is the weak spot, especially from an
      overhead view. Test with the video test mode early, and have a
      fallback: use the 2D positions only and set z from limb length.
- [ ] Mirror handling for rear projection (flip x, then left and right).

**Done when:** raising either arm raises the matching arm on the 3D
character, and a dance reads as a dance without limbs flipping through the
body.

### Phase 3: Parity with the 2D show

- [ ] 3D `Cast`: one character per track ID from a prebuilt pool, with
      clones (`SkeletonUtils.clone`) so skins don't share state.
- [ ] Keep on the floor, nearer is bigger, far end fades, fade in and out
      (port `pose/ground.js` and `placementFor`).
- [ ] Camera view on the projector, idle "COME DANCE!" sign, panel
      controls, presets and undo for the new settings.
- [ ] Benchmark 1, 2 and 4 people on the show laptop and write the fps in
      the Log.

**Done when:** 3 people dance at once, each with a character, at 24 fps or
better, and the panel controls the 3D scene the way it controls the 2D one.

### Phase 4: Physics balls

- [ ] Add Rapier. Step it on a fixed timestep in the render loop.
- [ ] Floor and side walls as static bodies.
- [ ] Balls: dynamic spheres with restitution (bounce) and a little
      friction. A spawner (drip from above, or a button in the panel).
- [ ] Character colliders: a capsule per limb and the torso, each a
      **kinematic** body that follows its bone every frame
      (`setNextKinematicTranslation` / `Rotation`), so the dancer pushes
      balls around but balls can't push the dancer.
- [ ] Turn on continuous collision detection for balls so fast hits don't
      pass through thin limbs.
- [ ] Controls: ball count, size, bounciness, gravity, spawn rate, clear
      all. Cap the ball count and recycle the oldest.
- [ ] Optional: hit sounds, a color flash on contact, balls fade after a
      while.

**Done when:** a dancer can bat a ball with a hand or knee and it bounces
away, 20+ balls stay at 24 fps or better with 2 people, and nothing
tunnels through the character.

### Phase 5: Show polish

- [ ] Character looks: material, rim light or glow so it reads on the
      sheet.
- [ ] More than one character (carry over the Phase 4 roster idea).
- [ ] Merge to the main show branch once it beats the 2D version.

## Open questions

- Character source: Mixamo or a custom Blender rig? (Custom is more work
  but fits the skeleton theme and has no license worries.)
- Overhead camera depth: does the 3D pose from MediaPipe hold up looking
  straight down, or do we need to drive from 2D only?
- Orthographic or perspective for the final look?

## Log

- 2026-11-05: Halloween 2026 closed and tagged `halloween-2026-final`.
  `3d` branch started. Picked Three.js + Rapier, keeping MediaPipe for pose.
