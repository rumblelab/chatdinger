'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/detector-harness');

// These paths came from the live ChatGPT controls on October 1, 2026.
const icons = {
  stop: 'M4.5 5.75C4.5 5.05964 5.05964 4.5 5.75 4.5H14.25C14.9404 4.5 15.5 5.05964 15.5 5.75V14.25C15.5 14.9404 14.9404 15.5 14.25 15.5H5.75C5.05964 15.5 4.5 14.9404 4.5 14.25V5.75Z',
  send: 'M9.33467 16.6663V4.93978L4.6374 9.63704L4.1667 9.16634L3.69599 8.69661L9.52998 2.86263L9.63447 2.77767C9.8925 2.60753 10.2433 2.63564 10.4704 2.86263L16.3034 8.69661L16.3884 8.80111C16.5588 9.05922 16.5306 9.40982 16.3034 9.63704C16.0762 9.86414 15.7255 9.89242 15.4675 9.722L15.363 9.63704L10.6647 4.9388V16.6663C10.6647 17.0336 10.367 17.3314 9.99971 17.3314C9.63259 17.3312 9.33467 17.0335 9.33467 16.6663ZM4.6374 9.63704C4.3777 9.89674 3.95569 9.89674 3.69599 9.63704C3.43657 9.37744 3.43668 8.95628 3.69599 8.69661L4.6374 9.63704Z',
  voice: 'M8.22266 2.45825C8.70579 2.45838 9.09766 2.85008 9.09766 3.33325V16.6663C9.09766 17.1494 8.70579 17.5411 8.22266 17.5413C7.73941 17.5413 7.34766 17.1495 7.34766 16.6663V3.33325C7.34766 2.85 7.73941 2.45825 8.22266 2.45825Z'
};

function setup(t, label = '開始語音對話') {
  const h = harness({ html: `<main><div data-composer-footer-responsive>
    <div data-composer-markdown contenteditable="true" role="textbox"><p></p></div>
    <button type="button" class="bg-composer-primary" aria-label="${label}"></button>
    </div></main>` });
  t.after(h.close);
  h.button = h.document.querySelector('button');
  return h;
}

function setIcon(h, name) {
  h.button.innerHTML = `<svg viewBox="0 0 20 20"><path d="${icons[name]}"></path></svg>`;
}

test('the reported Traditional Chinese voice control stays ready without recovery', async t => {
  const h = setup(t);
  await h.advance(45000);
  assert.equal(h.detector.getStatus().state, 'ready');
  assert.equal(h.refreshes.length, 0);
  assert.equal(h.completions.length, 0);
});

for (const idleLabel of ['開始語音對話', '傳送', '发送', '开始语音对话']) {
  test(`a Chinese Stop to ${idleLabel} transition completes exactly once`, async t => {
    const h = setup(t, idleLabel);
    h.button.setAttribute('aria-label', '停止生成');
    await h.advance(2000);
    assert.equal(h.detector.getStatus().state, 'generating');
    h.button.setAttribute('aria-label', idleLabel);
    await h.advance(15000);
    assert.equal(h.completions.length, 1);
    assert.equal(h.detector.getStatus().state, 'ready');
    assert.equal(h.refreshes.length, 0);
  });
}

for (const label of ['開始語音對話', 'Start voice conversation']) {
  test(`click and Enter on ${label} do not submit a text response`, async t => {
    const h = setup(t, label);
    h.button.click();
    h.document.querySelector('p').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await h.advance(15000);
    assert.equal(h.detector.getStatus().state, 'ready');
    assert.equal(h.detector.getDiagnostics().events.some(e => e.event === 'submission'), false);
    assert.equal(h.refreshes.length, 0);
  });
}

test('localized primary icons detect a response without label or test ID matches', async t => {
  const h = setup(t, '任意標籤');
  setIcon(h, 'voice');
  await h.advance(1);
  assert.equal(h.detector.getStatus().state, 'ready');
  h.button.click();
  await h.advance(15000);
  assert.equal(h.detector.getStatus().state, 'ready');
  setIcon(h, 'stop');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'generating');
  setIcon(h, 'send');
  h.button.disabled = true;
  await h.advance(15000);
  assert.equal(h.completions.length, 1);
  assert.equal(h.detector.getStatus().state, 'ready');
});

test('an icon-only Stop change cancels a pending completion before the next poll', async t => {
  const h = setup(t, '任意標籤');
  setIcon(h, 'stop');
  await h.advance(1000);
  h.button.querySelector('path').setAttribute('d', icons.send);
  await h.advance(500);
  h.button.querySelector('path').setAttribute('d', icons.stop);
  await h.advance(400);
  assert.equal(h.completions.length, 0);
  assert.equal(h.detector.getStatus().state, 'generating');
  h.button.querySelector('path').setAttribute('d', icons.voice);
  await h.advance(1000);
  assert.equal(h.completions.length, 1);
});

test('a localized Stop control with data-composer-submit is busy, not idle', async t => {
  const h = setup(t, '停止生成');
  h.button.setAttribute('data-composer-submit', '');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'generating');
  assert.equal(h.completions.length, 0);
  h.button.click();
  h.button.setAttribute('aria-label', '傳送訊息');
  await h.advance(15000);
  assert.equal(h.completions.length, 0);
  assert.equal(h.detector.getStatus().state, 'ready');
});

