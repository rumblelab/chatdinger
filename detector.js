(function initDetector(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatDingerDetector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDetectorAPI() {
  'use strict';

  const EDITORS = '#prompt-textarea, textarea[name="prompt-textarea"], #mobile-composer-prompt, [data-mobile-composer-prompt], [data-composer-markdown][contenteditable="true"], main textarea, main [contenteditable="true"][role="textbox"]';
  const BUTTONS = [
    '[data-composer-footer-responsive] button[aria-label="Stop"]',
    '[data-composer-footer-responsive] button.bg-composer-primary',
    'button[data-composer-submit]', 'button[data-stop-generating]', '#composer-submit-button',
    'button[data-testid$="stop-button"]', 'button[data-testid$="send-button"]',
    'button[aria-label="Stop generating"]', 'button[aria-label="Stop streaming"]',
    'button[aria-label="Send"]', 'button[aria-label="Send message"]', 'button[aria-label="Send prompt"]',
    'button.composer-submit-button-color', '[data-start-voice]'
  ];
  const GRACE_MS = 12000;
  const IDLE_MS = 900;
  const STALLED_MS = 30 * 60 * 1000;
  const RETRY_MS = [30000, 120000, 300000, 900000];
  const BUILD = 'creation-history-7';

  function visible(element) {
    return Boolean(element?.isConnected && element.getClientRects().length
      && !element.closest('[hidden], [aria-hidden="true"]'));
  }

  function query(root, selector) {
    try { return [...root.querySelectorAll(selector)]; } catch { return []; }
  }

  function composerRoot(editor) {
    return editor.closest('form, [data-composer-surface], [data-mobile-composer], [data-composer-footer-responsive]') || editor.parentElement;
  }

  function findComposer(document) {
    const composers = query(document, EDITORS).filter(visible).map(editor => ({ editor, root: composerRoot(editor) }));
    // ChatGPT can show two editors at once. With Canvas open, the large Canvas
    // editor comes first in the page and its container holds no control, so a
    // Brave session on October 13, 2026 never found Send or Stop. Prefer the
    // editor whose container holds a visible composer control.
    return composers.find(({ root }) => BUTTONS.some(selector => query(root, selector).some(visible)))
      || composers[0] || null;
  }

  function create({ document, window, getButtonState, refresh, onComplete, onHealth = () => {}, now = Date.now }) {
    let selectors = [...BUTTONS];
    let enabled = true;
    let running = false;
    let observer = null;
    let interval = null;
    let scanTimer = null;
    let idleTimer = null;
    let startedAt = null;
    let startedByButton = false;
    let submittedAt = null;
    let uncertainSubmission = false;
    let stoppedByUser = false;
    let missingSince = null;
    let attempts = 0;
    let nextRetryAt = 0;
    let refreshing = null;
    let revision = 0;
    let lastHealthKey = '';
    let lastPath = window.location.pathname;
    let lastEntryKey = currentEntryKey();
    let observedBusyElements = [];
    let navigationBusyElements = null;
    let creatingConversation = false;
    let creationEntryKey = null;
    let creationHomeEntryAssigned = false;
    let pendingCreationUntil = null;
    let clickedNavigationPath = null;
    const traceStart = now();
    const events = [];
    let lastSignals = '';
    let health = { state: 'checking', code: null, attempts: 0, nextRetryAt: 0 };

    function routeKind(path) {
      if (/(?:^|\/)c\/new(?:\/|$)/.test(path)) return 'new_conversation';
      if (/(?:^|\/)(?:c|uc)\/[^/]+/.test(path)) return 'conversation';
      if (/^\/images(?:\/|$)/.test(path)) return 'images';
      if (path === '/') return 'home';
      if (/^\/g\//.test(path)) return 'gpt_or_project';
      return 'other';
    }

    function currentEntryKey() {
      const key = window.navigation?.currentEntry?.key;
      return typeof key === 'string' && key ? key : null;
    }

    function clearCreation() {
      creatingConversation = false;
      creationEntryKey = null;
      creationHomeEntryAssigned = false;
      pendingCreationUntil = null;
    }

    function pendingCreation() {
      return pendingCreationUntil !== null && now() < pendingCreationUntil
        && creationEntryKey !== null && creationEntryKey === currentEntryKey();
    }

    function claimCreation() {
      creatingConversation = creatingConversation || creationPage() || pendingCreation();
      creationEntryKey = creatingConversation ? currentEntryKey() : null;
      pendingCreationUntil = null;
    }

    function trace(event, details = {}) {
      events.push({ ms: Math.max(0, now() - traceStart), event, ...details });
      if (events.length > 100) events.shift();
    }

    function signals(state) {
      return { route: routeKind(window.location.pathname), composer: Boolean(state.composer),
        button: Boolean(state.button), buttonVisible: visible(state.button),
        buttonState: state.buttonState.method, imageBusy: state.imageBusy, responseBusy: state.responseBusy, working: state.workingVisible,
        busy: state.busy, idle: state.idle, chatPage: state.chatPage, enabled,
        tracked: startedAt !== null, submitted: submittedAt !== null,
        cancelled: stoppedByUser, navigationBlocked: Boolean(navigationBusyElements), creatingConversation,
        pendingCreation: pendingCreation() };
    }

    function controlSummary(state) {
      const controls = [...new Set(selectors.flatMap(selector => query(document, selector)))].filter(visible);
      const tag = state.composer?.root?.tagName;
      return { visibleEditors: query(document, EDITORS).filter(visible).length,
        globalControls: controls.length,
        scopedControls: state.composer ? controls.filter(control => state.composer.root.contains(control)).length : 0,
        rootTag: ['FORM', 'DIV', 'MAIN', 'SECTION'].includes(tag) ? tag : tag ? 'OTHER' : null,
        footerRoot: Boolean(state.composer?.root?.hasAttribute('data-composer-footer-responsive')) };
    }

    function findButton(composer = findComposer(document)) {
      const scope = composer?.root || document;
      let found = [...new Set(selectors.flatMap(selector => query(scope, selector)))];
      // When the composer container shows no control, add the visible controls
      // from the whole page. Hidden controls stay out of this wider search, and
      // a hidden control inside the container keeps its place below.
      if (composer && !found.some(visible)) {
        const wider = selectors.flatMap(selector => query(document, selector)).filter(visible);
        found = [...new Set([...found, ...wider])];
      }
      // A hidden send control can become Stop without a new DOM element.
      const candidates = found.filter(button => visible(button)
        || (composer && button.isConnected && getButtonState(button).isIdle
          && (button.hasAttribute('data-composer-submit') || button.id === 'composer-submit-button'
            || String(button.getAttribute('data-testid')).endsWith('send-button'))));
      return candidates.find(button => visible(button) && getButtonState(button).isGenerating)
        || candidates.find(button => getButtonState(button).isIdle)
        || null;
    }

    function imageProgress() {
      // Use control attributes only. Never read the response text.
      const control = query(document, '[aria-label*="generating image" i], [aria-label*="creating image" i], [data-testid*="image-generation" i][aria-busy="true"], [data-testid*="image-generation" i] [role="progressbar"]').find(visible);
      if (control) return control;
      // Only the latest assistant message can hold a live progress bar. An
      // older message can keep a progress bar after its work is done.
      const latest = query(document, '[data-message-author-role="assistant"]').at(-1);
      return latest ? query(latest, '[role="progressbar"]').find(visible) || null : null;
    }

    function responseStatus() {
      // Use only the latest turn in the conversation, not sidebar or old status controls.
      for (const thread of query(document, '[data-thread-find-target="conversation"]').filter(visible)) {
        const latest = query(thread, '[data-turn-key]').at(-1);
        if (!visible(latest)) continue;
        const status = query(latest, '[role="status"][aria-busy="true"]').find(visible);
        if (status) return status;
      }
      return null;
    }

    function snapshot() {
      const composer = findComposer(document);
      const button = findButton(composer);
      const state = getButtonState(button);
      // A Working spinner can hold an active response, but cannot start one.
      const workingElement = query(document, '[role="status"][aria-label="Working"]').find(visible);
      const workingVisible = Boolean(workingElement);
      const working = startedAt !== null && workingVisible;
      const image = imageProgress();
      const response = responseStatus();
      const busyElements = [...new Set([
        visible(button) && state.isGenerating ? button : null,
        response, image, working ? workingElement : null
      ].filter(Boolean))];
      const busy = busyElements.length > 0;
      // An unknown primary control is idle only when a recognized Stop control
      // started this response, so the unknown control is what replaced Stop, or
      // when no response is tracked. A status-started response keeps the old rule,
      // because the unknown control could be a Stop this code does not know.
      const trusted = !state.uncertain || startedAt === null || startedByButton;
      const idle = Boolean(composer && button && state.isIdle && !busy && trusted);
      const path = window.location.pathname;
      const imagePage = /^\/images(?:\/|$)/.test(path);
      // Images can start a response before ChatGPT assigns its conversation URL.
      const chatPage = !/^\/(?:auth|plugins|settings|library)(?:\/|$)/.test(path)
        && (!imagePage || Boolean(composer) || startedAt !== null || submittedAt !== null);
      return { composer, button, buttonState: state, imageBusy: Boolean(image), responseBusy: Boolean(response),
        workingVisible, busyElements, busy, idle, chatPage };
    }

    function publish(state, code = null) {
      health = { state, code, attempts, nextRetryAt };
      const key = JSON.stringify(health);
      if (key === lastHealthKey) return;
      lastHealthKey = key;
      trace('health', { ...health });
      onHealth({ ...health });
    }

    function cancelIdle() {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = null;
    }

    function reset(reason = 'reset') {
      trace('reset', { reason, tracked: startedAt !== null, submitted: submittedAt !== null });
      revision++;
      cancelIdle();
      startedAt = null;
      startedByButton = false;
      submittedAt = null;
      uncertainSubmission = false;
      stoppedByUser = false;
      missingSince = null;
      attempts = 0;
      nextRetryAt = 0;
      navigationBusyElements = null;
      clearCreation();
      clickedNavigationPath = null;
    }

    function resetForNavigation(reason = 'navigation') {
      const previousElements = navigationBusyElements || (startedAt !== null ? observedBusyElements : null);
      reset(reason);
      // A route can change before React removes the previous busy control.
      navigationBusyElements = previousElements;
    }

    function syncRoute(navigationType = 'unknown') {
      if (pendingCreationUntil !== null && now() >= pendingCreationUntil) {
        clearCreation();
        trace('creation_expired');
      }
      const path = window.location.pathname;
      const entryKey = currentEntryKey();
      const entryChanged = entryKey !== lastEntryKey;
      if (path === lastPath && !entryChanged) return false;
      const toConversation = ['new_conversation', 'conversation'].includes(routeKind(path));
      const sameCreationEntry = creationEntryKey !== null && creationEntryKey === entryKey;
      const replacingCreation = navigationType === 'replace' && sameCreationEntry;
      const clickedNavigation = clickedNavigationPath === path;
      const activeCreation = creatingConversation && (startedAt !== null || submittedAt !== null);
      // The signed-out app can push a new home entry after Stop appears, then
      // replace that entry with its conversation URL. Own that first push only.
      const assigningHomeEntry = navigationType === 'push' && entryChanged && entryKey !== null
        && path === lastPath && routeKind(path) === 'home' && !creationHomeEntryAssigned
        && activeCreation
        && now() - (startedAt ?? submittedAt) < GRACE_MS;
      const assigningKnownConversation = toConversation
        && ((activeCreation && (creationPage(lastPath) || replacingCreation))
          || (pendingCreation() && replacingCreation));
      const assigningConversation = !clickedNavigation && !navigationBusyElements
        && (assigningHomeEntry || assigningKnownConversation);
      // ChatGPT can replace home with a temporary URL before Stop appears.
      // Remember that entry briefly, without treating the URL as a response start.
      const prepareCreation = enabled && !clickedNavigation && !navigationBusyElements
        && startedAt === null && submittedAt === null && creationPage(lastPath) && toConversation
        && navigationType === 'replace' && entryKey !== null && !entryChanged;
      trace('route', { from: routeKind(lastPath), to: routeKind(path), entryChanged,
        preserved: assigningConversation || prepareCreation });
      lastPath = path;
      lastEntryKey = entryKey;
      clickedNavigationPath = null;
      if (assigningConversation) {
        if (assigningHomeEntry) creationHomeEntryAssigned = true;
        creationEntryKey = entryKey;
        return false;
      }
      if (prepareCreation) {
        reset('creation_assignment');
        creationEntryKey = entryKey;
        pendingCreationUntil = now() + GRACE_MS;
        trace('creation_pending');
        return false;
      }
      resetForNavigation();
      return true;
    }

    function onRouteChange(event) {
      const path = window.location.pathname;
      trace('route_event', { native: event.isTrusted, changed: path !== lastPath });
      if (event.isTrusted && (path !== lastPath || currentEntryKey() !== lastEntryKey)) {
        // Browser history traversal leaves the response behind, including from home.
        resetForNavigation('history');
        lastPath = path;
        lastEntryKey = currentEntryKey();
      } else {
        // App route notifications can assign a new chat URL or repeat the same URL.
        syncRoute();
      }
      queueScan();
    }

    function onEntryChange(event) {
      const path = window.location.pathname;
      const type = ['push', 'replace', 'reload', 'traverse'].includes(event.navigationType)
        ? event.navigationType : 'state';
      const entryChanged = currentEntryKey() !== lastEntryKey;
      trace('entry_change', { type, changed: path !== lastPath, entryChanged });
      // The committed entry identifies history traversal before popstate arrives.
      // Native popstate alone does not identify how a new entry was created.
      if (type === 'traverse' && (path !== lastPath || entryChanged)) {
        resetForNavigation('history');
        lastPath = path;
        lastEntryKey = currentEntryKey();
      } else {
        syncRoute(type);
      }
      queueScan();
    }

    function creationPage(path = window.location.pathname) {
      return ['home', 'images', 'new_conversation', 'gpt_or_project'].includes(routeKind(path));
    }

    function failureCode(state) {
      if (state.busy && startedAt !== null && now() - startedAt >= STALLED_MS) return 'generation_stalled';
      return uncertainSubmission ? 'generation_unconfirmed' : 'controls_missing';
    }

    function reconcile() {
      if (!running) return;
      syncRoute();
      const state = snapshot();
      observedBusyElements = state.busyElements;
      if (navigationBusyElements && !state.busyElements.some(element => navigationBusyElements.includes(element))) navigationBusyElements = null;
      const currentSignals = signals(state);
      const key = JSON.stringify(currentSignals);
      if (key !== lastSignals) { lastSignals = key; trace('signals', { ...currentSignals, ...controlSummary(state) }); }
      if (!enabled) {
        publish('off');
        return;
      }
      if (!state.chatPage) {
        if (startedAt !== null || submittedAt !== null || navigationBusyElements) reset('non_chat_page');
        publish('waiting');
        return;
      }
      if (navigationBusyElements) {
        publish('waiting');
        return;
      }
      if (state.busy && !navigationBusyElements) {
        cancelIdle();
        if (startedAt === null) {
          if (submittedAt === null) claimCreation();
          startedAt = now();
          startedByButton = state.buttonState.isGenerating;
          trace('response_start', { source: state.buttonState.isGenerating ? 'button'
            : state.responseBusy ? 'response-status' : state.imageBusy ? 'image' : 'working' });
        }
        submittedAt = null;
        uncertainSubmission = false;
      } else if (startedAt !== null && state.idle) {
        if (idleTimer === null) {
          trace('idle_pending');
          idleTimer = window.setTimeout(() => {
            idleTimer = null;
            if (!running || !enabled || syncRoute()) return;
            const latest = snapshot();
            if (startedAt === null || !latest.idle || latest.busy) return;
            const duration = Math.max(0, now() - startedAt);
            const cancelled = stoppedByUser;
            trace('response_end', { duration, cancelled });
            startedAt = null;
            startedByButton = false;
            clearCreation();
            stoppedByUser = false;
            queueScan();
            if (!cancelled) onComplete(duration);
          }, IDLE_MS);
        }
      } else {
        // Missing controls and text pauses do not mean that a response is done.
        cancelIdle();
      }

      if (submittedAt !== null && now() - submittedAt >= GRACE_MS) {
        submittedAt = null;
        clearCreation();
        uncertainSubmission = true;
      }
      const stalled = state.busy && startedAt !== null && now() - startedAt >= STALLED_MS;
      const ready = (state.idle || state.busy) && !uncertainSubmission && !stalled;
      if (ready) {
        missingSince = null;
        attempts = 0;
        nextRetryAt = 0;
        publish(state.busy ? 'generating' : 'ready');
        return;
      }
      if (missingSince === null) missingSince = now();
      const code = failureCode(state);
      if (now() - missingSince < GRACE_MS && !uncertainSubmission && !stalled) {
        publish('checking');
        return;
      }
      if (refreshing) publish('recovering', code);
      else if (now() >= nextRetryAt) void recover();
      else publish('unavailable', code);
    }

    function recover({ manual = false } = {}) {
      if (refreshing) return refreshing;
      if (!enabled) return Promise.resolve(getStatus());
      if (!manual && now() < nextRetryAt) return Promise.resolve(getStatus());
      const requestRevision = revision;
      attempts++;
      const retry = RETRY_MS[Math.min(attempts - 1, RETRY_MS.length - 1)];
      nextRetryAt = now() + retry;
      publish('recovering', failureCode(snapshot()));
      refreshing = Promise.resolve().then(refresh).then(result => {
        if (revision !== requestRevision) return;
        if (result?.success && result.config) setSelectors(result.config.mainButtonSelectors);
        if (Number.isFinite(result?.retryAfterMs)) nextRetryAt = now() + Math.max(retry, result.retryAfterMs);
      }).catch(() => {}).finally(() => {
        refreshing = null;
        reconcile();
      });
      return refreshing.then(getStatus);
    }

    function setSelectors(values) {
      selectors = [...new Set([...(Array.isArray(values) ? values : []), ...BUTTONS])];
      // Keep the response state during selector updates.
    }

    function submitIntent(source) {
      syncRoute();
      trace('submission', { source });
      // A new Send action can reuse the previous chat's control before a scan runs.
      navigationBusyElements = null;
      clickedNavigationPath = null;
      if (startedAt === null && submittedAt === null) claimCreation();
      submittedAt = now();
      uncertainSubmission = false;
      stoppedByUser = false;
      queueScan();
    }

    function onSubmit(event) {
      const state = getButtonState(event.submitter);
      if (state.isGenerating || state.isVoice || state.uncertain || event.submitter?.disabled
        || event.submitter?.getAttribute('aria-disabled') === 'true') return;
      const composer = findComposer(document);
      if (composer && (event.target === composer.root || event.target.contains(composer.editor))) submitIntent('submit');
    }

    function onKey(event) {
      const button = findButton();
      const state = getButtonState(button);
      const editor = findComposer(document)?.editor;
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing
        && editor?.contains(event.target)
        && visible(button) && state.isIdle && !state.isVoice && !state.uncertain && !button.disabled
        && button.getAttribute('aria-disabled') !== 'true') submitIntent('enter');
    }

    function onClick(event) {
      const control = event.target.closest?.('button, [role="button"], a');
      if (!control) return;
      if (control.matches('a[href]')) {
        const url = new URL(control.href, window.location.href);
        if (url.origin === window.location.origin && url.pathname !== window.location.pathname
          && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0
          && (!control.target || control.target === '_self') && !control.hasAttribute('download')) {
          resetForNavigation('link');
          clickedNavigationPath = url.pathname;
        }
      }
      if (control.getAttribute('aria-label') === 'New chat') resetForNavigation('new_chat');
      const composer = findComposer(document);
      if (!composer?.root.contains(control) || control !== findButton(composer)
        || control.disabled || control.getAttribute('aria-disabled') === 'true') return;
      const state = getButtonState(control);
      trace('control_click', { native: event.isTrusted, buttonState: state.method });
      if (state.isGenerating) { stoppedByUser = true; trace('stop_click'); }
      else if (state.isIdle && !state.isVoice && !state.uncertain) submitIntent('click');
    }

    function queueScan() {
      if (scanTimer !== null) return;
      scanTimer = window.setTimeout(() => {
        scanTimer = null;
        reconcile();
      }, 0);
    }

    function getStatus() {
      const state = snapshot();
      return { success: true, detectorBuild: BUILD, ...health, enabled, isGenerating: state.chatPage && state.busy,
        composerFound: Boolean(state.composer), monitoring: enabled && state.chatPage
          && Boolean(state.idle || state.busy) && !uncertainSubmission && !navigationBusyElements };
    }

    function start() {
      if (running) return;
      running = true;
      trace('start');
      observer = new window.MutationObserver(queueScan);
      observer.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['aria-label', 'data-testid', 'hidden', 'disabled', 'aria-disabled', 'data-stop-generating', 'data-composer-submit', 'data-start-voice', 'aria-busy', 'data-state', 'id', 'd', 'viewBox']
      });
      document.addEventListener('submit', onSubmit, true);
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('click', onClick, true);
      window.addEventListener('popstate', onRouteChange);
      window.navigation?.addEventListener('currententrychange', onEntryChange);
      interval = window.setInterval(reconcile, 1000);
      reconcile();
    }

    function stop() {
      trace('stop');
      running = false;
      revision++;
      observer?.disconnect();
      window.clearInterval(interval);
      window.clearTimeout(scanTimer);
      scanTimer = null;
      cancelIdle();
      document.removeEventListener('submit', onSubmit, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onRouteChange);
      window.navigation?.removeEventListener('currententrychange', onEntryChange);
    }

    function getDiagnostics() {
      reconcile();
      return { build: BUILD, running, signals: signals(snapshot()),
        controls: controlSummary(snapshot()),
        events: events.map(event => ({ ...event })) };
    }

    return { start, stop, check: reconcile, recover, getStatus, getDiagnostics, setSelectors, findButton,
      setEnabled(value) { if (enabled !== value) reset('enabled_changed'); enabled = value; reconcile(); } };
  }

  return Object.freeze({ BUILD, BUTTONS, EDITORS, findComposer, visible, create });
});
