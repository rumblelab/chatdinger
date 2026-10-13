'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');

async function harness(t, { dictation = true } = {}) {
  const dom = new JSDOM(`<main><form data-mobile-composer>
    <textarea id="mobile-composer-prompt">Unsent draft</textarea>
    <div data-composer-trailing><!--renderer slot-->
      ${dictation ? '<span><button aria-label="Start dictation"></button></span>' : ''}
      <button data-composer-submit aria-label="Send message"></button>
    </div></form></main>`, { url: 'https://chatgpt.com/', runScripts: 'outside-only' });
  const { window } = dom;
  const { document } = window;
  let time = 1000, nextId = 1, storageListener, messageListener;
  const timers = new Map(), messages = [], mutations = [];
  window.Date.now = () => time;
  window.setTimeout = (fn, delay = 0) => { const id = nextId++; timers.set(id, { fn, at: time + delay }); return id; };
  window.setInterval = (fn, period) => { const id = nextId++; timers.set(id, { fn, at: time + period, period }); return id; };
  window.clearTimeout = window.clearInterval = id => timers.delete(id);
  window.HTMLElement.prototype.getClientRects = function () { return this.isConnected && !this.hidden ? [{}] : []; };
  window.HTMLElement.prototype.animate = () => ({});
  window.chrome = {
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`,
      onMessage: { addListener: fn => { messageListener = fn; }, removeListener() {} },
      sendMessage: async message => {
        messages.push(message);
        // Even an older worker asking for an in-page review must not change ChatGPT.
        return { success: true, audioStarted: true, shouldAskReview: true, metrics: { total: 7 } };
      } },
    storage: { local: { get: async () => ({}) },
      onChanged: { addListener: fn => { storageListener = fn; }, removeListener() {} } }
  };
  const editor = document.querySelector('textarea');
  editor.focus();
  editor.setSelectionRange(2, 6);
  const originalMarkup = document.documentElement.outerHTML;
  const observer = new window.MutationObserver(records => mutations.push(...records));
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  const inject = () => {
    for (const file of ['shared.js', 'detector.js', 'content.js']) window.eval(readFileSync(file, 'utf8'));
  };
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
  function assertUnchanged() {
    mutations.push(...observer.takeRecords());
    assert.equal(mutations.length, 0, 'The extension must not mutate the host page.');
    assert.equal(document.activeElement, editor, 'The extension must not move keyboard focus.');
    assert.equal(editor.value, 'Unsent draft');
    assert.equal(editor.selectionStart, 2);
    assert.equal(editor.selectionEnd, 6);
  }
  function status() {
    let result;
    messageListener({ action: 'getStatus' }, {}, value => { result = value; });
    return result;
  }
  inject();
  await flush();
  t.after(() => { observer.disconnect(); window.__chatDingerContentInstance?.dispose(); window.close(); });
  return { window, document, messages, originalMarkup, inject, advance, ownPageChange, assertUnchanged, status,
    storage: values => storageListener(window.JSON.parse(JSON.stringify(values)), 'local') };
}

for (const dictation of [true, false]) {
  test(`initial detection leaves the page unchanged ${dictation ? 'with' : 'without'} dictation`, async t => {
    const h = await harness(t, { dictation });
    await h.advance(8000);
    assert.equal(h.status().state, 'ready');
    h.assertUnchanged();
    assert.equal(h.document.documentElement.outerHTML, h.originalMarkup);
  });
}

test('selector recovery cannot insert UI into a renderer-owned composer', async t => {
  const h = await harness(t);
  h.storage({ customSelectors: { newValue: JSON.parse(readFileSync('selectors.json', 'utf8')) } });
  await h.advance(8000);
  h.assertUnchanged();
  assert.equal(h.status().state, 'ready');
});

test('popup alert settings mute and resume detection without a page control', async t => {
  const h = await harness(t);
  h.storage({ chatAlertSettings: { newValue: { enabled: false } } });
  assert.equal(h.status().state, 'off');
  h.storage({ chatAlertSettings: { newValue: { enabled: true } } });
  await h.advance(1000);
  assert.equal(h.status().state, 'ready');
  h.assertUnchanged();
});

test('completion plays one sound without an overlay or focus change', async t => {
  const h = await harness(t);
  const button = h.document.querySelector('[data-composer-submit]');
  h.ownPageChange(() => button.setAttribute('aria-label', 'Stop generating'));
  await h.advance(2000);
  h.ownPageChange(() => button.setAttribute('aria-label', 'Send message'));
  await h.advance(3000);
  assert.equal(h.messages.filter(m => m.action === 'playNotificationSound').length, 1);
  assert.equal(h.messages.filter(m => m.action === 'recordCompletion').length, 1);
  assert.equal(h.status().state, 'ready');
  h.assertUnchanged();
});

test('reinjection and back-forward restoration leave the page unchanged', async t => {
  const h = await harness(t);
  h.inject();
  h.window.dispatchEvent(new h.window.PageTransitionEvent('pagehide'));
  h.window.dispatchEvent(new h.window.PageTransitionEvent('pageshow', { persisted: true }));
  await h.advance(8000);
  assert.equal(h.status().state, 'ready');
  h.assertUnchanged();
});

test('new composer controls stay in the order supplied by the page renderer', async t => {
  const h = await harness(t);
  const controls = h.document.querySelector('[data-composer-trailing]');
  h.ownPageChange(() => {
    const send = h.document.createElement('button');
    send.setAttribute('data-composer-submit', '');
    send.setAttribute('aria-label', 'Send message');
    controls.replaceChildren(h.document.createComment('new renderer slot'), send);
  });
  const expected = [...controls.childNodes];
  await h.advance(8000);
  assert.deepEqual([...controls.childNodes], expected);
  h.assertUnchanged();
});