// Changed on October 13, 2026. A Brave session with the Dutch interface showed
// that the control that replaces a recognized Stop is the Voice button with an
// unknown label and icon. The old rule gave no ding until the next prompt.
test('an unknown primary control that replaces a recognized Stop completes once', async t => {
  const h = setup(t, '停止');
  await h.advance(1000);
  assert.equal(h.detector.getStatus().state, 'generating');
  h.button.setAttribute('aria-label', '未知控制');
  h.button.innerHTML = '<svg viewBox="0 0 20 20"><path d="M0 0H20V20Z"></path></svg>';
  await h.advance(15000);
  assert.equal(h.completions.length, 1);
  assert.equal(h.detector.getStatus().state, 'ready');
});

test('a localized Stop icon overrides the data-composer-submit idle fallback', async t => {
  const h = setup(t, '任意標籤');
  h.button.setAttribute('data-composer-submit', '');
  setIcon(h, 'stop');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'generating');
  h.button.click();
  setIcon(h, 'send');
  await h.advance(15000);
  assert.equal(h.completions.length, 0);
  assert.equal(h.detector.getStatus().state, 'ready');
});

test('Stop dictation is not a response control even with a broad remote selector', async t => {
  const h = setup(t, 'Send');
  h.button.setAttribute('aria-label', 'Stop dictation');
  h.detector.setSelectors(['button']);
  await h.advance(2000);
  assert.equal(h.detector.getStatus().isGenerating, false);
  h.button.setAttribute('aria-label', 'Send');
  await h.advance(2000);
  assert.equal(h.completions.length, 0);
});

test('a matching icon outside the primary composer control cannot start a response', async t => {
  const h = setup(t, 'Send');
  const unrelated = h.document.createElement('button');
  unrelated.innerHTML = `<svg viewBox="0 0 20 20"><path d="${icons.stop}"></path></svg>`;
  unrelated.className = 'unrelated';
  h.document.querySelector('[data-composer-footer-responsive]').appendChild(unrelated);
  h.detector.setSelectors(['.unrelated']);
  await h.advance(15000);
  assert.equal(h.completions.length, 0);
  assert.equal(h.detector.getStatus().state, 'ready');
});

test('a recognized Stop that becomes an unknown data-composer-submit control completes once', async t => {
  const h = setup(t, 'Stop');
  h.button.setAttribute('data-composer-submit', '');
  await h.advance(1000);
  h.button.setAttribute('aria-label', 'UNKNOWN_CONTROL');
  await h.advance(15000);
  assert.equal(h.completions.length, 1);
  assert.equal(h.detector.getStatus().state, 'ready');
});

test('an unknown primary control with no Stop seen is ready but cannot end a status-started response', async t => {
  const h = setup(t, 'UNKNOWN_CONTROL');
  h.button.setAttribute('data-composer-submit', '');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'ready');
  const thread = h.document.createElement('div');
  thread.setAttribute('data-thread-find-target', 'conversation');
  thread.innerHTML = '<div data-turn-key="t1"><div role="status" aria-busy="true"></div></div>';
  h.document.querySelector('main').appendChild(thread);
  await h.advance(1000);
  assert.equal(h.detector.getStatus().isGenerating, true);
  thread.querySelector('[role="status"]').remove();
  await h.advance(15000);
  assert.equal(h.completions.length, 0);
});

// The signed-out lightweight composer captured on October 13, 2026: one submit
// control, send and stop labels in data attributes, icon spans with <use> links.
function lightweight(t, { send = 'Nachricht senden', stop = 'Generierung stoppen' } = {}) {
  const h = harness({ html: `<main><form>
    <textarea id="mobile-composer-prompt"></textarea>
    <button type="submit" data-composer-submit="" aria-disabled="true" aria-label="${send}"
      data-send-label="${send}" data-stop-label="${stop}">
      <span data-composer-send-icon=""><svg viewBox="0 0 20 20"><use href="#lightweight-composer-send"></use></svg></span>
      <span data-composer-loading-icon="" hidden=""><svg viewBox="0 0 20 20"><circle r="7"></circle></svg></span>
      <span data-composer-stop-icon="" hidden=""><svg viewBox="0 0 20 20"><use href="#lightweight-composer-stop"></use></svg></span>
    </button></form></main>` });
  t.after(h.close);
  h.button = h.document.querySelector('button');
  h.span = name => h.button.querySelector(`[data-composer-${name}-icon]`);
  return h;
}

test('the lightweight composer with German labels completes exactly once', async t => {
  const h = lightweight(t);
  await h.advance(1000);
  assert.equal(h.detector.getStatus().state, 'ready');
  h.button.setAttribute('aria-label', 'Generierung stoppen');
  h.button.removeAttribute('aria-disabled');
  h.span('send').setAttribute('hidden', '');
  h.span('stop').removeAttribute('hidden');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'generating');
  assert.equal(h.completions.length, 0);
  h.button.setAttribute('aria-label', 'Nachricht senden');
  h.button.setAttribute('aria-disabled', 'true');
  h.span('stop').setAttribute('hidden', '');
  h.span('send').removeAttribute('hidden');
  await h.advance(15000);
  assert.equal(h.completions.length, 1);
  assert.equal(h.detector.getStatus().state, 'ready');
  assert.equal(h.refreshes.length, 0);
});

