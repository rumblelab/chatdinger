'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/detector-harness');

function setup(t, options) {
  const h = harness(options);
  t.after(h.close);
  return h;
}

test('local detector diagnostics exclude URLs, identifiers, text, and arbitrary labels', async t => {
  const h = setup(t);
  const secrets = [
    'PRIVATE_CONVERSATION_ID', 'PRIVATE_QUERY_VALUE', 'PRIVATE_FRAGMENT',
    'PRIVATE_PROMPT_TEXT', 'PRIVATE_RESPONSE_TEXT', 'PRIVATE_CONTROL_LABEL',
    'PRIVATE_CONTROL_ID', 'PRIVATE_CONTROL_CLASS', 'PRIVATE_SELECTOR_VALUE'
  ];
  h.window.history.pushState({}, '', '/c/PRIVATE_CONVERSATION_ID?value=PRIVATE_QUERY_VALUE#PRIVATE_FRAGMENT');
  const editor = h.document.querySelector('textarea');
  editor.value = 'PRIVATE_PROMPT_TEXT';
  editor.textContent = 'PRIVATE_PROMPT_TEXT';
  const response = h.document.createElement('article');
  response.textContent = 'PRIVATE_RESPONSE_TEXT';
  h.document.body.appendChild(response);
  const button = h.document.querySelector('button');
  button.hidden = false;
  button.id = 'PRIVATE_CONTROL_ID';
  button.className = 'PRIVATE_CONTROL_CLASS';
  button.setAttribute('aria-label', 'Stop');
  button.setAttribute('data-private', 'PRIVATE_SELECTOR_VALUE');
  h.detector.setSelectors(['[data-private="PRIVATE_SELECTOR_VALUE"]']);
  await h.advance(1000);
  button.setAttribute('aria-label', 'PRIVATE_CONTROL_LABEL');
  await h.advance(1000);
  const diagnostics = h.detector.getDiagnostics();
  assert.equal(diagnostics.signals.route, 'conversation');
  assert.equal(diagnostics.events.some(event => event.buttonState === 'stop-label'), true);
  const serialized = JSON.stringify(diagnostics);
  for (const secret of secrets) assert.equal(serialized.includes(secret), false, secret);
  assert.equal(serialized.includes('https://chatgpt.com'), false);
});

test('the diagnostic history keeps at most 100 recent events', async t => {
  const h = setup(t);
  for (let index = 0; index < 80; index++) {
    h.detector.setEnabled(false);
    h.detector.setEnabled(true);
    await h.advance(1);
  }
  const diagnostics = h.detector.getDiagnostics();
  assert.equal(diagnostics.events.length, 100);
  assert.equal(diagnostics.events.some(event => event.event === 'start'), false);
  assert.ok(diagnostics.events.every((event, index, events) => index === 0 || event.ms >= events[index - 1].ms));
  diagnostics.events[0].event = 'modified_by_reader';
  assert.equal(h.detector.getDiagnostics().events.some(event => event.event === 'modified_by_reader'), false);
});

test('the diagnostic history records one first-response start and completion across URL assignment', async t => {
  const h = setup(t);
  h.busy();
  await h.advance(1000);
  h.window.history.pushState({}, '', '/c/created-conversation');
  h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
  await h.advance(1000);
  h.idle();
  await h.advance(2000);
  const { events } = h.detector.getDiagnostics();
  const starts = events.filter(event => event.event === 'response_start');
  const ends = events.filter(event => event.event === 'response_end');
  assert.equal(starts.length, 1);
  assert.equal(starts[0].source, 'button');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].cancelled, false);
  assert.ok(ends[0].duration >= 2000);
  assert.ok(ends[0].ms > starts[0].ms);
  assert.equal(h.completions.length, 1);
});

test('diagnostics show a visible Working spinner before response tracking starts', async t => {
  const h = setup(t);
  const spinner = h.document.createElement('div');
  spinner.setAttribute('role', 'status');
  spinner.setAttribute('aria-label', 'Working');
  h.document.body.appendChild(spinner);
  await h.advance(1000);
  const diagnostics = h.detector.getDiagnostics();
  assert.equal(diagnostics.signals.working, true);
  assert.equal(diagnostics.signals.tracked, false);
  assert.equal(diagnostics.signals.busy, false);
  assert.ok(diagnostics.events.some(event => event.event === 'signals' && event.working && !event.tracked));
  assert.equal(diagnostics.events.some(event => event.event === 'response_start'), false);
  assert.equal(h.completions.length, 0);
});

test('diagnostics describe route categories without storing route identifiers', t => {
  const h = setup(t);
  const routes = [
    ['/', 'home'],
    ['/c/new', 'new_conversation'],
    ['/c/PRIVATE_CHAT_ID', 'conversation'],
    ['/images', 'images'],
    ['/g/PRIVATE_GPT_ID', 'gpt_or_project'],
    ['/settings', 'other']
  ];
  for (const [path, expected] of routes) {
    h.window.history.pushState({}, '', path);
    assert.equal(h.detector.getDiagnostics().signals.route, expected);
  }
  const diagnostics = h.detector.getDiagnostics();
  const categories = new Set(routes.map(([, category]) => category));
  const routeEvents = diagnostics.events.filter(event => event.event === 'route');
  assert.ok(routeEvents.length >= 5);
  assert.ok(routeEvents.every(event => categories.has(event.from) && categories.has(event.to)));
  assert.equal(JSON.stringify(diagnostics).includes('PRIVATE_'), false);
});

for (const footer of [false, true]) {
  test(`diagnostics distinguish global controls from controls inside a ${footer ? 'footer' : 'form'}`, t => {
    const root = footer ? 'div data-composer-footer-responsive' : 'form data-mobile-composer';
    const tag = footer ? 'div' : 'form';
    const h = setup(t, { html: `<main><${root}>
      <textarea id="mobile-composer-prompt"></textarea>
      <button data-composer-submit aria-label="Send message"></button>
      </${tag}><button data-stop-generating aria-label="Stop generating"></button>
      <button data-stop-generating aria-label="Stop generating" hidden></button></main>` });
    const diagnostics = h.detector.getDiagnostics();
    assert.deepEqual(diagnostics.controls, {
      visibleEditors: 1, globalControls: 2, scopedControls: 1,
      rootTag: footer ? 'DIV' : 'FORM', footerRoot: footer
    });
    assert.equal(diagnostics.signals.busy, false);
    assert.equal(diagnostics.signals.idle, true);
  });
}
