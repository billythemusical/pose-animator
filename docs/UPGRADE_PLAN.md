# Halloween 2026 Upgrade Plan

Goal: rear-project dancing skeletons onto a sheet in the garage, one skeleton
per trick-or-treater, running smoothly on the show laptop.

**How to use this file:** it's the progress tracker. Tick a box when its
**Done when** check passes on the real setup, not just when the code is
written. Add a dated line to the [Log](#log) when you finish a phase or make
a decision. Phases are in order; each one leaves the app working.

## Next up (top of the list)

Waypoint: tag `halloween-waypoint-1` (2026-10-24) is a known-working
state. Go back to it any time with `git checkout halloween-waypoint-1`.

- [x] **Separate control panel window** (code done; needs a try from a
      second machine). Open `/panel.html` in any browser that can reach the
      laptop. It shows the same controls as the main page, and changes go
      over a WebSocket bridge at `/bridge`, built into the Vite dev and
      preview servers (`sync/bridgePlugin.mjs`), so there's nothing extra to
      start. The main page stays the source of truth and its own controls
      keep working and following whether the panel is open or not. The bridge
      has no password, so use it on a network you trust.
- [x] **Backgrounds.** Drop png/jpg/webp files in `resources/backgrounds/`
      and they appear in the background list, with a fit setting (cover,
      stretch, tile) so images no longer tile by default.
- [x] **`yarn watch`**: dev server on the network with hot reload and no
      browser auto-open. `yarn show` builds and serves `dist/` the same way.

- [x] **Multi-body test mode** (code done, needs a look on the real setup).
      A "Test mode" folder in the controls plays a recorded clip in place of
      the camera: "play a video file..." opens a file picker, and "use
      camera" switches back. Loading `/?video=/test/fixtures/pretty-girls-walk.mp4`
      starts straight in test mode. Raise `maxPeople` to try several bodies.
      The choice isn't saved, so a reload goes back to the camera.

| Phase | What | Status |
|---|---|---|
| 0 | Clean up the build and dependencies | ✅ Done |
| 1 | Swap PoseNet for a modern pose model | ✅ Done (crowd benchmark still open) |
| 2 | Show setup: projection, mirroring, framing | ◐ Code done, needs testing on the sheet |
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

- [x] Create `pose/poseDetector.js` (`PoseDetector.create()` and
      `detect(video, w, h) → poses[]`). Pinned to `tasks-vision@1.0.1`. Uses
      the GPU delegate and falls back to CPU. Models are in `public/models`;
      the WASM is copied on postinstall, so it works offline.
- [x] Create `pose/toPoseNetFormat.js` to map MediaPipe landmarks to PoseNet
      part names. Landmarks are normalized 0–1, so multiply by the video
      size. Use `visibility` as the `score`, and use the mean visibility of
      the 13 joints we read as the pose `score`.
      Index map: 0 nose, 7 leftEar, 8 rightEar, 11/12 shoulders, 13/14
      elbows, 15/16 wrists, 23/24 hips, 25/26 knees, 27/28 ankles. Odd
      indices are left.
- [x] Mirroring: MediaPipe has no `flipHorizontal` option, so flip x in the
      adapter (`x = width - x`) and keep the existing `Skeleton.flipPose`
      call. Check left and right with one raised arm.
- [→] Raise the camera resolution. **Moved to Phase 2:** it has to change
      together with the canvas aspect ratio, or the skeleton gets stretched
      even more.
- [x] Guard `updatePoseParts` against `0/0`. If both the old and new score
      are 0, the blend weights come out as `NaN` (`skeleton.js:536-537`).
- [x] **Speed up skinning (found by profiling).** `updateSkeleton` took
      about 27 ms per frame, twice as long as pose detection: the bones SVG
      has 11,820 point-bone influences, each allocating paper.js Points.
      Bones now cache their direction once per frame. Result: 1.9 ms, with
      identical output.
- [x] **Live check:** run `yarn dev` and dance. Raise each arm and check
      that left and right match.
- [x] **Benchmark on the show laptop, 1 person:** 60 fps.
- [ ] **Benchmark with 2 and 4 people.** Use the multi-body test mode (video
      in place of the camera) instead of rounding up live people. Write the
      fps for each in the Log.

**Done when:** one person dances, the skeleton tracks them visibly better
than PoseNet did, and fps with 4 people stays at 24 or above. If 4 people
drops below 24 fps, try MoveNet MultiPose before moving on.

---

## Phase 2: Show setup (projector behind a sheet)

- [x] **Mirror toggle for rear projection.** Viewers on the far side of the
      sheet see the image flipped left to right. Add a GUI toggle that
      applies `scale(-1, 1)` to the illustration canvas, so a kid raising
      their right hand sees the skeleton's hand go up on their right.
- [ ] **Camera placement: overhead, shooting down.** The camera can't see
      through the sheet, so it hangs above the spot where people stand and
      looks straight down. Pose models are trained mostly on upright,
      side-on views, so top-down tracking may be weaker (foreshortened
      limbs, heads hiding shoulders). Test this early with a top-down video
      in the test mode, and check whether the joint mapping and smoothing
      still look right. Then add a GUI "crop/zoom" control so the area
      people actually stand in fills the projection.
- [x] Canvas size controls, plus skeleton size, stretch and position controls,
      all saved between reloads. "Fill window" plus fullscreen (`F`) sizes
      the canvas to the projector.
- [x] Use the camera's full width: it now asks for 640×360 (16:9) instead
      of a 300×300 center crop. A Camera folder offers 640×480 and
      1280×720, applied on reload. At size 1 the skeleton looks the same as
      before; lower `size` to fit people standing at the sides.
- [x] Skip the per-frame video copy unless face detection or the debug view
      needs it.
- [x] Background control (image or black). The default stays as the image
      for now. Make the background pure black (`#000`), not `background.png`. Black
      means no light on the sheet, so only the bones glow.
- [x] Hide the controls and the FPS meter for the show (key `H`).
- [ ] **"Come dance!" idle screen.** When nobody is in frame, show the
      prompt in a big, blocky, italic display font (bundle the font file in
      `public/` so it works offline). Fade it out when a body appears. A
      looping recorded skeleton is an optional extra.

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

### How we test it

Use the video test mode (see Next up) in place of the camera. Feed it a
multi-person clip, and a top-down one once the overhead camera is in
question, so tracking, crossing paths and fps can be checked repeatably
without a live crowd. Live testing on the porch comes last.

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
- 2026-10-12: Phase 1 code done. Headless Chrome with a test image as the
  fake camera:

  | | Detect | Skeleton update | Frame | FPS |
  |---|---|---|---|---|
  | Before (MediaPipe, old skinning) | 14 ms | 27 ms | 45 ms | about 22 |
  | After (MediaPipe, cached bones) | 13 ms | 1.9 ms | 18 ms | about 55 |

  Most of the fps gain comes from the skinning fix; MediaPipe's main
  benefit is accuracy. PoseNet's detection time wasn't measured separately.
  For Phase 3, the skeleton costs about 3 ms per person to update and draw,
  and MediaPipe's landmark step also runs once per detected person.
- 2026-10-12: Phase 1 live check passed, at **40–60 fps** on the show
  laptop (up from 19).
- 2026-10-12: Phase 2 controls added: Projection (mirror, canvas size, fill
  window, fullscreen, background) and Skeleton (size, stretch, offsets,
  reset), saved in localStorage. Defaults match the old 800×1600 layout.
  With mirror on, the left/right slider still follows the laptop screen.
- 2026-10-12: Camera now uses the full 16:9 view. Headless detect time per
  frame: 300×300 13 ms, **640×360 13 ms (the new default)**, 640×480 16–17 ms,
  1280×720 15 ms. Using the full width costs nothing.
- 2026-10-24: Halloween branch confirmed working; tagged
  `halloween-waypoint-1` as a safe point to return to. Added the pop-out
  control panel and the multi-body test mode to the top of the roadmap.
- 2026-10-24: Phase 1 benchmarked on the show laptop with 1 person: 60 fps.
  2 and 4 person runs will use the video test mode. Camera will be overhead,
  shooting down. "Come dance!" idle screen is now a planned item, in a big
  blocky italic font.
- 2026-10-24: Video test mode added. Headless Chrome smoke test with the
  pretty-girls-walk clip at `maxPeople` 1: tracks one person, about 28 ms
  detect and 2 ms skeleton per frame, 27-31 fps (headless, software
  rendering and a large video frame, so it says little about the show
  laptop). The file-picker button wasn't exercised headlessly.
- 2026-10-24: Control panel window, bridge, background list and `yarn
  watch` added. Headless test with a fake panel over the bridge: changed
  `maxPeople` to 4 and started the clip remotely, status came back. The
  clip is 3840x2160 and mostly wide shots: 1-2 poses per frame, 15-28 fps
  in headless Chrome, and track IDs ran past 28 in 30 s (people lost and
  re-found), so it is a rough load test and a hint that tracking needs
  looking at for small or distant bodies.
