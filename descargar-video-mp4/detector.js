// Corre en cada pagina y avisa cuando ve pasar una lista de video (.m3u8).
(() => {
  if (globalThis.__hlsDetector) return;
  globalThis.__hlsDetector = true;
  const RE = /\.m3u8(?![a-z0-9])/i;
  const seen = new Set();
  let dead = false;
  const report = (url) => {
    if (dead || typeof url !== 'string' || seen.size > 300 || seen.has(url)) return;
    if (!/^https?:/i.test(url) || !RE.test(url)) return;
    seen.add(url);
    try {
      const p = chrome.runtime.sendMessage({ type: 'found', url });
      if (p && p.catch) p.catch(() => {});
    } catch (e) { dead = true; }
  };
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) report(e.name); }).observe({ type: 'resource', buffered: true });
  } catch (e) { /* navegador sin esta funcion */ }
  const scan = () => {
    try { for (const el of document.querySelectorAll('video[src], audio[src], video source[src], audio source[src]')) report(el.src); } catch (e) { /* sin acceso al documento */ }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once: true });
  else scan();
})();
