// Relays messages between the main (projector) page and any number of control
// panel pages over a WebSocket at /bridge. It runs inside the Vite dev and
// preview servers, so there is nothing extra to start, and a panel on another
// machine only needs the laptop's address. The server keeps no state of its
// own beyond the last settings and status message, which it replays to pages
// that connect later.

import {execFile} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {readdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {WebSocketServer, WebSocket} from 'ws';

const PATH = '/bridge';
// Message types whose most recent copy is replayed to new connections.
const REPLAYED = ['settings', 'status'];

function attach(httpServer) {
  const wss = new WebSocketServer({noServer: true});
  const latest = {};

  const broadcast = (text, except) => {
    for (const client of wss.clients) {
      if (client !== except && client.readyState === WebSocket.OPEN) client.send(text);
    }
  };
  const announcePeers = () => {
    const main = [...wss.clients].some((client) => client.role === 'main');
    if (!main) delete latest.status;
    broadcast(JSON.stringify({type: 'peers', main}));
  };

  // Only claim our own path; Vite's hot-reload socket upgrades on the same
  // server and has to be left alone.
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  wss.on('connection', (ws) => {
    ws.role = null;
    REPLAYED.forEach((type) => latest[type] && ws.send(latest[type]));

    ws.on('message', (data) => {
      const text = data.toString();
      let message;
      try {
        message = JSON.parse(text);
      } catch (e) {
        return;
      }
      if (message.type === 'hello') {
        ws.role = message.role;
        announcePeers();
        return;
      }
      if (REPLAYED.includes(message.type)) latest[message.type] = text;
      broadcast(text, ws);
    });
    ws.on('close', announcePeers);
  });
}

// The mp4 files in test/fixtures, for the panel's test mode list.
// /api/videos lists them; /api/video/<name> streams one. Vite's own file
// server can't serve names with a "#" in them, and downloaded clips often
// have one.
function serveVideos(server) {
  const folder = join(server.config.root, 'test/fixtures');
  const listVideos = async () => {
    try {
      return (await readdir(folder)).filter((name) => name.toLowerCase().endsWith('.mp4')).sort();
    } catch (e) {
      return [];
    }
  };

  server.middlewares.use('/api/videos', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(await listVideos()));
  });

  server.middlewares.use('/api/video/', async (req, res) => {
    const name = decodeURIComponent(req.url.slice(1).split('?')[0]);
    if (!(await listVideos()).includes(name)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const path = join(folder, name);
    const {size} = await stat(path);
    // Video elements ask for byte ranges to seek and loop.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    const start = range && range[1] ? Number(range[1]) : 0;
    const end = range && range[2] ? Number(range[2]) : size - 1;
    res.statusCode = range ? 206 : 200;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', end - start + 1);
    if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    createReadStream(path, {start, end}).pipe(res);
  });
}

// With OPEN_PANEL set (see `yarn dev`), opens the control panel in its own
// Chrome window once the server is up, ready to drag to the other monitor.
// Cleared after the first time so a server restart doesn't open a second one.
function openPanelWindow(httpServer) {
  if (!process.env.OPEN_PANEL) return;
  httpServer.once('listening', () => {
    process.env.OPEN_PANEL = '';
    const url = `http://localhost:${httpServer.address().port}/panel.html`;
    if (process.platform !== 'darwin') {
      console.log(`Control panel: ${url}`);
      return;
    }
    execFile('open', ['-na', 'Google Chrome', '--args', '--new-window', url], (error) => {
      if (error) console.log(`Could not open Chrome; control panel: ${url}`);
    });
  });
}

export function bridgePlugin() {
  return {
    name: 'pose-animator-bridge',
    configureServer: (server) => {
      attach(server.httpServer);
      serveVideos(server);
      openPanelWindow(server.httpServer);
    },
    configurePreviewServer: (server) => {
      attach(server.httpServer);
      serveVideos(server);
    },
  };
}
