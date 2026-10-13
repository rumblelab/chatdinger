'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');

async function harness(t, responses = [], { navigation = false, html } = {}) {
  const dom = new JSDOM(html || `<main><div data-composer-footer-responsive>
    <div data-composer-markdown contenteditable="true" role="textbox" aria-label="Ask ChatGPT" class="ProseMirror"></div>
    <div class="flex items-center"><span class="contents"><button class="flex items-center gap-1" aria-label="Dictate"></button></span>
    <button class="bg-composer-primary" aria-label="Start Voice"></button></div>
  </div></main>`, { url: 'https://chatgpt.com/', runScripts: 'outside-only' });
  const { window } = dom;
  let entryNumber = 0;
  if (navigation) {
    const api = new window.EventTarget();
    api.currentEntry = { key: 'entry-0' };
    Object.defineProperty(window, 'navigation', { value: api });
  }
  function entryChange(path, navigationType) {
    const from = window.navigation.currentEntry;
    window.history[navigationType === 'replace' ? 'replaceState' : 'pushState']({}, '', path);
    window.navigation.currentEntry = { key: navigationType === 'replace' ? from.key : `entry-${++entryNumber}` };
    const event = new window.Event('currententrychange');
    Object.defineProperties(event, { navigationType: { value: navigationType }, from: { value: from } });
    window.navigation.dispatchEvent(event);
  }
  let time = 1000, nextTimer = 1, listener, storageListener;
  const timers = new Map(), messages = [];
  window.Date.now = () => time;
  window.HTMLElement.prototype.getClientRects = function () { return this.isConnected && !this.hidden ? [{}] : []; };
  window.setTimeout = (fn, delay = 0) => { const id = nextTimer++; timers.set(id, { fn, at: time + delay }); return id; };
  window.setInterval = (fn, period) => { const id = nextTimer++; timers.set(id, { fn, at: time + period, period }); return id; };
  window.clearTimeout = window.clearInterval = id => timers.delete(id);
  window.console.error = () => {};
  window.chrome = {
    runtime: { id: 'extension', onMessage: { addListener: fn => { listener = fn; } },
      sendMessage: async message => {
        messages.push(message);
        if (message.action === 'playNotificationSound') {
          const response = responses.shift() || { success: true, audioStarted: true };
          if (response instanceof Error) throw response;
          return response;
        }
        return { success: true };
      } },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener: fn => { storageListener = fn; } } }
  };
  for (const file of ['shared.js', 'detector.js', 'content.js']) window.eval(readFileSync(file, 'utf8'));
  t.after(() => { window.dispatchEvent(new window.PageTransitionEvent('pagehide')); window.close(); });
  function tick(milliseconds) {
    const end = time + milliseconds;
    for (let count = 0; count < 10000; count++) {
      const due = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      time = timer.at;
      if (timer.period) timer.at += timer.period;
      else timers.delete(id);
      timer.fn();
    }
    time = end;
  }
  async function flush() { for (let i = 0; i < 20; i++) { await Promise.resolve(); tick(0); } }
  async function advance(ms) { await flush(); tick(ms); await flush(); }
  function send(message, sender = { id: 'extension' }) {
    let response;
    listener(message, sender, value => { response = value; });
    return response;
  }
  async function response() {
    const button = window.document.querySelector('.bg-composer-primary');
    button.setAttribute('aria-label', 'Stop');
    await advance(2000);
    button.setAttribute('aria-label', 'Start Voice');
    await advance(1000);
  }
  await flush();
  return { window, messages, advance, send, response, entryChange, status: () => send({ action: 'getStatus' }),
    storageListener: (changes, namespace) => storageListener(window.JSON.parse(JSON.stringify(changes)), namespace) };
}

