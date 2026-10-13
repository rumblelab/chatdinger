// Run in the ChatGPT DevTools Console. The output contains control attributes.
// It does not include prompt text, response text, URLs, or input values.
(() => {
  const editors = [...document.querySelectorAll(
    '#prompt-textarea, textarea[name="prompt-textarea"], #mobile-composer-prompt, [data-mobile-composer-prompt], [data-composer-markdown][contenteditable="true"]'
  )];
  const roots = [...new Set(editors.map(editor => editor.closest('form, [data-composer-surface], [data-mobile-composer], [data-composer-footer-responsive]')).filter(Boolean))];
  const attributes = new Set([
    'id', 'class', 'type', 'role', 'aria-label', 'aria-disabled', 'disabled', 'hidden',
    'data-testid', 'data-composer-submit', 'data-composer-trailing', 'data-composer-surface',
    'data-mobile-composer', 'data-mobile-composer-prompt', 'data-start-dictation',
    'data-start-voice', 'data-stop-generating', 'data-idle-home', 'data-send-label', 'data-stop-label',
    'data-composer-footer-responsive', 'data-composer-markdown'
  ]);
  const describe = element => ({
    tag: element.tagName.toLowerCase(),
    attributes: Object.fromEntries([...element.attributes]
      .filter(attribute => attributes.has(attribute.name))
      .map(attribute => [attribute.name, attribute.value])),
    visible: element.offsetWidth > 0 && element.offsetHeight > 0
  });
  const result = {
    capturedAt: new Date().toISOString(),
    editors: editors.map(describe),
    composers: roots.map(root => ({
      ...describe(root),
      controls: [...root.querySelectorAll('button, a[aria-label], [role="button"]')].map(control => {
        const ancestors = [];
        for (let parent = control.parentElement; parent && parent !== root && ancestors.length < 4; parent = parent.parentElement) {
          ancestors.push(describe(parent));
        }
        const icons = [...control.querySelectorAll('svg')].slice(0, 4).map(svg => ({
          viewBox: svg.getAttribute('viewBox'),
          paths: [...svg.querySelectorAll('path')].slice(0, 8).map(path => path.getAttribute('d')?.slice(0, 2000))
        }));
        return { ...describe(control), ancestors, icons };
      })
    }))
  };
  const json = JSON.stringify(result, null, 2);
  console.log(json);
  return json;
})();
