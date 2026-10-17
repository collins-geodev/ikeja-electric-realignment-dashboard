/* Quiet gapless instrumental via Web Audio (loop from trimmed 3:20 file) */
(() => {
  const SOURCES = [
    "assets/audio/ambient-instrumental.mp3",
    "assets/audio/ambient-instrumental.m4a",
  ];
  const VOLUME = 0.018;

  const state = {
    ctx: null,
    gain: null,
    filter: null,
    buffer: null,
    source: null,
    started: false,
    unlocked: false,
    loading: null,
  };

  function syncButton(playing) {
    const btn = document.getElementById("btn-audio");
    if (!btn) return;
    btn.textContent = playing ? "Mute instrumental" : "Play instrumental";
    btn.title = "Quiet gapless instrumental loop (from 3:20)";
    btn.setAttribute("aria-pressed", playing ? "true" : "false");
  }

  function ensureCtx() {
    if (state.ctx) return state.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    state.ctx = new AC();
    state.gain = state.ctx.createGain();
    state.gain.gain.value = VOLUME;
    // Gentle presence boost so the instrumental stays sharp at low volume
    state.filter = state.ctx.createBiquadFilter();
    state.filter.type = "highshelf";
    state.filter.frequency.value = 3200;
    state.filter.gain.value = 3.5;
    const presence = state.ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 1800;
    presence.Q.value = 0.9;
    presence.gain.value = 2.2;
    state.filter.connect(presence);
    presence.connect(state.gain);
    state.gain.connect(state.ctx.destination);
    state._presence = presence;
    return state.ctx;
  }

  async function loadBuffer() {
    if (state.buffer) return state.buffer;
    if (state.loading) return state.loading;
    const ctx = ensureCtx();
    if (!ctx) return null;
    state.loading = (async () => {
      let lastErr = null;
      for (const url of SOURCES) {
        try {
          const res = await fetch(url, { cache: "force-cache" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const raw = await res.arrayBuffer();
          const buf = await ctx.decodeAudioData(raw.slice(0));
          state.buffer = buf;
          return buf;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr || new Error("Audio load failed");
    })();
    try {
      return await state.loading;
    } finally {
      state.loading = null;
    }
  }

  function stopSource() {
    if (state.source) {
      try {
        state.source.onended = null;
        state.source.stop(0);
      } catch (_) { /* ignore */ }
      try { state.source.disconnect(); } catch (_) { /* ignore */ }
      state.source = null;
    }
  }

  function startBufferSource() {
    const ctx = ensureCtx();
    if (!ctx || !state.buffer || !state.gain) return false;
    stopSource();
    const src = ctx.createBufferSource();
    src.buffer = state.buffer;
    src.loop = true; // Web Audio loop is gapless
    src.loopStart = 0;
    src.loopEnd = state.buffer.duration;
    src.connect(state.filter || state.gain);
    src.start(0);
    state.source = src;
    state.started = true;
    syncButton(true);
    return true;
  }

  async function tryPlay() {
    const ctx = ensureCtx();
    if (!ctx) {
      syncButton(false);
      return false;
    }
    try {
      if (ctx.state === "suspended") await ctx.resume();
      await loadBuffer();
      if (!state.source) startBufferSource();
      else if (ctx.state === "running") {
        state.started = true;
        syncButton(true);
      }
      state.gain.gain.setTargetAtTime(VOLUME, ctx.currentTime, 0.05);
      return true;
    } catch (_) {
      syncButton(false);
      return false;
    }
  }

  function setPlaying(on) {
    state.unlocked = true;
    const ctx = ensureCtx();
    if (!ctx) return;
    if (on) {
      tryPlay();
    } else {
      stopSource();
      state.started = false;
      try {
        state.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      } catch (_) { /* ignore */ }
      syncButton(false);
    }
  }

  function boot() {
    ensureCtx();
    loadBuffer().then(() => tryPlay()).catch(() => {});

    const unlock = () => {
      state.unlocked = true;
      tryPlay();
    };
    ["pointerdown", "keydown", "touchstart", "click"].forEach((ev) => {
      document.addEventListener(ev, unlock, { once: true, passive: true, capture: true });
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") tryPlay();
    });

    document.getElementById("btn-audio")?.addEventListener("click", () => {
      state.unlocked = true;
      if (state.started && state.source) setPlaying(false);
      else setPlaying(true);
    });

    let n = 0;
    const iv = setInterval(() => {
      n += 1;
      if (state.started || n > 30) clearInterval(iv);
      else tryPlay();
    }, 350);
  }

  window.IKEDCAudio = { boot, setPlaying, tryPlay, VOLUME };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
