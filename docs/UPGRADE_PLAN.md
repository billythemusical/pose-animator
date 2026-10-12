# Halloween 2026 Upgrade Plan

Goal: rear-project dancing skeletons onto a sheet in the garage, one skeleton
per trick-or-treater, running smoothly on the show laptop.

**How to use this file:** it's the progress tracker. Tick a box when its
**Done when** check passes on the real setup, not just when the code is
written. Add a dated line to the [Log](#log) when you finish a phase or make
a decision. Phases are in order; each one leaves the app working.

| Phase | What | Status |
|---|---|---|
| 0 | Clean up the build and dependencies | ✅ Done |
| 1 | Swap PoseNet for a modern pose model | ☐ Not started |
| 2 | Show setup: projection, mirroring, framing | ☐ Not started |
| 3 | Multiple bodies (same character) | ☐ Not started |
| 4 | Multiple characters (stretch) | ☐ Not started |
| 5 | Faces on (optional) | ☐ Not started |

Show date: **Sat Oct 31, 2026.** Phases 0–3 are the target; 4 and 5 are
bonuses.

---

## Where things stand

- **Model:** PoseNet MobileNetV1 at `inputResolution: 200` on a 300×300
  camera feed (`camera.js:107-111`). It decodes in multi-person mode but with
  `maxDetections: 1` (`camera.js:188-194`), and only `poses[0]` is ever drawn
  (`camera.js:219-230`).
- **One body:** there's one global `illustration`, which holds one
  `Skeleton`. The skeleton smooths each joint against the previous frame
  (`skeleton.js:531-548`), so it assumes the same person every frame.
- **Build:** Parcel 1 and Babel 6, both from around 2018. The working tree
  has a mismatched dependency: `@tensorflow/tfjs-backend-cpu@^4.12` sits next
  to `tfjs-core@^1.7`, and `package-lock.json` is staged for deletion. That
  needs fixing before anything else.
- **Faces:** `@tensorflow-models/facemesh@0.0.1` is off by default (the
  `detectFaces` toggle). `face-api.js` is installed but never used.
- **Canvas:** a 300×300 video is stretched onto an 800×1600 canvas, which
  scales width ×2.67 and height ×5.33 (`camera.js:242-245`). Squashing the
  frame like this won't work once several people stand side by side.

---

## Phase 0: Build and dependency cleanup

Modern TF.js and MediaPipe packages won't bundle under Parcel 1 or Babel 6.

- [x] Choose one package manager: keep `yarn.lock`, drop `package-lock.json`
      (it's already staged for deletion).
- [x] Replace `parcel-bundler` and the Babel 6 packages with **Vite**. Make
      `index.html` the entry, load `camera.js` as `type="module"`, and remove
      `babel-polyfill`.
- [x] Remove unused dependencies: `face-api.js` and the stray
      `tfjs-backend-cpu`. (`tfjs-converter` stays until Phase 1, because
      PoseNet needs it.)
- [x] Fix the stray `</cavnas>` typo in `index.html:135`.
- [x] Move `dat.gui` to `dependencies` (the app imports it at runtime), or
      replace it with `lil-gui`, which works as a drop-in.

- [x] Replace `Array#flatten` (which only existed through `babel-polyfill`)
      with `Array#flat` in `skeleton.js`.
- [x] **Live check:** run `yarn dev` and dance in front of the webcam.

**Done when:** `yarn dev` serves the *current* PoseNet app with no errors and
the skeleton dances exactly as before.

---

## Phase 1: Pose model upgrade

**Recommendation: MediaPipe Pose Landmarker** (`@mediapipe/tasks-vision`,
`pose_landmarker_lite` model, GPU delegate, `runningMode: 'VIDEO'`).

Why this model:
- It's maintained. `tasks-vision` is still getting releases, while
  `@tensorflow-models/pose-detection` (MoveNet and BlazePose) hasn't shipped
  since 2023 and `posenet` is long deprecated.
- `numPoses` gives multi-person detection, which Phase 3 needs.
- It's much more accurate than PoseNet, especially on limbs and partly hidden
  joints, and it runs comfortably at 30+ fps on a laptop GPU.
- The same package includes **Face Landmarker**, which uses the same mesh
  indices that `facePartName2Index` already depends on. That makes Phase 5
  cheap and lets us drop TF.js entirely.

**Fallback:** MoveNet MultiPose Lightning, through `pose-detection`. It costs
the same no matter how many people are in frame and has built-in tracking
IDs, but the package is stale. Switch to it only if the benchmark below fails.

The rest of the app reads PoseNet's format (`{keypoints: [{part, position:
{x, y}, score}], score}`), so the plan is a **small adapter** that converts
the new model's output into that shape. With the adapter in place,
`skeleton.js` and `illustration.js` don't change.

- [ ] Create `pose/poseDetector.js` with an `init()` function and a
      `detect(video, timestampMs) → poses[]` function.
- [ ] Create `pose/toPoseNetFormat.js` to map MediaPipe landmarks to PoseNet
      part names. Landmarks are normalized 0–1, so multiply by the video
      size. Use `visibility` as the `score`, and use the mean visibility of
      the 13 joints we read as the pose `score`.
      Index map: 0 nose, 7 leftEar, 8 rightEar, 11/12 shoulders, 13/14
      elbows, 15/16 wrists, 23/24 hips, 25/26 knees, 27/28 ankles. Odd
      indices are left.
- [ ] Mirroring: MediaPipe has no `flipHorizontal` option, so flip x in the
      adapter (`x = width - x`) and keep the existing `Skeleton.flipPose`
      call. Check left and right with one raised arm.
- [ ] Raise the camera from 300×300 to 640×480 or 1280×720 (use whatever the
      webcam gives natively).
- [ ] Guard `updatePoseParts` against `0/0`. If both the old and new score
      are 0, the blend weights come out as `NaN` (`skeleton.js:536-537`).
- [ ] **Benchmark on the show laptop** with 1, 2 and 4 people in frame. Write
      the fps for each in the Log.

**Done when:** one person dances, the skeleton tracks them visibly better
than PoseNet did, and fps with 4 people stays at 24 or above. If 4 people
drops below 24 fps, try MoveNet MultiPose before moving on.

---

## Phase 2: Show setup (projector behind a sheet)

- [ ] **Mirror toggle for rear projection.** Viewers on the far side of the
      sheet see the image flipped left to right. Add a GUI toggle that
      applies `scale(-1, 1)` to the illustration canvas, so a kid raising
      their right hand sees the skeleton's hand go up on their right.
- [ ] **Camera placement note.** The camera has to see the trick-or-treaters,
      and it can't see through the sheet. Mount it at the side or top edge of
      the sheet, angled at the porch. Then add a GUI "crop/zoom" control so
      the area people actually stand in fills the projection.
- [ ] Draw the canvas at the projector's resolution and at the camera's
      aspect ratio, so the image is no longer stretched. Add a fullscreen key
      (`f`).
- [ ] Make the background pure black (`#000`), not `background.png`. Black
      means no light on the sheet, so only the bones glow.
