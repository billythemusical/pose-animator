// Loads a generated character GLB in Node, for the tests.
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';

export const modelPath = (name) => fileURLToPath(new URL(`../../resources/models/${name}.glb`, import.meta.url));

export const hasModel = (name) => existsSync(modelPath(name));

/** @return {Promise<{scene, bones: Object<string, THREE.Bone>}>} */
export async function loadCharacter(name) {
  const file = readFileSync(modelPath(name));
  const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(data, '', resolve, reject));
  const bones = {};
  gltf.scene.traverse((object) => {
    if (object.isBone) bones[object.name] = object;
  });
  return {scene: gltf.scene, bones};
}
