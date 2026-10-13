'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/detector-harness');

function setup(t, options) {
  const h = harness(options);
  t.after(h.close);
  return h;
}

test('the live temporary-chat Send control completes one response', async t => {
  const h = setup(t, { html: '<main><div data-composer-footer-responsive><div data-composer-markdown contenteditable="true" role="textbox"></div><button type="submit" class="bg-composer-primary" aria-label="Send" aria-disabled="true" disabled></button></div></main>' });
  const button = h.document.querySelector('button');
  assert.equal(h.detector.getStatus().state, 'ready');
  button.disabled = false;
  button.removeAttribute('aria-disabled');
  button.click();
  button.type = 'button';
  button.setAttribute('aria-label', 'Stop');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'generating');
  button.type = 'submit';
  button.setAttribute('aria-label', 'Send');
  button.setAttribute('aria-disabled', 'true');
  button.disabled = true;
  await h.advance(2000);
  assert.equal(h.completions.length, 1);
  assert.equal(h.detector.getStatus().state, 'ready');
  await h.advance(15000);
  assert.equal(h.completions.length, 1);
});

test('a long response reports uncertainty and keeps observing without a false completion', async t => {
  const h = setup(t);
  h.busy();
  await h.advance(30 * 60 * 1000 - 1);
  assert.equal(h.detector.getStatus().state, 'generating');
  assert.equal(h.refreshes.length, 0);
  await h.advance(1);
  const status = h.detector.getStatus();
  assert.equal(status.state, 'unavailable');
  assert.equal(status.code, 'generation_stalled');
  assert.equal(status.isGenerating, true);
  assert.equal(status.monitoring, true);
  assert.equal(h.refreshes.length, 1);
  assert.equal(h.completions.length, 0);
  await h.advance(29000);
  assert.equal(h.refreshes.length, 1);
  await h.advance(1000);
  assert.equal(h.refreshes.length, 2);
  assert.equal(h.completions.length, 0);
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
  assert.equal(h.detector.getStatus().state, 'ready');
  assert.equal(h.detector.getStatus().code, null);
  h.busy();
  await h.advance(1000);
  assert.equal(h.detector.getStatus().state, 'generating');
});

test('a long response that the user stops does not produce a completion', async t => {
  const h = setup(t);
  h.busy();
  await h.advance(30 * 60 * 1000);
  h.document.querySelector('button').click();
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 0);
  assert.equal(h.detector.getStatus().state, 'ready');
});

test('Enter with Start Voice does not report an unconfirmed submission', async t => {
  const h = setup(t, { html: '<main><div data-composer-footer-responsive><div data-composer-markdown contenteditable="true" role="textbox"><p></p></div><button class="bg-composer-primary" aria-label="Start Voice"></button></div></main>' });
  h.document.querySelector('p').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await h.advance(15000);
  assert.equal(h.detector.getStatus().state, 'ready');
  assert.equal(h.refreshes.length, 0);
});

test('Enter from a child of the editor records a submission attempt', async t => {
  const h = setup(t, { html: '<main><div data-composer-footer-responsive><div data-composer-markdown contenteditable="true" role="textbox"><p></p></div><button class="bg-composer-primary" aria-label="Send prompt"></button></div></main>' });
  h.document.querySelector('p').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await h.advance(15000);
  assert.equal(h.detector.getStatus().code, 'generation_unconfirmed');
  assert.equal(h.completions.length, 0);
});

test('an aria-disabled send control does not record a submission attempt', async t => {
  const h = setup(t);
  const button = h.document.querySelector('button');
  button.type = 'button';
  button.hidden = false;
  button.setAttribute('aria-disabled', 'true');
  button.click();
  h.document.querySelector('form').dispatchEvent(new h.window.SubmitEvent('submit', { bubbles: true, submitter: button }));
  await h.advance(15000);
  assert.equal(h.detector.getStatus().state, 'ready');
  assert.equal(h.refreshes.length, 0);
});