test('a failed sound stays visible while detection continues and a later ding clears it', async t => {
  const h = await harness(t, [{ success: false, code: 'audio_failed' }, { success: true, audioStarted: true }]);
  await h.response();
  assert.equal(h.status().code, 'audio_failed');
  assert.equal(h.status().monitoring, true);
  assert.equal(h.status().state, 'unavailable');
  assert.equal(h.messages.filter(m => m.action === 'recordCompletion').length, 0);
  assert.ok(h.messages.some(m => m.action === 'detectorHealth' && m.health.code === 'audio_failed'));
  await h.advance(5000);
  assert.equal(h.status().code, 'audio_failed');
  await h.response();
  assert.equal(h.status().audioFailed, false);
  assert.equal(h.status().state, 'ready');
  assert.equal(h.messages.filter(m => m.action === 'recordCompletion').length, 1);
  const health = h.messages.filter(m => m.action === 'detectorHealth').at(-1).health;
  assert.equal(health.code, null);
});

test('an unavailable background raises sound failure without counting a ding', async t => {
  const h = await harness(t, [new Error('No receiver')]);
  await h.response();
  assert.equal(h.status().code, 'audio_failed');
  assert.equal(h.messages.filter(m => m.action === 'recordCompletion').length, 0);
});

for (const result of [{ success: true }, { success: true, audioStarted: false }]) {
  test(`an audio reply without a confirmed start (${JSON.stringify(result)}) cannot count a ding`, async t => {
    const h = await harness(t, [result]);
    await h.response();
    assert.equal(h.status().code, 'audio_failed');
    assert.equal(h.messages.filter(m => m.action === 'recordCompletion').length, 0);
  });
}

for (const skipReason of ['disabled', 'active_tab', 'superseded']) {
  test(`an intentional ${skipReason} skip does not raise sound failure`, async t => {
    const h = await harness(t, [{ success: true, skipped: true, skipReason }]);
    await h.response();
    assert.equal(h.status().audioFailed, false);
    assert.equal(h.status().state, 'ready');
    assert.equal(h.messages.filter(m => m.action === 'recordCompletion').length, 0);
  });
}

test('only an extension page can clear sound failure after a sound test', async t => {
  const h = await harness(t, [{ success: false, code: 'audio_failed' }]);
  await h.response();
  h.send({ action: 'setAudioHealth', failed: false }, { id: 'other' });
  h.send({ action: 'setAudioHealth', failed: false }, { id: 'extension', tab: { id: 1 } });
  assert.equal(h.status().code, 'audio_failed');
  h.send({ action: 'setAudioHealth', failed: false });
  assert.equal(h.status().state, 'ready');
  assert.equal(h.status().audioFailed, false);
});

test('muting suppresses a sound warning and preserves it when alerts resume', async t => {
  const h = await harness(t, [{ success: false, code: 'audio_failed' }]);
  await h.response();
  h.storageListener({ chatAlertSettings: { newValue: { enabled: false } } }, 'local');
  assert.equal(h.status().state, 'off');
  h.storageListener({ chatAlertSettings: { newValue: { enabled: true } } }, 'local');
  assert.equal(h.status().code, 'audio_failed');
});

test('a remote selector storage update preserves an active response without page UI', async t => {
  const h = await harness(t);
  const button = h.window.document.querySelector('.bg-composer-primary');
  button.setAttribute('aria-label', 'Stop');
  await h.advance(1500);
  h.storageListener({ customSelectors: { newValue: JSON.parse(readFileSync('selectors.json', 'utf8')) } }, 'local');
  await h.advance(1000);
  assert.equal(h.messages.filter(m => m.action === 'playNotificationSound').length, 0);
  button.setAttribute('aria-label', 'Start Voice');
  await h.advance(1000);
  assert.equal(h.messages.filter(m => m.action === 'playNotificationSound').length, 1);
  assert.equal(h.messages.filter(m => m.action === 'recordCompletion').length, 1);
  assert.equal(h.window.document.querySelectorAll('#chat-dinger-alert-toggle').length, 0);
  assert.equal(h.status().state, 'ready');
});

