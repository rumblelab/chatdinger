'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/detector-harness');

function setup(t) {
  // This structure came from the live response status on October 1, 2026.
  const h = harness({ navigation: true, html: `<main>
    <div data-thread-find-target="conversation"><div data-turn-key="test-turn">
      <span role="status" aria-busy="false"><span class="sr-only">處理中</span></span>
    </div></div>
    <div data-composer-footer-responsive>
      <div data-composer-markdown contenteditable="true" role="textbox"></div>
      <button type="button" class="bg-composer-primary" aria-label="Send"></button>
    </div></main>` });
  h.status = h.document.querySelector('[role="status"]');
  h.button = h.document.querySelector('button');
  t.after(h.close);
  return h;
}

test('the current response status detects a start without a recognized Stop button', async t => {
  const h = setup(t);
  h.button.setAttribute('aria-label', 'UNKNOWN_CONTROL');
  h.status.setAttribute('aria-busy', 'true');
  await h.advance(1000);
  assert.equal(h.detector.getStatus().state, 'generating');
  h.entryChange('/c/temporary', 'replace');
  await h.advance(1000);
  h.entryChange('/c/saved', 'replace');
  h.status.setAttribute('aria-busy', 'false');
  h.button.setAttribute('aria-label', 'Send');
  await h.advance(15000);
  assert.equal(h.completions.length, 1);
  assert.equal(h.refreshes.length, 0);
  assert.equal(h.detector.getStatus().state, 'ready');
});

test('a localized busy status prevents completion while the primary control is idle', async t => {
  const h = setup(t);
  h.button.setAttribute('aria-label', 'Stop');
  await h.advance(1000);
  h.status.setAttribute('aria-busy', 'true');
  h.button.setAttribute('aria-label', 'Send');
  await h.advance(15000);
  assert.equal(h.completions.length, 0);
  assert.equal(h.detector.getStatus().state, 'generating');
  h.status.setAttribute('aria-busy', 'false');
  await h.advance(899);
  assert.equal(h.completions.length, 0);
  await h.advance(1);
  assert.equal(h.completions.length, 1);
});

test('status removal cannot complete a response without a known idle control', async t => {
  const h = setup(t);
  h.button.setAttribute('aria-label', 'UNKNOWN_CONTROL');
  h.status.setAttribute('aria-busy', 'true');
  await h.advance(1000);
  assert.equal(h.detector.getStatus().isGenerating, true);
  h.status.remove();
  await h.advance(15000);
  assert.equal(h.completions.length, 0);
  assert.equal(h.detector.getStatus().code, 'controls_missing');
});

for (const source of ['sidebar', 'older turn', 'hidden turn', 'plain status']) {
  test(`a ${source} status cannot start or hold a response`, async t => {
    const h = setup(t);
    h.status.setAttribute('aria-busy', 'true');
    const turn = h.status.parentElement;
    if (source === 'sidebar') h.document.body.appendChild(turn);
    if (source === 'older turn') {
      const latest = h.document.createElement('div');
      latest.setAttribute('data-turn-key', 'latest');
      turn.after(latest);
    }
    if (source === 'hidden turn') turn.hidden = true;
    if (source === 'plain status') h.status.removeAttribute('aria-busy');
    await h.advance(1000);
    assert.equal(h.detector.getStatus().state, 'ready');
    h.button.setAttribute('aria-label', 'Stop');
    await h.advance(1000);
    h.button.setAttribute('aria-label', 'Send');
    await h.advance(1000);
    assert.equal(h.completions.length, 1);
  });
}

test('navigation cannot adopt the previous response status while its DOM remains', async t => {
  const h = setup(t);
  h.entryChange('/c/first', 'push');
  await h.advance(1000);
  h.button.setAttribute('aria-label', 'UNKNOWN_CONTROL');
  h.status.setAttribute('aria-busy', 'true');
  await h.advance(1000);
  h.entryChange('/c/other', 'push');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().monitoring, false);
  h.status.remove();
  h.button.setAttribute('aria-label', 'Send');
  await h.advance(2000);
  assert.equal(h.completions.length, 0);
});

test('navigation stays blocked when a stale response changes from Stop to a busy status', async t => {
  const h = setup(t);
  h.entryChange('/c/first', 'push');
  await h.advance(1000);
  h.button.setAttribute('aria-label', 'Stop');
  h.status.setAttribute('aria-busy', 'true');
  await h.advance(1000);
  h.entryChange('/c/other', 'push');
  h.button.setAttribute('aria-label', 'Send');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().monitoring, false);
  h.status.remove();
  await h.advance(2000);
  assert.equal(h.completions.length, 0);
});
