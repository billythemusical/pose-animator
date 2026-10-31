# Pose Animator

Pose Animator takes a 2D vector illustration and animates its containing curves in real-time based on the recognition result from a pose model. It borrows the idea of skeleton-based animation from computer graphics and applies it to vector characters.

*This is a Halloween 2026 fork of [yemount/pose-animator](https://github.com/yemount/pose-animator), not an officially supported Google product.*

## This fork: dancing skeletons on a sheet

Dancing skeletons rear-projected onto a sheet, one per trick-or-treater. It runs in the browser on a laptop with a webcam.

- **Pose model:** MediaPipe Pose Landmarker (lite), up to 6 people, each tracked with a stable ID (`pose/tracker.js`) and given their own skeleton (`illustrationGen/cast.js`). Face detection was removed.
- **Idle sign:** "COME DANCE!" fades in when nobody has been in frame for 1.5 s.

### Run it

```sh
yarn          # install, once
yarn dev      # hot-reloading dev server; opens the show page and the control panel
yarn test     # tracker unit tests
yarn build    # production build into dist/
```

The show page (`/`) is what goes on the projector. Press `F` for fullscreen and `H` to hide the controls. The control panel (`/panel.html`) opens in its own Chrome window; drag it to your other monitor. `P` on the show page opens it again.

### Control panel

- Same controls as the show page, plus the camera view with the detected points. While a panel is open, the show page hides its own controls and fps meter.
- Panel and show page talk over a WebSocket at `/bridge`, built into the Vite server (`sync/bridgePlugin.mjs`). There is no password, so use it on a network you trust.
- On the same Wi-Fi it also works from a phone: `http://<computer name>.local:5173/panel.html`.
- **Save and undo** folder: the show page writes every change to `settings/last.json` (git-ignored) and loads it on start, so a restart comes back as you left it. **save as preset** keeps a named copy in `settings/presets/` (committed, so presets are backups); **load preset** and **delete preset** use the list. **undo last change** steps back (30 steps; a slider drag counts as one).
- A panel sends only the control you changed, and does nothing until it has the show page's settings, so a phone can't overwrite your setup with defaults.
- **Projection > camera on projector** shows the camera view under the skeletons. **Skeleton > keep on floor** puts feet on a floor line; people nearer the sheet are drawn bigger and lower, the far end fades out (**sheet is toward** says which edge of the camera view is nearest it).
- **panel camera view** (Debug control): `light` (default) sends points about 10 times a second, `live` every frame, `off` nothing. The show comes first, so drop this if fps suffers.
- "fullscreen projector window" needs one click on the projector window, because browsers require a click in the window itself. It then fills the canvas to the screen.

### Test mode

Play a recorded clip in place of the camera to try several bodies, framing and fps. Put mp4 files in `test/fixtures/` (they are git-ignored, see its README) and pick one in the panel's **Test mode** folder, or open `/?video=/api/video/<file name>`. Raise `maxPeople` to see more than one skeleton.

### Backgrounds

Drop png, jpg or webp files into `resources/backgrounds/`. They appear in the **background** list, with a fit setting (cover, stretch, tile).

### Docs

- [docs/UPGRADE_PLAN.md](docs/UPGRADE_PLAN.md): progress tracker, roadmap and dated log.
- [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md): how the skeleton animation works, and how to make a character.

<img src="/resources/gifs/avatar-new-1.gif?raw=true" alt="cameraDemo" style="width: 250px;"/>

<img src="/resources/gifs/avatar-new-full-body.gif?raw=true" alt="cameraDemo" style="width: 250px;"/>

In skeletal animation a character is represented in two parts:
1. a surface used to draw the character, and 
1. a hierarchical set of interconnected bones used to animate the surface. 

In Pose Animator, the surface is defined by the 2D vector paths in the input SVG files. For the bone structure, Pose Animator provides a predefined rig (bone hierarchy) representation, designed based on the keypoints from the pose model. This bone structure’s initial pose is specified in the input SVG file, along with the character illustration, while the real time bone positions are updated by the recognition result from ML models.

<img src="https://firebasestorage.googleapis.com/v0/b/pose-animator-demo.appspot.com/o/ml-keypoints.png?alt=media" style="width:250px;"/>

<img src="/resources/gifs/avatar-new-bezier-1.gif?raw=true" alt="cameraDemo" style="width: 250px;"/>

// TODO: Add blog post link.
For more details on its technical design please check out this blog post.

### Demo 1: [Camera feed](https://pose-animator-demo.firebaseapp.com/camera.html)

The camera demo animates a 2D avatar in real-time from a webcam video stream.


### Demo 2: [Static image](https://pose-animator-demo.firebaseapp.com/static_image.html)

The static image demo shows the avatar positioned from a single image.

## Platform support

Demos are supported on Desktop Chrome and iOS Safari.

It should also run on Chrome on Android and potentially more Android mobile browsers though support has not been tested yet.

# Animate your own design

1. Download the [sample skeleton SVG here](/resources/samples/skeleton.svg).
1. Create a new file in your vector graphics editor of choice. Copy the group named ‘skeleton’ from the above file into your working file. Note: 
	* Do not add, remove or rename the joints (circles) in this group. Pose Animator relies on these named paths to read the skeleton’s initial position. Missing joints will cause errors.
	* However you can move the joints around to embed them into your illustration. See step 4.
1. Create a new group and name it ‘illustration’, next to the ‘skeleton’ group. This is the group where you can put all the paths for your illustration.
    * Flatten all subgroups so that ‘illustration’ only contains path elements.
    * Composite paths are not supported at the moment.
    * The working file structure should look like this:
	```
        [Layer 1]
        |---- skeleton
        |---- illustration
              |---- path 1
              |---- path 2
              |---- path 3
	```
1. Embed the sample skeleton in ‘skeleton’ group into your illustration by moving the joints around.
1. Export the file as an SVG file.
1. Open [Pose Animator camera demo](https://pose-animator-demo.firebaseapp.com/camera.html). Once everything loads, drop your SVG file into the browser tab. You should be able to see it come to life :D
