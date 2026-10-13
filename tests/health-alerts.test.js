'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const report = { extensionVersion: '2.0.22', code: 'controls_missing', selectorRevision: '1234abcd' };
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

async function harness(t, options = {}) {
  const { default: worker, HealthAlerts } = await import('../services/health-alerts/worker.mjs');
  const store = new Map(), emails = [], attempts = [];
  let alarmAt = null, time = Date.now();
  t.mock.method(Date, 'now', () => time);
  const ctx = { storage: {
    get: async key => structuredClone(store.get(key)),
    put: async (key, value) => store.set(key, structuredClone(value)),
    getAlarm: async () => alarmAt,
    setAlarm: async at => { alarmAt = at; }, deleteAlarm: async () => { alarmAt = null; },
    deleteAll: async () => { store.clear(); alarmAt = null; }
  } };
  const env = { ALERT_FROM: 'alerts@chatdinger.com', ALERT_TO: 'owner@example.test',
    EMAIL: { send: async message => {
      attempts.push(message);
      if (options.failEmail) throw new Error('unavailable');
      emails.push(message);
    } },
    RATE_LIMITER: { limit: async () => ({ success: options.limited !== true }) } };
  let object = new HealthAlerts(ctx, env);
  env.ALERTS = { idFromName: () => 'fixed', get: () => object };
  return { store, emails, attempts, env, get object() { return object; }, alarmAt: () => alarmAt,
    advance: ms => { time += ms; },
    restart: () => { object = new HealthAlerts(ctx, env); },
    failEmail: value => { options.failEmail = value; },
    fireAlarm: async () => {
      assert.ok(alarmAt !== null);
      time = Math.max(time, alarmAt);
      alarmAt = null;
      await object.alarm();
    },
    post: (body = report, origin = 'chrome-extension://kkpdpkhnioiapldpimpdlleonejkkddb') => worker.fetch(new Request('https://chatdinger.com/api/dinger-health', {
      method: 'POST', headers: { 'Content-Type': 'application/json', origin }, body: typeof body === 'string' ? body : JSON.stringify(body)
    }), env)
  };
}

test('alert service rejects unknown fields, oversized bodies, and foreign origins', async t => {
  const h = await harness(t);
  assert.equal((await h.post({ ...report, prompt: 'private' })).status, 400);
  assert.equal((await h.post({ ...report, selectorRevision: 12345678 })).status, 400);
  assert.equal((await h.post({ ...report, extensionVersion: ['2.0.22'] })).status, 400);
  assert.equal((await h.post({ ...report, code: 'other_error' })).status, 400);
  assert.equal((await h.post('x'.repeat(1025))).status, 400);
  assert.equal((await h.post(report, 'https://other.example')).status, 403);
  assert.equal(h.store.size, 0);
});

test('the report schema accepts audio failures and stalled generations without extra fields', async t => {
  const h = await harness(t);
  for (const code of ['audio_failed', 'generation_stalled']) {
    assert.equal((await h.post({ ...report, code })).status, 202);
    assert.equal((await h.post({ ...report, code, pageUrl: 'private' })).status, 400);
  }
  assert.equal(h.store.get('state').groups.length, 2);
});

test('edge rate limiting prevents a report from reaching durable storage', async t => {
  const h = await harness(t, { limited: true });
  assert.equal((await h.post()).status, 429);
  assert.equal(h.store.size, 0);
});

test('three matching reports trigger one email and later reports respect the cooldown', async t => {
  const h = await harness(t);
  await h.post(); await h.post();
  await h.object.alarm();
  assert.equal(h.emails.length, 0);
  await h.post();
  await h.object.alarm();
  assert.equal(h.emails.length, 1);
  assert.equal(h.emails[0].to, 'owner@example.test');
  assert.match(h.emails[0].text, /3 reports/);
  await Promise.all([h.post(), h.post(), h.post(), h.post()]);
  await h.object.alarm();
  assert.equal(h.emails.length, 1);
  const state = h.store.get('state');
  assert.equal(state.groups[0].count, 4);
  assert.equal(JSON.stringify(state).includes('Connecting-IP'), false);
});

test('email failures retain reports and schedule bounded retries', async t => {
  const h = await harness(t, { failEmail: true });
  await h.post(); await h.post(); await h.post();
  await h.object.alarm();
  assert.equal(h.store.get('state').groups[0].count, 3);
  assert.equal(h.store.get('state').lastSentAt, 0);
  assert.equal(h.store.get('state').retryCount, 1);
  assert.ok(h.alarmAt() > Date.now());
});

test('a second incident survives the hourly cooldown without new reports', async t => {
  const h = await harness(t);
  await h.post(); await h.post(); await h.post();
  await h.fireAlarm();
  const firstSentAt = Date.now();
  h.advance(MINUTE);
  const second = { ...report, code: 'generation_unconfirmed' };
  await h.post(second); await h.post(second); await h.post(second);
  assert.equal(h.alarmAt(), firstSentAt + HOUR);
  // The Durable Object can stop while the alert waits.
  h.restart();
  await h.fireAlarm();
  assert.equal(h.emails.length, 2);
  assert.match(h.emails[1].text, /3 reports: generation_unconfirmed/);
  assert.doesNotMatch(h.emails[1].text, /controls_missing/);
  await h.object.alarm();
  assert.equal(h.emails.length, 2);
});

