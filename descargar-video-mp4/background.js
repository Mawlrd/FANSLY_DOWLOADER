// Proceso de fondo: lleva la cuenta de los videos detectados en cada pestana,
// arranca y cancela las descargas, y guarda el archivo final en Descargas.
/* global importScripts, chrome */
importScripts('engine.fn.js'); // define self.__hlsEngine (el motor que corre dentro de la pagina)

const BOOT = Date.now(); // cuando arranco este proceso de fondo (el navegador lo duerme y lo despierta solo)
const store = chrome.storage.session;
const M3U8 = /\.m3u8(?![a-z0-9])/i;
const EXTS = ['mp4', 'ts', 'aac', 'mp3', 'ac3', 'bin'];
const LABELS = ['', 'video', 'audio'];

// Los cambios de estado se hacen de a uno para que no se pisen.
let chain = Promise.resolve();
function locked(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}
const get = async (key) => (await store.get(key))[key];
const set = (key, value) => store.set({ [key]: value });
const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
const str = (v, max) => String(v === undefined || v === null ? '' : v).slice(0, max || 300);

function safeName(raw) {
  let s = String(raw || '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '');
  if (s.length > 100) s = s.slice(0, 100).trim();
  if (!s || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = 'video';
  return s;
}

// ---------- Insignia del icono ----------

async function refreshBadge(tabId, job) {
  try {
    if (job === undefined) job = await get('job:' + tabId);
    let text = '';
    let color = '#0F2B36';
    if (job && job.status === 'running') {
      text = job.total ? Math.min(99, Math.floor((100 * job.done) / job.total)) + '%' : '…';
      color = '#8A5A00';
    } else if (job && job.status === 'saving') {
      text = '…';
      color = '#8A5A00';
    } else if (job && job.status === 'done') {
      text = '✓';
      color = '#1F7A50';
    } else if (job && job.status === 'error') {
      text = '!';
      color = '#B3261E';
    } else {
      const list = await get('streams:' + tabId);
      if (list && list.length) { text = '↓'; color = '#0F2B36'; }
    }
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: '#FFFFFF' });
    await chrome.action.setBadgeText({ tabId, text });
  } catch (e) { /* la pestana ya no existe */ }
}

// ---------- Videos detectados ----------

function addStream(tabId, frameId, url, frameUrl) {
  if (!(tabId >= 0) || !/^https?:/i.test(url) || url.length > 4000) return;
  locked(async () => {
    const key = 'streams:' + tabId;
    const list = (await get(key)) || [];
    const hit = list.find((s) => s.url === url);
    if (hit) {
      hit.t = Date.now();
      if (frameId >= 0) hit.frameId = frameId;
    } else {
      list.push({ url, frameId: frameId >= 0 ? frameId : 0, frameUrl: str(frameUrl, 500), t: Date.now() });
      while (list.length > 24) list.shift();
    }
    await set(key, list);
    await refreshBadge(tabId);
  });
}

chrome.webRequest.onHeadersReceived.addListener((d) => {
  if (d.tabId < 0 || d.statusCode >= 400) return;
  let hit = M3U8.test(d.url);
  if (!hit && d.responseHeaders) {
    const ct = d.responseHeaders.find((h) => h.name.toLowerCase() === 'content-type');
    hit = !!(ct && /mpegurl/i.test(ct.value || ''));
  }
  if (hit) addStream(d.tabId, d.frameId, d.url, '');
}, { urls: ['http://*/*', 'https://*/*'], types: ['xmlhttprequest', 'media', 'other'] }, ['responseHeaders']);

// ---------- Descargas ----------

// Se inyecta junto a la pagina: pasa los avisos del motor al proceso de fondo
// y las ordenes (cancelar, soltar memoria) en sentido contrario.
function relay(evt) {
  document.addEventListener(evt, (e) => {
    try {
      const p = chrome.runtime.sendMessage({ type: 'job-event', evt, data: typeof e.detail === 'string' ? e.detail : '' });
      if (p && p.catch) p.catch(() => {});
    } catch (err) { /* la extension se recargo */ }
  });
  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.type === 'job-cmd' && m.evt === evt) {
      document.dispatchEvent(new CustomEvent(evt + ':cmd', { detail: JSON.stringify(m.cmd) }));
    }
  });
  return true;
}

function sendCmd(job, cmd) {
  try {
    const p = chrome.tabs.sendMessage(job.tabId, { type: 'job-cmd', evt: job.evt, cmd }, { frameId: job.frameId });
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* la pestana ya no esta */ }
}