test('an unrelated Stop control cannot cancel a response alert', async t => {
  const h = setup(t);
  h.busy();
  await h.advance(1000);
  const dictate = h.document.createElement('button');
  dictate.type = 'button';
  dictate.setAttribute('aria-label', 'Stop dictation');
  h.document.querySelector('form').appendChild(dictate);
  dictate.click();
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

test('a programmatic conversation switch discards the previous response', async t => {
  const h = setup(t);
  h.window.history.pushState({}, '', '/c/first');
  h.detector.check();
  h.busy();
  await h.advance(1000);
  h.window.history.pushState({}, '', '/c/second');
  h.idle();
  await h.advance(2000);
  assert.equal(h.completions.length, 0);
  h.busy();
  await h.advance(1000);
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

test('a pending completion checks the conversation URL before sending the alert', async t => {
  const h = setup(t);
  h.window.history.pushState({}, '', '/c/first');
  h.detector.check();
  h.busy();
  await h.advance(1000);
  h.idle();
  await h.advance(700);
  h.window.history.pushState({}, '', '/c/second');
  await h.advance(200);
  assert.equal(h.completions.length, 0);
});

test('a route change cannot adopt the previous chat Stop control', async t => {
  const h = setup(t);
  h.window.history.pushState({}, '', '/c/first');
  h.detector.check();
  h.busy();
  await h.advance(1000);
  h.window.history.pushState({}, '', '/c/second');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'waiting');
  assert.equal(h.detector.getStatus().monitoring, false);
  assert.equal(h.detector.getStatus().isGenerating, true);
  assert.equal(h.refreshes.length, 0);
  h.idle();
  await h.advance(2000);
  assert.equal(h.completions.length, 0);
  assert.equal(h.detector.getStatus().state, 'ready');
  assert.equal(h.detector.getStatus().monitoring, true);
  h.busy();
  await h.advance(1000);
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

test('a replacement Stop control in the new conversation can start a response', async t => {
  const h = setup(t);
  h.window.history.pushState({}, '', '/c/first');
  h.detector.check();
  h.busy();
  await h.advance(1000);
  h.window.history.pushState({}, '', '/c/second');
  const old = h.document.querySelector('button');
  const replacement = old.cloneNode(true);
  old.replaceWith(replacement);
  await h.advance(1000);
  h.idle(replacement);
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

test('a new conversation URL keeps the first response active', async t => {
  const h = setup(t);
  h.busy();
  await h.advance(1000);
  h.window.history.pushState({}, '', '/c/new-conversation');
  await h.advance(1000);
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

test('opening a conversation in another tab preserves the current response', async t => {
  const h = setup(t);
  h.busy();
  await h.advance(1000);
  const link = h.document.createElement('a');
  link.href = '/c/other';
  link.target = '_blank';
  // Avoid starting real browser navigation in this DOM test.
  link.addEventListener('click', event => event.preventDefault());
  h.document.body.appendChild(link);
  link.click();
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

// A Brave session on October 13, 2026 showed two visible editors. The first one,
// with no control in its container, was chosen, so no Send or Stop was found.
test('a second editor without controls does not hide the composer button', async t => {
  const h = harness({ html: `<main>
    <div><textarea aria-label="Edit message"></textarea></div>
    <div data-composer-footer-responsive>
      <div><div data-composer-markdown contenteditable="true" role="textbox"></div></div>
      <div><button class="bg-composer-primary" aria-label="Send"></button></div>
    </div>
  </main>` });
  t.after(h.close);
  await h.advance(1000);
  assert.equal(h.detector.getStatus().state, 'ready');
  const button = h.document.querySelector('button');
  button.setAttribute('aria-label', 'Stop');
  await h.advance(1000);
  assert.equal(h.detector.getStatus().state, 'generating');
  button.setAttribute('aria-label', 'Send');
  await h.advance(2000);
  assert.equal(h.completions.length, 1);
  assert.equal(h.refreshes.length, 0);
});

test('a control in a footer outside the editor container is still found', async t => {
  // The Brave log showed a composer surface without a control and one visible
  // control elsewhere on the page.
  const h = harness({ html: `<main>
    <div data-composer-surface><div data-composer-markdown contenteditable="true" role="textbox"></div></div>
    <div data-composer-footer-responsive><button class="bg-composer-primary" aria-label="Send"></button></div>
    <div hidden><button class="bg-composer-primary" aria-label="Stop"></button></div>
  </main>` });
  t.after(h.close);
  await h.advance(1000);
  assert.equal(h.detector.getStatus().state, 'ready');
  const button = h.document.querySelector('button');
  button.setAttribute('aria-label', 'Stop');
  await h.advance(1000);
  assert.equal(h.detector.getStatus().state, 'generating');
  button.setAttribute('aria-label', 'Send');
  await h.advance(2000);
  assert.equal(h.completions.length, 1);
});
