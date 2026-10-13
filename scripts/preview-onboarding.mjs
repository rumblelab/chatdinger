// Local UI preview. Chrome APIs use sample data. This file is excluded from the ZIP.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SOUND_FILES } = require('../shared.js');
const assets = new Map([
  ['/onboarding.css', 'text/css'],
  ['/onboarding.js', 'application/javascript'],
  ['/shared.js', 'application/javascript'],
  ...SOUND_FILES.map(({ value }) => [`/sounds/${value}`, value.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'])
]);
const mock = `
  const sample = new URL(location.href).searchParams.get('scenario');
  const storage = sample === 'existing' ? { chatAlertSettings: { selectedSound: 'cryptic.wav' } } : {};
  const audio = document.createElement('audio');
  audio.id = 'preview-audio';
  document.body.append(audio);
  window.chrome = {
    storage: { local: { get: async () => storage, set: async value => Object.assign(storage, value) } },
    runtime: { sendMessage: async message => {
      if (message.action !== 'testSound') return { success: false };
      audio.src = '/sounds/' + message.soundFile;
      audio.volume = message.volume;
      await audio.play();
      return { success: true };
    } },
    tabs: {
      query: async () => sample === 'missing' ? [{ id: 1, windowId: 1 }] : [],
      sendMessage: async () => null,
      getCurrent: async () => null,
      create: async () => {}, update: async () => {}
    },
    windows: { update: async () => {} }
  };
`;

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    if (pathname === '/') {
      const html = await readFile(new URL('../onboarding.html', import.meta.url), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html.replace('<script src="shared.js"', '<script src="preview-data.js" defer></script>\n  <script src="shared.js"'));
    } else if (pathname === '/preview-data.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(mock);
    } else if (assets.has(pathname)) {
      res.setHeader('Content-Type', assets.get(pathname));
      res.end(await readFile(new URL('..' + pathname, import.meta.url)));
    } else {
      res.writeHead(404).end();
    }
  } catch {
    res.writeHead(500).end();
  }
});
server.listen(4320, '127.0.0.1', () => console.log('Setup preview: http://127.0.0.1:4320 (sample Chrome data)'));
