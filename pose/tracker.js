// Gives each detected person a stable ID across frames. The detector returns
// poses in no particular order, but each Skeleton smooths against its own
// previous frame, so every person needs to keep the same skeleton.

const TORSO_PARTS = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'];

function torsoCenter(pose) {
  let x = 0;
  let y = 0;
  let n = 0;
  pose.keypoints.forEach((kp) => {
    if (TORSO_PARTS.includes(kp.part)) {
      x += kp.position.x;
      y += kp.position.y;
      n++;
    }
  });
  return n ? {x: x / n, y: y / n} : null;
}

export class PoseTracker {
  /**
   * @param {number} maxDistance How far (px) a torso may move between frames
   *     and still count as the same person.
   * @param {number} holdFrames How many frames to keep showing a person after
   *     the detector loses them. Hides one-frame dropouts.
   */
  constructor({maxDistance, holdFrames = 5}) {
    this.maxDistance = maxDistance;
    this.holdFrames = holdFrames;
    this.tracks = [];
    this.nextId = 1;
  }

  /**
   * @param {Array} poses This frame's PoseNet-format poses.
   * @return {Array<{id, pose, missed}>} Every current track. `missed` is 0
   *     for people seen this frame, or how many frames ago they were last
   *     seen (their `pose` is then the last one seen).
   */
  update(poses) {
    const detections = poses
        .map((pose) => ({pose, center: torsoCenter(pose)}))
        .filter((d) => d.center);

    // Score every track/detection pair by distance from where the track is
    // expected to be (last position plus last velocity), then match greedily,
    // closest pairs first. Velocity helps when two people cross paths.
    const pairs = [];
    this.tracks.forEach((track) => {
      const expectedX = track.center.x + track.velocity.x * (track.missed + 1);
      const expectedY = track.center.y + track.velocity.y * (track.missed + 1);
      detections.forEach((d) => {
        const distance = Math.hypot(d.center.x - expectedX, d.center.y - expectedY);
        if (distance <= this.maxDistance) {
          pairs.push({track, d, distance});
        }
      });
    });
    pairs.sort((a, b) => a.distance - b.distance);

    const matchedTracks = new Set();
    const matchedDetections = new Set();
    pairs.forEach(({track, d}) => {
      if (matchedTracks.has(track) || matchedDetections.has(d)) return;
      matchedTracks.add(track);
      matchedDetections.add(d);
      const frames = track.missed + 1;
      track.velocity = {
        x: (d.center.x - track.center.x) / frames,
        y: (d.center.y - track.center.y) / frames,
      };
      track.center = d.center;
      track.pose = d.pose;
      track.missed = 0;
    });

    this.tracks.forEach((track) => {
      if (!matchedTracks.has(track)) track.missed++;
    });
    this.tracks = this.tracks.filter((track) => track.missed <= this.holdFrames);

    detections.forEach((d) => {
      if (matchedDetections.has(d)) return;
      this.tracks.push({
        id: this.nextId++,
        center: d.center,
        velocity: {x: 0, y: 0},
        pose: d.pose,
        missed: 0,
      });
    });

    return this.tracks.map(({id, pose, missed}) => ({id, pose, missed}));
  }
}
