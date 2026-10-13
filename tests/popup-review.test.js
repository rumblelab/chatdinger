const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const source = readFileSync('popup-review.js', 'utf8');
async function harness(stored) {
  const classes = new Set(), listeners = {}, opened = [];
  const link = { href: 'https://chromewebstore.google.com/detail/chat-dinger-%E2%80%93-notificatio/kkpdpkhnioiapldpimpdlleonejkkddb/reviews',
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    addEventListener: (name, handler) => { listeners[name] = handler; }
  };
  vm.runInNewContext(source, { document: { getElementById: () => link }, chrome: {
    storage: { local: { get: async () => ({ ...stored }), set: async values => Object.assign(stored, values) } },
    tabs: { create: async options => opened.push(options) }
  } });
  await new Promise(resolve => setImmediate(resolve));
  return { classes, listeners, opened };
}
test('review link animates until clicked and stays still when reopened', async () => {
  const stored = {};
  const h = await harness(stored);
  assert.equal(h.classes.has('review-unread'), true);
  await h.listeners.click({ preventDefault() {} });
  assert.equal(h.classes.has('review-unread'), false);
  assert.equal(stored.reviewLinkClicked, true);
  assert.match(h.opened[0].url, /^https:\/\/chromewebstore.google.com\/.*\/reviews$/);
  const reopened = await harness(stored);
  assert.equal(reopened.classes.has('review-unread'), false);
});
test('middle clicking records the review link without preventing native navigation', async () => {
  const stored = {};
  const h = await harness(stored);
  h.listeners.auxclick({ button: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stored.reviewLinkClicked, true);
  assert.equal(h.classes.has('review-unread'), false);
});
