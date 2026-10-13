// Local preview with sample data. This file is excluded from the extension ZIP.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const allowed = new Set(['popup.css', 'shared.js', 'metrics.js', 'popup.js', 'popup-review.js']);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html.replace('<script src="shared.js">', '<script src="preview-data.js"></script><script src="shared.js">'));
    } else if (url.pathname === '/preview-data.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(`
        const scenario = new URL(location.href).searchParams.get('scenario');
        const fixture = scenario === 'empty' ? { total: 0, totalGenTime: 0 }
          : scenario === 'large' ? { total: 124895, totalGenTime: 9786540000 }
          : { total: 1248, totalGenTime: 88680000 };
        const storage = { dingerMetrics: fixture, reviewLinkClicked: scenario === 'reviewed' };
        window.chrome = {
          storage: { local: { get: async () => storage, set: async value => Object.assign(storage, value) }, onChanged: { addListener() {} } },
          runtime: { getManifest: () => ({ version: '2.0.23' }), sendMessage: async () => ({ success: true, audioStarted: true }) },
          tabs: { query: async () => [{ id: 1, url: 'https://chatgpt.com/' }],
            sendMessage: async () => scenario === 'error'
              ? { success: true, state: 'unavailable', code: 'controls_missing', nextRetryAt: Date.now() + 120000 }
              : { success: true, state: 'ready', monitoring: true },
            create: async () => {}, reload: async () => {} }
        };`);
    } else if (allowed.has(url.pathname.slice(1))) {
      res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript');
      res.end(await readFile(new URL(`..${url.pathname}`, import.meta.url)));
    } else { res.writeHead(404); res.end(); }
  } catch { res.writeHead(500); res.end(); }
});
server.listen(4318, '127.0.0.1', () => console.log('Popup preview: http://127.0.0.1:4318 (sample data)'));