test('the first response requests one sound after a new conversation URL and route event', async t => {
  const h = await harness(t);
  const button = h.window.document.querySelector('.bg-composer-primary');
  button.setAttribute('aria-label', 'Stop');
  await h.advance(1500);
  h.window.history.pushState({}, '', '/c/created-conversation');
  h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
  await h.advance(1000);
  button.setAttribute('aria-label', 'Start Voice');
  await h.advance(2000);
  assert.equal(h.messages.filter(m => m.action === 'playNotificationSound').length, 1);
  assert.equal(h.messages.filter(m => m.action === 'recordCompletion').length, 1);
  assert.equal(h.status().state, 'ready');
});

test('an image started on Images requests one sound after the first conversation is created', async t => {
  const h = await harness(t);
  h.window.history.pushState({}, '', '/images');
  h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
  await h.advance(1000);
  const button = h.window.document.querySelector('.bg-composer-primary');
  button.setAttribute('aria-label', 'Stop');
  const progress = h.window.document.createElement('div');
  progress.setAttribute('aria-label', 'Creating image');
  h.window.document.querySelector('main').appendChild(progress);
  await h.advance(2000);
  button.setAttribute('aria-label', 'Start Voice');
  await h.advance(1000);
  assert.equal(h.messages.filter(m => m.action === 'playNotificationSound').length, 0);
  h.window.history.pushState({}, '', '/c/created-image');
  h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
  progress.remove();
  await h.advance(2000);
  assert.equal(h.messages.filter(m => m.action === 'playNotificationSound').length, 1);
  assert.equal(h.messages.filter(m => m.action === 'recordCompletion').length, 1);
  assert.equal(h.status().state, 'ready');
});

test('a first response from c/new requests one sound across temporary and saved URLs', async t => {
  const h = await harness(t, [], { navigation: true });
  h.entryChange('/c/new', 'push');
  await h.advance(1000);
  const button = h.window.document.querySelector('.bg-composer-primary');
  button.setAttribute('aria-label', 'Stop');
  await h.advance(1500);
  for (const path of ['/c/temporary', '/c/saved']) {
    h.entryChange(path, 'replace');
    await h.advance(1000);
    assert.equal(h.status().state, 'generating');
    assert.equal(h.status().monitoring, true);
  }
  button.setAttribute('aria-label', 'Start Voice');
  await h.advance(2000);
  assert.equal(h.messages.filter(m => m.action === 'playNotificationSound').length, 1);
  assert.equal(h.messages.filter(m => m.action === 'recordCompletion').length, 1);
});

test('local diagnostics report detection and sound without chat content', async t => {
  const h = await harness(t, [new Error('PRIVATE ERROR')]);
  h.window.document.querySelector('[contenteditable]').textContent = 'PRIVATE PROMPT';
  await h.response();
  const diagnostics = h.send({ action: 'getDiagnostics' });
  assert.equal(diagnostics.detector.build, 'creation-history-7');
  assert.equal(diagnostics.status.detectorBuild, 'creation-history-7');
  assert.equal(diagnostics.sound.failed, true);
  assert.deepEqual(Array.from(diagnostics.sound.events, event => event.outcome), ['requested', 'request_failed']);
  assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE|https?:/);
  assert.equal(h.send({ action: 'getDiagnostics' }, { id: 'other' }), undefined);
  assert.equal(h.send({ action: 'getDiagnostics' }, { id: 'extension', tab: { id: 1 } }), undefined);
});

test('the reported delayed Stop sequence sends one sound and records one completion', async t => {
  const h = await harness(t, [], { navigation: true });
  const button = h.window.document.querySelector('.bg-composer-primary');
  h.entryChange('/c/existing', 'push');
  await h.advance(2177);
  h.entryChange('/', 'push');
  await h.advance(1960);
  // This new Send control is unknown until it changes to the exact Stop label.
  button.setAttribute('aria-label', 'Send');
  await h.advance(714);
  h.entryChange('/c/temporary', 'replace');
  await h.advance(190);
  button.setAttribute('aria-label', 'Stop');
  await h.advance(2874);
  assert.equal(h.status().monitoring, true);
  h.entryChange('/c/saved', 'replace');
  await h.advance(18119);
  assert.equal(h.status().state, 'generating');
  button.setAttribute('aria-label', 'Start Voice');
  await h.advance(1000);
  assert.equal(h.messages.filter(m => m.action === 'playNotificationSound').length, 1);
  assert.equal(h.messages.filter(m => m.action === 'recordCompletion').length, 1);
  const diagnostics = h.send({ action: 'getDiagnostics' });
  assert.equal(diagnostics.detector.events.some(event => event.event === 'creation_pending'), true);
  assert.deepEqual(Array.from(diagnostics.sound.events, event => event.outcome), ['requested', 'started']);
});

