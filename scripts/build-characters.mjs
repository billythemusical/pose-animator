// Builds the show's characters as GLB files in resources/models/, from plain
// shapes, so no Blender is needed. Each shape belongs wholly to one bone, which
// suits both: a skeleton's bones are rigid, and a marshmallow man's blobs just
// squash into each other at the joints. Any GLB that follows the bone contract
// in render3d/rigContract.js can replace these.
//
// Run with: node scripts/build-characters.mjs

import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  CapsuleGeometry, Color, CylinderGeometry, Euler, Matrix4, Quaternion,
  SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import {BONES} from '../render3d/rigContract.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../resources/models');

// Mirrors a right-side position to the left, for the bones that come in pairs.
function joints(center, sided) {
  const positions = {...center};
  Object.entries(sided).forEach(([name, [x, y, z]]) => {
    positions[`Left${name}`] = [x, y, z];
    positions[`Right${name}`] = [-x, y, z];
  });
  return positions;
}

class Model {
  constructor(positions) {
    this.positions = positions;
    this.boneIndex = Object.fromEntries(BONES.map(({name}, i) => [name, i]));
    this.vertices = [];
    this.normals = [];
    this.colors = [];
    this.joints = [];
    this.indices = [];
  }

  add(bone, geometry, color, matrix) {
    const first = this.vertices.length / 3;
    const rgb = new Color(color);
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const normalMatrix = new Matrix4().copy(matrix).invert().transpose();
    const p = new Vector3();
    const n = new Vector3();
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(matrix);
      n.fromBufferAttribute(normal, i).transformDirection(normalMatrix);
      this.vertices.push(p.x, p.y, p.z);
      this.normals.push(n.x, n.y, n.z);
      this.colors.push(rgb.r, rgb.g, rgb.b);
      this.joints.push(this.boneIndex[bone]);
    }
    geometry.index.array.forEach((index) => this.indices.push(first + index));
  }

  /** A squashed sphere, the marshmallow's building block. */
  blob(bone, center, radii, color, rotation = [0, 0, 0], detail = 24) {
    this.add(bone, new SphereGeometry(1, detail, Math.round(detail * 0.7)), color, new Matrix4().compose(
        new Vector3(...center),
        new Quaternion().setFromEuler(new Euler(...rotation)),
        new Vector3(...radii)));
  }

  /** A rounded bar from one point to another. */
  bar(bone, from, to, radius, color) {
    const a = new Vector3(...from);
    const b = new Vector3(...to);
    const axis = b.clone().sub(a);
    this.add(bone, new CapsuleGeometry(radius, axis.length(), 6, 12), color, new Matrix4().compose(
        a.add(b).multiplyScalar(0.5),
        new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.normalize()),
        new Vector3(1, 1, 1)));
  }

  /** A ring lying flat, squashed to `depth` front to back. */
  ring(bone, center, radius, tube, color, depth = 1, tiltX = Math.PI / 2) {
    this.add(bone, new TorusGeometry(radius, tube, 10, 32), color, new Matrix4().compose(
        new Vector3(...center),
        new Quaternion().setFromEuler(new Euler(tiltX, 0, 0)),
        new Vector3(1, depth, 1)));
  }

  cylinder(bone, center, top, bottom, height, color) {
    this.add(bone, new CylinderGeometry(top, bottom, height, 28), color,
        new Matrix4().setPosition(...center));
  }

  /** Writes the model as a binary glTF with one skinned mesh. */
  write(path) {
    const count = this.vertices.length / 3;
    const chunks = [];
    const bufferViews = [];
    const accessors = [];
    let offset = 0;
    const addAccessor = (typed, componentType, type, target, bounds) => {
      const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
      const padding = Buffer.alloc((4 - (bytes.length % 4)) % 4);
      bufferViews.push({buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? {target} : {})});
      chunks.push(bytes, padding);
      offset += bytes.length + padding.length;
      const size = {SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16}[type];
      accessors.push({bufferView: bufferViews.length - 1, componentType, type, count: typed.length / size, ...bounds});
      return accessors.length - 1;
    };

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    this.vertices.forEach((value, i) => {
      min[i % 3] = Math.min(min[i % 3], value);
      max[i % 3] = Math.max(max[i % 3], value);
    });
    const FLOAT = 5126;
    const UBYTE = 5121;
    const UINT = 5125;
    const ARRAY_BUFFER = 34962;
    const INDEX_BUFFER = 34963;
    const jointData = new Uint8Array(count * 4);
    const weightData = new Float32Array(count * 4);
    this.joints.forEach((joint, i) => {
      jointData[i * 4] = joint;
      weightData[i * 4] = 1;
    });
    const attributes = {
      POSITION: addAccessor(new Float32Array(this.vertices), FLOAT, 'VEC3', ARRAY_BUFFER, {min, max}),
      NORMAL: addAccessor(new Float32Array(this.normals), FLOAT, 'VEC3', ARRAY_BUFFER),
      COLOR_0: addAccessor(new Float32Array(this.colors), FLOAT, 'VEC3', ARRAY_BUFFER),
      JOINTS_0: addAccessor(jointData, UBYTE, 'VEC4', ARRAY_BUFFER),
      WEIGHTS_0: addAccessor(weightData, FLOAT, 'VEC4', ARRAY_BUFFER),
    };
    const indices = addAccessor(new Uint32Array(this.indices), UINT, 'SCALAR', INDEX_BUFFER);

    // Bones sit under their parents with no rest rotation.
    const inverseBind = new Float32Array(BONES.length * 16);
    const nodes = BONES.map(({name, parent}, i) => {
      const at = this.positions[name];
      const from = parent ? this.positions[parent] : [0, 0, 0];
      new Matrix4().makeTranslation(-at[0], -at[1], -at[2]).toArray(inverseBind, i * 16);
      const children = BONES.flatMap((bone, j) => bone.parent === name ? [j] : []);
      return {
        name,
        translation: at.map((value, axis) => value - from[axis]),
        ...(children.length ? {children} : {}),
      };
    });
    const skinAccessor = addAccessor(inverseBind, FLOAT, 'MAT4');
    const meshNode = nodes.length;
    nodes.push({name: 'Body', mesh: 0, skin: 0});
    nodes.push({name: 'Character', children: [this.boneIndex.Hips, meshNode]});

    const json = {
      asset: {version: '2.0', generator: 'scripts/build-characters.mjs'},
      scene: 0,
      scenes: [{nodes: [nodes.length - 1]}],
      nodes,
      meshes: [{primitives: [{attributes, indices, material: 0}]}],
      materials: [{pbrMetallicRoughness: {metallicFactor: 0, roughnessFactor: 0.8}}],
      skins: [{joints: BONES.map((_, i) => i), inverseBindMatrices: skinAccessor, skeleton: this.boneIndex.Hips}],
      accessors,
      bufferViews,
      buffers: [{byteLength: offset}],
    };
    let jsonBytes = Buffer.from(JSON.stringify(json));
    jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
    const bin = Buffer.concat(chunks);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + bin.length, 8);
    const chunkHeader = (length, type) => {
      const bytes = Buffer.alloc(8);
      bytes.writeUInt32LE(length, 0);
      bytes.writeUInt32LE(type, 4);
      return bytes;
    };
    writeFileSync(path, Buffer.concat([
      header,
      chunkHeader(jsonBytes.length, 0x4e4f534a), jsonBytes,
      chunkHeader(bin.length, 0x004e4942), bin,
    ]));
    console.log(`${path}: ${count} vertices, ${(this.indices.length / 3) | 0} triangles`);
  }
}

