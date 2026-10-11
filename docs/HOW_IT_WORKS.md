# How the skeleton animation works

This app is a fork of Google's Pose Animator. It uses a technique from 3D
animation called **skeletal rigging with linear blend skinning**, applied to
a flat 2D SVG. Here's the whole process, from the Illustrator file to the
pixels on the sheet.

## 1. The SVG has two parts

Open `resources/samples/my-bones-5-white.svg` and you'll find two top-level
groups (layers in Illustrator):

| Group | What's in it | What it's for |
|---|---|---|
| `skeleton` (exported as `skeleton_1_`) | 82 tiny shapes, each **named** after a joint: `leftShoulder`, `rightKnee`, `nose3`, `leftJaw4`, and so on | Marks where each joint sits in the drawing. Only the *center* of each shape matters; the shape itself is never drawn. |
| `illustration` | The actual artwork: bone paths, skull, ribs | The part that gets drawn and deformed. |

The code finds these groups **by name prefix**:

- `SVGUtils.findFirstItemWithPrefix(project, 'skeleton')` finds the skeleton
  group. That's why Illustrator's `_1_` suffix on the name doesn't break
  anything.
- `bindSkeleton` takes every item whose parent's name starts with
  `illustration`.

The names are the contract between your drawing and the code. Rename a
layer in Illustrator and that joint silently stops working.

## 2. Joints become bones (`Skeleton` constructor, `skeleton.js`)

When the SVG loads, `Skeleton` reads the center point of each named joint
shape. That gives the **rest pose**, the pose the drawing was made in. It
then joins pairs of joints into **bones** (`leftShoulder→leftElbow`,
`nose3→nose4`, …) and sorts the bones into groups: `torso`, `leftArm`,
`rightArm`, `leftLeg`, `rightLeg`, `face`.

It also records the total length of all body bones and of all face bones in
the rest pose. Later, comparing those lengths with the live ones tells the
code how close to the camera you are, so it can scale the drawing.

## 3. Binding: attaching artwork to bones (`PoseIllustration.bindSkeleton`)

This step runs once at load time. Every path in the illustration is a series
of Bézier segments, and each segment has an anchor point and up to two
handles. For **every anchor and every handle**, the code does this:

1. **Pick a bone group.** `findBoneGroup` finds the group (arm, leg, torso,
   face) with a bone closest to the point. So a point on the forearm drawing
   is controlled only by the arm bones, and the torso never pulls on it.
2. **Weight the bones.** For each bone in that group, the weight is
   `1 / distance²`, and the weights are then scaled to add up to 1. A point
   near the elbow gets roughly half its movement from the upper arm and half
   from the forearm, which is why joints bend smoothly instead of tearing.
3. **Record the offset.** `Bone.getPointTransform` stores where the point
   sits *relative to the bone*: how far along it (`anchorPerc`, from 0 to 1)
   and how far off to the side (an x/y offset in the bone's own direction).
   That offset stays fixed from then on.

If two handles lie on a straight line through their anchor, all three share
the anchor's weights, so smooth curves stay smooth after bending.

**Secondary bones.** If a *subgroup* inside `illustration` contains its own
joint-named markers, its paths are bound only to a private copy of those
bones (`bindGroup`). Use this when a piece should move stiffly with one body
part instead of blending with the bones around it.

## 4. Every frame: pose in, drawing out (`camera.js` → `updateSkeleton` → `draw`)

1. **PoseNet** looks at the camera frame and returns 17 keypoints, each with
   x, y and a confidence score.
2. `Skeleton.flipPose` swaps left and right names to match the mirrored
   display.
3. `Skeleton.updatePoseParts` **smooths** each joint by blending the new
   position with last frame's, weighted by confidence. Shaky, low-confidence
   detections move the joint less. (This is why multiple bodies need
   tracking: the blend assumes the same person as last frame.)
4. `updateFaceParts` places the face joints. With face detection off (the
   default), the whole face rig is positioned from the two **ear** keypoints.
   That's why the skull still turns and scales without facemesh.
5. Every bone gets its live position. The live total bone length divided by
   the rest-pose total gives the scale, so you get bigger as you walk toward
   the camera.
6. For every anchor and handle, the code computes each bone's suggested
   position (the bone's live position plus the stored offset, times the
   scale), then takes the **weighted average** of those suggestions. That
   average is linear blend skinning.
7. A path is skipped if its average confidence is below 0.3
   (`MIN_CONFIDENCE_PATH_SCORE`). That's why a forearm disappears when your
   arm leaves the frame.
8. paper.js rebuilds the paths from the new points, and the layer is scaled
   up to the canvas size.

Turn on **Debug control → showIllustrationDebug** to watch this happen. Each
point is colored by the bones influencing it, and blue lines run from each
point to its anchor spots on the bones.

## Making a new character in Illustrator

1. Start from `resources/samples/skeleton.svg` (the template) or your bones
   file. **Keep the `skeleton` layer exactly as it is.** You can move joint
   markers to fit your character, but don't rename or delete any; the code
   expects all 82.
2. Draw on a layer named `illustration`. Draw the character in the **same
   pose as the joint markers** (arms slightly out works best), because
   binding happens in that pose.
3. Keep the parts of each limb close to their own bones. A point is
   controlled by whichever bone group is nearest, so a sleeve drawn far from
   the arm may end up following the torso.
4. Use plain paths and basic shapes only. Text, images, gradients, clipping
   masks and compound effects aren't supported (only `Path`, `Shape` and
   `Group` are handled). Expand strokes and outline text first.
5. Export with **File → Export → Export As… → SVG**, using *Object IDs:
   Layer Names*. *Styling: Presentation Attributes* is the safest choice for
   paper.js.
6. Test the file by dragging it onto the running app, then check
   `showIllustrationDebug` to see if anything is bound to the wrong bone.
7. For projection, use light fills on a dark background. Black on the sheet
   means no light.