test('Traditional Chinese controls request one sound after the first response in a new chat', async t => {
  const h = await harness(t, [], { navigation: true });
  const button = h.window.document.querySelector('.bg-composer-primary');
  button.setAttribute('aria-label', '開始語音對話');
  await h.advance(15000);
  assert.equal(h.status().state, 'ready');
  button.setAttribute('aria-label', '傳送訊息');
  button.click();
  h.entryChange('/c/temporary', 'replace');
  button.setAttribute('aria-label', '停止');
  await h.advance(2000);
  h.entryChange('/c/saved', 'replace');
  await h.advance(2000);
  button.setAttribute('aria-label', '開始語音對話');
  await h.advance(15000);
  assert.equal(h.messages.filter(m => m.action === 'playNotificationSound').length, 1);
  assert.equal(h.messages.filter(m => m.action === 'recordCompletion').length, 1);
  assert.equal(h.messages.filter(m => m.action === 'refreshSelectors').length, 0);
  assert.equal(h.status().state, 'ready');
  const diagnostics = h.send({ action: 'getDiagnostics' });
  assert.deepEqual(Array.from(diagnostics.sound.events, event => event.outcome), ['requested', 'started']);
});

test('the reported Brave home push and uc replacement produce one confirmed sound', async t => {
  const h = await harness(t, [], { navigation: true, html: `<main><form data-mobile-composer>
    <textarea id="mobile-composer-prompt"></textarea><div data-composer-trailing>
    <button type="submit" data-composer-submit aria-label="Send message"></button>
    </div></form></main>` });
  const { window } = h;
  const button = window.document.querySelector('[data-composer-submit]');
  const editor = window.document.querySelector('textarea');
  const form = window.document.querySelector('form');
  editor.value = 'PRIVATE_PROMPT';
  // Relative times and events come from the 2.0.27 report. No real chat ID is kept.
  await h.advance(146874);
  editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await h.advance(14);
  form.dispatchEvent(new window.Event('submit', { bubbles: true }));
  button.setAttribute('aria-label', 'Stop generating');
  button.setAttribute('data-stop-generating', '');
  await h.advance(16);
  assert.equal(h.status().state, 'generating');
  await h.advance(27);
  form.dispatchEvent(new window.Event('submit', { bubbles: true }));
  await h.advance(222);
  h.entryChange('/', 'push');
  await h.advance(1188);
  h.entryChange('/uc/PRIVATE_CONVERSATION_ID', 'replace');
  await h.advance(4383);
  h.entryChange('/uc/PRIVATE_CONVERSATION_ID', 'replace');
  await h.advance(12);
  h.entryChange('/uc/PRIVATE_CONVERSATION_ID', 'replace');
  await h.advance(5);
  button.setAttribute('aria-label', 'Send message');
  button.removeAttribute('data-stop-generating');
  await h.advance(1000);
  assert.equal(h.messages.filter(m => m.action === 'playNotificationSound').length, 1);
  assert.equal(h.messages.filter(m => m.action === 'recordCompletion').length, 1);
  assert.equal(h.status().state, 'ready');
  const diagnostics = h.send({ action: 'getDiagnostics' });
  assert.equal(diagnostics.detector.events.some(event => event.event === 'reset'), false);
  assert.deepEqual(Array.from(diagnostics.sound.events, event => event.outcome), ['requested', 'started']);
  assert.equal(diagnostics.detector.signals.route, 'conversation');
  assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE|https?:/);
  await h.advance(15000);
  assert.equal(h.messages.filter(m => m.action === 'playNotificationSound').length, 1);
});
