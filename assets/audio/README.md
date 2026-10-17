# Ambient instrumental

Quiet gapless background loop for the dashboard (user-provided OneDrive track).

- UI: **Play instrumental** / **Mute instrumental**
- Files: `ambient-instrumental.mp3` and `.m4a`
- Trimmed with ffmpeg from **3:20 (200s)** to end
- Playback: `js/audio.js` — Web Audio `AudioBufferSourceNode.loop` (gapless), volume ~0.07, light presence EQ
