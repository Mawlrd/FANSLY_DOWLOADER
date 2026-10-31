// Motor que corre dentro de la pagina del video (generado desde src/engine).
self.__hlsEngine = function (job) {
var __hlsmp4 = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/engine/page.js
  var page_exports = {};
  __export(page_exports, {
    start: () => start
  });

  // src/engine/util.js
  var JobError = class extends Error {
    constructor(code, message, extra) {
      super(message);
      this.name = "JobError";
      this.code = code;
      this.extra = extra || null;
    }
  };
  function concat(chunks, total) {
    if (total === void 0) {
      total = 0;
      for (const c of chunks) total += c.length;
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
  function concat2(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }
  var u16be = (d, o) => d[o] << 8 | d[o + 1];
  var u32be = (d, o) => (d[o] << 24 | d[o + 1] << 16 | d[o + 2] << 8 | d[o + 3]) >>> 0;
  var i32be = (d, o) => d[o] << 24 | d[o + 1] << 16 | d[o + 2] << 8 | d[o + 3];
  var u64be = (d, o) => u32be(d, o) * 4294967296 + u32be(d, o + 4);
  var i64be = (d, o) => i32be(d, o) * 4294967296 + u32be(d, o + 4);
  var fourcc = (d, o) => String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(new JobError("aborted", "Cancelado"));
      const t = setTimeout(() => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(new JobError("aborted", "Cancelado"));
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
    });
  }

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
  function pickVariant(master, height) {
    const sorted = sortVariants(master);
    if (!sorted.length) return null;
    let variant = sorted[0];
    if (height) {
      const exact = sorted.find((v) => v.height === height);
      if (exact) variant = exact;
    }
    return { variant, audioUri: audioFor(master, variant) };
  }

  // src/engine/h264.js
  var BitReader = class {
    constructor(d) {
      this.d = d;
      this.p = 0;
      this.n = d.length * 8;
    }
    bit() {
      if (this.p >= this.n) {
        this.p++;
        return 0;
      }
      const v = this.d[this.p >> 3] >> 7 - (this.p & 7) & 1;
      this.p++;
      return v;
    }
    bits(n) {
      let v = 0;
      for (let i = 0; i < n; i++) v = v * 2 + this.bit();
      return v;
    }
    ue() {
      let z = 0;
      while (z < 32 && this.bit() === 0) z++;
      if (z === 0) return 0;
      if (z >= 32) return 0;
      return Math.pow(2, z) - 1 + this.bits(z);
    }
    se() {
      const k = this.ue();
      return k & 1 ? (k + 1) / 2 : -(k / 2);
    }
    get overrun() {
      return this.p > this.n;
    }
  };
  function unescapeRbsp(u, limit) {
    const n = limit === void 0 ? u.length : Math.min(u.length, limit);
    const out = new Uint8Array(n);
    let o = 0, z = 0;
    for (let i = 0; i < n; i++) {
      const b = u[i];
      if (z >= 2 && b === 3) {
        z = 0;
        continue;
      }
      out[o++] = b;
      z = b === 0 ? z + 1 : 0;
    }
    return out.subarray(0, o);
  }
  var SAR = [null, [1, 1], [12, 11], [10, 11], [16, 11], [40, 33], [24, 11], [20, 11], [32, 11], [80, 33], [18, 11], [15, 11], [64, 33], [160, 99], [4, 3], [3, 2], [2, 1]];
  var HIGH_PROFILES = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135];
  function skipScalingList(r, size) {
    let last = 8, next = 8;
    for (let j = 0; j < size; j++) {
      if (next !== 0) next = (last + r.se() + 256) % 256;
      last = next === 0 ? last : next;
    }
  }
  function parseSps(nal) {
    const r = new BitReader(unescapeRbsp(nal.subarray(1)));
    const profile = r.bits(8);
    const constraints = r.bits(8);
    const level = r.bits(8);
    const id = r.ue();
    let chromaFormat = 1, bitDepthLuma = 8, bitDepthChroma = 8, separatePlanes = 0;
    if (HIGH_PROFILES.includes(profile)) {
      chromaFormat = r.ue();
      if (chromaFormat === 3) separatePlanes = r.bit();
      bitDepthLuma = r.ue() + 8;
      bitDepthChroma = r.ue() + 8;
      r.bit();
      if (r.bit()) {
        const n = chromaFormat !== 3 ? 8 : 12;
        for (let i = 0; i < n; i++) if (r.bit()) skipScalingList(r, i < 6 ? 16 : 64);
      }
    }
    r.ue();
    const pocType = r.ue();
    if (pocType === 0) r.ue();
    else if (pocType === 1) {
      r.bit();
      r.se();
      r.se();
      const n = r.ue();
      for (let i = 0; i < n && i < 256; i++) r.se();
    }
    r.ue();
    r.bit();
    const widthMbs = r.ue() + 1;
    const heightUnits = r.ue() + 1;
    const frameMbsOnly = r.bit();
    if (!frameMbsOnly) r.bit();
    r.bit();
    let cl = 0, cr = 0, ct = 0, cb = 0;
    if (r.bit()) {
      cl = r.ue();
      cr = r.ue();
      ct = r.ue();
      cb = r.ue();
    }
    let sarW = 1, sarH = 1;
    if (r.bit()) {
      if (r.bit()) {
        const idc = r.bits(8);
        if (idc === 255) {
          sarW = r.bits(16);
          sarH = r.bits(16);
        } else if (SAR[idc]) {
          sarW = SAR[idc][0];
          sarH = SAR[idc][1];
        }
      }
    }
    if (!sarW || !sarH) {
      sarW = 1;
      sarH = 1;
    }
    const mono = chromaFormat === 0 || separatePlanes === 1;
    const cropX = mono ? 1 : chromaFormat === 3 ? 1 : 2;
    const cropY = (mono ? 1 : chromaFormat === 1 ? 2 : 1) * (2 - frameMbsOnly);
    const width = widthMbs * 16 - (cl + cr) * cropX;
    const height = heightUnits * 16 * (2 - frameMbsOnly) - (ct + cb) * cropY;
    const ok = !r.overrun && width > 0 && height > 0 && width <= 16384 && height <= 16384;
    return { ok, id, profile, constraints, level, width, height, sarW, sarH, frameMbsOnly, chromaFormat, bitDepthLuma, bitDepthChroma };
  }
  function ppsId(nal) {
    return new BitReader(unescapeRbsp(nal.subarray(1), 8)).ue();
  }
  function sliceInfo(nal) {
    const r = new BitReader(unescapeRbsp(nal.subarray(1), 16));
    const firstMb = r.ue();
    const type = r.ue() % 5;
    return { firstMb, intra: type === 2 || type === 4 };
  }
  function seiHasRecoveryPoint(nal) {
    const d = unescapeRbsp(nal.subarray(1));
    let i = 0;
    while (i + 2 <= d.length) {
      let type = 0;
      while (i < d.length && d[i] === 255) {
        type += 255;
        i++;
      }
      if (i >= d.length) break;
      type += d[i++];
      let size = 0;
      while (i < d.length && d[i] === 255) {
        size += 255;
        i++;
      }
      if (i >= d.length) break;
      size += d[i++];
      if (type === 6) return true;
      i += size;
    }
    return false;
  }
  function buildAvcC(spsList, ppsList, info) {
    const sps0 = spsList[0];
    const parts = [Uint8Array.of(1, sps0[1], sps0[2], sps0[3], 255, 224 | Math.min(spsList.length, 31))];
    for (const s of spsList.slice(0, 31)) parts.push(Uint8Array.of(s.length >> 8, s.length & 255), s);
    parts.push(Uint8Array.of(Math.min(ppsList.length, 255)));
    for (const p of ppsList.slice(0, 255)) parts.push(Uint8Array.of(p.length >> 8, p.length & 255), p);
    if (sps0[1] !== 66 && sps0[1] !== 77 && sps0[1] !== 88) {
      parts.push(Uint8Array.of(252 | info.chromaFormat & 3, 248 | info.bitDepthLuma - 8 & 7, 248 | info.bitDepthChroma - 8 & 7, 0));
    }
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  // src/engine/aac.js
  var AAC_RATES = [96e3, 88200, 64e3, 48e3, 44100, 32e3, 24e3, 22050, 16e3, 12e3, 11025, 8e3, 7350];
  var AdtsAssembler = class {
    constructor(emit) {
      this.emit = emit;
      this.rem = null;
      this.next = void 0;
      this.cfg = null;
      this.inSync = false;
      this.skipped = 0;
      this.reanchors = 0;
      this.unsupported = null;
      this.changed = false;
    }
    push(payload, pts) {
      let buf = payload;
      let remLen = 0;
      if (this.rem) {
        remLen = this.rem.length;
        buf = concat2(this.rem, payload);
        this.rem = null;
      }
      const n = buf.length;
      let i = 0;
      let pesPts = pts;
      while (i + 7 <= n) {
        if (buf[i] !== 255 || (buf[i + 1] & 246) !== 240) {
          i++;
          this.skipped++;
          this.inSync = false;
          continue;
        }
        const hdr = buf[i + 1] & 1 ? 7 : 9;
        const len = (buf[i + 3] & 3) << 11 | buf[i + 4] << 3 | buf[i + 5] >> 5;
        const sfi = buf[i + 2] >> 2 & 15;
        if (len < hdr || sfi > 12) {
          i++;
          this.skipped++;
          this.inSync = false;
          continue;
        }
        if (i + len > n) break;
        if (!this.inSync && i + len + 1 < n && (buf[i + len] !== 255 || (buf[i + len + 1] & 246) !== 240)) {
          i++;
          this.skipped++;
          continue;
        }
        this.inSync = true;
        const aot = (buf[i + 2] >> 6 & 3) + 1;
        const ch = (buf[i + 2] & 1) << 2 | buf[i + 3] >> 6;
        const blocks = (buf[i + 6] & 3) + 1;
        if (!this.cfg) {
          this.cfg = { aot, sfi, ch, sampleRate: AAC_RATES[sfi] };
          if (ch === 0) this.unsupported = "audio AAC con canales no estándar";
        } else if (this.cfg.sfi !== sfi || this.cfg.ch !== ch || this.cfg.aot !== aot) {
          this.changed = true;
        }
        if (blocks !== 1) this.unsupported = "audio AAC con varios bloques por cuadro";
        const samples = blocks * 1024;
        const dur = samples * 9e4 / this.cfg.sampleRate;
        let t, cont = true;
        if (i >= remLen && pesPts !== void 0) {
          if (this.next !== void 0 && Math.abs(pesPts - this.next) <= dur / 2) t = this.next;
          else {
            t = pesPts;
            cont = false;
            if (this.next !== void 0) this.reanchors++;
          }
          pesPts = void 0;
        } else {
          t = this.next;
        }
        if (t !== void 0) {
          this.emit({ data: buf.subarray(i + hdr, i + len), pts: t, samples, cont });
          this.next = t + dur;
        }
        i += len;
      }
      if (i < n) this.rem = buf.slice(i);
    }
    flush() {
      this.rem = null;
    }
  };
  function parsePackedHeader(b) {
    let p = 0;
    let pts;
    while (p + 10 <= b.length && b[p] === 73 && b[p + 1] === 68 && b[p + 2] === 51) {
      const ver = b[p + 3];
      const size = (b[p + 6] & 127) << 21 | (b[p + 7] & 127) << 14 | (b[p + 8] & 127) << 7 | b[p + 9] & 127;
      const end = Math.min(b.length, p + 10 + size);
      let q = p + 10;
      while (q + 10 <= end) {
        const id = String.fromCharCode(b[q], b[q + 1], b[q + 2], b[q + 3]);
        const fsz = ver >= 4 ? (b[q + 4] & 127) << 21 | (b[q + 5] & 127) << 14 | (b[q + 6] & 127) << 7 | b[q + 7] & 127 : (b[q + 4] << 24 | b[q + 5] << 16 | b[q + 6] << 8 | b[q + 7]) >>> 0;
        if (!fsz || b[q] === 0) break;
        const fs = q + 10;
        const fe = Math.min(end, fs + fsz);
        if (id === "PRIV") {
          let z = fs;
          while (z < fe && b[z] !== 0) z++;
          const owner = String.fromCharCode.apply(null, b.subarray(fs, z));
          if (owner === "com.apple.streaming.transportStreamTimestamp" && z + 9 <= fe) {
            const o = z + 1;
            pts = (b[o + 3] & 1) * 4294967296 + ((b[o + 4] << 24 | b[o + 5] << 16 | b[o + 6] << 8 | b[o + 7]) >>> 0);
          }
        }
        q = fe;
      }
      p += 10 + size + (b[p + 5] & 16 ? 10 : 0);
    }
    return { offset: Math.min(p, b.length), pts };
  }
  function sniffPacked(b, offset) {
    for (let i = offset; i + 2 <= b.length && i < offset + 4096; i++) {
      if (b[i] === 255 && (b[i + 1] & 224) === 224) return (b[i + 1] & 6) === 0 ? "aac" : "mp3";
      if (b[i] === 11 && b[i + 1] === 119) return "ac3";
    }
    return "unknown";
  }
  function audioSpecificConfig(cfg) {
    return Uint8Array.of(cfg.aot << 3 | cfg.sfi >> 1, (cfg.sfi & 1) << 7 | cfg.ch << 3);
  }

  // src/engine/ts.js
  var W33 = 8589934592;
  var VIDEO_TYPES = { 27: "h264", 36: "hevc", 1: "mpeg1video", 2: "mpeg2video", 16: "mpeg4", 219: "h264-cifrado" };
  var AUDIO_TYPES = { 15: "aac", 17: "aac-latm", 3: "mp3", 4: "mp3", 129: "ac3", 135: "eac3", 207: "aac-cifrado", 193: "ac3-cifrado", 194: "eac3-cifrado" };
  function trimZeros(buf, start2, end) {
    while (end > start2 && buf[end - 1] === 0) end--;
    return end;
  }
  var H264Assembler = class {
    constructor(emit) {
      this.emit = emit;
      this.carry = null;
      this.carryPes = null;
      this.au = null;
      this.audSeen = false;
      this.interlaced = false;
      this.spsMap = /* @__PURE__ */ new Map();
      this.ppsMap = /* @__PURE__ */ new Map();
      this.info = null;
      this.config = null;
      this.started = false;
      this.dropped = 0;
      this.known = null;
      this.waiting = [];
      this.frameDur = 0;
      this.guessed = 0;
    }
    push(payload, pts, dts) {
      const pes = { pts, dts, used: false, started: false };
      const carryLen = this.carry ? this.carry.length : 0;
      const buf = carryLen ? concat2(this.carry, payload) : payload;
      const n = buf.length;
      let nalStart = carryLen ? 3 : -1;
      let nalPes = carryLen ? this.carryPes : null;
      let i = carryLen ? Math.max(3, carryLen - 2) : 0;
      while (i + 2 < n) {
        const b2 = buf[i + 2];
        if (b2 > 1) {
          i += 3;
          continue;
        }
        if (b2 === 0) {
          i += 1;
          continue;
        }
        if (buf[i] !== 0 || buf[i + 1] !== 0) {
          i += 3;
          continue;
        }
        if (nalStart >= 0) {
          const end = trimZeros(buf, nalStart, i);
          if (end > nalStart) this.nal(buf.subarray(nalStart, end), nalPes);
        }
        nalStart = i + 3;
        nalPes = i + 2 >= carryLen ? pes : this.carryPes;
        i += 3;
      }
      if (nalStart >= 0) {
        this.carry = buf.subarray(nalStart - 3);
        this.carryPes = nalPes;
      } else {
        this.carry = null;
        this.carryPes = null;
      }
    }
    nal(u, pes) {
      const type = u[0] & 31;
      const firstOfPes = !pes.started;
      pes.started = true;
      const au = this.au;
      let startNew = false;
      if (!au) startNew = true;
      else if (this.interlaced && au.pes === pes) startNew = false;
      else if (type === 9) startNew = true;
      else if (au.hasVcl) {
        if (firstOfPes && !this.audSeen) startNew = true;
        else if (!this.audSeen || au.pes === pes) {
          if (type === 6 || type === 7 || type === 8 || type >= 14 && type <= 18) startNew = true;
          else if ((type === 1 || type === 5) && sliceInfo(u).firstMb === 0) startNew = true;
        }
      }
      if (type === 9) this.audSeen = true;
      if (startNew) {
        this.closeAu();
        this.au = { nals: [], bytes: 0, pts: void 0, dts: void 0, pes, hasVcl: false, idr: false, rp: false, intra: false, hasSps: false };
      }
      const cur = this.au;
      if (cur.pts === void 0 && !pes.used && pes.pts !== void 0 && (startNew || firstOfPes)) {
        cur.pts = pes.pts;
        cur.dts = pes.dts;
        pes.used = true;
      }
      if (type === 7) {
        cur.hasSps = true;
        if (!this.started) {
          const info = parseSps(u);
          if (info.ok) {
            this.spsMap.set(info.id, u.slice());
            if (!this.info) {
              this.info = info;
              this.interlaced = !info.frameMbsOnly;
            }
          }
        }
      } else if (type === 8) {
        if (!this.started) this.ppsMap.set(ppsId(u), u.slice());
      } else if (type === 5) {
        cur.hasVcl = true;
        cur.idr = true;
      } else if (type === 1) {
        if (!cur.hasVcl) cur.intra = sliceInfo(u).intra;
        cur.hasVcl = true;
      } else if (type === 6) {
        if (!cur.rp && seiHasRecoveryPoint(u)) cur.rp = true;
      }
      cur.nals.push(u);
      cur.bytes += 4 + u.length;
    }
    closeAu() {
      const au = this.au;
      this.au = null;
      if (!au || !au.hasVcl) return;
      const key = au.idr || au.rp || au.intra && au.hasSps;
      if (!this.started) {
        if (!key || !this.info || !this.ppsMap.size) {
          this.dropped++;
          return;
        }
        this.started = true;
        this.config = { sps: [...this.spsMap.values()], pps: [...this.ppsMap.values()], info: this.info };
      }
      const data = new Uint8Array(au.bytes);
      let o = 0;
      for (const u of au.nals) {
        const len = u.length;
        data[o] = len >>> 24;
        data[o + 1] = len >>> 16 & 255;
        data[o + 2] = len >>> 8 & 255;
        data[o + 3] = len & 255;
        data.set(u, o + 4);
        o += 4 + len;
      }
      const sample = { data, pts: au.pts, dts: au.dts, key };
      if (au.pts === void 0) {
        this.waiting.push(sample);
        this.guessed++;
        return;
      }
      this.resolveWaiting(au.dts);
      if (this.known && au.dts > this.known.dts) this.frameDur = au.dts - this.known.dts;
      this.known = { dts: au.dts, pts: au.pts };
      this.emit(sample);
    }
    // Reparte parejo los cuadros sin hora entre los dos que si la tienen.
    resolveWaiting(nextDts) {
      const w = this.waiting;
      if (!w.length) return;
      this.waiting = [];
      const k = w.length + 1;
      if (!this.known) {
        const dur = this.frameDur || 3e3;
        const end = nextDts === void 0 ? k * dur : nextDts;
        w.forEach((s, j) => {
          s.dts = Math.round(end - (w.length - j) * dur);
          s.pts = s.dts;
          this.emit(s);
        });
        return;
      }
      const step = nextDts !== void 0 && nextDts > this.known.dts ? (nextDts - this.known.dts) / k : this.frameDur || 3e3;
      const lag = this.known.pts - this.known.dts;
      w.forEach((s, j) => {
        s.dts = Math.round(this.known.dts + step * (j + 1));
        s.pts = s.dts + lag;
        this.emit(s);
      });
      const last = w[w.length - 1];
      this.known = { dts: last.dts, pts: last.pts };
      this.frameDur = step;
    }
    flush() {
      if (this.carry) {
        const end = trimZeros(this.carry, 3, this.carry.length);
        if (end > 3) this.nal(this.carry.subarray(3, end), this.carryPes);
        this.carry = null;
        this.carryPes = null;
      }
      this.closeAu();
      this.resolveWaiting(void 0);
    }
  };
  var TsDemuxer = class _TsDemuxer {
    constructor(opts = {}) {
      this.wantVideo = opts.video !== false;
      this.wantAudio = opts.audio !== false;
      this.rem = null;
      this.synced = false;
      this.pmtPid = -1;
      this.pmtSeen = false;
      this.videoPid = -1;
      this.audioPid = -1;
      this.videoCodec = null;
      this.audioCodec = null;
      this.psi = /* @__PURE__ */ new Map();
      this.pes = /* @__PURE__ */ new Map();
      this.tsRef = null;
      this.shift = 0;
      this.prevShift = 0;
      this.last = /* @__PURE__ */ new Map();
      this.jumps = 0;
      this.video = [];
      this.audio = [];
      this.h264 = new H264Assembler((s) => this.video.push(s));
      this.adts = new AdtsAssembler((s) => this.audio.push(s));
      this.scrambled = false;
      this.packets = 0;
      this.resyncs = 0;
    }
    static findSync(buf, from) {
      const n = buf.length;
      for (let p = from; p < n; p++) {
        if (buf[p] !== 71) continue;
        if (p + 188 < n && buf[p + 188] !== 71) continue;
        if (p + 376 < n && buf[p + 376] !== 71) continue;
        return p;
      }
      return -1;
    }
    push(data) {
      let buf = data;
      if (this.rem) {
        buf = concat2(this.rem, data);
        this.rem = null;
      }
      const n = buf.length;
      let i = 0;
      if (!this.synced) {
        i = _TsDemuxer.findSync(buf, 0);
        if (i < 0) return;
        this.synced = true;
      }
      while (i + 188 <= n) {
        if (buf[i] !== 71) {
          this.resyncs++;
          const j = _TsDemuxer.findSync(buf, i + 1);
          if (j < 0) {
            i = n;
            break;
          }
          i = j;
          continue;
        }
        this.packet(buf, i);
        i += 188;
      }
      if (i < n) this.rem = buf.slice(i);
    }
    packet(buf, o) {
      this.packets++;
      const b1 = buf[o + 1], b3 = buf[o + 3];
      if (b1 & 128) return;
      const pid = (b1 & 31) << 8 | buf[o + 2];
      const afc = b3 >> 4 & 3;
      if (!(afc & 1)) return;
      let p = o + 4;
      if (afc & 2) p += 1 + buf[o + 4];
      const end = o + 188;
      if (p >= end) return;
      const pusi = (b1 & 64) !== 0;
      if (pid === this.videoPid || pid === this.audioPid) {
        if (b3 & 192) {
          this.scrambled = true;
          return;
        }
        this.pesData(pid, pusi, buf.subarray(p, end));
      } else if (pid === 0) {
        const sec = this.section(pid, pusi, buf.subarray(p, end));
        if (sec) this.pat(sec);
      } else if (pid === this.pmtPid) {
        const sec = this.section(pid, pusi, buf.subarray(p, end));
        if (sec) this.pmt(sec);
      }
    }
    section(pid, pusi, payload) {
      let st = this.psi.get(pid);
      if (pusi) {
        const start2 = 1 + payload[0];
        if (start2 >= payload.length) return null;
        st = { chunks: [payload.subarray(start2)], size: payload.length - start2 };
        this.psi.set(pid, st);
      } else if (st) {
        st.chunks.push(payload);
        st.size += payload.length;
      } else return null;
      const d = st.chunks.length === 1 ? st.chunks[0] : concat(st.chunks, st.size);
      st.chunks = [d];
      if (d.length < 3) return null;
      const len = 3 + ((d[1] & 15) << 8 | d[2]);
      if (d.length < len) return null;
      this.psi.delete(pid);
      return d.subarray(0, len);
    }
    pat(d) {
      if (d[0] !== 0) return;
      for (let i = 8; i + 4 <= d.length - 4; i += 4) {
        const prog = d[i] << 8 | d[i + 1];
        if (prog !== 0) {
          this.pmtPid = (d[i + 2] & 31) << 8 | d[i + 3];
          return;
        }
      }
    }
    pmt(d) {
      if (d[0] !== 2 || d.length < 16) return;
      const end = d.length - 4;
      let i = 12 + ((d[10] & 15) << 8 | d[11]);
      let vPid = -1, aPid = -1, vName = null, aName = null;
      while (i + 5 <= end) {
        const type = d[i];
        const pid = (d[i + 1] & 31) << 8 | d[i + 2];
        const esLen = (d[i + 3] & 15) << 8 | d[i + 4];
        let v = VIDEO_TYPES[type] || null;
        let a = AUDIO_TYPES[type] || null;
        if (type === 6) {
          for (let q = i + 5; q + 2 <= Math.min(end, i + 5 + esLen); q += 2 + d[q + 1]) {
            if (d[q] === 106) a = "ac3";
            else if (d[q] === 122) a = "eac3";
            else if (d[q] === 123) a = "dts";
          }
        }
        if (v && vPid < 0) {
          vPid = pid;
          vName = v;
        }
        if (a && aPid < 0) {
          aPid = pid;
          aName = a;
        }
        i += 5 + esLen;
      }
      if (this.pmtSeen) return;
      this.pmtSeen = true;
      this.videoCodec = vName;
      this.audioCodec = aName;
      if (this.wantVideo && vName === "h264") this.videoPid = vPid;
      if (this.wantAudio && aName === "aac") this.audioPid = aPid;
    }
    pesData(pid, pusi, payload) {
      let st = this.pes.get(pid);
      if (pusi) {
        if (st && st.size) this.finishPes(pid, st);
        st = { chunks: [payload], size: payload.length, need: -1 };
        this.pes.set(pid, st);
      } else if (st) {
        st.chunks.push(payload);
        st.size += payload.length;
      } else return;
      if (st.need < 0) {
        const h = st.chunks[0];
        if (h.length >= 6) {
          const l = h[4] << 8 | h[5];
          st.need = l ? l + 6 : 0;
        }
      }
      if (st.need > 0 && st.size >= st.need) {
        this.finishPes(pid, st);
        this.pes.delete(pid);
      }
    }
    static readTs(d, o) {
      return (d[o] & 14) * 536870912 + d[o + 1] * 4194304 + (d[o + 2] & 254) * 16384 + d[o + 3] * 128 + ((d[o + 4] & 254) >> 1);
    }
    unwrap(ts) {
      if (this.tsRef === null) {
        this.tsRef = ts;
        return ts;
      }
      const v = ts + Math.round((this.tsRef - ts) / W33) * W33;
      this.tsRef = v;
      return v;
    }
    // Si el reloj de una pista retrocede mas de medio segundo, o se adelanta mas
    // de un minuto, es un salto que la lista no aviso: se corre para que siga de
    // corrido. La otra pista usa la misma correccion, asi no se pierde la sincronia.
    fix(pid, dts) {
      const st = this.last.get(pid);
      let t = dts + this.shift;
      if (!st) {
        this.last.set(pid, { t, dur: 0 });
        return this.shift;
      }
      const lo = st.t - 45e3, hi = st.t + 54e5;
      if (t < lo || t > hi) {
        const alt = dts + this.prevShift;
        if (this.prevShift !== this.shift && alt >= lo && alt <= hi) {
          t = alt;
        } else {
          const want = st.t + (st.dur || 3e3);
          this.prevShift = this.shift;
          this.shift += want - t;
          t = want;
          this.jumps++;
        }
      }
      if (t > st.t) {
        if (t - st.t < 9e4) st.dur = t - st.t;
        st.t = t;
      }
      return t - dts;
    }
    finishPes(pid, st) {
      const d = st.chunks.length === 1 ? st.chunks[0] : concat(st.chunks, st.size);
      st.chunks = [];
      st.size = 0;
      if (d.length < 9 || d[0] !== 0 || d[1] !== 0 || d[2] !== 1) return;
      const pesLen = d[4] << 8 | d[5];
      const flags = d[7];
      let pts, dts;
      if (flags & 128 && d.length >= 14) {
        const rawPts = _TsDemuxer.readTs(d, 9);
        const rawDts = flags & 64 && d.length >= 19 ? _TsDemuxer.readTs(d, 14) : rawPts;
        dts = this.unwrap(rawDts);
        let diff = rawPts - rawDts;
        if (diff > W33 / 2) diff -= W33;
        else if (diff < -W33 / 2) diff += W33;
        dts += this.fix(pid, dts);
        pts = dts + diff;
      }
      const start2 = 9 + d[8];
      let end = d.length;
      if (pesLen && pesLen + 6 < end) end = pesLen + 6;
      if (start2 >= end) return;
      const payload = d.subarray(start2, end);
      if (pid === this.videoPid) this.h264.push(payload, pts, dts);
      else this.adts.push(payload, pts);
    }
    // Fin de un tramo continuo: larga lo que quedo a medio armar.
    flush() {
      for (const [pid, st] of this.pes) if (st.size) this.finishPes(pid, st);
      this.pes.clear();
      this.h264.flush();
      this.adts.flush();
    }
  };

  // src/engine/fmp4.js
  function children(d, start2, end) {
    const out = [];
    let p = start2;
    while (p + 8 <= end) {
      let size = u32be(d, p);
      const type = fourcc(d, p + 4);
      let hdr = 8;
      if (size === 1) {
        if (p + 16 > end) break;
        size = u64be(d, p + 8);
        hdr = 16;
      } else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      out.push({ type, start: p, body: p + hdr, end: p + size });
      p += size;
    }
    return out;
  }
  var find = (list, type) => list.find((b) => b.type === type);
  function parseInit(d) {
    const moov = find(children(d, 0, d.length), "moov");
    if (!moov) throw new JobError("parse", "El encabezado del video no tiene la tabla que esperaba (moov).");
    const mk = children(d, moov.body, moov.end);
    const mvhd = find(mk, "mvhd");
    const movieTimescale = mvhd ? u32be(d, mvhd.body + (d[mvhd.body] === 1 ? 20 : 12)) || 1e3 : 1e3;
    const trex = /* @__PURE__ */ new Map();
    const mvex = find(mk, "mvex");
    if (mvex) {
      for (const b of children(d, mvex.body, mvex.end)) {
        if (b.type === "trex" && b.end - b.body >= 24) {
          trex.set(u32be(d, b.body + 4), { desc: u32be(d, b.body + 8), duration: u32be(d, b.body + 12), size: u32be(d, b.body + 16), flags: u32be(d, b.body + 20) });
        }
      }
    }
    const tracks = [];
    for (const trak of mk) {
      if (trak.type !== "trak") continue;
      const tk = children(d, trak.body, trak.end);
      const tkhd = find(tk, "tkhd");
      const mdia = find(tk, "mdia");
      if (!tkhd || !mdia) continue;
      const id = u32be(d, tkhd.body + (d[tkhd.body] === 1 ? 20 : 12));
      const md = children(d, mdia.body, mdia.end);
      const mdhd = find(md, "mdhd"), hdlr = find(md, "hdlr"), minf = find(md, "minf");
      if (!mdhd || !hdlr || !minf) continue;
      const v1 = d[mdhd.body] === 1;
      const timescale = u32be(d, mdhd.body + (v1 ? 20 : 12));
      if (!timescale) continue;
      const language = u16be(d, mdhd.body + (v1 ? 32 : 20));
      const handler = fourcc(d, hdlr.body + 8);
      const stbl = find(children(d, minf.body, minf.end), "stbl");
      const stsd = stbl && find(children(d, stbl.body, stbl.end), "stsd");
      if (!stsd) continue;
      const entries = children(d, stsd.body + 8, stsd.end).map((b) => ({ type: b.type, bytes: d.slice(b.start, b.end) }));
      if (!entries.length) continue;
      let mediaTime = 0, emptyDur = 0;
      const edts = find(tk, "edts");
      const elst = edts && find(children(d, edts.body, edts.end), "elst");
      if (elst) {
        const v = d[elst.body] === 1;
        const n = u32be(d, elst.body + 4);
        const step = v ? 20 : 12;
        let p = elst.body + 8;
        for (let i = 0; i < n && p + step <= elst.end; i++, p += step) {
          const segDur = v ? u64be(d, p) : u32be(d, p);
          const mt = v ? i64be(d, p + 8) : i32be(d, p + 4);
          if (mt < 0) emptyDur += segDur;
          else {
            mediaTime = mt;
            break;
          }
        }
      }
      tracks.push({
        id,
        handler,
        type: handler === "vide" ? "video" : handler === "soun" ? "audio" : "other",
        timescale,
        language,
        width: u32be(d, tkhd.end - 8),
        height: u32be(d, tkhd.end - 4),
        entries,
        trex: trex.get(id) || { desc: 1, duration: 0, size: 0, flags: 0 },
        mediaTime,
        emptySec: emptyDur / movieTimescale,
        encrypted: entries.some((e) => e.type === "encv" || e.type === "enca")
      });
    }
    const byId = new Map(tracks.map((t) => [t.id, t]));
    return { movieTimescale, tracks, byId };
  }
  function parseFragments(d, init, state, rangeOffset) {
    const out = /* @__PURE__ */ new Map();
    let found = false;
    for (const b of children(d, 0, d.length)) {
      if (b.type !== "moof") continue;
      found = true;
      let prevEnd = null;
      for (const traf of children(d, b.body, b.end)) {
        if (traf.type !== "traf") continue;
        const tf = children(d, traf.body, traf.end);
        const tfhd = find(tf, "tfhd");
        if (!tfhd) continue;
        const fl = u32be(d, tfhd.body) & 16777215;
        let p = tfhd.body + 4;
        const trackId = u32be(d, p);
        p += 4;
        const trk = init.byId.get(trackId);
        const trex = trk ? trk.trex : { desc: 1, duration: 0, size: 0, flags: 0 };
        let base = null, desc = trex.desc || 1, defDur = trex.duration, defSize = trex.size, defFlags = trex.flags;
        if (fl & 1) {
          base = u64be(d, p) - (rangeOffset || 0);
          p += 8;
        }
        if (fl & 2) {
          desc = u32be(d, p) || 1;
          p += 4;
        }
        if (fl & 8) {
          defDur = u32be(d, p);
          p += 4;
        }
        if (fl & 16) {
          defSize = u32be(d, p);
          p += 4;
        }
        if (fl & 32) {
          defFlags = u32be(d, p);
          p += 4;
        }
        if (base === null) base = fl & 131072 ? b.start : prevEnd === null ? b.start : prevEnd;
        const st = state.get(trackId) || { nextDts: 0 };
        const tfdt = find(tf, "tfdt");
        let dts = tfdt ? d[tfdt.body] === 1 ? u64be(d, tfdt.body + 4) : u32be(d, tfdt.body + 4) : st.nextDts;
        let pos = base;
        let samples = out.get(trackId);
        if (!samples) {
          samples = [];
          out.set(trackId, samples);
        }
        for (const trun of tf) {
          if (trun.type !== "trun") continue;
          const tfl = u32be(d, trun.body) & 16777215;
          const count = u32be(d, trun.body + 4);
          let q = trun.body + 8;
          if (tfl & 1) {
            pos = base + i32be(d, q);
            q += 4;
          }
          let firstFlags = null;
          if (tfl & 4) {
            firstFlags = u32be(d, q);
            q += 4;
          }
          const per = (tfl & 256 ? 4 : 0) + (tfl & 512 ? 4 : 0) + (tfl & 1024 ? 4 : 0) + (tfl & 2048 ? 4 : 0);
          if (q + per * count > trun.end) throw new JobError("parse", "Un pedazo del video vino con la tabla cortada.");
          for (let i = 0; i < count; i++) {
            let dur = defDur, size = defSize, flags = defFlags, cts = 0;
            if (tfl & 256) {
              dur = u32be(d, q);
              q += 4;
            }
            if (tfl & 512) {
              size = u32be(d, q);
              q += 4;
            }
            if (tfl & 1024) {
              flags = u32be(d, q);
              q += 4;
            } else if (i === 0 && firstFlags !== null) flags = firstFlags;
            if (tfl & 2048) {
              cts = i32be(d, q);
              q += 4;
            }
            if (pos < 0 || pos + size > d.length) throw new JobError("parse", "Un pedazo del video vino incompleto.");
            samples.push({ offset: pos, size, dts, cts, dur, key: (flags & 65536) === 0, desc });
            pos += size;
            dts += dur;
          }
        }
        prevEnd = pos;
        st.nextDts = dts;
        state.set(trackId, st);
      }
    }
    return { tracks: out, found };
  }

  // src/engine/mp4mux.js
  var ascii = (s) => {
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
    return u;
  };
  var zeros = (n) => new Uint8Array(n);
  function u16(...v) {
    const u = new Uint8Array(v.length * 2);
    const dv = new DataView(u.buffer);
    v.forEach((x, i) => dv.setUint16(i * 2, x & 65535));
    return u;
  }
  function u32(...v) {
    const u = new Uint8Array(v.length * 4);
    const dv = new DataView(u.buffer);
    v.forEach((x, i) => dv.setUint32(i * 4, x >>> 0));
    return u;
  }
  function u64(v) {
    const u = new Uint8Array(8);
    const dv = new DataView(u.buffer);
    dv.setUint32(0, Math.floor(v / 4294967296));
    dv.setUint32(4, v % 4294967296);
    return u;
  }
  function box(type, ...parts) {
    let size = 8;
    for (const p of parts) size += p.length;
    const out = new Uint8Array(size);
    new DataView(out.buffer).setUint32(0, size);
    out.set(ascii(type), 4);
    let o = 8;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
  function full(type, version, flags, ...parts) {
    return box(type, Uint8Array.of(version, flags >> 16 & 255, flags >> 8 & 255, flags & 255), ...parts);
  }
  var MATRIX = u32(65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824);
  function avc1Entry(config) {
    const info = config.info;
    const avcC = box("avcC", buildAvcC(config.sps, config.pps, info));
    const extra = [avcC];
    if (info.sarW !== info.sarH) extra.push(box("pasp", u32(info.sarW, info.sarH)));
    return box(
      "avc1",
      zeros(6),
      u16(1),
      // reservado + indice de referencia de datos
      zeros(16),
      // predefinidos
      u16(info.width, info.height),
      u32(4718592, 4718592),
      // 72 dpi
      u32(0),
      u16(1),
      // reservado + cuadros por muestra
      zeros(32),
      // nombre del compresor
      u16(24, 65535),
      ...extra
    );
  }
  function descriptor(tag, ...parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const head = n < 128 ? Uint8Array.of(tag, n) : Uint8Array.of(tag, 128 | n >> 21, 128 | n >> 14 & 127, 128 | n >> 7 & 127, n & 127);
    const out = new Uint8Array(head.length + n);
    out.set(head, 0);
    let o = head.length;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
  function mp4aEntry(cfg, bitrate) {
    const br = Math.max(0, Math.min(4294967295, Math.round(bitrate || 0)));
    const dsi = descriptor(5, audioSpecificConfig(cfg));
    const dec = descriptor(4, Uint8Array.of(64, 21, 0, 0, 0), u32(br, br), dsi);
    const es = descriptor(3, u16(0), Uint8Array.of(0), dec, descriptor(6, Uint8Array.of(2)));
    const channels = cfg.ch === 7 ? 8 : cfg.ch;
    return box(
      "mp4a",
      zeros(6),
      u16(1),
      u32(0, 0),
      u16(channels, 16, 0, 0),
      u32(cfg.sampleRate <= 65535 ? cfg.sampleRate * 65536 : 0),
      full("esds", 0, 0, es)
    );
  }
  var Track = class {
    constructor(mux, def) {
      this.mux = mux;
      this.def = def;
      this.type = def.type;
      this.timescale = def.timescale;
      this.queue = [];
      this.head = 0;
      this.lastIn = null;
      this.maxPts = null;
      this.presentShift = def.presentShift || 0;
      this.lastDelta = 0;
      this.lastDuration = 0;
      this.ended = false;
      this.fixedDts = 0;
      this.sizes = [];
      this.dts = [];
      this.cts = [];
      this.sync = [];
      this.allSync = true;
      this.anyCts = false;
      this.negCts = false;
      this.count = 0;
      this.bytes = 0;
      this.chunkOff = [];
      this.chunkN = [];
      this.chunkDesc = [];
      this.entries = def.entries ? def.entries.slice() : null;
    }
    add(data, dts, cts, key, desc) {
      dts = Math.round(dts);
      cts = Math.round(cts) || 0;
      if (this.lastIn !== null) {
        if (dts <= this.lastIn) {
          const fixed = this.lastIn + 1;
          cts -= fixed - dts;
          dts = fixed;
          this.fixedDts++;
        } else {
          this.lastDelta = dts - this.lastIn;
        }
      }
      this.lastIn = dts;
      if (this.maxPts === null || dts + cts > this.maxPts) this.maxPts = dts + cts;
      this.queue.push({ data, dts, cts, key: !!key, desc: desc || 1, sec: dts / this.timescale });
      this.mux.queuedBytes += data.length;
    }
    // Hora (en segundos, reloj comun de salida) en la que termina de mostrarse
    // lo ultimo que recibio esta pista.
    presentEndSec() {
      if (this.maxPts === null) return null;
      return (this.maxPts + (this.lastDuration || this.lastDelta || 0)) / this.timescale + this.presentShift;
    }
    end() {
      this.ended = true;
    }
  };
  var Mp4Muxer = class {
    constructor(o = {}) {
      this.flushBytes = o.flushBytes || 8 << 20;
      this.sliceSec = o.sliceSec || 1;
      this.maxQueueBytes = o.maxQueueBytes || 96 << 20;
      this.tracks = [];
      this.pieces = [];
      this.pieceBytes = 0;
      this.dataSize = 0;
      this.queuedBytes = 0;
    }
    addTrack(def) {
      const t = new Track(this, def);
      this.tracks.push(t);
      return t;
    }
    ordered() {
      return this.tracks.slice().sort((a, b) => a.type === b.type ? 0 : a.type === "video" ? -1 : 1);
    }
    // Escribe todo lo que ya se puede escribir, intercalando video y audio de a
    // tramos de ~1 segundo.
    advance(final) {
      let limit = Infinity;
      if (!final && this.queuedBytes <= this.maxQueueBytes) {
        for (const t of this.tracks) {
          if (t.ended) continue;
          limit = Math.min(limit, t.lastIn === null ? -Infinity : t.lastIn / t.timescale);
        }
      }
      const order = this.ordered();
      for (; ; ) {
        let tMin = Infinity;
        for (const t of order) {
          if (t.head < t.queue.length) {
            const s = t.queue[t.head].sec;
            if (s < tMin) tMin = s;
          }
        }
        if (tMin === Infinity) break;
        const sliceEnd = tMin + this.sliceSec;
        if (sliceEnd > limit) break;
        for (const t of order) this.writeSlice(t, sliceEnd);
      }
      for (const t of order) {
        if (t.head > 512) {
          t.queue = t.queue.slice(t.head);
          t.head = 0;
        }
      }
    }
    // Entrega los datos ya ordenados (para guardarlos fuera de la memoria de la
    // pagina). Devuelve null si todavia hay poco, salvo que se pida todo.
    take(all) {
      if (!this.pieces.length || !all && this.pieceBytes < this.flushBytes) return null;
      const out = { pieces: this.pieces, bytes: this.pieceBytes };
      this.pieces = [];
      this.pieceBytes = 0;
      return out;
    }
    writeSlice(t, sliceEnd) {
      const q = t.queue;
      while (t.head < q.length && q[t.head].sec < sliceEnd) {
        const desc = q[t.head].desc;
        const off = this.dataSize;
        let n = 0;
        while (t.head < q.length) {
          const s = q[t.head];
          if (s.sec >= sliceEnd || s.desc !== desc) break;
          q[t.head++] = void 0;
          const len = s.data.length;
          if (len) this.pieces.push(s.data);
          this.pieceBytes += len;
          this.dataSize += len;
          this.queuedBytes -= len;
          t.sizes.push(len);
          t.dts.push(s.dts);
          t.cts.push(s.cts);
          if (s.cts !== 0) {
            t.anyCts = true;
            if (s.cts < 0) t.negCts = true;
          }
          t.count++;
          t.bytes += len;
          if (s.key) t.sync.push(t.count);
          else t.allSync = false;
          n++;
        }
        t.chunkOff.push(off);
        t.chunkN.push(n);
        t.chunkDesc.push(desc);
      }
    }
    // Cierra el archivo. Devuelve el encabezado (va ANTES de todos los datos
    // entregados con take) y un resumen. Lo que quede sin entregar sale con take(true).
    finalize() {
      for (const t of this.tracks) t.ended = true;
      this.advance(true);
      const tracks = this.ordered().filter((t) => t.count > 0);
      if (!tracks.length) throw new JobError("empty", "No encontré video ni audio para guardar.");
      const MT = 1e3;
      for (const t of tracks) {
        const n = t.count, d = t.dts;
        let last = t.lastDuration > 0 ? t.lastDuration : n > 1 ? d[n - 1] - d[n - 2] : 0;
        last = Math.round(last);
        if (!(last > 0)) last = 1;
        t.lastOut = last;
        t.mediaDur = d[n - 1] - d[0] + last;
        let lift = 0;
        if (t.negCts) {
          for (let i = 0; i < n; i++) if (-t.cts[i] > lift) lift = -t.cts[i];
          for (let i = 0; i < n; i++) t.cts[i] += lift;
          t.negCts = false;
          t.anyCts = true;
        }
        let editMedia = Math.max(0, t.cts[0]);
        let startSec = (d[0] + editMedia - lift) / t.timescale + t.presentShift;
        const trim = t.def.trimStart;
        if (trim !== void 0 && trim > startSec + 1e-9) {
          editMedia += Math.round((trim - startSec) * t.timescale);
          startSec = trim;
        }
        t.editMedia = editMedia;
        t.startSec = startSec;
      }
      let t0 = Infinity;
      for (const t of tracks) t0 = Math.min(t0, t.startSec);
      let movieDur = 0;
      for (const t of tracks) {
        t.emptyMs = Math.max(0, Math.round((t.startSec - t0) * MT));
        const playable = Math.max(0, Math.round((t.mediaDur - (t.editMedia - Math.max(0, t.cts[0]))) / t.timescale * MT));
        t.needEdit = t.emptyMs > 0 || t.editMedia > 0;
        t.segMs = playable;
        t.trackMs = t.needEdit ? t.emptyMs + playable : Math.round(t.mediaDur / t.timescale * MT);
        movieDur = Math.max(movieDur, t.trackMs);
      }
      const codecOf = (t) => t.def.codec || (t.entries && t.entries[0] ? String.fromCharCode(t.entries[0][4], t.entries[0][5], t.entries[0][6], t.entries[0][7]) : "");
      const hasAvc = tracks.some((t) => codecOf(t) === "avc1" || codecOf(t) === "avc3");
      const ftyp = box("ftyp", ascii("isom"), u32(512), ascii("isomiso2" + (hasAvc ? "avc1" : "") + "mp41"));
      const build = (base2, co642) => {
        const traks = tracks.map((t, i) => this.trak(t, i + 1, base2, co642, MT));
        const mvhd = full("mvhd", 0, 0, u32(0, 0, MT, movieDur), u32(65536), u16(256, 0), zeros(8), MATRIX, zeros(24), u32(tracks.length + 1));
        return box("moov", mvhd, ...traks);
      };
      let co64 = this.dataSize > 4026531840;
      let moov = build(0, co64);
      const mdatBig = this.dataSize + 8 > 4294967295;
      let base = ftyp.length + moov.length + (mdatBig ? 16 : 8);
      if (!co64 && base + this.dataSize > 4294967295) {
        co64 = true;
        moov = build(0, true);
        base = ftyp.length + moov.length + (mdatBig ? 16 : 8);
      }
      moov = build(base, co64);
      const mdatHead = mdatBig ? (() => {
        const h = new Uint8Array(16);
        h.set(u32(1), 0);
        h.set(ascii("mdat"), 4);
        h.set(u64(this.dataSize + 16), 8);
        return h;
      })() : (() => {
        const h = new Uint8Array(8);
        h.set(u32(this.dataSize + 8), 0);
        h.set(ascii("mdat"), 4);
        return h;
      })();
      const summary = tracks.map((t) => ({
        type: t.type,
        codec: codecOf(t),
        samples: t.count,
        seconds: t.mediaDur / t.timescale,
        bytes: t.bytes,
        fixedDts: t.fixedDts
      }));
      return { head: [ftyp, moov, mdatHead], size: base + this.dataSize, seconds: movieDur / MT, tracks: summary };
    }
    trak(t, id, base, co64, MT) {
      const n = t.count, d = t.dts;
      const isVideo = t.type === "video";
      const entries = t.entries || t.def.buildEntries(t);
      const sttsRuns = [];
      {
        let prev = -1, cnt = 0;
        for (let i = 0; i < n; i++) {
          const delta = i + 1 < n ? d[i + 1] - d[i] : t.lastOut;
          if (delta === prev) cnt++;
          else {
            if (cnt) sttsRuns.push(cnt, prev);
            prev = delta;
            cnt = 1;
          }
        }
        if (cnt) sttsRuns.push(cnt, prev);
      }
      const stts = full("stts", 0, 0, u32(sttsRuns.length / 2), tableU32(sttsRuns));
      const stbl = [full("stsd", 0, 0, u32(entries.length), ...entries), stts];
      if (isVideo && !t.allSync) stbl.push(full("stss", 0, 0, u32(t.sync.length), tableU32(t.sync)));
      if (t.anyCts) {
        const runs = [];
        let prev = null, cnt = 0;
        for (let i = 0; i < n; i++) {
          const c = t.cts[i];
          if (c === prev) cnt++;
          else {
            if (cnt) runs.push(cnt, prev);
            prev = c;
            cnt = 1;
          }
        }
        if (cnt) runs.push(cnt, prev);
        stbl.push(full("ctts", t.negCts ? 1 : 0, 0, u32(runs.length / 2), tableI32(runs)));
      }
      {
        const runs = [];
        let pn = -1, pd = -1;
        for (let i = 0; i < t.chunkN.length; i++) {
          if (t.chunkN[i] !== pn || t.chunkDesc[i] !== pd) {
            runs.push(i + 1, t.chunkN[i], t.chunkDesc[i]);
            pn = t.chunkN[i];
            pd = t.chunkDesc[i];
          }
        }
        stbl.push(full("stsc", 0, 0, u32(runs.length / 3), tableU32(runs)));
      }
      stbl.push(full("stsz", 0, 0, u32(0, n), tableU32(t.sizes)));
      {
        const c = t.chunkOff.length;
        if (co64) {
          const u = new Uint8Array(c * 8);
          const dv = new DataView(u.buffer);
          for (let i = 0; i < c; i++) {
            const v = t.chunkOff[i] + base;
            dv.setUint32(i * 8, Math.floor(v / 4294967296));
            dv.setUint32(i * 8 + 4, v % 4294967296);
          }
          stbl.push(full("co64", 0, 0, u32(c), u));
        } else {
          const u = new Uint8Array(c * 4);
          const dv = new DataView(u.buffer);
          for (let i = 0; i < c; i++) dv.setUint32(i * 4, t.chunkOff[i] + base);
          stbl.push(full("stco", 0, 0, u32(c), u));
        }
      }
      const minf = box(
        "minf",
        isVideo ? full("vmhd", 0, 1, zeros(8)) : full("smhd", 0, 0, zeros(4)),
        box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))),
        box("stbl", ...stbl)
      );
      const lang = t.def.language || 21956;
      const mdhd = t.mediaDur > 4294967295 ? full("mdhd", 1, 0, u64(0), u64(0), u32(t.timescale), u64(t.mediaDur), u16(lang, 0)) : full("mdhd", 0, 0, u32(0, 0, t.timescale, t.mediaDur), u16(lang, 0));
      const hdlr = full("hdlr", 0, 0, u32(0), ascii(isVideo ? "vide" : "soun"), zeros(12), ascii(isVideo ? "VideoHandler\0" : "SoundHandler\0"));
      const w = isVideo ? t.def.tkhdWidth !== void 0 ? t.def.tkhdWidth : Math.round((t.def.width || 0) * 65536) : 0;
      const h = isVideo ? t.def.tkhdHeight !== void 0 ? t.def.tkhdHeight : Math.round((t.def.height || 0) * 65536) : 0;
      const tkhd = full("tkhd", 0, 3, u32(0, 0, id, 0, t.trackMs), zeros(8), u16(0, 0, isVideo ? 0 : 256, 0), MATRIX, u32(w, h));
      const parts = [tkhd];
      if (t.needEdit) {
        const rows = [];
        const big = t.editMedia > 2147483647 || t.segMs > 4294967295 || t.emptyMs > 4294967295;
        if (big) {
          if (t.emptyMs > 0) rows.push(u64(t.emptyMs), u32(4294967295, 4294967295), u16(1, 0));
          rows.push(u64(t.segMs), u64(t.editMedia), u16(1, 0));
        } else {
          if (t.emptyMs > 0) rows.push(u32(t.emptyMs, 4294967295), u16(1, 0));
          rows.push(u32(t.segMs, t.editMedia), u16(1, 0));
        }
        parts.push(box("edts", full("elst", big ? 1 : 0, 0, u32(t.emptyMs > 0 ? 2 : 1), ...rows)));
      }
      parts.push(box("mdia", mdhd, hdlr, minf));
      return box("trak", ...parts);
    }
  };
  function tableU32(arr) {
    const u = new Uint8Array(arr.length * 4);
    const dv = new DataView(u.buffer);
    for (let i = 0; i < arr.length; i++) dv.setUint32(i * 4, arr[i] >>> 0);
    return u;
  }
  function tableI32(arr) {
    const u = new Uint8Array(arr.length * 4);
    const dv = new DataView(u.buffer);
    for (let i = 0; i < arr.length; i++) dv.setInt32(i * 4, arr[i]);
    return u;
  }

  // src/engine/pipeline.js
  var MSG = {
    aborted: "Cancelado.",
    encrypted: "Este video viene cifrado, así que no lo puedo guardar.",
    drm: "Este video tiene protección anticopia (DRM), así que no se puede guardar.",
    notPlaylist: "Ese link no es una lista de video (m3u8) válida.",
    emptyList: "La lista del video está vacía.",
    network: "No pude conectarme con el servidor del video.",
    notVideo: "En lugar del video, el servidor mandó otra cosa (puede ser un link vencido o una lista de subtítulos). Recargá la página, dale play y probá de nuevo.",
    storage: "El navegador se quedó sin lugar para ir guardando el video. Liberá espacio en disco y probá de nuevo (en una ventana privada los videos grandes no entran)."
  };
  var Net = class {
    constructor(host, signal) {
      this.fetch = host.fetch;
      this.signal = signal;
      this.max = host.concurrency || 4;
      this.timeoutMs = host.timeoutMs || 45e3;
      this.delays = host.retryDelays || [0, 700, 2e3, 5e3];
      this.active = 0;
      this.waiters = [];
      this.cred = /* @__PURE__ */ new Map();
      this.bytes = 0;
      this.whole = null;
    }
    async get(url, opt = {}) {
      if (this.active >= this.max) await new Promise((r) => this.waiters.push(r));
      else this.active++;
      try {
        return await this.retrying(url, opt);
      } finally {
        const w = this.waiters.shift();
        if (w) w();
        else this.active--;
      }
    }
    async retrying(url, opt) {
      let last = null;
      for (let a = 0; a < this.delays.length; a++) {
        if (this.delays[a]) await sleep(this.delays[a], this.signal);
        if (this.signal.aborted) throw new JobError("aborted", MSG.aborted);
        let origin = "";
        try {
          origin = new URL(url).origin;
        } catch (e) {
        }
        const mode = this.cred.get(origin) || "same-origin";
        let r;
        try {
          r = await this.once(url, opt, mode);
        } catch (e) {
          if (this.signal.aborted) throw new JobError("aborted", MSG.aborted);
          last = new JobError("network", MSG.network, { url, cause: String(e && e.message || e) });
          if (mode === "include") this.cred.delete(origin);
          continue;
        }
        if (r.ok) return r;
        if ((r.status === 401 || r.status === 403) && mode !== "include") {
          try {
            const r2 = await this.once(url, opt, "include");
            if (r2.ok) {
              this.cred.set(origin, "include");
              return r2;
            }
          } catch (e) {
            if (this.signal.aborted) throw new JobError("aborted", MSG.aborted);
          }
        }
        last = new JobError("http", `El servidor respondió con el error ${r.status}.`, { url, status: r.status });
        if ([401, 403, 404, 410].includes(r.status) && a >= 1) break;
      }
      throw last;
    }
    async once(url, opt, credentials) {
      const range = opt.range || null;
      if (range && this.whole && this.whole.url === url) {
        return { ok: true, status: 200, url, data: this.whole.data.subarray(range.offset, range.offset + range.length) };
      }
      const ctl = new AbortController();
      const onAbort = () => ctl.abort();
      this.signal.addEventListener("abort", onAbort, { once: true });
      let timer = null;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      };
      arm();
      try {
        const init = { credentials, signal: ctl.signal };
        if (range) init.headers = { Range: `bytes=${range.offset}-${range.offset + range.length - 1}` };
        const r = await this.fetch(url, init);
        if (!r.ok) {
          try {
            if (r.body && r.body.cancel) await r.body.cancel();
          } catch (e) {
          }
          return { ok: false, status: r.status };
        }
        let data;
        if (r.body && r.body.getReader) {
          const reader = r.body.getReader();
          const chunks = [];
          let total = 0;
          for (; ; ) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            total += value.length;
            this.bytes += value.length;
            arm();
          }
          data = chunks.length === 1 ? chunks[0] : concat(chunks, total);
        } else {
          data = new Uint8Array(await r.arrayBuffer());
          this.bytes += data.length;
        }
        if (opt.text) return { ok: true, status: r.status, url: r.url || url, text: new TextDecoder("utf-8").decode(data) };
        if (range) {
          if (r.status === 200 && data.length >= range.offset + range.length && (range.offset > 0 || data.length > range.length)) {
            this.whole = { url, data };
            data = data.subarray(range.offset, range.offset + range.length);
          } else if (data.length > range.length) data = data.subarray(0, range.length);
        }
        return { ok: true, status: r.status, url: r.url || url, data };
      } finally {
        clearTimeout(timer);
        this.signal.removeEventListener("abort", onAbort);
      }
    }
  };
  var Store = class {
    constructor(host, signal, notify) {
      this.Blob = host.Blob;
      this.signal = signal;
      this.notify = notify;
      this.maxWaitMs = host.storeWaitMs === void 0 ? 9e4 : host.storeWaitMs;
      this.parts = [];
      this.retries = 0;
    }
    async readable(blob) {
      if (!blob.size) return true;
      try {
        return (await blob.slice(0, 1).arrayBuffer()).byteLength === 1;
      } catch (e) {
        return false;
      }
    }
    async add(pieces) {
      let waited = 0;
      for (let a = 0; ; a++) {
        if (this.signal.aborted) throw new JobError("aborted", MSG.aborted);
        const blob = new this.Blob(pieces);
        if (await this.readable(blob)) {
          this.parts.push(blob);
          return blob;
        }
        if (waited >= this.maxWaitMs) throw new JobError("storage", MSG.storage);
        this.retries++;
        if (this.notify) this.notify();
        const d = Math.min(3e3, 250 * (a + 1));
        await sleep(d, this.signal);
        waited += d;
      }
    }
    // Ultima revision antes de entregar: que no se haya perdido ninguna parte.
    async check() {
      for (const b of this.parts) {
        if (this.signal.aborted) throw new JobError("aborted", MSG.aborted);
        if (!await this.readable(b)) throw new JobError("storage", MSG.storage);
      }
    }
  };
  function makeFeed(net, segs, window) {
    const pending = [];
    let next = 0;
    const fill = () => {
      while (pending.length < window && next < segs.length) {
        const s = segs[next++];
        const p = net.get(s.uri, { range: s.range });
        p.catch(() => {
        });
        pending.push(p);
      }
    };
    return {
      prime: fill,
      async next() {
        fill();
        if (!pending.length) return null;
        const r = await pending.shift();
        fill();
        return r.data;
      }
    };
  }
  var Input = class {
    constructor(role, pl, url) {
      this.pl = pl;
      this.url = url;
      this.setRole(role);
      this.segs = [];
      this.sections = [];
      let cut = false;
      for (const s of pl.segments) {
        if (s.discontinuity) cut = true;
        if (s.gap) continue;
        if (!this.sections.length || cut) this.sections.push([]);
        cut = false;
        this.sections[this.sections.length - 1].push(s);
        this.segs.push(s);
      }
      this.bounds = [0];
      for (const sec of this.sections) this.bounds.push(this.bounds[this.bounds.length - 1] + sec.length);
      this.idx = 0;
      this.playSec = 0;
      this.offsetSec = 0;
      this.tracks = { video: null, audio: null };
      this.audioCfg = null;
      this.kinds = /* @__PURE__ */ new Set();
      this.selfInit = null;
      this.jumps = 0;
      this.tsJumps = 0;
      this.resetSection();
    }
    setRole(role) {
      this.role = role;
      this.wantVideo = role !== "audio";
      this.wantAudio = role !== "video";
    }
    resetSection() {
      this.kind = null;
      this.demux = null;
      this.tsChecked = false;
      this.adts = null;
      this.adtsOut = [];
      this.frag = /* @__PURE__ */ new Map();
      this.audioAnchored = false;
      this.audioBase = 0;
      this.audioCount = 0;
    }
  };
  function sniffKind(b) {
    if (b.length >= 189 && b[0] === 71 && b[188] === 71) return "ts";
    if (b.length >= 3 && b[0] === 73 && b[1] === 68 && b[2] === 51) return "packed";
    if (b.length >= 2 && b[0] === 255 && (b[1] & 224) === 224) return "packed";
    if (b.length >= 2 && b[0] === 11 && b[1] === 119) return "packed";
    if (b.length >= 8 && ["ftyp", "styp", "moof", "moov", "sidx", "emsg", "prft"].includes(fourcc(b, 4))) return "fmp4";
    const lim = Math.min(b.length - 377, 2048);
    for (let i = 1; i < lim; i++) if (b[i] === 71 && b[i + 188] === 71 && b[i + 376] === 71) return "ts";
    return "unknown";
  }
  var sameBytes = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  function unsupported(what) {
    return new JobError("unsupported", `No sé pasar este video a mp4 (${what}).`, { what });
  }
  async function getInit(ctx, map) {
    const key = map.uri + "|" + (map.range ? map.range.offset + ":" + map.range.length : "");
    let p = ctx.inits.get(key);
    if (!p) {
      p = ctx.net.get(map.uri, { range: map.range }).then((r) => ({ key, bytes: r.data, parsed: null }));
      p.catch(() => {
      });
      ctx.inits.set(key, p);
    }
    return p;
  }
  async function demuxSegment(ctx, inp, seg, bytes, sectionStart) {
    const batch = { video: null, audio: null, minSec: Infinity };
    if (!bytes || !bytes.length) return batch;
    let kind;
    if (seg.map) kind = "fmp4";
    else if (sectionStart || !inp.kind) kind = sniffKind(bytes);
    else kind = inp.kind;
    inp.kind = kind;
    inp.kinds.add(kind);
    if (kind === "ts") {
      if (!inp.demux) inp.demux = new TsDemuxer({ video: inp.wantVideo, audio: inp.wantAudio });
      if (ctx.pause && bytes.length > 2 * TS_SLICE) {
        for (let o = 0; o < bytes.length; o += TS_SLICE) {
          inp.demux.push(bytes.subarray(o, Math.min(bytes.length, o + TS_SLICE)));
          await ctx.pause();
        }
      } else inp.demux.push(bytes);
      collectTs(inp, batch);
    } else if (kind === "packed") {
      if (!inp.wantAudio) return batch;
      const h = parsePackedHeader(bytes);
      const fmt = sniffPacked(bytes, h.offset);
      if (fmt !== "aac") throw unsupported(fmt === "unknown" ? "formato de audio desconocido" : "audio " + fmt);
      if (!inp.adts) inp.adts = new AdtsAssembler((s) => inp.adtsOut.push(s));
      let pts = h.pts;
      if (pts === void 0 && inp.adts.next === void 0) pts = Math.round(inp.playSec * 9e4);
      inp.adts.push(bytes.subarray(h.offset), pts);
      if (inp.adts.unsupported) throw unsupported(inp.adts.unsupported);
      if (inp.adtsOut.length) {
        batch.audio = { samples: inp.adtsOut, cfg: inp.adts.cfg };
        batch.minSec = inp.adtsOut[0].pts / 9e4;
        inp.adtsOut = [];
      }
    } else if (kind === "fmp4") {
      let init;
      if (seg.map) {
        init = await getInit(ctx, seg.map);
      } else {
        if (children(bytes, 0, bytes.length).some((b) => b.type === "moov")) inp.selfInit = { key: "self" + ctx.seq++, bytes, parsed: null };
        init = inp.selfInit;
      }
      if (!init) throw unsupported("le falta el encabezado");
      if (!init.parsed) init.parsed = parseInit(init.bytes);
      const tracks = init.parsed.tracks;
      const pickV = inp.wantVideo ? tracks.find((t) => t.type === "video") : null;
      const pickA = inp.wantAudio || !tracks.some((t) => t.type === "video") ? tracks.find((t) => t.type === "audio") : null;
      const chosen = [["video", pickV], ["audio", pickA]].filter((x) => x[1]);
      if (chosen.some((x) => x[1].encrypted)) throw new JobError("drm", MSG.drm);
      const res = parseFragments(bytes, init.parsed, inp.frag, seg.range ? seg.range.offset : 0);
      for (const [type, trk] of chosen) {
        const samples = res.tracks.get(trk.id);
        if (!samples || !samples.length) continue;
        const shift = trk.emptySec - trk.mediaTime / trk.timescale;
        batch[type] = { fmp4: true, trk, initKey: init.key, samples, bytes, shift };
        batch.minSec = Math.min(batch.minSec, (samples[0].dts + samples[0].cts) / trk.timescale + shift);
      }
    } else {
      let p = 0;
      while (p < bytes.length && p < 64 && (bytes[p] === 32 || bytes[p] === 10 || bytes[p] === 13 || bytes[p] === 9 || bytes[p] >= 239)) p++;
      const c = bytes[p];
      if (c === 60 || c === 123 || c === 35 || c === 91 || c === 87 && bytes[p + 1] === 69 && bytes[p + 2] === 66) throw new JobError("parse", MSG.notVideo);
      throw unsupported("formato desconocido");
    }
    return batch;
  }
  function collectTs(inp, batch) {
    const dm = inp.demux;
    if (dm.scrambled) throw new JobError("drm", MSG.drm);
    if (dm.pmtSeen && !inp.tsChecked) {
      inp.tsChecked = true;
      const v = dm.videoCodec, a = dm.audioCodec;
      if (inp.wantVideo && v && v.endsWith("-cifrado") || inp.wantAudio && a && a.endsWith("-cifrado")) throw new JobError("drm", MSG.drm);
      if (inp.wantVideo && v && v !== "h264") throw unsupported("video " + v);
      if (inp.wantAudio && a && a !== "aac") throw unsupported("audio " + a);
    }
    if (dm.adts.unsupported) throw unsupported(dm.adts.unsupported);
    if (dm.adts.changed) throw unsupported("el audio cambia de formato por la mitad");
    if (dm.video.length) {
      batch.video = { samples: dm.video, config: dm.h264.config };
      batch.minSec = Math.min(batch.minSec, dm.video[0].pts / 9e4);
      dm.video = [];
    }
    if (dm.audio.length) {
      batch.audio = { samples: dm.audio, cfg: dm.adts.cfg };
      batch.minSec = Math.min(batch.minSec, dm.audio[0].pts / 9e4);
      dm.audio = [];
    }
  }
  function fixJump(inp, batch) {
    if (batch.minSec === Infinity) return;
    let end = -Infinity;
    for (const tr of [inp.tracks.video, inp.tracks.audio]) {
      if (!tr) continue;
      const e = tr.presentEndSec();
      if (e !== null && e > end) end = e;
    }
    if (end === -Infinity) return;
    const start2 = batch.minSec + inp.offsetSec;
    if (start2 < end - 1 || start2 > end + 60) {
      inp.offsetSec += end - start2;
      inp.audioAnchored = false;
      inp.jumps++;
    }
  }
  function commitBatch(ctx, inp, batch) {
    const off = inp.offsetSec;
    const mux = ctx.mux;
    for (const type of ["video", "audio"]) {
      const b = batch[type];
      if (!b) continue;
      let tr = inp.tracks[type];
      if (b.fmp4) {
        const trk = b.trk;
        if (!tr) {
          tr = inp.tracks[type] = mux.addTrack({
            type,
            timescale: trk.timescale,
            entries: [],
            tkhdWidth: trk.width,
            tkhdHeight: trk.height,
            language: trk.language,
            presentShift: b.shift,
            trimStart: trk.emptySec + off
          });
          tr.descMap = /* @__PURE__ */ new Map();
        }
        const scale = tr.timescale / trk.timescale;
        const offT = Math.round((off + b.shift - tr.presentShift) * tr.timescale);
        const descOf = (d) => {
          const key = b.initKey + "#" + trk.id + "#" + d;
          let v = tr.descMap.get(key);
          if (!v) {
            const e = (trk.entries[d - 1] || trk.entries[0]).bytes;
            let idx = tr.entries.findIndex((x) => sameBytes(x, e));
            if (idx < 0) {
              if (tr.entries.length && fourcc(tr.entries[0], 4) !== fourcc(e, 4)) throw unsupported("el " + (type === "video" ? "video" : "audio") + " cambia de formato por la mitad");
              tr.entries.push(e);
              idx = tr.entries.length - 1;
            }
            v = idx + 1;
            tr.descMap.set(key, v);
          }
          return v;
        };
        for (const s of b.samples) {
          const dts = scale === 1 ? s.dts : s.dts * scale;
          const cts = scale === 1 ? s.cts : s.cts * scale;
          tr.add(b.bytes.subarray(s.offset, s.offset + s.size), dts + offT, cts, s.key, descOf(s.desc));
        }
        tr.lastDuration = Math.round(b.samples[b.samples.length - 1].dur * scale);
      } else if (type === "video") {
        if (!tr) {
          const config = b.config;
          const info = config.info;
          tr = inp.tracks.video = mux.addTrack({
            type: "video",
            codec: "avc1",
            timescale: 9e4,
            width: info.width * info.sarW / info.sarH,
            height: info.height,
            buildEntries: () => [avc1Entry(config)]
          });
        }
        const off90 = Math.round(off * 9e4);
        for (const s of b.samples) tr.add(s.data, s.dts + off90, Math.max(0, s.pts - s.dts), s.key);
      } else {
        const cfg = b.cfg;
        if (!tr) {
          inp.audioCfg = cfg;
          tr = inp.tracks.audio = mux.addTrack({
            type: "audio",
            codec: "mp4a",
            timescale: cfg.sampleRate,
            buildEntries: (t) => [mp4aEntry(cfg, t.mediaDur > 0 ? t.bytes * 8 * t.timescale / t.mediaDur : 0)]
          });
        } else if (cfg.sfi !== inp.audioCfg.sfi || cfg.ch !== inp.audioCfg.ch || cfg.aot !== inp.audioCfg.aot) {
          throw unsupported("el audio cambia de formato por la mitad");
        }
        const sr = tr.timescale;
        for (const s of b.samples) {
          if (!s.cont || !inp.audioAnchored) {
            inp.audioBase = Math.round((s.pts / 9e4 + off) * sr);
            inp.audioCount = 0;
            inp.audioAnchored = true;
          }
          tr.add(s.data, inp.audioBase + inp.audioCount, 0, true);
          inp.audioCount += s.samples;
          tr.lastDuration = s.samples;
        }
      }
    }
  }
  async function loadPlaylist(net, url) {
    const r = await net.get(url, { text: true });
    const pl = parseM3U8(r.text, r.url || url);
    if (pl.kind === "invalid") throw new JobError("parse", MSG.notPlaylist);
    return pl;
  }
  async function resolveInputs(job, net) {
    let videoUrl = job.videoUrl || null;
    let audioUrl = job.audioUrl || null;
    let main = null;
    let variant = null;
    if (!videoUrl) {
      const pl = await loadPlaylist(net, job.url);
      if (pl.kind === "master") {
        if (pl.drm) throw new JobError("drm", MSG.drm);
        const pick = pickVariant(pl, job.height);
        if (!pick) throw new JobError("empty", MSG.emptyList);
        variant = pick.variant;
        videoUrl = variant.uri;
        audioUrl = pick.audioUri;
      } else {
        main = pl;
        videoUrl = job.url;
      }
    }
    if (!main) main = await loadPlaylist(net, videoUrl);
    if (main.kind !== "media") throw new JobError("parse", MSG.notPlaylist);
    if (audioUrl === videoUrl) audioUrl = null;
    const inputs = [new Input(audioUrl ? "video" : "both", main, videoUrl)];
    if (audioUrl) {
      const apl = await loadPlaylist(net, audioUrl);
      if (apl.kind !== "media") throw new JobError("parse", MSG.notPlaylist);
      inputs.push(new Input("audio", apl, audioUrl));
    }
    for (const inp of inputs) {
      if (!inp.segs.length) throw new JobError("empty", MSG.emptyList);
      const enc = inp.segs.find((s) => s.key);
      if (enc) {
        const plain = enc.key.method === "AES-128";
        throw new JobError(plain ? "encrypted" : "drm", plain ? MSG.encrypted : MSG.drm, { method: enc.key.method });
      }
    }
    return { inputs, variant };
  }
  var TS_SLICE = 188 * 5577;
  var RAW_EXT = { ts: "ts", fmp4: "mp4", aac: "aac", mp3: "mp3", ac3: "ac3" };
  async function runRaw(ctx, inputs, host, report, newStore) {
    const files = [];
    for (const inp of inputs) {
      const store = newStore();
      let lastMap = null;
      let ext = null;
      for (const seg of inp.segs) {
        if (seg.map) {
          const init = await getInit(ctx, seg.map);
          if (init.key !== lastMap) {
            await store.add([init.bytes]);
            lastMap = init.key;
          }
        }
        const bytes = await inp.feed.next();
        if (!ext && bytes && bytes.length) {
          let kind = seg.map ? "fmp4" : sniffKind(bytes);
          if (kind === "packed") kind = sniffPacked(bytes, parsePackedHeader(bytes).offset);
          ext = RAW_EXT[kind] || "bin";
        }
        if (bytes && bytes.length) await store.add([bytes]);
        report();
      }
      await store.check();
      const label = inputs.length > 1 ? inp.role === "audio" ? "audio" : "video" : "";
      files.push({ blob: new host.Blob(store.parts, { type: "application/octet-stream" }), ext: ext || "bin", label });
    }
    return files;
  }
  async function runJob(job, host) {
    const outer = host.signal || null;
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    if (outer) {
      if (outer.aborted) ctl.abort();
      else outer.addEventListener("abort", onAbort, { once: true });
    }
    const net = new Net(host, ctl.signal);
    try {
      return await runInner(job, host, net, ctl.signal);
    } finally {
      ctl.abort();
      if (outer) outer.removeEventListener("abort", onAbort);
    }
  }
  async function runInner(job, host, net, signal) {
    const notify = (p) => {
      try {
        if (host.onProgress) host.onProgress(p);
      } catch (e) {
      }
    };
    const { inputs, variant } = await resolveInputs(job, net);
    const total = inputs.reduce((n, i) => n + i.segs.length, 0);
    const live = inputs.some((i) => !i.pl.endList);
    const seconds = inputs[0].pl.duration;
    let done = 0;
    const report = () => {
      done++;
      notify({ phase: "download", total, done, bytes: net.bytes });
    };
    notify({ phase: "start", total, done: 0, bytes: 0, live, seconds, height: variant ? variant.height : 0 });
    const ctx = { net, inits: /* @__PURE__ */ new Map(), seq: 0, mux: null, pause: host.pause || null };
    for (const inp of inputs) inp.feed = makeFeed(net, inp.segs, host.window || 3);
    for (const inp of inputs) inp.feed.prime();
    const waiting = () => notify({ phase: "wait", total, done, bytes: net.bytes });
    const newStore = () => new Store(host, signal, waiting);
    if (job.mode === "raw") {
      const files = await runRaw(ctx, inputs, host, report, newStore);
      return { files, info: { mode: "raw", live, seconds } };
    }
    const mux = ctx.mux = new Mp4Muxer();
    const store = newStore();
    const pump = async (all) => {
      mux.advance(false);
      for (let c = mux.take(all); c; c = mux.take(all)) await store.add(c.pieces);
    };
    const step = async (inp, sectionStart) => {
      const seg = inp.segs[inp.idx];
      const bytes = await inp.feed.next();
      inp.idx++;
      const batch = await demuxSegment(ctx, inp, seg, bytes, sectionStart);
      inp.playSec += seg.duration;
      report();
      return batch;
    };
    const endSection = (inp) => {
      const batch = { video: null, audio: null, minSec: Infinity };
      if (inp.demux) {
        inp.demux.flush();
        collectTs(inp, batch);
        inp.tsJumps += inp.demux.jumps;
      }
      return batch;
    };
    const nSec = Math.max(...inputs.map((i) => i.sections.length));
    let outStart = 0;
    for (let k = 0; k < nSec; k++) {
      const act = inputs.filter((i) => k < i.sections.length);
      const held = /* @__PURE__ */ new Map();
      for (const inp of act) {
        inp.resetSection();
        const list = [];
        held.set(inp, list);
        let first = true;
        while (inp.idx < inp.bounds[k + 1]) {
          const b = await step(inp, first);
          first = false;
          list.push(b);
          if (b.minSec !== Infinity) break;
        }
      }
      let minSrc = Infinity;
      for (const list of held.values()) for (const b of list) if (b.minSec < minSrc) minSrc = b.minSec;
      const offset = minSrc === Infinity ? 0 : outStart - minSrc;
      for (const inp of act) {
        inp.offsetSec = offset;
        for (const b of held.get(inp)) commitBatch(ctx, inp, b);
      }
      await pump(false);
      for (; ; ) {
        let pick = null;
        for (const inp of act) if (inp.idx < inp.bounds[k + 1] && (!pick || inp.playSec < pick.playSec)) pick = inp;
        if (!pick) break;
        const b = await step(pick, false);
        fixJump(pick, b);
        commitBatch(ctx, pick, b);
        await pump(false);
      }
      for (const inp of act) {
        commitBatch(ctx, inp, endSection(inp));
        if (k === inp.sections.length - 1) {
          for (const tr of [inp.tracks.video, inp.tracks.audio]) if (tr) tr.end();
        }
      }
      await pump(false);
      for (const t of mux.tracks) {
        const e = t.presentEndSec();
        if (e !== null && e > outStart) outStart = e;
      }
    }
    notify({ phase: "assemble", total, done, bytes: net.bytes });
    const fin = mux.finalize();
    for (let c = mux.take(true); c; c = mux.take(true)) await store.add(c.pieces);
    await store.check();
    const notes = [];
    for (const inp of inputs) {
      if (inp.demux && inp.demux.h264.dropped) notes.push("descarté " + inp.demux.h264.dropped + " cuadros del principio que no se podían ver solos");
      const jumps = inp.jumps + inp.tsJumps;
      if (jumps) notes.push("el reloj del video pegó " + jumps + " salto(s) y lo emparejé");
    }
    const blob = new host.Blob([...fin.head, ...store.parts], { type: "video/mp4" });
    return { files: [{ blob, ext: "mp4", label: "" }], info: { mode: "mp4", live, seconds: fin.seconds, size: fin.size, tracks: fin.tracks, sections: nSec, notes } };
  }

  // src/engine/page.js
  function pause() {
    return new Promise((resolve) => {
      const c = new MessageChannel();
      c.port1.onmessage = () => {
        c.port1.close();
        resolve();
      };
      c.port2.postMessage(0);
    });
  }
  function start(job) {
    const evt = String(job.evt);
    const doc = document;
    const send = (type, data) => {
      try {
        doc.dispatchEvent(new CustomEvent(evt, { detail: JSON.stringify(Object.assign({ type }, data || {})) }));
      } catch (e) {
      }
    };
    const ctl = new AbortController();
    let files = null;
    doc.addEventListener(evt + ":cmd", (e) => {
      let m;
      try {
        m = JSON.parse(e.detail);
      } catch (x) {
        return;
      }
      if (!m) return;
      if (m.type === "cancel") ctl.abort();
      else if (m.type === "release") {
        if (files) for (const f of files) {
          try {
            URL.revokeObjectURL(f.url);
          } catch (x) {
          }
        }
        files = null;
      } else if (m.type === "anchor") {
        const f = files && files[m.index];
        if (!f) return;
        try {
          const a = doc.createElement("a");
          a.href = f.url;
          a.download = String(m.filename || "video." + f.ext);
          a.style.display = "none";
          (doc.body || doc.documentElement).appendChild(a);
          a.click();
          a.remove();
          send("anchored", { index: m.index });
        } catch (x) {
          send("anchor-failed", { index: m.index });
        }
      }
    });
    let lastSent = 0;
    let lastPhase = "";
    const onProgress = (p) => {
      const now = Date.now();
      const final = p.total > 0 && p.done >= p.total;
      if (p.phase === lastPhase && !final && now - lastSent < 300) return;
      lastSent = now;
      lastPhase = p.phase;
      send("progress", { phase: p.phase, done: p.done, total: p.total, bytes: p.bytes, live: p.live });
    };
    const host = {
      fetch: (u, i) => fetch(u, i),
      Blob,
      signal: ctl.signal,
      concurrency: 4,
      window: 4,
      onProgress,
      pause
    };
    (async () => {
      try {
        let res;
        let note = "";
        try {
          res = await runJob(job, host);
        } catch (e) {
          if (!e || e.code !== "unsupported" || job.mode === "raw") throw e;
          note = String(e.message || "");
          lastPhase = "";
          send("progress", { phase: "restart", done: 0, total: 0, bytes: 0 });
          res = await runJob(Object.assign({}, job, { mode: "raw" }), host);
        }
        files = res.files.map((f) => ({ url: URL.createObjectURL(f.blob), blob: f.blob, size: f.blob.size, ext: f.ext, label: f.label }));
        send("done", {
          files: files.map((f) => ({ url: f.url, size: f.size, ext: f.ext, label: f.label })),
          info: { mode: res.info.mode, live: !!res.info.live, seconds: res.info.seconds || 0, notes: res.info.notes || [] },
          note
        });
      } catch (e) {
        send("error", {
          code: e && e.code || "bug",
          message: String(e && e.message || e),
          status: e && e.extra && e.extra.status || 0
        });
      }
    })();
    return "started";
  }
  return __toCommonJS(page_exports);
})();

return __hlsmp4.start(job);
};
