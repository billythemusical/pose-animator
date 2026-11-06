// What the show knows about each character model beyond its bones.
//
// limbScale multiplies the ball-collider radii in rigContract.js LIMBS, which
// are for a thin character. A marshmallow man is fat, so his limbs hit balls
// further out; a skeleton's bones are thin.

export const CHARACTERS = {
  'marshmallow-man': {limbScale: 1.8},
  'skeleton': {limbScale: 1},
};

export const CHARACTER_NAMES = Object.keys(CHARACTERS);

// The models are built by scripts/build-characters.mjs. The marshmallow man is
// kept out of git, so a fresh checkout has only the skeleton until it's run.
const urls = import.meta.glob('../resources/models/*.glb', {query: '?url', import: 'default', eager: true});

/** The URL of a character's model, or the skeleton's if that one isn't built. */
export function modelUrl(name) {
  return urls[`../resources/models/${name}.glb`] || urls['../resources/models/skeleton.glb'];
}