async function keepTab(tabId, keep) {
  try { await chrome.tabs.update(tabId, { autoDiscardable: !keep }); } catch (e) { /* sin esa opcion */ }
}

function startJob(msg) {
  const tabId = Number(msg.tabId);
  const frameId = Number(msg.frameId) || 0;
  const spec = msg.spec || {};
  return locked(async () => {
    if (!(tabId >= 0) || !/^https?:/i.test(String(spec.url || ''))) return { ok: false, error: 'Falta el link del video.' };
    const key = 'job:' + tabId;
    const cur = await get(key);
    if (cur && (cur.status === 'running' || cur.status === 'saving')) return { ok: false, error: 'Ya hay una descarga en marcha en esta pestaña.' };
    if (cur) sendCmd(cur, { type: 'release' });
    const evt = 'hls' + crypto.randomUUID().replace(/-/g, '');
    const job = {
      evt, tabId, frameId, name: safeName(msg.name), status: 'running', phase: 'start', done: 0, total: 0, bytes: 0,
      startedAt: Date.now(), files: [], message: '', code: '', note: '', live: false, mode: spec.mode === 'raw' ? 'raw' : 'mp4',
    };
    await set(key, job);
    try {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: 'ISOLATED', func: relay, args: [evt] });
      const arg = {
        evt, url: String(spec.url), videoUrl: spec.videoUrl ? String(spec.videoUrl) : null, audioUrl: spec.audioUrl ? String(spec.audioUrl) : null,
        mode: job.mode, height: num(spec.height),
      };
      const res = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: 'MAIN', func: self.__hlsEngine, args: [arg] });
      if (!res || !res[0] || res[0].result !== 'started') throw new Error('el motor no arrancó');
    } catch (e) {
      job.status = 'error';
      job.code = 'inject';
      job.message = 'No pude trabajar en esta página. Recargala, dale play al video y probá de nuevo.';
      job.detail = str(e && e.message);
      await set(key, job);
      await refreshBadge(tabId, job);
      return { ok: false, error: job.message };
    }
    await keepTab(tabId, true);
    await refreshBadge(tabId, job);
    return { ok: true };
  });
}

async function saveFile(job, f) {
  const base = job.name + (f.label ? ' (' + f.label + ')' : '');
  // Si el sistema no acepta el nombre (por ejemplo, por los acentos), se prueba sin ellos.
  const plain = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tries = [base + '.' + f.ext];
  if (plain && plain !== base) tries.push(plain + '.' + f.ext);
  tries.push('video' + (f.label ? '-' + f.label : '') + '.' + f.ext);
  for (const filename of tries) {
    try {
      const id = await chrome.downloads.download({ url: f.url, filename, conflictAction: 'uniquify', saveAs: false });
      if (id !== undefined && id !== null) return { id, filename };
    } catch (e) { /* nombre no aceptado: se prueba con uno simple */ }
  }
  return { id: null, filename: tries[0] };
}

async function finishJob(job, d) {
  const list = Array.isArray(d.files) ? d.files.slice(0, 2) : [];
  const files = [];
  for (const f of list) {
    if (!f || typeof f.url !== 'string' || !f.url.startsWith('blob:')) continue;
    if (!EXTS.includes(f.ext) || !LABELS.includes(f.label || '')) continue;
    files.push({ url: f.url, ext: f.ext, label: f.label || '', size: num(f.size) });
  }
  if (!files.length) {
    job.status = 'error';
    job.code = 'empty';
    job.message = 'No quedó ningún archivo para guardar.';
    return;
  }
  const info = d.info || {};
  job.live = !!info.live;
  job.mode = info.mode === 'raw' ? 'raw' : 'mp4';
  job.seconds = num(info.seconds);
  job.note = str(d.note);
  job.notes = Array.isArray(info.notes) ? info.notes.slice(0, 4).map((x) => str(x, 200)) : [];
  job.status = 'saving';
  job.files = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const r = await saveFile(job, f);
    const entry = { index: i, url: f.url, ext: f.ext, label: f.label, size: f.size, filename: r.filename, downloadId: r.id, state: r.id === null ? 'anchor' : 'saving', path: '' };
    job.files.push(entry);
    if (r.id === null) askPage(job, entry);
    else await set('dl:' + r.id, { tabId: job.tabId });
  }
  settle(job);
}

