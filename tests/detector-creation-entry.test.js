'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/detector-harness');

function setup(t) {
  const h = harness({ navigation: true });
  t.after(h.close);
  return h;
}

test('a same-home history push during the first response keeps detection active', async t => {
  const h = setup(t);
  h.busy();
  await h.advance(249);
  h.entryChange('/', 'push');
  await h.advance(1188);
  assert.equal(h.detector.getStatus().state, 'generating');
  h.entryChange('/c/assigned', 'replace');
  await h.advance(4400);
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
  assert.equal(h.detector.getDiagnostics().events.some(event => event.event === 'reset'), false);
});

test('a same-home creation push before Stop keeps the submitted response', async t => {
  const h = setup(t);
  const button = h.document.querySelector('[data-composer-submit]');
  button.hidden = false;
  button.type = 'button';
  button.click();
  h.entryChange('/', 'push');
  await h.advance(249);
  h.busy();
  await h.advance(1188);
  h.entryChange('/c/assigned', 'replace');
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

test('a second same-home history push cannot retain an earlier response', async t => {
  const h = setup(t);
  h.busy();
  await h.advance(249);
  h.entryChange('/', 'push');
  await h.advance(249);
  h.entryChange('/', 'push');
  await h.advance(1000);
  h.entryChange('/c/different', 'replace');
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 0);
});

test('a delayed same-home history push does not retain an earlier response', async t => {
  const h = setup(t);
  h.busy();
  await h.advance(13000);
  h.entryChange('/', 'push');
  await h.advance(1000);
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 0);
});

for (const navigation of ['traverse', 'new_chat']) {
  test(`${navigation} on the home page discards an active response`, async t => {
    const h = setup(t);
    h.busy();
    await h.advance(249);
    if (navigation === 'new_chat') {
      const button = h.document.createElement('button');
      button.setAttribute('aria-label', 'New chat');
      h.document.body.appendChild(button);
      button.click();
    }
    h.entryChange('/', navigation === 'traverse' ? 'traverse' : 'push');
    await h.advance(1188);
    h.entryChange('/c/different', 'replace');
    h.idle();
    await h.advance(1000);
    assert.equal(h.completions.length, 0);
  });
}

test('a uc conversation assignment keeps the active first response', async t => {
  const h = setup(t);
  h.busy();
  await h.advance(249);
  h.entryChange('/uc/first', 'replace');
  await h.advance(2000);
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
  assert.equal(h.detector.getDiagnostics().signals.route, 'conversation');
});

test('Stop still suppresses the first response after the home push and uc assignment', async t => {
  const h = setup(t);
  h.busy();
  await h.advance(249);
  h.entryChange('/', 'push');
  await h.advance(1188);
  h.entryChange('/uc/first', 'replace');
  await h.advance(1000);
  assert.equal(h.detector.getStatus().state, 'generating');
  h.document.querySelector('[data-composer-submit]').click();
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 0);
  assert.ok(h.detector.getDiagnostics().events.some(event => event.event === 'response_end' && event.cancelled));
});

for (const type of ['push', 'replace', 'traverse']) {
  test(`a ${type} between existing uc chats discards the previous response`, async t => {
    const h = setup(t);
    h.entryChange('/uc/first', 'push');
    await h.advance(1000);
    h.busy();
    await h.advance(1000);
    h.entryChange('/uc/different', type);
    h.idle();
    await h.advance(1000);
    assert.equal(h.completions.length, 0);
  });
}

test('the reported URL-before-Stop sequence produces one first-response ding', async t => {
  const h = setup(t);
  h.entryChange('/c/existing', 'push');
  await h.advance(2177);
  h.entryChange('/', 'push');
  await h.advance(122);
  h.entryChange('/', 'replace');
  await h.advance(2552);
  h.entryChange('/c/temporary', 'replace');
  await h.advance(109);
  h.entryChange('/c/temporary', 'replace');
  await h.advance(81);
  h.busy();
  await h.advance(2874);
  assert.equal(h.detector.getStatus().state, 'generating');
  h.entryChange('/c/saved', 'replace');
  await h.advance(18119);
  assert.equal(h.detector.getStatus().state, 'generating');
  assert.equal(h.detector.getStatus().monitoring, true);
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
  assert.equal(h.health.some(health => health.state === 'waiting'), false);
});

test('replacement ownership starts only after positive response evidence', async t => {
  const h = setup(t);
  h.entryChange('/c/temporary', 'replace');
  await h.advance(2000);
  h.entryChange('/c/saved', 'replace');
  await h.advance(2000);
  assert.equal(h.detector.getDiagnostics().signals.tracked, false);
  assert.equal(h.completions.length, 0);
});

test('repeated replacements cannot extend the pending creation deadline', async t => {
  const h = setup(t);
  h.entryChange('/c/temporary', 'replace');
  await h.advance(7000);
  h.entryChange('/c/temporary-two', 'replace');
  await h.advance(6000);
  h.busy();
  await h.advance(1000);
  h.entryChange('/c/different', 'replace');
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 0);
});

test('active creation ownership lasts beyond the pending deadline', async t => {
  const h = setup(t);
  h.entryChange('/c/temporary', 'replace');
  await h.advance(1000);
  h.busy();
  await h.advance(20000);
  h.entryChange('/c/saved', 'replace');
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

for (const phase of ['pending', 'active']) {
  for (const type of ['push', 'traverse']) {
    test(`${type} clears ${phase} creation ownership even when the path stays the same`, async t => {
      const h = setup(t);
      h.entryChange('/c/temporary', 'replace');
      await h.advance(1000);
      if (phase === 'active') {
        h.busy();
        await h.advance(1000);
      }
      h.entryChange('/c/temporary', type);
      await h.advance(1000);
      h.busy();
      await h.advance(1000);
      h.entryChange('/c/another', 'replace');
      h.idle();
      await h.advance(1000);
      assert.equal(h.completions.length, 0);
    });
  }
}

test('a different history entry cannot inherit a first response', async t => {
  const h = setup(t);
  h.busy();
  await h.advance(1000);
  h.entryChange('/c/first', 'push');
  await h.advance(1000);
  h.entryChange('/c/unrelated-existing', 'push');
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 0);
});

test('a clicked conversation link cannot create pending ownership', async t => {
  const h = setup(t);
  const link = h.document.createElement('a');
  link.href = '/c/existing';
  link.addEventListener('click', event => event.preventDefault());
  h.document.body.appendChild(link);
  link.click();
  h.entryChange('/c/existing', 'replace');
  h.busy();
  await h.advance(1000);
  h.entryChange('/c/another', 'replace');
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 0);
});

test('temporary composer removal does not discard pending ownership', async t => {
  const h = setup(t);
  const composer = h.document.querySelector('form');
  composer.remove();
  h.entryChange('/c/temporary', 'replace');
  await h.advance(200);
  h.document.querySelector('main').appendChild(composer);
  h.busy();
  await h.advance(2000);
  h.entryChange('/c/saved', 'replace');
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

test('local diagnostics never contain the owned history entry key', async t => {
  const h = setup(t);
  h.entryChange('/', 'push', 'PRIVATE_HISTORY_ENTRY_KEY');
  h.entryChange('/c/temporary', 'replace');
  await h.advance(1000);
  h.busy();
  await h.advance(1000);
  h.entryChange('/c/saved', 'replace');
  const report = h.detector.getDiagnostics();
  assert.equal(report.signals.creatingConversation, true);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_HISTORY_ENTRY_KEY/);
});
