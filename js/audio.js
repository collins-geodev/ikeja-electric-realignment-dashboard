/* Quiet looping instrumental — trimmed from 3:20; start ASAP on load */
(() => {
  const SOURCES = [
    "assets/audio/ambient-instrumental.mp3",
    "assets/audio/ambient-instrumental.m4a",
  ];
  /** File is already trimmed from 3:20; keep 0. If full track ever used, set to 200. */
  const START_SEC = 0;
  const VOLUME = 0.2;

  const state = { audio: null, started: false, unlocked: false };

  function ensureAudio() {
    if (state.audio) return state.audio;
    let el = document.getElementById("ambient-audio");
    if (!el) {
      el = document.createElement("audio");
      el.id = "ambient-audio";
      el.preload = "auto";
      el.loop = true;
      el.setAttribute("playsinline", "");
      el.setAttribute("crossorigin", "anonymous");
      el.style.display = "none";
      document.body.appendChild(el);
    }
    el.volume = VOLUME;
    el.innerHTML = SOURCES.map((s) => {
      const type = s.endsWith(".m4a") ? "audio/mp4" : "audio/mpeg";
      return `<source src="${s}" type="${type}">`;
    }).join("");
    if (!el.getAttribute("src") && !el.querySelector("source")) el.src = SOURCES[0];

    el.addEventListener("ended", () => {
      try {
        el.currentTime = START_SEC;
        el.play().catch(() => {});
      } catch (_) { /* ignore */ }
    });
    el.addEventListener("timeupdate", () => {
      if (!el.loop && Number.isFinite(el.duration) && el.currentTime >= el.duration - 0.4) {
        el.currentTime = START_SEC;
      }
    });
    el.addEventListener("loadedmetadata", () => {
      if (START_SEC > 0 && el.currentTime < START_SEC - 0.5) {
        try { el.currentTime = START_SEC; } catch (_) { /* ignore */ }
      }
      tryPlay(true);
    });
    state.audio = el;
    return el;
  }

  function syncButton(playing) {
    const btn = document.getElementById("btn-audio");
    if (!btn) return;
    btn.textContent = playing ? "Mute instrumental" : "Play instrumental";
    btn.title = "Quiet instrumental loop (from 3:20 of source)";
    btn.setAttribute("aria-pressed", playing ? "true" : "false");
  }

  async function tryPlay(forceSeek) {
    const el = ensureAudio();
    el.volume = VOLUME;
    if (forceSeek && START_SEC > 0) {
      try {
        if (el.readyState >= 1) el.currentTime = START_SEC;
      } catch (_) { /* ignore */ }
    }
    try {
      if (!state.unlocked) {
        el.muted = true;
        await el.play();
        el.muted = false;
        el.volume = VOLUME;
      } else {
        await el.play();
      }
      state.started = !el.paused;
      syncButton(state.started);
      return state.started;
    } catch (_) {
      syncButton(false);
      return false;
    }
  }

  function setPlaying(on) {
    const el = ensureAudio();
    state.unlocked = true;
    if (on) {
      el.muted = false;
      el.volume = VOLUME;
      tryPlay(true);
    } else {
      el.pause();
      state.started = false;
      syncButton(false);
    }
  }

  function boot() {
    ensureAudio();
    tryPlay(true);
    const el = state.audio;
    el.addEventListener("canplay", () => tryPlay(true), { once: true });
    el.addEventListener("canplaythrough", () => tryPlay(true), { once: true });

    const unlock = () => {
      state.unlocked = true;
      tryPlay(true);
    };
    ["pointerdown", "keydown", "touchstart", "click"].forEach((ev) => {
      document.addEventListener(ev, unlock, { once: true, passive: true, capture: true });
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") tryPlay(false);
    });

    document.getElementById("btn-audio")?.addEventListener("click", () => {
      state.unlocked = true;
      const a = ensureAudio();
      if (a && !a.paused) setPlaying(false);
      else setPlaying(true);
    });

    let n = 0;
    const iv = setInterval(() => {
      n += 1;
      if (state.started || n > 24) clearInterval(iv);
      else tryPlay(false);
    }, 400);
  }

  window.IKEDCAudio = { boot, setPlaying, tryPlay, START_SEC, VOLUME };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
