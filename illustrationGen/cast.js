import { PoseIllustration } from './illustration';
import { Skeleton } from './skeleton';
import { centerX, footY, scalePose, shiftPose } from '../pose/ground';

// How long a skeleton takes to fade in or out.
const FADE_MS = 400;
// How fast placement (size and floor position) eases toward its target each
// frame, so a flickering detection doesn't make the skeleton jump.
const EASE = 0.3;

// One PoseIllustration per tracked person, all bound to the same character
// SVG. Binding an illustration means weighting every point of the SVG
// against every bone, so they're built up front in a pool and reused as
// people come and go.
export class Cast {
    constructor(scope) {
        this.scope = scope;
        this.svgScope = null;
        this.pool = [];
        this.byTrackId = new Map();
        // Per person: {alpha, shift, scale}.
        this.state = new Map();
        // Skeletons of people who just left, fading out: {illustration, alpha}.
        this.leaving = [];
        this.lastTime = null;
    }

    setCharacter(svgScope, size) {
        this.svgScope = svgScope;
        this.pool = [];
        this.byTrackId.clear();
        this.state.clear();
        this.leaving = [];
        this.resize(size);
    }

    // Number of people that can be drawn at once.
    resize(size) {
        if (!this.svgScope) {
            return;
        }
        while (this.pool.length < size) {
            let skeleton = new Skeleton(this.svgScope);
            let illustration = new PoseIllustration(this.scope);
            illustration.bindSkeleton(skeleton, this.svgScope);
            this.pool.push(illustration);
        }
        if (this.pool.length > size) {
            let removed = new Set(this.pool.splice(size));
            for (let [id, illustration] of this.byTrackId) {
                if (removed.has(illustration)) {
                    this.byTrackId.delete(id);
                    this.state.delete(id);
                }
            }
            this.leaving = this.leaving.filter(l => !removed.has(l.illustration));
        }
    }

    // tracked: output of PoseTracker.update(). face: a face frame, or null.
    // placeFor: optional (pose) => {floor, scale, presence} saying where that
    // person's feet belong (video y, or null to leave them), how big to draw
    // them, and how visible (0 to 1). null draws everyone as detected.
    update(tracked, face, placeFor = null) {
        let now = performance.now();
        let dt = this.lastTime === null ? 0 : Math.min(now - this.lastTime, 100);
        this.lastTime = now;

        // People seen this frame get priority over ones being held after a
        // dropout, and there are never more skeletons than the pool size.
        let active = tracked.slice()
            .sort((a, b) => a.missed - b.missed)
            .slice(0, this.pool.length);
        let activeIds = new Set(active.map(t => t.id));
        // Anyone who's gone keeps their skeleton on screen while it fades out.
        for (let [id, illustration] of this.byTrackId) {
            if (!activeIds.has(id)) {
                this.byTrackId.delete(id);
                let state = this.state.get(id);
                this.state.delete(id);
                this.leaving.push({illustration, alpha: state ? state.alpha : 1});
            }
        }
        this.leaving.forEach(l => l.alpha -= dt / FADE_MS);
        this.leaving = this.leaving.filter(l => l.alpha > 0);

        let inUse = new Set(this.byTrackId.values());
        let leavingSet = new Set(this.leaving.map(l => l.illustration));
        let free = this.pool.filter(illustration => !inUse.has(illustration) && !leavingSet.has(illustration));

        // Face tracking isn't matched to bodies yet, so only use it when
        // there's exactly one person.
        let faceFor = active.length === 1 ? face : null;
        active.forEach(({id, pose, missed}) => {
            let illustration = this.byTrackId.get(id);
            if (!illustration) {
                // With every skeleton busy, take over the one fading out longest.
                illustration = free.shift() || this.leaving.shift().illustration;
                // Don't blend the new person with whoever used this skeleton last.
                illustration.skeleton.reset();
                this.byTrackId.set(id, illustration);
                this.state.set(id, {alpha: 0, shift: undefined, scale: undefined});
            }
            // Held people keep their last drawn pose.
            if (missed === 0) {
                let state = this.state.get(id);
                let placement = placeFor ? placeFor(pose) : null;
                let target = placement ? placement.presence : 1;
                state.alpha += Math.max(-dt / FADE_MS, Math.min(dt / FADE_MS, target - state.alpha));
                illustration.updateSkeleton(placement ? this.placed(state, pose, placement) : pose, faceFor);
            }
        });
    }

    // The pose resized and moved so its feet are on the floor, eased over
    // frames through `state`.
    placed(state, pose, placement) {
        let feet = footY(pose);
        let x = centerX(pose);
        if (feet === null || x === null) {
            return pose;
        }
        let ease = (previous, target) => previous === undefined ? target : previous + (target - previous) * EASE;
        state.scale = ease(state.scale, placement.scale);
        let sized = scalePose(pose, state.scale, x, feet);
        if (placement.floor === null) {
            return sized;
        }
        state.shift = ease(state.shift, placement.floor - feet);
        return shiftPose(sized, state.shift);
    }

    draw(debug) {
        for (let [id, illustration] of this.byTrackId) {
            illustration.draw(this.state.get(id).alpha);
            if (debug) {
                illustration.debugDraw();
            }
        }
        this.leaving.forEach(({illustration, alpha}) => illustration.draw(alpha));
    }
}
