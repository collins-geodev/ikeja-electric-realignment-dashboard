# Ambient instrumental

Quiet background loop for the dashboard (user-provided OneDrive track).

- UI label: **Play instrumental** / **Mute instrumental**
- Files: `ambient-instrumental.mp3` and `.m4a`
- Trimmed with ffmpeg from **3:20 (200s)** to end so the loop is the instrumental section
- Playback: `js/audio.js` — autoplay on load (muted-unlock fallback), `loop`, volume ~0.2