test('new reports after the report window do not erase a pending incident', async t => {
  const h = await harness(t);
  await h.post(); await h.post(); await h.post();
  await h.fireAlarm();
  h.advance(MINUTE);
  await h.post(); await h.post(); await h.post();
  h.advance(35 * MINUTE);
  await h.post();
  await h.fireAlarm();
  assert.equal(h.emails.length, 2);
  assert.match(h.emails[1].text, /4 reports/);
});

test('continuous reports do not postpone the first alert', async t => {
  const h = await harness(t);
  await h.post(); await h.post(); await h.post();
  const firstAlarm = h.alarmAt();
  for (let index = 0; index < 20; index++) {
    h.advance(100);
    await h.post();
    assert.equal(h.alarmAt(), firstAlarm);
  }
  await h.fireAlarm();
  assert.equal(h.emails.length, 1);
  assert.match(h.emails[0].text, /23 reports/);
});

test('the threshold uses three reports within a rolling thirty-minute window', async t => {
  const h = await harness(t);
  await h.post();
  h.advance(29 * MINUTE);
  await h.post();
  h.advance(2 * MINUTE);
  await h.post();
  await h.object.alarm();
  assert.equal(h.emails.length, 0);
  h.advance(9 * MINUTE);
  await h.post();
  await h.fireAlarm();
  assert.equal(h.emails.length, 1);
  assert.match(h.emails[0].text, /3 reports/);
});

test('new reports and an object restart cannot bypass the email retry delay', async t => {
  const h = await harness(t, { failEmail: true });
  await h.post(); await h.post(); await h.post();
  await h.fireAlarm();
  const retryAt = h.alarmAt();
  h.advance(1000);
  await h.post();
  h.restart();
  await h.object.alarm();
  assert.equal(h.attempts.length, 1);
  assert.equal(h.alarmAt(), retryAt);
  h.failEmail(false);
  await h.fireAlarm();
  assert.equal(h.emails.length, 1);
  assert.match(h.emails[0].text, /4 reports/);
  assert.equal(h.store.get('state').retryCount, 0);
  assert.equal(h.store.get('state').retryAt, 0);
});

test('email delivery recovers after three quick retries with an hourly retry', async t => {
  const h = await harness(t, { failEmail: true });
  t.mock.method(console, 'error', () => {});
  await h.post(); await h.post(); await h.post();
  await h.fireAlarm();
  for (const delay of [MINUTE, 2 * MINUTE, 3 * MINUTE]) {
    assert.equal(h.alarmAt(), Date.now() + delay);
    await h.fireAlarm();
  }
  assert.equal(h.attempts.length, 4);
  const retryAt = Date.now() + HOUR;
  assert.equal(h.alarmAt(), retryAt);
  h.advance(MINUTE);
  await h.post();
  assert.equal(h.alarmAt(), retryAt);
  h.restart();
  h.failEmail(false);
  await h.fireAlarm();
  assert.equal(h.attempts.length, 5);
  assert.equal(h.emails.length, 1);
  assert.match(h.emails[0].text, /4 reports/);
});

test('full report storage keeps pending incidents and rejects overflow explicitly', async t => {
  const h = await harness(t);
  for (let index = 0; index < 50; index++) {
    const incident = { ...report, selectorRevision: index.toString(16).padStart(8, '0') };
    await h.post(incident); await h.post(incident); await h.post(incident);
  }
  assert.equal((await h.post()).status, 503);
  assert.equal(h.store.get('state').groups.length, 50);
  await h.fireAlarm();
  assert.equal(h.emails.length, 1);
  assert.equal((h.emails[0].text.match(/3 reports:/g) || []).length, 50);
});

test('report storage removes an unqualified group before a pending incident', async t => {
  const h = await harness(t);
  await h.post(); await h.post(); await h.post();
  for (let index = 0; index < 50; index++) {
    await h.post({ ...report, selectorRevision: index.toString(16).padStart(8, '0') });
  }
  const groups = h.store.get('state').groups;
  assert.equal(groups.length, 50);
  assert.equal(groups.find(group => group.selectorRevision === report.selectorRevision).count, 3);
  await h.fireAlarm();
  assert.equal(h.emails.length, 1);
  assert.match(h.emails[0].text, /controls 1234abcd/);
});

test('pending alerts still expire after twenty-four hours without new reports', async t => {
  const h = await harness(t, { failEmail: true });
  await h.post(); await h.post(); await h.post();
  await h.fireAlarm();
  h.advance(24 * HOUR);
  await h.fireAlarm();
  assert.equal(h.store.size, 0);
  assert.equal(h.alarmAt(), null);
  assert.equal(h.attempts.length, 1);
});

test('report expiry does not erase the last email cooldown', async t => {
  const h = await harness(t, { failEmail: true });
  await h.post(); await h.post(); await h.post();
  await h.fireAlarm();
  h.advance(24 * HOUR - 2 * MINUTE);
  h.failEmail(false);
  await h.fireAlarm();
  const lastSentAt = Date.now();
  assert.equal(h.emails.length, 1);
  await h.fireAlarm();
  assert.deepEqual(h.store.get('state').groups, []);
  assert.equal(h.alarmAt(), lastSentAt + HOUR);
  await h.post(); await h.post(); await h.post();
  await h.object.alarm();
  assert.equal(h.emails.length, 1);
  assert.equal(h.alarmAt(), lastSentAt + HOUR);
  await h.fireAlarm();
  assert.equal(h.emails.length, 2);
});

test('expired report records are removed', async t => {
  const h = await harness(t);
  await h.post();
  h.advance(24 * 60 * 60 * 1000 + 1);
  await h.object.alarm();
  assert.equal(h.store.size, 0);
});
