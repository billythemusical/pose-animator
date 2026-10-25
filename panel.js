// The control panel as its own page: open /panel.html in any browser that can
// reach the laptop, on this machine or another. It holds no state of its own;
// the main page is the source of truth, and changes made here are sent to it.

import {DEFAULTS} from './settings';
import {buildControls} from './controls';
import {connectBridge} from './sync/bridgeClient';
import {applyRemoteSettings} from './sync/settingsSync';

const settings = JSON.parse(JSON.stringify(DEFAULTS));
const status = {source: '-', cameraGives: '-', fps: '-', people: '-', mainWindow: 'not connected'};
const banner = document.getElementById('banner');

let controls = null;
let bridge = null;
const send = () => bridge.send({type: 'settings', settings});

function setConnected(serverUp, mainUp) {
  status.mainWindow = mainUp ? 'connected' : 'not connected';
  banner.textContent = !serverUp ? 'Lost the server, reconnecting...' :
      mainUp ? 'Connected to the show page' : 'Waiting for the show page to open...';
  banner.classList.toggle('connected', serverUp && mainUp);
}

bridge = connectBridge('panel', (message) => {
  if (message.type === 'settings') {
    applyRemoteSettings(settings, message.settings);
    controls.refresh();
  } else if (message.type === 'status') {
    Object.assign(status, message.status);
    controls.refresh();
  } else if (message.type === 'peers') {
    setConnected(true, message.main);
    controls.refresh();
  }
}, (connected) => {
  if (!connected) setConnected(false, false);
});

controls = buildControls(settings, status, {
  isPanel: true,
  onChange: send,
  onAction: (name, value) => bridge.send({type: 'action', name, value}),
});
