const EXTENSION_ORIGIN = 'chrome-extension://kkpdpkhnioiapldpimpdlleonejkkddb';
const WINDOW_MS = 30 * 60 * 1000;
const EMAIL_COOLDOWN_MS = 60 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const THRESHOLD = 3;

export function validReport(report) {
  return report && typeof report === 'object' && !Array.isArray(report)
    && Object.keys(report).sort().join(',') === 'code,extensionVersion,selectorRevision'
    && ['controls_missing', 'generation_unconfirmed', 'generation_stalled', 'audio_failed'].includes(report.code)
    && typeof report.extensionVersion === 'string'
    && typeof report.selectorRevision === 'string'
    && /^\d{1,5}(?:\.\d{1,5}){2,3}$/.test(report.extensionVersion)
    && /^(?:[a-f0-9]{8}|unknown)$/.test(report.selectorRevision);
}

function headers(origin) {
  return { 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store', Vary: 'Origin' };
}

async function readReport(request) {
  if (Number(request.headers.get('content-length')) > 1024) throw new Error('Too large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  let length = 0, text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 1024) throw new Error('Too large');
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally { await reader.cancel(); }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/api/dinger-health') return new Response('Not found', { status: 404 });
    const origin = request.headers.get('origin');
    if (origin && origin !== EXTENSION_ORIGIN) return new Response('Not permitted', { status: 403 });
    const responseHeaders = headers(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders });
    if (!env.EMAIL || !env.ALERTS || !env.RATE_LIMITER || !env.ALERT_FROM || !env.ALERT_TO) {
      return new Response('Alert service is not configured', { status: 503, headers: responseHeaders });
    }
    if (request.method === 'GET') return Response.json({ service: 'chat-dinger-health', ready: true }, { headers: responseHeaders });
    if (request.method !== 'POST') return new Response('Method not permitted', { status: 405, headers: responseHeaders });
    if (!request.headers.get('content-type')?.startsWith('application/json')) return new Response('JSON required', { status: 415, headers: responseHeaders });
    // This public endpoint has no client secret. Apply a limit before durable storage.
    // The IP stays in the short-lived edge limiter, outside report records.
    const limit = await env.RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
    if (!limit.success) return new Response('Try later', { status: 429, headers: responseHeaders });
    let report;
    try { report = await readReport(request); } catch { return new Response('Invalid report', { status: 400, headers: responseHeaders }); }
    if (!validReport(report)) return new Response('Invalid report', { status: 400, headers: responseHeaders });
    const id = env.ALERTS.idFromName('reports');
    const result = await env.ALERTS.get(id).fetch(new Request('https://internal/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report)
    }));
    return new Response(null, { status: result.status, headers: responseHeaders });
  }
};

export class HealthAlerts {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.queue = Promise.resolve();
  }

  serial(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  fetch(request) {
    return this.serial(async () => {
      const report = await request.json();
      if (!validReport(report)) return new Response(null, { status: 400 });
      const now = Date.now();
      const state = await this.load(now);
      const key = `${report.code}:${report.extensionVersion}:${report.selectorRevision}`;
      let group = state.groups.find(item => item.key === key);
      if (!group) {
        if (state.groups.length >= 50) {
          // Keep each alert that has reached the threshold until delivery or expiry.
          const removable = state.groups.filter(item => item.count < THRESHOLD)
            .sort((a, b) => a.lastAt - b.lastAt)[0];
          if (!removable) return new Response(null, { status: 503 });
          state.groups.splice(state.groups.indexOf(removable), 1);
        }
        group = { ...report, key, count: 0, firstAt: now, lastAt: now };
        state.groups.push(group);
      }
      if (group.count < THRESHOLD) {
        // Keep at most three times to measure the rolling report window.
        const recent = group.recentAt || [group.firstAt, group.lastAt].slice(0, group.count);
        group.recentAt = recent.filter(at => now - at <= WINDOW_MS).concat(now);
        group.firstAt = group.recentAt[0];
        group.count = group.recentAt.length;
      } else {
        // The threshold stays met while the alert waits for the hourly limit.
        group.count = Math.min(100000, group.count + 1);
      }
      group.lastAt = now;
      await this.ctx.storage.put('state', state);
      await this.schedule(state, now);
      return new Response(null, { status: 202 });
    });
  }

  async load(now) {
    const state = await this.ctx.storage.get('state') || { groups: [], lastSentAt: 0, retryCount: 0, retryAt: 0 };
    state.groups = state.groups.filter(group => now - group.lastAt < RETENTION_MS);
    if (!state.groups.some(group => group.count >= THRESHOLD)) {
      state.retryCount = 0;
      state.retryAt = 0;
    }
    return state;
  }

  async schedule(state, now) {
    if (!state.groups.length) {
      if (state.lastSentAt + EMAIL_COOLDOWN_MS > now) await this.ctx.storage.setAlarm(state.lastSentAt + EMAIL_COOLDOWN_MS);
      else await this.ctx.storage.deleteAlarm();
      return;
    }
    const pending = state.groups.some(group => group.count >= THRESHOLD);
    const expiry = Math.min(...state.groups.map(group => group.lastAt + RETENTION_MS));
    const time = pending ? Math.min(expiry, Math.max(now + 1000, state.lastSentAt + EMAIL_COOLDOWN_MS, state.retryAt || 0))
      : expiry;
    // A steady stream of reports must not move an earlier alarm forward.
    const currentAlarm = await this.ctx.storage.getAlarm();
    await this.ctx.storage.setAlarm(currentAlarm === null ? time : Math.min(currentAlarm, time));
  }

  alarm() {
    return this.serial(async () => {
      const now = Date.now();
      const state = await this.load(now);
      if (!state.groups.length) {
        if (now < state.lastSentAt + EMAIL_COOLDOWN_MS) {
          await this.ctx.storage.put('state', state);
          await this.schedule(state, now);
        } else await this.ctx.storage.deleteAll();
        return;
      }
      const groups = state.groups.filter(group => group.count >= THRESHOLD);
      if (!groups.length || now < Math.max(state.lastSentAt + EMAIL_COOLDOWN_MS, state.retryAt || 0)) {
        await this.ctx.storage.put('state', state);
        await this.schedule(state, now);
        return;
      }
      const text = ['Chat Dinger reports repeated errors.', '', ...groups.map(group =>
        `${group.count} reports: ${group.code}, extension ${group.extensionVersion}, controls ${group.selectorRevision}`),
        '', 'Examine ChatGPT controls, sound playback, and the hosted selectors.json file.',
        'Reports contain no chat text or account identifiers.',
        'Counts are reports, not verified unique users. This public endpoint can receive false reports.'].join('\n');
      try {
        await this.env.EMAIL.send({ to: this.env.ALERT_TO, from: this.env.ALERT_FROM,
          subject: 'Chat Dinger: repeated errors', text });
        state.lastSentAt = now;
        state.retryCount = 0;
        state.retryAt = 0;
        for (const group of groups) { group.count = 0; group.recentAt = []; }
        await this.ctx.storage.put('state', state);
        await this.schedule(state, now);
      } catch (_error) {
        state.retryCount = Math.min(4, state.retryCount + 1);
        state.retryAt = now + (state.retryCount <= 3 ? state.retryCount * 60000 : EMAIL_COOLDOWN_MS);
        await this.ctx.storage.put('state', state);
        if (state.retryCount === 4) console.error('Chat Dinger email error. The service will try again in one hour.');
        await this.schedule(state, now);
      }
    });
  }
}
