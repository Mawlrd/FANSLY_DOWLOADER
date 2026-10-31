(() => {
  // src/engine/m3u8.js
  function parseAttrs(s) {
    const out = {};
    const re = /([A-Za-z0-9_-]+)=("([^"]*)"|[^,]*)/g;
    let m;
    while (m = re.exec(s)) out[m[1].toUpperCase()] = m[3] !== void 0 ? m[3] : m[2].trim();
    return out;
  }
  function parseRange(s, prevEnd) {
    if (!s) return null;
    const m = /^(\d+)(?:@(\d+))?$/.exec(String(s).trim());
    if (!m) return null;
    const length = Number(m[1]);
    const offset = m[2] !== void 0 ? Number(m[2]) : prevEnd || 0;
    return { offset, length };
  }
  function parseM3U8(text, baseUrl) {
    if (typeof text !== "string") return { kind: "invalid" };
    const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/).map((l) => l.trim());
    const first = lines.find((l) => l.length > 0);
    if (!first || !first.startsWith("#EXTM3U")) return { kind: "invalid" };
    const abs = (u) => {
      try {
        return new URL(u, baseUrl).href;
      } catch (e) {
        return null;
      }
    };
    if (lines.some((l) => l.startsWith("#EXT-X-STREAM-INF"))) {
      const variants = [];
      const renditions = [];
      let pending = null;
      let drm = false;
      for (const l of lines) {
        if (!l) continue;
        if (l.startsWith("#EXT-X-STREAM-INF:")) {
          pending = parseAttrs(l.slice(18));
          continue;
        }
        if (l.startsWith("#EXT-X-MEDIA:")) {
          const a = parseAttrs(l.slice(13));
          renditions.push({
            type: (a.TYPE || "").toUpperCase(),
            groupId: a["GROUP-ID"] || "",
            name: a.NAME || "",
            language: a.LANGUAGE || "",
            isDefault: a.DEFAULT === "YES",
            autoselect: a.AUTOSELECT === "YES",
            uri: a.URI ? abs(a.URI) : null
          });
          continue;
        }
        if (l.startsWith("#EXT-X-SESSION-KEY:")) {
          const a = parseAttrs(l.slice(19));
          if (a.METHOD && a.METHOD !== "NONE" && a.METHOD !== "AES-128") drm = true;
          continue;
        }
        if (l[0] === "#") continue;
        if (pending) {
          const res = /^(\d+)x(\d+)$/i.exec(pending.RESOLUTION || "");
          const uri = abs(l);
          if (uri) {
            variants.push({
              uri,
              bandwidth: Number(pending.BANDWIDTH) || 0,
              avgBandwidth: Number(pending["AVERAGE-BANDWIDTH"]) || 0,
              width: res ? Number(res[1]) : 0,
              height: res ? Number(res[2]) : 0,
              codecs: pending.CODECS || "",
              frameRate: Number(pending["FRAME-RATE"]) || 0,
              audio: pending.AUDIO || "",
              name: pending.NAME || ""
            });
          }
          pending = null;
        }
      }
      return { kind: "master", variants, renditions, drm };
    }
    const segments = [];
    const lastEnd = /* @__PURE__ */ new Map();
    let dur = 0, sawInf = false, disc = false, key = null, map = null, br = null, gap = false;
    let endList = false, targetDuration = 0, mediaSequence = 0, playlistType = "", iframesOnly = false;
    for (const l of lines) {
      if (!l) continue;
      if (l[0] === "#") {
        if (l.startsWith("#EXTINF:")) {
          dur = parseFloat(l.slice(8)) || 0;
          sawInf = true;
        } else if (l.startsWith("#EXT-X-BYTERANGE:")) br = l.slice(17);
        else if (l.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE")) {
        } else if (l.startsWith("#EXT-X-DISCONTINUITY")) disc = true;
        else if (l.startsWith("#EXT-X-KEY:")) {
          const a = parseAttrs(l.slice(11));
          const method = (a.METHOD || "NONE").toUpperCase();
          key = method === "NONE" ? null : { method, uri: a.URI ? abs(a.URI) : null, iv: a.IV || null, keyFormat: a.KEYFORMAT || "identity" };
        } else if (l.startsWith("#EXT-X-MAP:")) {
          const a = parseAttrs(l.slice(11));
          const uri2 = a.URI ? abs(a.URI) : null;
          map = uri2 ? { uri: uri2, range: parseRange(a.BYTERANGE, 0) } : null;
        } else if (l.startsWith("#EXT-X-ENDLIST")) endList = true;
        else if (l.startsWith("#EXT-X-TARGETDURATION:")) targetDuration = Number(l.slice(22)) || 0;
        else if (l.startsWith("#EXT-X-MEDIA-SEQUENCE:")) mediaSequence = Number(l.slice(22)) || 0;
        else if (l.startsWith("#EXT-X-PLAYLIST-TYPE:")) playlistType = l.slice(21).trim().toUpperCase();
        else if (l.startsWith("#EXT-X-GAP")) gap = true;
        else if (l.startsWith("#EXT-X-I-FRAMES-ONLY")) iframesOnly = true;
        continue;
      }
      if (!sawInf) continue;
      const uri = abs(l);
      if (uri) {
        let range = null;
        if (br) {
          range = parseRange(br, lastEnd.get(uri));
          if (range) lastEnd.set(uri, range.offset + range.length);
        }
        segments.push({ uri, duration: dur, discontinuity: disc, key, map, range, gap });
      }
      dur = 0;
      sawInf = false;
      disc = false;
      br = null;
      gap = false;
    }
    let duration = 0;
    for (const s of segments) duration += s.duration;
    const enc = segments.find((s) => s.key);
    return {
      kind: "media",
      segments,
      endList,
      targetDuration,
      mediaSequence,
      playlistType,
      duration,
      iframesOnly,
      encrypted: enc ? enc.key.method : null
    };
  }
  function sortVariants(master) {
    return master.variants.slice().sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
  }
  function audioFor(master, variant) {
    if (!variant || !variant.audio) return null;
    const group = master.renditions.filter((r) => r.type === "AUDIO" && r.groupId === variant.audio);
    if (!group.length) return null;
    const pick = group.find((r) => r.isDefault) || group.find((r) => r.autoselect) || group[0];
    return pick.uri || null;
  }

  // ext-src/popup.js
  var $ = (id) => document.getElementById(id);
  var VIEWS = ["v-wait", "v-blocked", "v-empty", "v-list", "v-run", "v-done", "v-error"];
  var CELLS = 24;
  var params = new URLSearchParams(location.search);
  var state = { tabId: null, streams: [], job: null, cache: /* @__PURE__ */ new Map(), items: [], analyzing: false, dirty: false };
  function show(view, withManual) {
    for (const v of VIEWS) $(v).hidden = v !== view;
    $("manual").hidden = !withManual;
  }
  function clock(sec) {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    const two = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
  }
  function size(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1).replace(".", ",") + " GB";
    if (bytes >= 1e6) return Math.round(bytes / 1e6) + " MB";
    return Math.max(1, Math.round(bytes / 1e3)) + " KB";
  }
  function cleanTitle(t) {
    return String(t || "").replace(/[\u0000-\u001f<>:"/\\|?*~]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "video";
  }
  function quality(v) {
    if (v.height) return v.height + "p";
    if (v.bandwidth) return Math.round(v.bandwidth / 1e3) + " kbps";
    return "calidad única";
  }
  async function pageFetchText(url) {
    try {
      let r = await fetch(url);
      if (r.status === 401 || r.status === 403) {
        try {
          const r2 = await fetch(url, { credentials: "include" });
          if (r2.ok) r = r2;
        } catch (e) {
        }
      }
      if (!r.ok) return { ok: false, status: r.status };
      const text = await r.text();
      return { ok: true, url: r.url || url, text: text.length > 4e6 ? text.slice(0, 4e6) : text };
    } catch (e) {
      return { ok: false, status: 0 };
    }
  }
  async function fetchVia(frameId, url) {
    try {
      const res = await chrome.scripting.executeScript({ target: { tabId: state.tabId, frameIds: [frameId] }, world: "MAIN", func: pageFetchText, args: [url] });
      return res && res[0] && res[0].result ? res[0].result : { ok: false, status: 0 };
    } catch (e) {
      return { ok: false, status: 0, gone: true };
    }
  }
  async function analyze(stream) {
    const a = { url: stream.url, frameId: stream.frameId, t: stream.t, kind: "dead", pl: null, detail: null };
    const r = await fetchVia(stream.frameId, stream.url);
    if (!r.ok) return a;
    const pl = parseM3U8(r.text, r.url);
    if (pl.kind === "invalid") return a;
    a.kind = pl.kind;
    a.pl = pl;
    if (pl.kind === "master") {
      a.variants = sortVariants(pl);
      if (!a.variants.length) {
        a.kind = "dead";
        return a;
      }
      const d = await fetchVia(stream.frameId, a.variants[0].uri);
      if (d.ok) {
        const dp = parseM3U8(d.text, d.url);
        if (dp.kind === "media") a.detail = dp;
      }
    } else a.detail = pl;
    return a;
  }
  function buildItems() {
    const all = state.streams.map((s) => state.cache.get(s.url)).filter((a) => a && a.kind !== "dead");
    const masters = all.filter((a) => a.kind === "master");
    const used = /* @__PURE__ */ new Set();
    for (const m of masters) {
      for (const v of m.pl.variants) used.add(v.uri);
      for (const r of m.pl.renditions) if (r.uri) used.add(r.uri);
    }
    const seen = /* @__PURE__ */ new Set();
    const medias = [];
    for (const a of all) {
      if (a.kind !== "media" || used.has(a.url)) continue;
      const first = a.pl.segments[0];
      let path0 = "";
      try {
        path0 = first ? new URL(first.uri).pathname : "";
      } catch (e) {
      }
      if (!first || a.pl.iframesOnly || /\.(vtt|webvtt|srt|ttml|dfxp|jpe?g|png|webp)$/i.test(path0)) continue;
      const sig = a.pl.segments.length + "|" + Math.round(a.pl.duration) + "|" + path0;
      if (seen.has(sig)) continue;
      seen.add(sig);
      medias.push(a);
    }
    masters.sort((a, b) => b.t - a.t);
    medias.sort((a, b) => b.pl.duration - a.pl.duration || b.t - a.t);
    return [...masters, ...medias].slice(0, 6);
  }
  function describe(item, variant) {
    const d = item.detail;
    const parts = [];
    if (variant && variant.height) parts.push(variant.height + "p");
    if (d && d.endList && d.duration > 0) {
      const bw = variant ? variant.avgBandwidth || variant.bandwidth : 0;
      if (bw) parts.push("unos " + size(bw / 8 * d.duration));
    }
    return parts.join(", ");
  }
  function renderList() {
    const ul = $("items");
    ul.textContent = "";
    state.items.forEach((item) => {
      const li = document.createElement("li");
      const d = item.detail;
      const title = document.createElement("span");
      title.className = "title";
      if (d && !d.endList) title.textContent = "Video en vivo";
      else if (d && d.duration > 0) title.textContent = "Video de " + clock(d.duration);
      else title.textContent = "Video";
      const sub = document.createElement("span");
      sub.className = "sub";
      const locked = d && d.encrypted || item.kind === "master" && item.pl.drm;
      li.append(title, sub);
      if (locked) {
        li.className = "locked";
        sub.textContent = "Está protegido contra copia: no se puede guardar.";
        ul.append(li);
        return;
      }
      let select = null;
      const info = document.createElement("span");
      if (item.kind === "master" && item.variants.length > 1) {
        select = document.createElement("select");
        select.setAttribute("aria-label", "Calidad");
        item.variants.forEach((v, i) => {
          const o = document.createElement("option");
          o.value = String(i);
          o.textContent = quality(v) + (i === 0 ? " (la mejor)" : "");
          select.append(o);
        });
        sub.append(select, document.createTextNode(" "));
      }
      sub.append(info);
      const variantNow = () => item.kind === "master" ? item.variants[select ? Number(select.value) : 0] : null;
      const refresh = () => {
        let text = describe(item, variantNow());
        if (select) text = text.replace(/^\d+p,?\s*/, "");
        if (d && !d.endList) text = (text ? text + ". " : "") + "Se guarda solo lo que hay hasta ahora.";
        info.textContent = text;
      };
      refresh();
      if (select) select.addEventListener("change", refresh);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Descargar";
      btn.addEventListener("click", () => {
        const v = variantNow();
        const spec = v ? { url: item.url, videoUrl: v.uri, audioUrl: audioFor(item.pl, v), height: v.height } : { url: item.url };
        startDownload(item.frameId, spec, btn, $("list-error"));
      });
      li.append(btn);
      ul.append(li);
    });
  }
  async function startDownload(frameId, spec, btn, errBox) {
    errBox.hidden = true;
    btn.disabled = true;
    if ($("raw").checked) spec.mode = "raw";
    let r = null;
    try {
      r = await chrome.runtime.sendMessage({ type: "start", tabId: state.tabId, frameId, name: $("name").value, spec });
    } catch (e) {
      r = null;
    }
    btn.disabled = false;
    if (!r || !r.ok) {
      errBox.textContent = r && r.error || "No pude arrancar la descarga. Recargá la página y probá de nuevo.";
      errBox.hidden = false;
    }
  }
  async function refreshList() {
    if (state.analyzing) {
      state.dirty = true;
      return;
    }
    state.analyzing = true;
    try {
      do {
        state.dirty = false;
        const recent = state.streams.slice().sort((a, b) => b.t - a.t).slice(0, 12);
        const todo = recent.filter((s) => !state.cache.has(s.url));
        if (todo.length && !state.items.length) show("v-wait", false);
        await Promise.all(todo.map(async (s) => {
          state.cache.set(s.url, await analyze(s));
        }));
        state.items = buildItems();
      } while (state.dirty);
    } finally {
      state.analyzing = false;
    }
    if (state.job) return;
    if (state.items.length) {
      renderList();
      show("v-list", true);
    } else show("v-empty", true);
  }
  function renderStrip(fraction) {
    const strip = $("strip");
    if (strip.childElementCount !== CELLS) {
      strip.textContent = "";
      for (let i = 0; i < CELLS; i++) strip.append(document.createElement("i"));
    }
    const exact = Math.max(0, Math.min(1, fraction)) * CELLS;
    const cells = strip.children;
    for (let i = 0; i < CELLS; i++) {
      const fill = Math.max(0, Math.min(1, exact - i));
      cells[i].className = fill >= 1 ? "full" : "";
      cells[i].style.background = fill > 0 && fill < 1 ? `linear-gradient(to right, var(--amber) ${Math.round(fill * 100)}%, var(--line) ${Math.round(fill * 100)}%)` : "";
    }
    strip.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
  }
  function renderRun(job) {
    const frac = job.status === "saving" || job.phase === "assemble" ? 1 : job.total ? job.done / job.total : 0;
    $("pct").textContent = String(Math.min(100, Math.floor(frac * 100)));
    renderStrip(frac);
    let line = "Leyendo la lista del video…";
    let eta = "";
    if (job.status === "saving") line = "Guardando en Descargas…";
    else if (job.phase === "assemble") line = "Armando el archivo…";
    else if (job.phase === "restart") line = "Este video no se puede pasar a mp4. Lo descargo tal cual…";
    else if (job.phase === "wait") line = "El navegador está haciendo lugar para seguir…";
    else if (job.total) {
      line = `Descargando: ${job.done} de ${job.total} pedazos, ${size(job.bytes)}`;
      const elapsed = (Date.now() - job.startedAt) / 1e3;
      if (job.done >= 3 && frac > 0.03 && frac < 1) {
        const left = elapsed * (1 - frac) / frac;
        eta = left < 50 ? "Falta menos de un minuto." : `Falta aprox. ${Math.max(1, Math.round(left / 60))} min.`;
      }
      if (job.mode === "raw") eta = (eta ? eta + " " : "") + "Se guarda sin convertir.";
    }
    $("run-line").textContent = line;
    $("run-eta").textContent = eta;
    $("cancel").hidden = job.status === "saving";
    show("v-run", false);
  }
  var baseName = (p) => String(p || "").split(/[\\/]/).pop();
  function renderDone(job) {
    const names = job.files.map((f) => baseName(f.path) || f.filename);
    $("done-file").textContent = names.join(" y ");
    const total = job.files.reduce((n, f) => n + (f.size || 0), 0);
    $("done-where").textContent = "Está en tu carpeta de Descargas" + (total ? ` (${size(total)}` + (job.seconds ? `, ${clock(job.seconds)} de video)` : ")") : "") + ".";
    const notes = [];
    if (job.mode === "raw") notes.push((job.note ? job.note + " " : "") + "Quedó guardado sin convertir; se puede ver con VLC.");
    if (job.live) notes.push("Era una transmisión en vivo: se guardó lo que había hasta ese momento.");
    if (job.files.length > 1) notes.push("El video y el audio vienen separados, por eso son dos archivos.");
    for (const n of job.notes || []) notes.push(n.charAt(0).toUpperCase() + n.slice(1) + ".");
    $("done-note").textContent = notes.join(" ");
    $("done-note").hidden = !notes.length;
    const withId = job.files.find((f) => f.state === "saved" && f.downloadId !== null && f.downloadId !== void 0);
    $("show").hidden = !withId;
    $("show").onclick = () => chrome.runtime.sendMessage({ type: "show", id: withId.downloadId });
    show("v-done", false);
  }
  function explain(job) {
    const st = job.httpStatus;
    if (job.code === "http") {
      if (st === 401 || st === 403) return `El servidor rechazó el pedido (error ${st}). Casi siempre es porque el link venció: recargá la página, dale play al video y probá de nuevo.`;
      if (st === 404 || st === 410) return `El servidor ya no tiene ese video (error ${st}). Recargá la página, dale play y probá de nuevo.`;
      return `El servidor del video falló (error ${st}). Probá de nuevo en un rato.`;
    }
    if (job.code === "network") return "Se cortó la conexión con el servidor del video. Revisá tu internet y probá de nuevo.";
    if (job.code === "bug") return "Algo falló adentro de la extensión: " + job.message;
    return job.message || "No se pudo descargar.";
  }
  function renderError(job) {
    const locked = job.code === "encrypted" || job.code === "drm";
    $("err-title").textContent = locked ? "Este video no se puede guardar" : job.code === "save" || job.code === "save-cancelled" ? "No se guardó el archivo" : "No se pudo descargar";
    $("err-msg").textContent = explain(job);
    $("resave").hidden = !(job.code === "save" || job.code === "save-cancelled");
    $("retry").className = $("resave").hidden ? "" : "quiet";
    show("v-error", false);
  }
  function render() {
    const job = state.job;
    if (job && (job.status === "running" || job.status === "saving")) return renderRun(job);
    if (job && job.status === "done") return renderDone(job);
    if (job && job.status === "error") return renderError(job);
    if (job && job.status === "cancelled") {
      chrome.runtime.sendMessage({ type: "clear", tabId: state.tabId }).catch(() => {
      });
      state.job = null;
    }
    if (!state.streams.length) return show("v-empty", true);
    return refreshList();
  }
  async function currentTab() {
    if (params.has("tabId")) return chrome.tabs.get(Number(params.get("tabId")));
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }
  async function init() {
    let tab = null;
    try {
      tab = await currentTab();
    } catch (e) {
      tab = null;
    }
    if (!tab || !/^https?:/i.test(tab.url || "")) return show("v-blocked", false);
    state.tabId = tab.id;
    $("name").value = cleanTitle(tab.title);
    const sk = "streams:" + tab.id, jk = "job:" + tab.id;
    const data = await chrome.storage.session.get([sk, jk]);
    state.streams = data[sk] || [];
    state.job = data[jk] || null;
    chrome.storage.session.onChanged.addListener((changes) => {
      let touched = false;
      if (changes[sk]) {
        state.streams = changes[sk].newValue || [];
        touched = true;
      }
      if (changes[jk]) {
        state.job = changes[jk].newValue || null;
        touched = true;
      }
      if (touched) render();
    });
    setInterval(() => {
      if (!state.job) return;
      if (state.job.status === "running") renderRun(state.job);
      else if (state.job.status === "saving") chrome.runtime.sendMessage({ type: "tick", tabId: state.tabId }).catch(() => {
      });
    }, 1e3);
    $("cancel").addEventListener("click", () => chrome.runtime.sendMessage({ type: "cancel", tabId: state.tabId }));
    const back = () => chrome.runtime.sendMessage({ type: "clear", tabId: state.tabId });
    $("again").addEventListener("click", back);
    $("retry").addEventListener("click", back);
    $("resave").addEventListener("click", () => chrome.runtime.sendMessage({ type: "save-again", tabId: state.tabId }));
    $("go").addEventListener("click", async () => {
      const box = $("manual-error");
      box.hidden = true;
      const link = $("link").value.trim();
      let origin = "";
      try {
        const u = new URL(link);
        if (!/^https?:$/.test(u.protocol)) throw new Error("x");
        origin = u.origin;
      } catch (e) {
        box.textContent = "Eso no parece un link. Tiene que empezar con https://";
        box.hidden = false;
        return;
      }
      let frameId = 0;
      try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId: state.tabId }) || [];
        const hit = frames.find((f) => {
          try {
            return new URL(f.url).origin === origin;
          } catch (e) {
            return false;
          }
        });
        if (hit) frameId = hit.frameId;
      } catch (e) {
      }
      startDownload(frameId, { url: link }, $("go"), box);
    });
    render();
  }
  init();
})();
