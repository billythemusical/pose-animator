// The control panel as its own page: open /panel.html in any browser that can
// reach the laptop, on this machine or another. It holds no state of its own;
// the main page is the source of truth, and changes made here are sent to it.

import {DEFAULTS} from './settings';
import {buildControls} from './controls';
import {connectBridge} from './sync/bridgeClient';
import {applyRemoteSettings} from './sync/settingsSync';
import {PanelView} from './panelView';

const settings = JSON.parse(JSON.stringify(DEFAULTS));
const status = {source: '-', cameraGives: '-', fps: '-', people: '-', mainWindow: 'not connected'};
const banner = document.getElementById('banner');

let controls = null;
let view = null;
let bridge = null;
// Until the show page's settings arrive, this page only has defaults, and
// sending anything from them would overwrite the real setup.
let synced = false;

function setConnected(serverUp, mainUp) {
  status.mainWindow = mainUp ? 'connected' : 'not connected';
  banner.textContent = !serverUp ? 'Lost the server, reconnecting...' :
      mainUp ? 'Connected to the show page' : 'Waiting for the show page to open...';
  banner.classList.toggle('connected', serverUp && mainUp);
}

async function start() {
  // The clips in test/fixtures, for the test mode dropdown.
  const videos = await fetch('/api/videos').then((r) => r.json()).catch(() => []);

  view = new PanelView(
      document.getElementById('view'),
      (on) => bridge && bridge.send({type: 'wantFrames', on}));

  controls = buildControls(settings, status, {
    isPanel: true,
    videos,
    onChange: () => {
      view.setMode(settings.debug.cameraView);
      if (!synced) {
        // Don't send, and put the control back.
        settings[section][key] = DEFAULTS[section][key];
        controls.refresh();
        return;
      }
      // Send only the value that changed, never the whole set, so a stale
      // copy of the other values can't overwrite them.
      bridge.send({type: 'settings', settings: {[section]: {[key]: settings[section][key]}}});
    },
    onAction: (name, value) => bridge.send({type: 'action', name, value}),
  });

  // Connect last: messages from the show page need the controls to exist.
  bridge = connectBridge('panel', (message) => {
    if (message.type === 'settings') {
      if (message.full) synced = true;
      applyRemoteSettings(settings, message.settings);
      view.setMode(settings.debug.cameraView);
      controls.refresh();
    } else if (message.type === 'status') {
      Object.assign(status, message.status);
      view.setSource(status.source);
      controls.refresh();
    } else if (message.type === 'poses') {
      view.setPoses(message);
    } else if (message.type === 'peers') {
      setConnected(true, message.main);
      // A show page that just (re)connected needs to hear what we want.
      view.reportWantFrames(true);
      controls.refresh();
    }
  }, (connected) => {
    if (!connected) {
      synced = false;
      setConnected(false, false);
    }
  }, (frame) => view.setFrame(frame));
}

start();
