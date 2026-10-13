'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');

function makeEvent() {
  const listeners = new Set();
  return { listeners, addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) };
}

async function harness(t, { legacy = false, pendingSettings = false } = {}) {
  const dom = new JSDOM('<main><form data-mobile-composer><textarea id="mobile-composer-prompt"></textarea><div data-composer-trailing><button data-composer-submit aria-label="Send message"></button></div></form></main>',
    { url: 'https://chatgpt.com/', runScripts: 'outside-only' });
  const { window } = dom;
  const messages = [];
  let time = 1000, nextId = 1, resolveSettings;
  const timers = new Map();
  window.Date.now = () => time;
  window.setTimeout = (fn, delay = 0) => { const id = nextId++; timers.set(id, { fn, at: time + delay }); return id; };
  window.setInterval = (fn, period) => { const id = nextId++; timers.set(id, { fn, at: time + period, period }); return id; };
  window.clearTimeout = window.clearInterval = id => timers.delete(id);
  window.HTMLElement.prototype.getClientRects = function () { return this.isConnected && !this.hidden ? [{}] : []; };
  const settings = pendingSettings ? new Promise(resolve => { resolveSettings = resolve; }) : Promise.resolve({});
  function makeChrome() {
    return {
      runtime: { id: 'extension', getManifest: () => ({ version: 'test' }), onMessage: makeEvent(),
        sendMessage: async message => { messages.push(message); return { success: true, enabled: false }; } },
      storage: { local: { get: () => settings }, onChanged: makeEvent() }
    };
  }
  window.chrome = makeChrome();
  if (legacy) {
    window.__chatDingerContentLoaded = true;
    const button = window.document.createElement('button');
    button.id = 'chat-dinger-mute-btn';
    button.type = 'button';
    button.addEventListener('click', () => assert.fail('The old button must not handle the new control.'));
    window.document.querySelector('[data-composer-trailing]').append(button);
  }
  const inject = () => {
    for (const file of ['shared.js', 'detector.js', 'content.js']) window.eval(readFileSync(file, 'utf8'));
  };
  function tick(ms) {
    const end = time + ms;
    for (let count = 0; count < 10000; count++) {
      const due = [...timers].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
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
  function status() {
    let result;
    for (const fn of window.chrome.runtime.onMessage.listeners) fn({ action: 'getStatus' }, {}, value => { result = value; });
    return result;
  }
  inject();
  await flush();
  t.after(() => { window.__chatDingerContentInstance?.dispose(); window.close(); });
  return { window, messages, timers, inject, makeChrome, advance, flush, status, resolveSettings };
}

test('manifest and installation injection keep one live listener and one response alert', async t => {
  const h = await harness(t);
  const original = h.window.__chatDingerContentInstance;
  h.inject();
  assert.equal(h.window.__chatDingerContentInstance, original);
  assert.equal(h.window.chrome.runtime.onMessage.listeners.size, 1);
  assert.equal(h.window.chrome.storage.onChanged.listeners.size, 1);
  const button = h.window.document.querySelector('[data-composer-submit]');
  button.setAttribute('aria-label', 'Stop generating');
  await h.advance(2000);
  button.setAttribute('aria-label', 'Send message');
  await h.advance(1000);
  assert.equal(h.messages.filter(m => m.action === 'playNotificationSound').length, 1);
});

test('an update replaces an invalid context without a page refresh', async t => {
  const h = await harness(t);
  const oldChrome = h.window.chrome;
  const oldInstance = h.window.__chatDingerContentInstance;
  oldChrome.runtime.getManifest = () => { throw new Error('Extension context invalidated.'); };
  h.window.chrome = h.makeChrome();
  h.inject();
  await h.flush();
  assert.equal(oldInstance.alive(), false);
  assert.equal(oldChrome.runtime.onMessage.listeners.size, 0);
  assert.equal(oldChrome.storage.onChanged.listeners.size, 0);
  assert.equal(h.window.chrome.runtime.onMessage.listeners.size, 1);
  assert.equal(h.status().monitoring, true);
  assert.equal(h.window.document.querySelectorAll('#chat-dinger-alert-toggle').length, 0);
  assert.equal([...h.timers.values()].filter(timer => timer.period).length, 1);
});

test('legacy loaded flags and mute controls do not prevent a new working connection', async t => {
  const h = await harness(t, { legacy: true });
  assert.equal(h.status().monitoring, true);
  const legacyButton = h.window.document.getElementById('chat-dinger-mute-btn');
  assert.ok(legacyButton);
  const button = h.window.document.querySelector('[data-composer-submit]');
  button.setAttribute('aria-label', 'Stop generating');
  await h.advance(2000);
  button.setAttribute('aria-label', 'Send message');
  await h.advance(1000);
  await h.flush();
  assert.equal(h.messages.filter(m => m.action === 'playNotificationSound').length, 1);
  assert.equal(h.window.document.getElementById('chat-dinger-mute-btn'), legacyButton);
  assert.equal(h.window.document.getElementById('chat-dinger-alert-toggle'), null);
  assert.equal(h.window.document.getElementById('chat-dinger-alert-styles'), null);
});

test('a page event cannot stop a live context but retires an invalid context', async t => {
  const h = await harness(t);
  h.window.dispatchEvent(new h.window.Event('chat-dinger-context-replaced'));
  assert.equal(h.status().monitoring, true);
  h.window.chrome.runtime.id = undefined;
  h.window.dispatchEvent(new h.window.Event('chat-dinger-context-replaced'));
  assert.equal(h.window.chrome.runtime.onMessage.listeners.size, 0);
  assert.equal(h.window.document.getElementById('chat-dinger-alert-toggle'), null);
  assert.equal(h.timers.size, 0);
});

test('disposal stops a delayed initialization and a retained page-show listener', async t => {
  const h = await harness(t, { pendingSettings: true });
  h.window.__chatDingerContentInstance.dispose();
  h.resolveSettings({});
  await h.flush();
  h.window.dispatchEvent(new h.window.PageTransitionEvent('pageshow', { persisted: true }));
  assert.equal(h.timers.size, 0);
  assert.equal(h.window.document.getElementById('chat-dinger-alert-toggle'), null);
});
