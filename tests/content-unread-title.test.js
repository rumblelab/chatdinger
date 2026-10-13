'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');

const MARK = '● ';

async function harness(t, { title = '<title>ChatGPT</title>', visible = false, focused = false,
  settings = {}, sound = 'ok' } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head>${title}</head><body><main><form data-mobile-composer>
    <textarea id="mobile-composer-prompt">Unsent draft</textarea>
    <div data-composer-trailing><button data-composer-submit aria-label="Send message"></button></div>
    </form></main></body></html>`, { url: 'https://chatgpt.com/', runScripts: 'outside-only' });
  const { window } = dom;
  const { document } = window;
  const view = { visible, focused };
  // JSDOM looks hidden by default. Let each test pick what the user sees.
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => view.visible ? 'visible' : 'hidden' });
  document.hasFocus = () => view.focused;
  let time = 1000, nextId = 1, storageListener;
  const timers = new Map(), messages = [], mutations = [];
  window.Date.now = () => time;
  window.setTimeout = (fn, delay = 0) => { const id = nextId++; timers.set(id, { fn, at: time + delay }); return id; };
  window.setInterval = (fn, period) => { const id = nextId++; timers.set(id, { fn, at: time + period, period }); return id; };
  window.clearTimeout = window.clearInterval = id => timers.delete(id);
  window.HTMLElement.prototype.getClientRects = function () { return this.isConnected && !this.hidden ? [{}] : []; };
  window.chrome = {
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`,
      onMessage: { addListener() {}, removeListener() {} },
      sendMessage: async message => {
        messages.push(message);
        if (message.action === 'playNotificationSound' && sound === 'throw') throw new Error('No receiver');
        if (message.action === 'playNotificationSound' && sound === 'fail') return { success: false };
        return { success: true, audioStarted: true };
      } },
    storage: { local: { get: async () => window.JSON.parse(JSON.stringify({ chatAlertSettings: settings })) },
      onChanged: { addListener: fn => { storageListener = fn; }, removeListener() {} } }
  };
  const titleElement = document.querySelector('head > title');
  const textNode = titleElement?.firstChild || null;
  const headChildren = [...document.head.childNodes];
  const titleChildren = titleElement ? [...titleElement.childNodes] : [];
  const observer = new window.MutationObserver(records => mutations.push(...records));
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  for (const file of ['shared.js', 'detector.js', 'content.js']) window.eval(readFileSync(file, 'utf8'));
  function tick(ms) {
    const end = time + ms;
    for (let count = 0; count < 10000; count++) {
      const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
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
  function ownPageChange(fn) { fn(); observer.takeRecords(); }
  async function complete() {
    const button = document.querySelector('[data-composer-submit]');
    ownPageChange(() => button.setAttribute('aria-label', 'Stop generating'));
    await advance(2000);
    ownPageChange(() => button.setAttribute('aria-label', 'Send message'));
    await advance(3000);
  }
  // The only allowed change is the nodeValue of the same title Text node.
  function assertOnlyTitleText() {
    mutations.push(...observer.takeRecords());
    for (const record of mutations) {
      assert.equal(record.type, 'characterData', 'The extension must not add, remove, or change other nodes.');
      assert.equal(record.target, textNode);
    }
    mutations.length = 0;
    assert.deepEqual([...document.head.childNodes], headChildren);
    if (titleElement) assert.deepEqual([...titleElement.childNodes], titleChildren);
    assert.equal(document.querySelector('head > title'), titleElement);
    assert.equal(document.querySelector('textarea').value, 'Unsent draft');
  }
  function show() { view.visible = true; view.focused = true; }
  await flush();
  t.after(() => { observer.disconnect(); window.__chatDingerContentInstance?.dispose(); window.close(); });
  return { window, document, messages, textNode, view, flush, advance, complete, show, ownPageChange,
    assertOnlyTitleText, storage: values => storageListener(window.JSON.parse(JSON.stringify(values)), 'local') };
}

test('a hidden tab gets the unread mark on the same title Text node', async t => {
  const h = await harness(t);
  await h.complete();
  assert.equal(h.document.querySelector('head > title').firstChild, h.textNode);
  assert.equal(h.textNode.nodeValue, `${MARK}ChatGPT`);
  assert.equal(h.messages.filter(m => m.action === 'playNotificationSound').length, 1);
  assert.equal(h.messages.filter(m => m.action === 'recordCompletion').length, 1);
  h.assertOnlyTitleText();
});

test('a visible tab and window focus each clear the mark', async t => {
  const h = await harness(t);
  await h.complete();
  h.show();
  h.document.dispatchEvent(new h.window.Event('visibilitychange'));
  assert.equal(h.textNode.nodeValue, 'ChatGPT');
  h.view.visible = false; h.view.focused = false;
  await h.complete();
  assert.equal(h.textNode.nodeValue, `${MARK}ChatGPT`);
  h.window.dispatchEvent(new h.window.Event('focus'));
  assert.equal(h.textNode.nodeValue, 'ChatGPT');
  h.assertOnlyTitleText();
});

test('a ChatGPT title rename keeps the mark in front of the new name', async t => {
  const h = await harness(t);
  await h.complete();
  h.textNode.nodeValue = 'Trip plans';
  await h.flush();
  assert.equal(h.document.querySelector('head > title').firstChild, h.textNode);
  assert.equal(h.textNode.nodeValue, `${MARK}Trip plans`);
  await h.flush();
  assert.equal(h.textNode.nodeValue, `${MARK}Trip plans`);
  h.assertOnlyTitleText();
});

test('dispose restores the title and stops the title observer', async t => {
  const h = await harness(t);
  await h.complete();
  h.window.__chatDingerContentInstance.dispose();
  assert.equal(h.textNode.nodeValue, 'ChatGPT');
  h.textNode.nodeValue = 'Trip plans';
  await h.flush();
  assert.equal(h.textNode.nodeValue, 'Trip plans');
  h.assertOnlyTitleText();
});

for (const settings of [{ markUnreadTab: false }, { enabled: false }]) {
  test(`no mark when ${Object.keys(settings)[0]} is false`, async t => {
    const h = await harness(t, { settings });
    await h.complete();
    assert.equal(h.textNode.nodeValue, 'ChatGPT');
    h.assertOnlyTitleText();
  });
}

test('turning the setting off clears an existing mark', async t => {
  const h = await harness(t);
  await h.complete();
  h.storage({ chatAlertSettings: { newValue: { markUnreadTab: false } } });
  assert.equal(h.textNode.nodeValue, 'ChatGPT');
  h.assertOnlyTitleText();
});

for (const [name, title] of [['a title without a Text node', '<title><!--x--></title>'], ['no title element', '']]) {
  test(`${name} stays unchanged`, async t => {
    const h = await harness(t, { title });
    await h.complete();
    h.window.dispatchEvent(new h.window.Event('focus'));
    h.window.__chatDingerContentInstance.dispose();
    h.assertOnlyTitleText();
  });
}

for (const sound of ['fail', 'throw']) {
  test(`a sound request that does ${sound} still marks the title`, async t => {
    const h = await harness(t, { sound });
    await h.complete();
    assert.equal(h.messages.filter(m => m.action === 'playNotificationSound').length, 1);
    assert.equal(h.textNode.nodeValue, `${MARK}ChatGPT`);
    h.assertOnlyTitleText();
  });
}

test('a visible, focused tab gets no mark', async t => {
  const h = await harness(t, { visible: true, focused: true });
  await h.complete();
  assert.equal(h.textNode.nodeValue, 'ChatGPT');
  h.assertOnlyTitleText();
});

test('a visible tab in an unfocused window gets the mark', async t => {
  const h = await harness(t, { visible: true, focused: false });
  await h.complete();
  assert.equal(h.textNode.nodeValue, `${MARK}ChatGPT`);
  h.assertOnlyTitleText();
});
