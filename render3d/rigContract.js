// The bone-name contract between a character model and the code, the 3D
// version of the SVG layer names in docs/HOW_IT_WORKS.md. A GLB works as a
// character when it has a skin with these bones, in a T-pose, facing +z, with
// the character's left at +x and its feet at y = 0. Rename a bone and that
// joint silently stops following the dancer. The bones don't need identity
// rest rotations, so a rig from Blender can be used as it comes.

// Parents come before children: the retargeter walks this list in order.
export const BONES = [
  {name: 'Hips', parent: null},
  {name: 'Spine', parent: 'Hips'},
  {name: 'Chest', parent: 'Spine'},
  {name: 'Neck', parent: 'Chest'},
  {name: 'Head', parent: 'Neck'},
  {name: 'HeadTop', parent: 'Head'},
  ...['Left', 'Right'].flatMap((side) => [
    {name: `${side}Shoulder`, parent: 'Chest'},
    {name: `${side}UpperArm`, parent: `${side}Shoulder`},
    {name: `${side}LowerArm`, parent: `${side}UpperArm`},
    {name: `${side}Hand`, parent: `${side}LowerArm`},
    {name: `${side}HandTip`, parent: `${side}Hand`},
    {name: `${side}UpperLeg`, parent: 'Hips'},
    {name: `${side}LowerLeg`, parent: `${side}UpperLeg`},
    {name: `${side}Foot`, parent: `${side}LowerLeg`},
    {name: `${side}Toe`, parent: `${side}Foot`},
  ]),
];

// The bones that touch the balls: [from bone, to bone, radius in meters, for a
// thin character]. Each character multiplies these by its own limbScale.
export const LIMBS = [
  ['Hips', 'Neck', 0.15],
  ['Head', 'HeadTop', 0.11],
  ...['Left', 'Right'].flatMap((side) => [
    [`${side}UpperArm`, `${side}LowerArm`, 0.05],
    [`${side}LowerArm`, `${side}HandTip`, 0.05],
    [`${side}UpperLeg`, `${side}LowerLeg`, 0.07],
    [`${side}LowerLeg`, `${side}Foot`, 0.055],
    [`${side}Foot`, `${side}Toe`, 0.05],
  ]),
];
