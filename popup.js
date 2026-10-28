const radios = [...document.querySelectorAll('input[name="mode"]')];
const checkbox = document.getElementById('allowlist');
const site = document.getElementById('site');
let currentHost = null;
function hostFor(url) {
  try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) ? u.hostname.toLowerCase().replace(/\.$/, '') : null; }
  catch { return null; }
}
const covers = (host, entry) => host === entry || host.endsWith('.' + entry);
chrome.storage.local.get({mode:null, enabled:true}, ({mode,enabled}) => {
  const selected = ['accept','reject','off'].includes(mode) ? mode : (enabled === false ? 'off' : 'accept');
  const radio = radios.find(r => r.value === selected);
  if (radio) radio.checked = true;
});
for (const radio of radios) radio.addEventListener('change', () => {
  if (!radio.checked) return;
  chrome.storage.local.set({mode:radio.value});
});
chrome.tabs.query({active:true,currentWindow:true}, tabs => {
  currentHost = hostFor(tabs[0]?.url);
  if (!currentHost) {
    site.textContent = 'This page cannot be added to the whitelist.';
    checkbox.disabled = true;
    return;
  }
  site.textContent = currentHost + ' (including its subdomains)';
  chrome.storage.local.get({whitelist:[]}, ({whitelist}) => {
    const entries = Array.isArray(whitelist) ? whitelist : [];
    checkbox.checked = entries.some(entry => covers(currentHost, entry));
  });
});
checkbox.addEventListener('change', () => {
  if (!currentHost) return;
  const desired = checkbox.checked;
  checkbox.disabled = true;
  chrome.storage.local.get({whitelist:[]}, ({whitelist}) => {
    const entries = Array.isArray(whitelist) ? whitelist.filter(h => typeof h === 'string') : [];
    // When removing, remove the exact current host. An ancestor-listed host remains in effect.
    const next = desired ? [...new Set([...entries,currentHost])] : entries.filter(h => h !== currentHost);
    chrome.storage.local.set({whitelist:next}, () => {
      checkbox.checked = next.some(h => covers(currentHost,h));
      checkbox.disabled = false;
    });
  });
});
