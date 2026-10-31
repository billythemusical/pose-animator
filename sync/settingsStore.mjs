// Saves settings to disk, in the project's settings/ folder:
//   settings/last.json         the settings as they were last changed; the
//                              show page loads these when it starts
//   settings/presets/<name>.json  named setups to save and recall
// /api/settings/last and /api/presets are how the pages reach them. Both
// folders are written by the show page, which is the source of truth.

import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Preset names become file names, so keep them plain.
const NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

/** @param announcePresets called with the preset names whenever they change */
export function serveSettings(server, announcePresets) {
  const folder = join(server.config.root, 'settings');
  const presetFolder = join(folder, 'presets');
  const lastFile = join(folder, 'last.json');

  const listPresets = async () => {
    try {
      return (await readdir(presetFolder))
          .filter((file) => file.endsWith('.json'))
          .map((file) => file.slice(0, -'.json'.length))
          .sort((a, b) => a.localeCompare(b));
    } catch (e) {
      return [];
    }
  };
  const send = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body));
  };
  // Only objects get saved, so a bad request can't leave an unreadable file.
  const parseSettings = async (req) => {
    const value = JSON.parse(await readBody(req));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return JSON.stringify(value, null, 2);
  };

  server.middlewares.use('/api/settings/last', async (req, res) => {
    try {
      if (req.method === 'PUT') {
        const text = await parseSettings(req);
        await mkdir(folder, {recursive: true});
        await writeFile(lastFile, text);
        send(res, 204);
      } else {
        send(res, 200, await readFile(lastFile, 'utf8'));
      }
    } catch (e) {
      send(res, e.code === 'ENOENT' ? 404 : 400, {error: e.message});
    }
  });

  server.middlewares.use('/api/presets', async (req, res) => {
    const name = decodeURIComponent(req.url.slice(1).split('?')[0]);
    try {
      if (!name) {
        send(res, 200, await listPresets());
        return;
      }
      if (!NAME.test(name)) {
        send(res, 400, {error: 'Preset names use letters, numbers, spaces, - and _ (40 at most).'});
        return;
      }
      const file = join(presetFolder, `${name}.json`);
      if (req.method === 'PUT') {
        const text = await parseSettings(req);
        await mkdir(presetFolder, {recursive: true});
        await writeFile(file, text);
        send(res, 204);
        announcePresets(await listPresets());
      } else if (req.method === 'DELETE') {
        await rm(file, {force: true});
        send(res, 204);
        announcePresets(await listPresets());
      } else {
        send(res, 200, await readFile(file, 'utf8'));
      }
    } catch (e) {
      send(res, e.code === 'ENOENT' ? 404 : 400, {error: e.message});
    }
  });
}
