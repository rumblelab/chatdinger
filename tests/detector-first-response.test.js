'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/detector-harness');

function setup(t, options) {
  const h = harness(options);
  t.after(h.close);
  return h;
}

function entryChange(h, path, navigationType) {
  h.entryChange(path, navigationType);
}

for (const initial of ['/c/new', '/images', '/g/project/c/new']) {
  test(`the first response keeps ownership through multiple conversation assignments from ${initial}`, async t => {
    const h = setup(t, { navigation: true });
    entryChange(h, initial, 'push');
    await h.advance(1000);
    h.busy();
    await h.advance(1000);
    entryChange(h, '/c/temporary', 'replace');
    await h.advance(1000);
    entryChange(h, '/c/final', 'replace');
    await h.advance(1000);
    assert.equal(h.detector.getStatus().monitoring, true);
    assert.equal(h.detector.getStatus().state, 'generating');
    h.idle();
    await h.advance(1000);
    assert.equal(h.completions.length, 1);
    // Ownership ends with the first response. A later chat change must cancel.
    h.busy();
    await h.advance(1000);
    entryChange(h, '/c/unrelated', 'replace');
    h.idle();
    await h.advance(1000);
    assert.equal(h.completions.length, 1);
  });
}

test('committed creation events preserve the response before native popstate arrives', async t => {
  const h = setup(t, { navigation: true });
  // Use jsdom history traversal to deliver a real, trusted popstate after the
  // simulated browser commit. The detector must process the commit first.
  h.window.history.pushState({}, '', '/c/assigned');
  h.window.history.pushState({}, '', '/');
  h.window.addEventListener('popstate', () => {
    const event = new h.window.Event('currententrychange');
    Object.defineProperty(event, 'navigationType', { value: 'push' });
    h.window.navigation.dispatchEvent(event);
  }, { capture: true, once: true });
  h.busy();
  await h.advance(1000);
  h.window.history.back();
  await h.advance(1000);
  assert.equal(h.detector.getStatus().monitoring, true);
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

for (const navigationType of ['push', 'replace']) {
  test(`a committed ${navigationType} URL assignment keeps the first response`, async t => {
    const h = setup(t, { navigation: true });
    h.busy();
    await h.advance(1000);
    entryChange(h, '/c/new', navigationType);
    await h.advance(1000);
    entryChange(h, '/c/final', navigationType);
    h.idle();
    await h.advance(1000);
    assert.equal(h.completions.length, 1);
  });
}

test('a committed history traversal cancels a response even without popstate', async t => {
  const h = setup(t, { navigation: true });
  h.busy();
  await h.advance(1000);
  entryChange(h, '/c/previous', 'traverse');
  assert.equal(h.detector.getStatus().monitoring, false);
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 0);
});

test('a conversation link cancels creation ownership', async t => {
  const h = setup(t);
  h.busy();
  await h.advance(1000);
  route(h, '/c/temporary');
  const link = h.document.createElement('a');
  link.href = '/c/existing';
  link.addEventListener('click', event => event.preventDefault());
  h.document.body.appendChild(link);
  link.click();
  route(h, '/c/existing');
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 0);
});

function route(h, path) {
  h.window.history.pushState({}, '', path);
  h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
}

test('the first response survives a route event when ChatGPT creates its conversation URL', async t => {
  const h = setup(t);
  h.busy();
  await h.advance(2000);
  route(h, '/c/created-conversation');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().monitoring, true);
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
  assert.equal(h.completions[0], 4900);
  await h.advance(10000);
  assert.equal(h.completions.length, 1);
});

test('a route notification after the URL was observed keeps the first response active', async t => {
  const h = setup(t);
  h.busy();
  await h.advance(1000);
  h.window.history.pushState({}, '', '/c/created-conversation');
  await h.advance(1000);
  h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
  await h.advance(1000);
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

test('the first image remains tracked when its busy phase starts on Images', async t => {
  const h = setup(t);
  route(h, '/images');
  await h.advance(1000);
  h.busy();
  const progress = h.document.createElement('div');
  progress.setAttribute('aria-label', 'Creating image');
  h.document.body.appendChild(progress);
  await h.advance(3000);
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 0);
  // The finished image and its new route can appear in the same update.
  route(h, '/c/created-image');
  progress.remove();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

test('a same-URL route notification cannot discard an active response', async t => {
  const h = setup(t);
  route(h, '/c/existing');
  await h.advance(1000);
  h.busy();
  await h.advance(1000);
  h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
  h.idle();
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

test('a new submission releases the reused control from the previous chat', async t => {
  const h = setup(t);
  route(h, '/c/previous');
  h.busy();
  await h.advance(1000);
  const newChat = h.document.createElement('button');
  newChat.setAttribute('aria-label', 'New chat');
  h.document.body.appendChild(newChat);
  newChat.click();
  h.window.history.pushState({}, '', '/');
  const button = h.document.querySelector('[data-composer-submit]');
  h.idle(button);
  button.hidden = false;
  button.type = 'button';
  button.click();
  h.busy(button);
  route(h, '/c/created-conversation');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().monitoring, true);
  h.idle(button);
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

for (const direction of ['back', 'forward']) {
  test(`native ${direction} navigation does not carry a response into an existing conversation`, async t => {
    const h = setup(t);
    route(h, '/c/previous');
    route(h, '/');
    if (direction === 'forward') {
      route(h, '/c/next');
      h.window.history.back();
      await h.advance(1000);
    }
    h.busy();
    await h.advance(1000);
    const traversals = [];
    h.window.addEventListener('popstate', event => traversals.push(event.isTrusted));
    h.window.history[direction]();
    await h.advance(1000);
    assert.deepEqual(traversals, [true]);
    h.idle();
    await h.advance(1000);
    assert.equal(h.completions.length, 0);
  });
}

test('an Images gallery without a composer does not start response detection', async t => {
  const h = setup(t);
  route(h, '/images');
  h.document.body.innerHTML = '<main><div aria-label="Creating image"></div></main>';
  await h.advance(30000);
  assert.equal(h.detector.getStatus().state, 'waiting');
  assert.equal(h.detector.getStatus().monitoring, false);
  assert.equal(h.detector.getStatus().isGenerating, false);
  assert.equal(h.refreshes.length, 0);
  assert.equal(h.completions.length, 0);
});