// Plan B: pedirle a la pagina que guarde el archivo con un enlace de descarga.
// El navegador avisa cuando esa descarga aparece (ver onCreated mas abajo).
function askPage(job, f) {
  f.triedAnchor = true;
  f.state = 'anchor';
  f.anchorAt = Date.now();
  f.downloadId = null;
  sendCmd(job, { type: 'anchor', index: f.index, filename: f.filename });
}

// Cuando ya no queda ningun archivo "guardando", cierra el trabajo. Solo se da
// por descargado si el navegador confirmo que cada archivo quedo guardado.
function settle(job) {
  if (job.status !== 'saving') return;
  for (const f of job.files) {
    if (f.state === 'anchor' && Date.now() - (f.anchorAt || 0) > 20000) f.state = 'failed'; // la pagina no pudo
  }
  if (job.files.some((f) => f.state === 'saving' || f.state === 'anchor')) return;
  if (job.files.some((f) => f.state === 'failed')) {
    job.status = 'error';
    job.code = job.files.some((f) => f.cancelled) ? 'save-cancelled' : 'save';
    job.message = job.code === 'save-cancelled' ? 'No se guardó porque cerraste el cuadro de guardar.' : 'El video se descargó entero, pero el navegador no pudo guardar el archivo. Fijate si queda espacio en disco y tocá "Guardar de nuevo".';
  } else {
    job.status = 'done';
    sendCmd(job, { type: 'release' });
  }
  job.endedAt = Date.now();
  keepTab(job.tabId, false);
}

function onJobEvent(tabId, frameId, evt, raw) {
  let d;
  try { d = JSON.parse(raw); } catch (e) { return; }
  if (!d || typeof d !== 'object') return;
  locked(async () => {
    const key = 'job:' + tabId;
    const job = await get(key);
    if (!job || job.evt !== evt || job.frameId !== frameId || job.status !== 'running') return;
    if (d.type === 'progress') {
      job.phase = str(d.phase, 20);
      job.done = num(d.done);
      job.total = num(d.total);
      job.bytes = num(d.bytes);
      if (d.live !== undefined) job.live = !!d.live;
      if (job.phase === 'restart') job.mode = 'raw';
    } else if (d.type === 'done') {
      await finishJob(job, d);
    } else if (d.type === 'error') {
      job.status = d.code === 'aborted' ? 'cancelled' : 'error';
      job.code = str(d.code, 30);
      job.message = str(d.message);
      job.httpStatus = num(d.status);
      job.endedAt = Date.now();
      await keepTab(tabId, false);
    } else return;
    await set(key, job);
    await refreshBadge(tabId, job);
  });
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state && !delta.filename && !delta.error) return;
  locked(async () => {
    const ref = await get('dl:' + delta.id);
    if (!ref) return;
    const key = 'job:' + ref.tabId;
    const job = await get(key);
    const f = job && job.files.find((x) => x.downloadId === delta.id);
    if (!f) { await store.remove('dl:' + delta.id); return; }
    if (delta.filename && delta.filename.current) f.path = str(delta.filename.current, 1000);
    if (delta.state && delta.state.current === 'complete') {
      f.state = 'saved';
      await store.remove('dl:' + delta.id);
    } else if (delta.state && delta.state.current === 'interrupted') {
      const why = (delta.error && delta.error.current) || '';
      if (why === 'USER_CANCELED') { f.state = 'failed'; f.cancelled = true; }
      else if (!f.triedAnchor) askPage(job, f);
      else f.state = 'failed';
      await store.remove('dl:' + delta.id);
    }
    settle(job);
    await set(key, job);
    await refreshBadge(ref.tabId, job);
  });
});

// Descarga iniciada por la pagina (plan B): se adopta para seguirle el rastro.
chrome.downloads.onCreated.addListener((item) => {
  if (!item || typeof item.url !== 'string' || !item.url.startsWith('blob:')) return;
  locked(async () => {
    const all = await store.get(null);
    for (const key of Object.keys(all)) {
      const job = all[key];
      if (!key.startsWith('job:') || !job || job.status !== 'saving') continue;
      const f = job.files.find((x) => x.state === 'anchor' && x.url === item.url);
      if (!f) continue;
      f.downloadId = item.id;
      f.state = 'saving';
      await set('dl:' + item.id, { tabId: job.tabId });
      await set(key, job);
      return;
    }
  });
});

// La ventanita avisa cada segundo mientras se guarda: sirve para dar por
// fallido un plan B que nunca arranco.
function tick(tabId) {
  return locked(async () => {
    const key = 'job:' + tabId;
    const job = await get(key);
    if (!job || job.status !== 'saving') return { ok: true };
    settle(job);
    if (job.status !== 'saving') { await set(key, job); await refreshBadge(tabId, job); }
    return { ok: true };
  });
}

