import { PoseIllustration } from './illustration';
import { Skeleton } from './skeleton';

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
    }

    setCharacter(svgScope, size) {
        this.svgScope = svgScope;
        this.pool = [];
        this.byTrackId.clear();
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
                }
            }
        }
    }

    // tracked: output of PoseTracker.update(). face: a face frame, or null.
    update(tracked, face) {
        // People seen this frame get priority over ones being held after a
        // dropout, and there are never more skeletons than the pool size.
        let active = tracked.slice()
            .sort((a, b) => a.missed - b.missed)
            .slice(0, this.pool.length);
        let activeIds = new Set(active.map(t => t.id));
        for (let id of this.byTrackId.keys()) {
            if (!activeIds.has(id)) {
                this.byTrackId.delete(id);
            }
        }
        let inUse = new Set(this.byTrackId.values());
        let free = this.pool.filter(illustration => !inUse.has(illustration));

        // Face tracking isn't matched to bodies yet, so only use it when
        // there's exactly one person.
        let faceFor = active.length === 1 ? face : null;
        active.forEach(({id, pose, missed}) => {
            let illustration = this.byTrackId.get(id);
            if (!illustration) {
                illustration = free.shift();
                // Don't blend the new person with whoever used this skeleton last.
                illustration.skeleton.reset();
                this.byTrackId.set(id, illustration);
            }
            // Held people keep their last drawn pose.
            if (missed === 0) {
                illustration.updateSkeleton(pose, faceFor);
            }
        });
    }

    draw(debug) {
        for (let illustration of this.byTrackId.values()) {
            illustration.draw();
            if (debug) {
                illustration.debugDraw();
            }
        }
    }
}
