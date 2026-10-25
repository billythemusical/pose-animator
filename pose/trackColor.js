// One color per tracked person, so the same person keeps their color in the
// debug camera view.
const TRACK_COLORS = ['aqua', 'yellow', 'magenta', 'lime', 'orange', 'white'];

export function trackColor(id) {
  return TRACK_COLORS[id % TRACK_COLORS.length];
}
