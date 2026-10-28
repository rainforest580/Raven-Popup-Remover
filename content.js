(() => {
  'use strict';
  if (window.__ravenPopupRemoverLoadedV10) return;
  window.__ravenPopupRemoverLoadedV10 = true;

  const ACCEPT = /^(?:accept\s+all(?:\s+cookies)?|allow\s+all(?:\s+cookies)?|agree\s+to\s+all|agree\s+and\s+continue|i\s+accept\s+all|yes,?\s+i\s+agree|accept\s+everything|(?:accept|allow)\s+(?:additional|optional|analytics)\s+cookies|tout\s+accepter|alle\s+akzeptieren|alle\s+cookies\s+akzeptieren|aceptar\s+tod[oa]s?|accetta\s+tutti|alles\s+accepteren|接受全部|全部接受|同意全部)$/i;
  const ACCEPT_SHORT = /^(?:accept|i agree|agree|allow cookies|accept cookies|got it|ok)$/i;
  const REJECT = /^(?:reject\s+all(?:\s+cookies)?|decline\s+all(?:\s+cookies)?|refuse\s+all(?:\s+cookies)?|deny\s+all(?:\s+cookies)?|disallow\s+all|(?:reject|decline|refuse)\s+(?:additional|optional|analytics|non-essential)\s+cookies|do\s+not\s+(?:accept|allow|consent)|only\s+necessary(?:\s+cookies)?|necessary\s+only|essential\s+only|use\s+necessary\s+cookies\s+only|continue\s+without\s+(?:accepting|consenting)|tout\s+refuser|alle\s+ablehnen|alle\s+cookies\s+ablehnen|rechazar\s+tod[oa]s?|rifiuta\s+tutti|alles\s+weigeren|拒绝全部|全部拒绝|仅必要)$/i;
  const CONTEXT = /cookie|consent|privacy|gdpr|tracking|your choices|your preferences|隐私|同意|쿠키|galletas|datenschutz/i;
  const BUTTONS = 'button, button-secondary, button-primary, input[type="button"], input[type="submit"], [role="button"], a';
  const observedRoots = new WeakSet();
  const attempted = new WeakSet();
  let mode = 'off';
  let whitelist = [];
  let ready = false;
  const currentHost = location.hostname.toLowerCase().replace(/\.$/, '');
  const isWhitelisted = () => whitelist.some(h => currentHost === h || currentHost.endsWith('.' + h));
  const isPaused = () => !ready || mode === 'off' || isWhitelisted();
  let scheduled = false;
  let lastClick = 0;

  chrome.storage.local.get({mode:null, enabled:true, whitelist:[]}, result => {
    mode = ['accept','reject','off'].includes(result.mode) ? result.mode : (result.enabled === false ? 'off' : 'accept');
    whitelist = Array.isArray(result.whitelist) ? result.whitelist.filter(h => typeof h === 'string') : [];
    ready = true;
    schedule();
  });
  chrome.storage.onChanged.addListener(changes => {
    if (changes.mode) mode = ['accept','reject','off'].includes(changes.mode.newValue) ? changes.mode.newValue : 'off';
    if (changes.whitelist) whitelist = Array.isArray(changes.whitelist.newValue) ? changes.whitelist.newValue : [];
    schedule();
  });

  function normalized(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
  function label(el) {
    return normalized(el.getAttribute('aria-label') || el.innerText || el.textContent || el.getAttribute('title') || el.value).slice(0, 160);
  }
  function visible(el) {
    if (!el.isConnected || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0 &&
      r.width >= 2 && r.height >= 2 && r.bottom >= 0 && r.right >= 0 &&
      r.top <= innerHeight && r.left <= innerWidth;
  }
  function attributes(el) {
    return [el.localName, el.id, typeof el.className === 'string' ? el.className : '',
      el.getAttribute('role'), el.getAttribute('aria-label'), el.getAttribute('data-testid')]
      .filter(Boolean).join(' ');
  }
  function text(el) { return normalized(el?.innerText || el?.textContent).slice(0, 6000); }
  function getComposedParent(el) {
    return el.parentElement || el.getRootNode()?.host || null;
  }
  function inConsentContext(el, allowShort) {
    let ancestor = el;
    for (let i = 0; ancestor && i < 24; i++, ancestor = getComposedParent(ancestor)) {
      if (CONTEXT.test(attributes(ancestor))) return true;
      if (i > 0 && i < 15) {
        const t = text(ancestor);
        if (/your cookie choices/i.test(t) && /reject all|save preferences|site usage measurement/i.test(t)) return true;
        if (CONTEXT.test(t) && /reject all|manage preferences|save preferences|cookie settings|necessary cookies|marketing cookies/i.test(t)) return true;
      }
    }
    return !allowShort && false;
  }
  function click(el) {
    if (isPaused() || attempted.has(el) || !visible(el) || Date.now() - lastClick < 900) return false;
    attempted.add(el);
    lastClick = Date.now();
    el.click();
    return true;
  }
  function scanRoot(root) {
    if (isPaused()) return false;
    // Verified Cambridge markup: <cookie-consent policy="cwp"> has an OPEN shadow root
    // containing <button-secondary>Accept all</button-secondary>.
    // Search each root AND all descendant open shadow roots.
    const hosts = root.querySelectorAll('cookie-consent');
    for (const host of hosts) {
      if (!host.shadowRoot) continue;
      observeRoot(host.shadowRoot);
      const buttons = host.shadowRoot.querySelectorAll(BUTTONS);
      for (const btn of buttons) {
        if ((mode === 'accept' ? ACCEPT : REJECT).test(label(btn)) && click(btn)) return true;
      }
    }

    for (const el of root.querySelectorAll(BUTTONS)) {
      const name = label(el);
      const acceptShort = mode === 'accept' && ACCEPT_SHORT.test(name);
      if (!(mode === 'accept' ? (ACCEPT.test(name) || acceptShort) : REJECT.test(name))) continue;
      if (!inConsentContext(el, acceptShort)) continue;
      if (click(el)) return true;
    }
    for (const el of root.querySelectorAll('*')) {
      if (!el.shadowRoot) continue;
      observeRoot(el.shadowRoot);
      if (scanRoot(el.shadowRoot)) return true;
    }
    return false;
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      if (isPaused()) return;
      try { scanRoot(document); } catch (e) { console.debug('Raven Pop-up Remover:', e); }
    }, 120);
  }
  function observeRoot(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
    const observer = new MutationObserver(schedule);
    observer.observe(root, {subtree:true, childList:true, characterData:true});
  }
  function start() {
    observeRoot(document.documentElement);
    schedule();
  }
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, {once:true});
  // Custom elements can attach a shadow root after their host is added.
  // This lightweight periodic check also covers delayed hydration.
  setInterval(schedule, 2500);
})();