// A round marshmallow man: big head, fat belly, stubby puffed limbs. Both sides
// of a limb are drawn by the same code with x flipped.
function buildMarshmallowMan() {
  const WHITE = '#fff8ec';
  const SHADE = '#f4e9d6';
  const BLUE = '#2f62b8';
  const RED = '#d8232a';
  const DARK = '#15130f';
  const m = new Model(joints({
    Hips: [0, 0.62, 0],
    Spine: [0, 0.76, 0],
    Chest: [0, 0.98, 0],
    Neck: [0, 1.18, 0],
    Head: [0, 1.24, 0],
    HeadTop: [0, 1.78, 0],
  }, {
    Shoulder: [0.12, 1.08, 0],
    UpperArm: [0.3, 1.08, 0],
    LowerArm: [0.55, 1.08, 0],
    Hand: [0.78, 1.08, 0],
    HandTip: [0.96, 1.08, 0],
    UpperLeg: [0.17, 0.58, 0],
    LowerLeg: [0.17, 0.33, 0],
    Foot: [0.17, 0.08, 0],
    Toe: [0.17, 0.0, 0.24],
  }));

  // Belly and chest, overlapping enough to hide the gap when he bends.
  m.blob('Hips', [0, 0.62, 0], [0.31, 0.2, 0.25], WHITE);
  m.blob('Spine', [0, 0.78, 0.01], [0.34, 0.24, 0.28], WHITE);
  m.blob('Chest', [0, 0.98, 0], [0.31, 0.22, 0.25], WHITE);

  // Head: a wide marshmallow with the face set into its front.
  const HEAD_Y = 1.38;
  m.blob('Head', [0, HEAD_Y, 0], [0.24, 0.21, 0.21], WHITE, undefined, 32);
  [-1, 1].forEach((s) => {
    m.blob('Head', [0.085 * s, HEAD_Y + 0.045, 0.188], [0.024, 0.03, 0.012], DARK);
    m.blob('Head', [0.15 * s, HEAD_Y - 0.03, 0.15], [0.05, 0.035, 0.03], '#ffd9cf');
  });
  // The grin: a thin arc under the nose.
  for (let i = -5; i <= 5; i++) {
    const t = i / 5;
    m.blob('Head', [t * 0.09, HEAD_Y - 0.06 - (1 - t * t) * 0.03, 0.2 - Math.abs(t) * 0.025],
        [0.012, 0.007, 0.008], DARK, undefined, 10);
  }
  m.blob('Head', [0, HEAD_Y - 0.005, 0.205], [0.016, 0.012, 0.01], '#f2c9b8', undefined, 12);

  // Sailor hat, collar and neckerchief.
  m.cylinder('Head', [0, HEAD_Y + 0.235, 0], 0.17, 0.195, 0.09, WHITE);
  m.ring('Head', [0, HEAD_Y + 0.2, 0], 0.195, 0.025, WHITE);
  m.cylinder('Head', [0, HEAD_Y + 0.25, 0], 0.173, 0.18, 0.035, BLUE);
  m.blob('Head', [0, HEAD_Y + 0.29, 0], [0.17, 0.035, 0.17], SHADE);
  m.ring('Chest', [0, 1.17, 0], 0.17, 0.045, BLUE, 1);
  m.blob('Chest', [0, 1.12, 0.17], [0.075, 0.05, 0.045], RED);
  m.add('Chest', new CylinderGeometry(0.075, 0.01, 0.17, 4), RED, new Matrix4().compose(
      new Vector3(0, 1.02, 0.235),
      new Quaternion().setFromEuler(new Euler(-0.15, Math.PI / 4, 0)),
      new Vector3(1, 1, 0.35)));

  ['Left', 'Right'].forEach((side) => {
    const s = side === 'Left' ? 1 : -1;
    // Arms: a run of fat beads.
    m.blob('Chest', [0.27 * s, 1.08, 0], [0.13, 0.13, 0.13], WHITE);
    m.blob(`${side}UpperArm`, [0.4 * s, 1.08, 0], [0.15, 0.115, 0.115], WHITE);
    m.blob(`${side}LowerArm`, [0.56 * s, 1.08, 0], [0.09, 0.1, 0.1], SHADE);
    m.blob(`${side}LowerArm`, [0.67 * s, 1.08, 0], [0.13, 0.1, 0.1], WHITE);
    // Mitten hand with a thumb.
    m.blob(`${side}Hand`, [0.86 * s, 1.08, 0], [0.11, 0.085, 0.075], WHITE);
    m.blob(`${side}Hand`, [0.82 * s, 1.14, 0.02], [0.045, 0.06, 0.04], WHITE, [0, 0, -0.5 * s]);
    // Legs.
    m.blob(`${side}UpperLeg`, [0.17 * s, 0.46, 0], [0.145, 0.17, 0.15], WHITE);
    m.blob(`${side}LowerLeg`, [0.17 * s, 0.33, 0], [0.12, 0.08, 0.12], SHADE);
    m.blob(`${side}LowerLeg`, [0.17 * s, 0.2, 0], [0.13, 0.15, 0.13], WHITE);
    // Round foot, flat on the ground.
    m.blob(`${side}Foot`, [0.17 * s, 0.075, 0.07], [0.125, 0.075, 0.18], WHITE);
  });
  return m;
}

