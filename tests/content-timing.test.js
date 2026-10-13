'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/detector-harness');

function setup(t, options) { const h = harness(options); t.after(h.close); return h; }

test('an empty modern composer is ready even when Send is hidden', async t => {
  const h = setup(t);
  await h.advance(30000);
  assert.equal(h.detector.getStatus().state, 'ready');
  assert.equal(h.refreshes.length, 0);
  assert.equal(h.completions.length, 0);
});

test('attribute-only send-stop-idle changes produce exactly one completion', async t => {
  const h = setup(t);
  h.busy(); await h.advance(2500);
  h.idle(); await h.advance(899);
  assert.equal(h.completions.length, 0);
  await h.advance(1);
  assert.equal(h.completions.length, 1);
  await h.advance(10000);
  assert.equal(h.completions.length, 1);
});

test('an idle flicker during a response cancels the pending completion', async t => {
  const h = setup(t);
  h.busy(); await h.advance(1000);
  h.idle(); await h.advance(500);
  h.busy(); await h.advance(3000);
  assert.equal(h.completions.length, 0);
  h.idle(); await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

test('a removed composer never produces a completion without positive idle evidence', async t => {
  const h = setup(t);
  h.busy(); await h.advance(1000);
  h.document.querySelector('form').remove();
  await h.advance(30000);
  assert.equal(h.completions.length, 0);
  assert.ok(h.refreshes.length > 0);
});

test('a replacement Stop button keeps the response active', async t => {
  const h = setup(t);
  h.busy(); await h.advance(1000);
  const old = h.document.querySelector('[data-composer-submit]');
  const replacement = old.cloneNode(true);
  old.replaceWith(replacement);
  await h.advance(3000);
  assert.equal(h.completions.length, 0);
  h.idle(replacement); await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

test('active image progress delays completion without reading response text', async t => {
  const h = setup(t);
  h.busy(); await h.advance(1000);
  const progress = h.document.createElement('div');
  progress.setAttribute('aria-label', 'Creating image');
  h.document.body.appendChild(progress);
  h.idle(); await h.advance(10000);
  assert.equal(h.completions.length, 0);
  progress.remove(); await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

test('user Stop and navigation do not produce a completion ding', async t => {
  const h = setup(t);
  h.busy(); await h.advance(1000);
  h.document.querySelector('[data-composer-submit]').click();
  h.idle(); await h.advance(1000);
  assert.equal(h.completions.length, 0);
  h.busy(); await h.advance(1000);
  h.window.history.pushState({}, '', '/settings');
  h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
  h.idle(); await h.advance(1000);
  assert.equal(h.completions.length, 0);
});

test('selector updates during a response do not reset its state or double-ding', async t => {
  const h = setup(t);
  h.busy(); await h.advance(1000);
  h.detector.setSelectors(['[invalid', '#obsolete-button']);
  await h.advance(1000);
  h.idle(); await h.advance(2000);
  assert.equal(h.completions.length, 1);
});

test('an unrelated disabled button cannot signal response completion', async t => {
  const h = setup(t);
  h.busy(); await h.advance(1000);
  h.document.querySelector('[data-composer-submit]').outerHTML = '<button class="mystery" disabled></button>';
  h.detector.setSelectors(['.mystery']);
  await h.advance(20000);
  assert.equal(h.completions.length, 0);
  assert.equal(h.detector.getStatus().monitoring, false);
});

test('recovery retries after a network failure and respects the server cooldown', async t => {
  const h = setup(t, { html: '<main><form><textarea id="mobile-composer-prompt"></textarea></form></main>',
    refresh: () => ({ success: false, status: 'cooldown', retryAfterMs: 60000 }) });
  await h.advance(12000);
  assert.equal(h.refreshes.length, 1);
  assert.equal(h.detector.getStatus().state, 'unavailable');
  await h.advance(59000);
  assert.equal(h.refreshes.length, 1);
  await h.advance(1000);
  assert.equal(h.refreshes.length, 2);
});

test('a valid remote selector repairs detection without reloading the chat', async t => {
  const h = setup(t, { html: '<main><form><textarea id="mobile-composer-prompt"></textarea><div role="button" class="new-control" aria-label="Send message"></div></form></main>',
    refresh: () => ({ success: true, config: { mainButtonSelectors: ['.new-control'] } }) });
  await h.advance(12000);
  assert.equal(h.refreshes.length, 1);
  assert.equal(h.detector.getStatus().state, 'ready');
  assert.equal(h.completions.length, 0);
});

test('a submitted prompt without an observed response start raises uncertainty, not a ding', async t => {
  const h = setup(t);
  h.document.querySelector('[data-composer-submit]').hidden = false;
  h.document.querySelector('textarea').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await h.advance(14000);
  assert.equal(h.completions.length, 0);
  assert.ok(h.refreshes.length > 0);
  assert.equal(h.detector.getStatus().code, 'generation_unconfirmed');
  h.busy(); await h.advance(1000);
  assert.equal(h.detector.getStatus().state, 'generating');
});

test('Enter in an empty or disabled composer does not report a failed response', async t => {
  const h = setup(t);
  const editor = h.document.querySelector('textarea');
  const button = h.document.querySelector('[data-composer-submit]');
  editor.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await h.advance(15000);
  button.hidden = false;
  button.disabled = true;
  editor.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await h.advance(15000);
  assert.equal(h.detector.getStatus().state, 'ready');
  assert.equal(h.refreshes.length, 0);
});

test('a non-chat page and disabled alerts do not request repairs', async t => {
  const h = setup(t);
  h.window.history.pushState({}, '', '/images');
  h.document.body.replaceChildren();
  await h.advance(30000);
  assert.equal(h.detector.getStatus().state, 'waiting');
  assert.equal(h.refreshes.length, 0);
  h.window.history.pushState({}, '', '/');
  h.detector.setEnabled(false);
  await h.advance(30000);
  assert.equal(h.detector.getStatus().state, 'off');
  assert.equal(h.refreshes.length, 0);
});
