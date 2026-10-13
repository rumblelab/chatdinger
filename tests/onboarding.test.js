'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const Shared = require('../shared.js');
const source = readFileSync('onboarding.js', 'utf8');

async function harness(options = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', dataset: {}, disabled: false, listeners: {}, children: [],
      addEventListener(event, listener) { this.listeners[event] = listener; },
      appendChild(child) { this.children.push(child); }
    });
    return elements.get(id);
  };
  let settings = { ...Shared.DEFAULT_SETTINGS, notifyOnActiveTab: false, ...options.settings };
  const messages = [], opened = [], focused = [], removed = [];
  const chrome = {
    storage: { local: {
      get: async () => ({ chatAlertSettings: settings }),
      set: async values => { settings = values.chatAlertSettings; }
    } },
    runtime: { sendMessage: async message => {
      messages.push(message);
      return { success: options.playbackSuccess !== false };
    } },
    tabs: {
      query: async () => options.tabs || [],
      getCurrent: async () => ({ id: 99 }),
      remove: async id => removed.push(id),
      sendMessage: async () => options.status,
      create: async value => opened.push(value),
      update: async id => focused.push(id)
    },
    windows: { update: async () => {} }
  };
  const context = vm.createContext({
    ChatDingerShared: Shared, chrome,
    document: { getElementById: element, createElement: () => ({}), addEventListener() {} }
  });
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { element, messages, opened, focused, removed, settings: () => settings };
}

test('sound test saves selection, preserves other settings, and uses the background player', async () => {
  const h = await harness();
  h.element('sound').value = 'nylon.mp3';
  h.element('volume').value = '35';
  await h.element('test-sound').listeners.click();
  assert.equal(h.settings().selectedSound, 'nylon.mp3');
  assert.equal(h.settings().volume, .35);
  assert.equal(h.settings().notifyOnActiveTab, false);
  assert.equal(h.messages[0].action, 'testSound');
  assert.equal(h.messages[0].soundFile, 'nylon.mp3');
  assert.equal(h.messages[0].volume, .35);
  assert.match(h.element('sound-status').textContent, /Did you hear the sound/);
});

test('failed playback shows an error and permits another attempt', async () => {
  const h = await harness({ playbackSuccess: false });
  await h.element('test-sound').listeners.click();
  assert.equal(h.element('sound-status').dataset.error, 'true');
  assert.equal(h.element('test-sound').disabled, false);
});

test('a missing listener never reports active alerts', async () => {
  const h = await harness({ tabs: [{ id: 1, windowId: 1 }] });
  assert.match(h.element('connection-title').textContent, /not active/);
  assert.match(h.element('connection-detail').textContent, /Reconnect/);
});

test('a confirmed listener reports active and Open ChatGPT reuses its tab', async () => {
  const h = await harness({ tabs: [{ id: 1, windowId: 1 }], status: { success: true, enabled: true, monitoring: true } });
  assert.match(h.element('connection-title').textContent, /active in 1 ChatGPT tab/);
  await h.element('open-chatgpt').listeners.click();
  assert.deepEqual(h.focused, [1]);
  assert.equal(h.opened.length, 0);
  assert.deepEqual(h.removed, [99]);
});

test('Open ChatGPT creates a tab when none exists', async () => {
  const h = await harness();
  await h.element('open-chatgpt').listeners.click();
  assert.equal(h.opened[0].url, 'https://chatgpt.com/');
  assert.deepEqual(h.removed, [99]);
});


test('zero volume explains the problem without sending a playback request', async () => {
  const h = await harness();
  h.element('volume').value = '0';
  await h.element('test-sound').listeners.click();
  assert.equal(h.messages.length, 0);
  assert.match(h.element('sound-status').textContent, /volume is zero/);
  assert.equal(h.element('hearing-check').hidden, true);
});

test('unheard audio shows output guidance without refresh advice', async () => {
  const h = await harness();
  await h.element('test-sound').listeners.click();
  assert.equal(h.element('hearing-check').hidden, false);
  h.element('heard-no').listeners.click();
  assert.match(h.element('sound-status').textContent, /Bluetooth/);
  assert.doesNotMatch(h.element('sound-status').textContent, /refresh/i);
  assert.equal(h.element('response-help').hidden, true);
  await h.element('test-sound').listeners.click();
  assert.equal(h.element('hearing-check').hidden, false);
});

test('only confirmed audio reveals response help and a new selection clears confirmation', async () => {
  const h = await harness();
  await h.element('test-sound').listeners.click();
  h.element('heard-yes').listeners.click();
  assert.equal(h.element('response-help').hidden, false);
  h.element('sound').value = 'nylon.mp3';
  await h.element('sound').listeners.change();
  assert.equal(h.element('response-help').hidden, true);
  assert.equal(h.element('hearing-check').hidden, true);
});

test('setup changes the foreground sound choice without changing desktop notifications', async () => {
  const h = await harness();
  h.element('active-sound').checked = true;
  await h.element('active-sound').listeners.change();
  assert.equal(h.settings().notifyOnActiveTab, true);
  assert.equal(h.settings().showSystemNotification, true);
  h.element('active-sound').checked = false;
  await h.element('active-sound').listeners.change();
  assert.equal(h.settings().notifyOnActiveTab, false);
  assert.equal(h.settings().showSystemNotification, true);
});


test('fresh setup selects Soft tap and sends it to the background player', async () => {
  const h = await harness();
  assert.deepEqual(h.element('sound').children.map(option => option.textContent),
    ['Soft tap', 'Bloop', 'Nylon', 'Tone', 'Coin', 'Pew']);
  assert.equal(h.element('sound').value, 'soft-tap.wav');
  await h.element('test-sound').listeners.click();
  assert.equal(h.messages[0].soundFile, 'soft-tap.wav');
  assert.equal(h.settings().selectedSound, 'soft-tap.wav');
});

test('setup keeps the previous default sound for an existing user', async () => {
  const h = await harness({ settings: { selectedSound: 'cryptic.wav' } });
  assert.equal(h.element('sound').value, 'cryptic.wav');
  await h.element('open-chatgpt').listeners.click();
  assert.equal(h.settings().selectedSound, 'cryptic.wav');
});

test('reopened setup preserves an existing sound outside the short list', async () => {
  const h = await harness({ settings: { selectedSound: 'alert.mp3' } });
  assert.equal(h.element('sound').value, 'alert.mp3');
  assert.equal(h.element('sound').children.at(-1).textContent, 'Alert');
  await h.element('open-chatgpt').listeners.click();
  assert.equal(h.settings().selectedSound, 'alert.mp3');
});
