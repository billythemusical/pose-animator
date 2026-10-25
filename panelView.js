// The camera view in the control panel. When the show is running off the
// live camera, the panel opens that camera itself and draws the detected
// points (which are tiny) over it, so the picture is as smooth as the camera.
// When it can't (a recorded test clip, or a phone, where browsers refuse the
// camera on a plain http address), the show page sends JPEG frames instead.

import {drawKeypoints, drawSkeleton} from './utils/demoUtils';
import {trackColor} from './pose/trackColor';

const MIN_PART_CONFIDENCE = 0.1;

export class PanelView {
  /** onWantFrames(bool): tell the show page whether to send JPEG frames. */
  constructor(canvas, onWantFrames) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onWantFrames = onWantFrames;

    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.stream = null;
    this.opening = false;
    this.cameraFailed = false;
    this.wantFrames = null;
    this.mode = 'light';
    this.source = 'camera';

    this.poses = null;
    this.frame = null;
    this.decoding = false;
    this.bitmap = null;

    requestAnimationFrame(() => this.draw());
  }

  get cameraReady() {
    return this.stream !== null && this.video.readyState >= 2;
  }

  /** Called with the show page's source label ("camera", "video: ..."). */
  setSource(source) {
    this.source = source;
    if (this.mode === 'off') {
      this.stopCamera();
    } else if (source.startsWith('camera')) {
      if (!this.stream && !this.opening && !this.cameraFailed) this.startCamera();
    } else {
      this.stopCamera();
    }
    this.reportWantFrames();
  }

  /** The camera view setting: 'live', 'light' or 'off'. */
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.canvas.style.visibility = mode === 'off' ? 'hidden' : '';
    this.setSource(this.source);
  }

  /** Re-sends whether JPEG frames are wanted, e.g. after the show page reconnects. */
  reportWantFrames(force = false) {
    const want = this.stream === null && this.mode !== 'off';
    if (force || want !== this.wantFrames) {
      this.wantFrames = want;
      this.onWantFrames(want);
    }
  }

  async startCamera() {
    this.opening = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {facingMode: 'user', width: {ideal: 640}, height: {ideal: 360}},
      });
      this.video.srcObject = this.stream;
      await this.video.play();
    } catch (e) {
      console.warn(`Panel could not open the camera, using streamed frames: ${e.name}: ${e.message}`);
      this.cameraFailed = true;
      this.stopCamera();
    }
    this.opening = false;
    this.reportWantFrames();
  }

  stopCamera() {
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  setPoses(message) {
    this.poses = message;
  }

  /** Newest frame wins: frames that arrive while one is decoding replace each other. */
  async setFrame(buffer) {
    this.frame = buffer;
    if (this.decoding) return;
    this.decoding = true;
    while (this.frame) {
      const next = this.frame;
      this.frame = null;
      const bitmap = await createImageBitmap(new Blob([next], {type: 'image/jpeg'}));
      if (this.bitmap) this.bitmap.close();
      this.bitmap = bitmap;
    }
    this.decoding = false;
  }

  draw() {
    requestAnimationFrame(() => this.draw());
    const {canvas, ctx} = this;
    if (this.cameraReady) {
      const {videoWidth: w, videoHeight: h} = this.video;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      // Mirrored, the same as the show page's pose coordinates.
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(this.video, -w, 0, w, h);
      ctx.restore();
      this.drawPoses();
    } else if (this.bitmap) {
      if (canvas.width !== this.bitmap.width || canvas.height !== this.bitmap.height) {
        canvas.width = this.bitmap.width;
        canvas.height = this.bitmap.height;
      }
      ctx.drawImage(this.bitmap, 0, 0);
    }
  }

  drawPoses() {
    if (!this.poses) return;
    const scale = this.canvas.width / this.poses.width;
    this.poses.poses.forEach(({id, keypoints}) => {
      drawKeypoints(keypoints, MIN_PART_CONFIDENCE, this.ctx, scale, trackColor(id));
      drawSkeleton(keypoints, MIN_PART_CONFIDENCE, this.ctx, scale, trackColor(id));
    });
  }
}