test('the lightweight composer label change alone detects Stop and Send', async t => {
  const h = lightweight(t, { send: 'Envoyer le message', stop: 'Arrêter la génération' });
  h.button.setAttribute('aria-label', 'Arrêter la génération');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'generating');
  h.button.setAttribute('aria-label', 'Envoyer le message');
  await h.advance(2000);
  assert.equal(h.completions.length, 1);
});

test('the lightweight composer icon span change alone detects Stop and Send', async t => {
  const h = lightweight(t, { send: 'x', stop: 'x' });
  h.span('send').setAttribute('hidden', '');
  h.span('stop').removeAttribute('hidden');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'generating');
  h.span('stop').setAttribute('hidden', '');
  h.span('send').removeAttribute('hidden');
  await h.advance(2000);
  assert.equal(h.completions.length, 1);
});

test('the lightweight loading state does not complete a response early', async t => {
  const h = lightweight(t);
  h.button.setAttribute('aria-label', 'Generierung stoppen');
  h.span('send').setAttribute('hidden', '');
  h.span('stop').removeAttribute('hidden');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'generating');
  // A loading phase shows neither label state and only the loading span.
  h.button.setAttribute('aria-label', 'Wird geladen');
  h.span('stop').setAttribute('hidden', '');
  h.span('loading').removeAttribute('hidden');
  await h.advance(5000);
  assert.equal(h.completions.length, 0);
  h.span('loading').setAttribute('hidden', '');
  h.span('stop').removeAttribute('hidden');
  h.button.setAttribute('aria-label', 'Generierung stoppen');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'generating');
  h.button.setAttribute('aria-label', 'Nachricht senden');
  h.span('stop').setAttribute('hidden', '');
  h.span('send').removeAttribute('hidden');
  await h.advance(2000);
  assert.equal(h.completions.length, 1);
});

// Replay of a Brave session with the Dutch interface on October 13, 2026. The
// Send and Stop icons matched. The Voice control after the response had a label
// and an icon this code did not know, so the tab went to controls_missing and
// the ding came only when the user typed the next prompt.
const unknownVoicePath = 'M10 2a3 3 0 0 1 3 3v5a3 3 0 1 1-6 0V5a3 3 0 0 1 3-3Z';

test('an unknown primary control after Stop is idle and completes exactly once', async t => {
  const h = setup(t, 'Spraakmodus starten');
  h.button.innerHTML = `<svg viewBox="0 0 20 20"><path d="${unknownVoicePath}"></path></svg>`;
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'ready');
  assert.equal(h.refreshes.length, 0);
  setIcon(h, 'stop');
  h.button.setAttribute('aria-label', 'Stoppen met genereren');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'generating');
  h.button.setAttribute('aria-label', 'Spraakmodus starten');
  h.button.innerHTML = `<svg viewBox="0 0 20 20"><path d="${unknownVoicePath}"></path></svg>`;
  await h.advance(899);
  assert.equal(h.completions.length, 0);
  await h.advance(15000);
  assert.equal(h.completions.length, 1);
  assert.equal(h.detector.getStatus().state, 'ready');
  assert.equal(h.refreshes.length, 0);
});

test('click and Enter on an unknown primary control are not submissions', async t => {
  const h = setup(t, 'Spraakmodus starten');
  h.button.innerHTML = `<svg viewBox="0 0 20 20"><path d="${unknownVoicePath}"></path></svg>`;
  h.button.click();
  h.document.querySelector('p').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await h.advance(15000);
  assert.equal(h.detector.getStatus().state, 'ready');
  assert.equal(h.detector.getDiagnostics().events.some(e => e.event === 'submission'), false);
});

test('a primary control that shows a loading state is not idle', async t => {
  const h = setup(t, 'Even geduld');
  h.button.innerHTML = '<span data-composer-loading-icon=""><svg viewBox="0 0 20 20"><circle r="7"></circle></svg></span>';
  setIcon(h, 'stop');
  await h.advance(2000);
  assert.equal(h.detector.getStatus().state, 'generating');
  h.button.innerHTML = '<span data-composer-loading-icon=""><svg viewBox="0 0 20 20"><circle r="7"></circle></svg></span>';
  await h.advance(5000);
  assert.equal(h.completions.length, 0);
});

test('an unknown button outside the primary composer set stays unknown', async t => {
  const h = setup(t, 'Spraakmodus starten');
  h.button.classList.remove('bg-composer-primary');
  h.button.innerHTML = `<svg viewBox="0 0 20 20"><path d="${unknownVoicePath}"></path></svg>`;
  await h.advance(15000);
  assert.notEqual(h.detector.getStatus().state, 'ready');
  assert.equal(h.completions.length, 0);
});