- [ ] Turn off debug overlays and hide the FPS meter in show mode (key `d`).
- [ ] Optional idle behavior: when nobody is in frame, show a "come dance!"
      prompt or a looping recorded skeleton.

**Done when:** standing on the street side of the sheet, a raised right hand
shows up on the viewer's right, nothing is stretched, and only the skeleton
is lit.

---

## Phase 3: Multiple bodies (same character)

### Design

The core problem is **identity**. Each `Skeleton` blends against its
previous frame. If person A's pose goes to person B's skeleton on the next
frame, the bones will jump and smear between them. So each person needs a
stable ID across frames, and a skeleton of their own.

```
camera frame
   └─▶ detector.detect()            → poses[] (unordered, any count)
         └─▶ tracker.update(poses)  → [{id, pose}]   ← stable IDs
               └─▶ cast.sync(ids)   → one PoseIllustration per id
                     └─▶ for each: flipPose → updateSkeleton → draw
```

- **Tracker** (`pose/tracker.js`, about 60 lines). Match each new pose to an
  existing track using the distance between torso centers (the mean of the
  shoulders and hips), and only accept a match within a maximum distance.
  Unmatched poses become new tracks. A track that goes unmatched for N
  frames (around 15, half a second) is dropped. MoveNet would provide IDs,
  but MediaPipe doesn't, so we write this ourselves.
