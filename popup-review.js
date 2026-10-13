'use strict';

(() => {
  const link = document.getElementById('review-link');
  let clicked = false;

  chrome.storage.local.get('reviewLinkClicked').then(stored => {
    if (!clicked && stored.reviewLinkClicked !== true) link.classList.add('review-unread');
  }).catch(() => {});

  async function recordClick() {
    clicked = true;
    link.classList.remove('review-unread');
    try {
      await chrome.storage.local.set({ reviewLinkClicked: true });
    } catch (_error) {
      // A storage error must not prevent access to the review page.
    }
  }

  link.addEventListener('click', async event => {
    event.preventDefault();
    await recordClick();
    try {
      await chrome.tabs.create({ url: link.href, active: !event.ctrlKey && !event.metaKey });
    } catch (_error) {
      window.open(link.href, '_blank', 'noopener,noreferrer');
    }
  });
  link.addEventListener('auxclick', event => {
    if (event.button === 1) recordClick();
  });
})();