// An original skeleton, for the second character.
function buildSkeleton() {
  const BONE = '#efe6d0';
  const DARK = '#100e0b';
  const m = new Model(joints({
    Hips: [0, 0.95, 0],
    Spine: [0, 1.05, 0],
    Chest: [0, 1.25, 0],
    Neck: [0, 1.48, 0],
    Head: [0, 1.56, 0],
    HeadTop: [0, 1.78, 0],
  }, {
    Shoulder: [0.04, 1.43, 0],
    UpperArm: [0.19, 1.43, 0],
    LowerArm: [0.47, 1.43, 0],
    Hand: [0.72, 1.43, 0],
    HandTip: [0.9, 1.43, 0],
    UpperLeg: [0.1, 0.92, 0],
    LowerLeg: [0.1, 0.5, 0],
    Foot: [0.1, 0.08, 0],
    Toe: [0.1, 0.0, 0.18],
  }));

  // Spine, ribs and pelvis.
  [[0.98, 'Hips'], [1.04, 'Hips'], [1.1, 'Spine'], [1.16, 'Spine'], [1.22, 'Spine'], [1.3, 'Chest'],
    [1.37, 'Chest'], [1.44, 'Chest'], [1.5, 'Neck']].forEach(([y, bone]) => {
    m.blob(bone, [0, y, -0.03], [0.028, 0.025, 0.028], BONE, undefined, 12);
  });
  [1.42, 1.37, 1.32, 1.27, 1.22].forEach((y, i) => {
    m.ring('Chest', [0, y, 0.02], 0.15 - Math.abs(i - 1) * 0.012, 0.012, BONE, 0.7);
  });
  m.ring('Hips', [0, 0.94, 0], 0.12, 0.03, BONE, 0.7);

  // Skull.
  m.blob('Head', [0, 1.67, 0], [0.095, 0.105, 0.11], BONE, undefined, 28);
  m.blob('Head', [0, 1.585, 0.035], [0.06, 0.035, 0.065], BONE);
  [-1, 1].forEach((s) => {
    m.blob('Head', [0.04 * s, 1.665, 0.088], [0.026, 0.03, 0.018], DARK);
  });
  m.blob('Head', [0, 1.625, 0.102], [0.012, 0.018, 0.008], DARK, undefined, 10);

  ['Left', 'Right'].forEach((side) => {
    const s = side === 'Left' ? 1 : -1;
    const limb = (bone, from, to, radius) => {
      m.bar(bone, from, to, radius, BONE);
      m.blob(bone, from, [radius * 1.5, radius * 1.5, radius * 1.5], BONE, undefined, 12);
    };
    limb(`${side}Shoulder`, [0.02 * s, 1.44, 0], [0.19 * s, 1.43, 0], 0.012);
    limb(`${side}UpperArm`, [0.19 * s, 1.43, 0], [0.47 * s, 1.43, 0], 0.016);
    limb(`${side}LowerArm`, [0.47 * s, 1.43, 0.012], [0.72 * s, 1.43, 0.012], 0.01);
    limb(`${side}LowerArm`, [0.47 * s, 1.43, -0.012], [0.72 * s, 1.43, -0.012], 0.01);
    m.blob(`${side}Hand`, [0.76 * s, 1.43, 0], [0.04, 0.012, 0.035], BONE, undefined, 12);
    [-0.03, -0.01, 0.01, 0.03].forEach((z) => {
      m.bar(`${side}Hand`, [0.79 * s, 1.43, z], [0.89 * s, 1.43, z * 1.3], 0.006, BONE);
    });
    limb(`${side}UpperLeg`, [0.1 * s, 0.92, 0], [0.1 * s, 0.5, 0], 0.024);
    limb(`${side}LowerLeg`, [0.1 * s, 0.5, 0], [0.1 * s, 0.08, 0], 0.018);
    m.blob(`${side}Foot`, [0.1 * s, 0.045, 0.06], [0.04, 0.03, 0.1], BONE, undefined, 14);
  });
  return m;
}

mkdirSync(outDir, {recursive: true});
buildMarshmallowMan().write(join(outDir, 'marshmallow-man.glb'));
buildSkeleton().write(join(outDir, 'skeleton.glb'));