- **Cast** (`illustrationGen/cast.js`). Replaces the global `illustration`
  and keeps `Map<trackId, PoseIllustration>`. Parse the SVG **once** into an
  `svgScope` and keep it as the template. For each new ID, build a fresh
  `new Skeleton(svgScope)` and `new PoseIllustration(canvasScope)`, then
  `bindSkeleton`. Each skeleton has its own joint state, so people can't
  disturb each other.
  - Check that building several `Skeleton`s from one `svgScope` doesn't share
    mutable objects. `getKeyPointFromSVG` creates new objects, and so does
    `bindGroup`. If anything does turn out to be shared, re-import the SVG
    for each person instead. That's slower to spawn, but always safe.
  - Binding costs a few milliseconds per character. Pre-build a pool of
    `maxPeople` skeletons at startup so that a new kid walking up doesn't
    cause a stutter.
- **Draw order:** keep `canvasScope.project.clear()` and draw each
  illustration into the active layer. The existing layer scale already
  applies to all of them.
- **GUI:** add `maxPeople` (1–6, default 4), which maps to the detector's
  `numPoses`. Also add a "min pose confidence" slider, so people walking past
  in the background don't get skeletons.
- **Nice to have:** fade a skeleton in over about 10 frames when it appears
  and out when it disappears, instead of popping.

### Tasks
- [ ] `pose/tracker.js` with stable IDs, plus a unit test using hand-made
      pose arrays (two people swap order in the array; their IDs should
      stay the same).
- [ ] `illustrationGen/cast.js` with spawn, update and despawn, plus a
      prebuilt pool.
- [ ] Rewire `detectPoseInRealTime` to run through detector → tracker → cast.
- [ ] Make the debug overlay color each person's keypoints by track ID.
- [ ] `maxPeople` and confidence controls in the GUI.

**Done when:** 3 people dance at once, each with their own skeleton. Two
people crossing paths get their own skeletons back afterwards, and someone
leaving the frame makes their skeleton disappear within about half a second.

---

## Phase 4 (stretch): Multiple characters

- [ ] Turn `avatarSvgs` into a **roster**: the default bones plus any SVG you
      drag and drop (this replaces the current behavior, where a drop swaps
      out the single character).
- [ ] Cast assigns characters per track ID, either rotating through the
      roster or picking at random (a GUI choice). Keep one parsed template
      per roster entry.
- [ ] Draw 2–3 Halloween characters in Illustrator using the template rules
      in [HOW_IT_WORKS.md](HOW_IT_WORKS.md#making-a-new-character-in-illustrator):
      for example bones, a ghost, a pumpkin-head.
- [ ] Optional: give each character its own color palette, so two "bones"
      skeletons can still be told apart.

**Done when:** two people in frame get two different characters, and those
characters don't swap when the people cross paths.

---

## Phase 5 (optional): Faces

Behind a sheet, with masks and costumes, face tracking will often fail. The
current fallback already infers the skull from the ear positions. Only do
this phase if Phases 0–3 are solid.

- [ ] Replace `facemesh@0.0.1` with MediaPipe **Face Landmarker**
      (`numFaces = maxPeople`). Its landmark indices 0–467 match what
      `facePartName2Index` expects.
- [ ] Match each face to a body: give a face to the track whose nose (or ear
      midpoint) is nearest the face's nose landmark.
- [ ] Run face detection every other frame if fps suffers.

---

## Log

Add a dated line for each decision, benchmark or finished phase.

- 2026-10-11: Plan written. Recommended MediaPipe Pose Landmarker over
  MoveNet and PoseNet. Phases 0–3 are the target for Oct 31.
- 2026-10-11: Phase 0 code done. Moved to Vite 6.4: Vite 7 and later need
  Node 20.19+, and this machine has 20.9. Upgrading Node would allow a newer
  Vite but isn't needed. `yarn build` is clean. A headless Chrome smoke test
  with a fake camera loads both models and the SVG with no errors. Still
  needs a live webcam check.
- 2026-10-12: Phase 0 live check passed. **Baseline: about 19 fps** with
  PoseNet and face detection off.
