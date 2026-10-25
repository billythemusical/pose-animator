// Merging settings that arrive from the other page.

/**
 * Copies every value in `incoming` into `target`, section by section, and
 * returns the [section, key] pairs whose value actually changed.
 */
export function applyRemoteSettings(target, incoming) {
  const changed = [];
  Object.keys(incoming).forEach((section) => {
    if (!target[section]) return;
    Object.keys(incoming[section]).forEach((key) => {
      if (target[section][key] !== incoming[section][key]) {
        target[section][key] = incoming[section][key];
        changed.push([section, key]);
      }
    });
  });
  return changed;
}
