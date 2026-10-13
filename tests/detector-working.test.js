'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/detector-harness');

function setup(t) {
  const h = harness({ html: `<main>
    <div data-composer-footer-responsive>
      <div><div data-composer-markdown contenteditable="true" role="textbox" aria-label="Ask ChatGPT"></div></div>
      <div><button class="bg-composer-primary" aria-label="Start Voice"></button></div>
    </div>
  </main>` });
  t.after(h.close);
  return h;
}

function addWorking(h) {
  const spinner = h.document.createElement('div');
  spinner.setAttribute('role', 'status');
  spinner.setAttribute('aria-label', 'Working');
  h.document.querySelector('main').appendChild(spinner);
  return spinner;
}

test('the signed-in footer detects Stop and idle without remote selectors', async t => {
  const h = setup(t);
  assert.equal(h.detector.getStatus().state, 'ready');
  const button = h.document.querySelector('button');
  button.setAttribute('aria-label', 'Stop');
  await h.advance(1000);
  assert.equal(h.detector.getStatus().state, 'generating');
  button.setAttribute('aria-label', 'Start Voice');
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

test('Working prevents completion after Stop returns to idle', async t => {
  const h = setup(t);
  const button = h.document.querySelector('button');
  button.setAttribute('aria-label', 'Stop');
  await h.advance(1000);
  const spinner = addWorking(h);
  button.setAttribute('aria-label', 'Start Voice');
  await h.advance(5000);
  assert.equal(h.detector.getStatus().state, 'generating');
  assert.equal(h.completions.length, 0);
  spinner.remove();
  await h.advance(899);
  assert.equal(h.completions.length, 0);
  await h.advance(1);
  assert.equal(h.completions.length, 1);
  await h.advance(5000);
  assert.equal(h.completions.length, 1);
});

test('a Working spinner alone does not start or complete a response', async t => {
  const h = setup(t);
  const spinner = addWorking(h);
  await h.advance(1000);
  assert.equal(h.detector.getStatus().state, 'ready');
  spinner.remove();
  await h.advance(1000);
  assert.equal(h.completions.length, 0);
});

test('spinner removal without an idle control does not cause a ding', async t => {
  const h = setup(t);
  const button = h.document.querySelector('button');
  button.setAttribute('aria-label', 'Stop');
  await h.advance(1000);
  const spinner = addWorking(h);
  button.remove();
  await h.advance(1000);
  spinner.remove();
  await h.advance(2000);
  assert.equal(h.completions.length, 0);
});

test('a hidden Working spinner does not hold a completed response', async t => {
  const h = setup(t);
  const button = h.document.querySelector('button');
  button.setAttribute('aria-label', 'Stop');
  await h.advance(1000);
  const spinner = addWorking(h);
  spinner.hidden = true;
  button.setAttribute('aria-label', 'Start Voice');
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

function addAssistantMessage(h, { progress = false } = {}) {
  const message = h.document.createElement('div');
  message.setAttribute('data-message-author-role', 'assistant');
  if (progress) {
    const bar = h.document.createElement('div');
    bar.setAttribute('role', 'progressbar');
    message.appendChild(bar);
  }
  h.document.querySelector('main').appendChild(message);
  return message;
}

test('a progress bar in an older assistant message does not hold the detector busy', async t => {
  const h = setup(t);
  addAssistantMessage(h, { progress: true });
  addAssistantMessage(h);
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'ready');
  assert.equal(h.detector.getStatus().isGenerating, false);
  assert.equal(h.completions.length, 0);
});

test('a progress bar in the latest assistant message still counts as busy', async t => {
  const h = setup(t);
  addAssistantMessage(h);
  const latest = addAssistantMessage(h, { progress: true });
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'generating');
  latest.querySelector('[role="progressbar"]').remove();
  await h.advance(2000);
  assert.equal(h.completions.length, 1);
});