function cancelJob(tabId) {
  return locked(async () => {
    const key = 'job:' + tabId;
    const job = await get(key);
    if (!job) return { ok: true };
    if (job.status === 'running') {
      sendCmd(job, { type: 'cancel' });
      sendCmd(job, { type: 'release' });
      job.status = 'cancelled';
      job.endedAt = Date.now();
      await set(key, job);
      await keepTab(tabId, false);
    }
    await refreshBadge(tabId, job);
    return { ok: true };
  });
}

function clearJob(tabId) {
  return locked(async () => {
    const key = 'job:' + tabId;
    const job = await get(key);
    if (job && (job.status === 'running' || job.status === 'saving')) return { ok: false };
    if (job) sendCmd(job, { type: 'release' });
    await store.remove(key);
    await refreshBadge(tabId, null);
    return { ok: true };
  });
}

// Vuelve a intentar guardar un archivo que ya esta armado (por ejemplo, si se cerro el cuadro de guardar).
function saveAgain(tabId) {
  return locked(async () => {
    const key = 'job:' + tabId;
    const job = await get(key);
    if (!job || job.status !== 'error' || !job.files || !job.files.length) return { ok: false };
    job.status = 'saving';
    job.message = '';
    for (const f of job.files) {
      if (f.state === 'saved') continue;
      const r = await saveFile(job, f);
      f.downloadId = r.id;
      f.cancelled = false;
      f.triedAnchor = false;
      f.state = 'saving';
      if (r.id === null) askPage(job, f);
      else await set('dl:' + r.id, { tabId });
    }
    settle(job);
    await set(key, job);
    await refreshBadge(tabId, job);
    return { ok: true };
  });
}

// ---------- Mensajes ----------

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg !== 'object' || sender.id !== chrome.runtime.id) return undefined;
  const fromPage = !!sender.tab && !(sender.url || '').startsWith(chrome.runtime.getURL(''));
  if (fromPage) {
    if (msg.type === 'found') addStream(sender.tab.id, sender.frameId, str(msg.url, 4000), sender.url);
    else if (msg.type === 'job-event') onJobEvent(sender.tab.id, sender.frameId, str(msg.evt, 80), typeof msg.data === 'string' ? msg.data : '');
    return undefined;
  }
  const tabId = Number(msg.tabId);
  let p = null;
  if (msg.type === 'start') p = startJob(msg);
  else if (msg.type === 'cancel') p = cancelJob(tabId);
  else if (msg.type === 'clear') p = clearJob(tabId);
  else if (msg.type === 'save-again') p = saveAgain(tabId);
  else if (msg.type === 'tick') p = tick(tabId);
  else if (msg.type === 'show') { try { chrome.downloads.show(Number(msg.id)); } catch (e) { /* ya no existe */ } }
  else if (msg.type === 'ping') { reply({ ok: true, boot: BOOT }); return undefined; }
  if (!p) return undefined;
  p.then((r) => reply(r), (e) => reply({ ok: false, error: str(e && e.message) }));
  return true;
});

// ---------- Vida de las pestanas ----------

chrome.tabs.onRemoved.addListener((tabId) => {
  locked(() => store.remove(['streams:' + tabId, 'job:' + tabId]));
});

chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.tabId < 0 || d.documentLifecycle === 'prerender') return;
  locked(async () => {
    const jk = 'job:' + d.tabId;
    const job = await get(jk);
    let shown = job;
    if (job && (d.frameId === 0 || d.frameId === job.frameId)) {
      if (job.status === 'running') {
        job.status = 'error';
        job.code = 'gone';
        job.message = 'La página se recargó o cambió antes de terminar.';
        job.endedAt = Date.now();
        await set(jk, job);
        await keepTab(d.tabId, false);
      } else if (job.status === 'done' || job.status === 'cancelled') {
        await store.remove(jk);
        shown = null;
      }
    }
    const sk = 'streams:' + d.tabId;
    const list = await get(sk);
    if (list && list.length) {
      const keep = d.frameId === 0 ? [] : list.filter((s) => s.frameId !== d.frameId);
      if (keep.length !== list.length) await set(sk, keep);
    }
    await refreshBadge(d.tabId, shown);
  });
});

// Al instalar: pone el detector en las pestanas que ya estaban abiertas.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const t of tabs) {
      try { await chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['detector.js'] }); } catch (e) { /* pagina protegida */ }
    }
  } catch (e) { /* sin pestanas */ }
});
