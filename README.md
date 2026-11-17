# Andrew-Chess

A local chess game with illustrated, talking coaches. Vanilla JavaScript, Vite and chess.js. The game and studio use audio plus animated portrait sheets.

## Run

Requires Node 20.19+ or 22.12+ (Node 24 works).

```sh
npm install
npm run dev
```

On PowerShell, use `npm.cmd` if execution policy blocks `npm`. Open the printed Vite address for the game, or `/studio.html` for the audio studio. The server listens on port 5173 on the local network. Use `npm run dev -- --host 127.0.0.1` for this PC only.

```sh
npm test
npm run build
npm run preview
```

The production build is a playback snapshot. Recording, analysis and generation require the local development server. Rebuild after changing recordings or artwork.

## Folders and assets

| Location | Purpose |
| --- | --- |
| `src/` | Current game and studio code |
| `public/coach/jimmy/artwork/` | Jimmy’s portrait sheets; image files stay outside the source code |
| `public/coach/jimmy/artwork.json` | Sheet names and style-reference metadata |
| `public/coach/andrew/frame-sets/` | Andrew’s portrait animation sheets |
| `public/fonts/` | Local bitmap font |
| `public/coach/jimmy/` | Jimmy’s recordings, audio, frame sets, voice references and history |
| `public/coach/andrew/` | Andrew’s recordings, audio, frame sets, portraits, voice references and history |
| `raw-media/coach/shared/` | Original recordings and shared analysis/rendering intermediates (Git-ignored) |
| `public/coach/coaches.json` | Coach registry; stable internal IDs mapped to display names |
| `scripts/` | Local server, asset tools and build packaging |
| `tests/` | Game, studio, media and build regression tests |
| `raw-media/` | Local production sources, generated voice batches, analysis, and video exports (Git-ignored) |
| `media-originals/` | Source material and reusable audio conversion cache |
| `tmp/` | Generated previews, working files and logs |
| `archive/2026-11-17-cleanup/` | Unused modules, old artwork, previews and setup backups |
| `dist/` | Generated deployment folder; safe to regenerate with `npm run build` |

Coach IDs now match their names and folders: `jimmy` and `andrew`. No runtime ID-to-name translation is needed. Saved coach metadata has been migrated. On the next studio visit, IndexedDB upgrades old draft ownership in place without changing recorded audio chunks. Close old studio tabs and reload if the upgrade is blocked. The historical database name is retained to recover existing takes; only the isolated legacy-migration helper knows the old IDs. Old UUID links select Andrew; `?coach=andrew` now unambiguously means Andrew, and Jimmy uses `?coach=jimmy`. Backups are in `archive/2026-11-17-coach-ids/`.

### Small production builds

`scripts/playback-assets.mjs` packages only selected audio, approved portrait sheets, the active core portrait, the font, and compact playback manifests. Audio is encoded as mono AAC in M4A containers at 96 kb/s. Identical source files reuse a content-addressed cache under `media-originals/audio/`.

Build audio lives at `dist/coach/<coach-name>/audio/`. Vite bundles only code and styles under `dist/assets/`. Jimmy’s image files remain at `dist/coach/jimmy/artwork/`, with filenames defined by `artwork.json`. Metadata is bundled, but PNG files are not imported into JavaScript. Andrew’s animation sheets are under `dist/coach/andrew/frame-sets/`, and his core portrait is under `dist/coach/andrew/references/`. Each coach’s recordings manifest is beside those folders. Old takes, original videos, rendered animation exports, analysis intermediates, voice-cloning references and generation requests are excluded from the build. Full studio manifests remain unchanged except for extracted-audio playback links.

Missing selected media makes the build fail instead of silently shipping broken recordings. Animation and mouth timing are preserved and rebound to the packaged audio. Stale timing from an earlier take is excluded.

### Convert remaining videos to audio

```sh
npm run coach:audio
```

This scans `public/`, `raw-media/`, and `media-originals/`, extracts audio with bundled FFmpeg, and writes `media-originals/audio/conversion-report.json`. Each report entry maps the source video to its M4A. Repeated runs reuse cached conversions. Videos without audio are reported separately; conversion errors produce a failing exit code.

For currently selected video takes, the tool also installs audio under `public/coach/<coach-name>/audio/` and links it to the take. The game and studio preview prefer that audio only while the original take still matches. Retakes cannot accidentally play an older extraction. Originals remain available for editing and recovery. No source videos are included in production builds.

Back up `public/coach/`, `raw-media/`, and `media-originals/` to preserve recordings, reference material and editing history. The archive contains the pre-cleanup README with historical workflows.

## Game behavior and code

You play White. Click a piece and destination; legal moves, castling, en passant, promotion and game-over rules use chess.js. Games are not persisted across reloads. Menu selects the coach, difficulty and new game. The learning mode is a placeholder.

Difficulty labels 500 / 1000 / 1300 are approximate, not measured Elo. The opponent runs in a worker with material, centralization and iterative alpha-beta search. It is not Stockfish.

- `src/main.js`: board, controls and turn flow.
- `src/engine.js`, `src/engine.worker.js`: computer moves.
- `src/coach-config.js`: ordered reaction triggers, spoken lines, stable action IDs, idle lines and reviews.
- `src/coach.js`: chess facts and reaction playback.
- `src/recorded-performance.js`: selected audio and matching animation timing.
- `src/portrait-config.js`: expression sheets and per-phrase animation choices.
- `src/studio.js`: recording and editing UI.

The coach deliberately values pawns over other pieces. Player reactions run after White moves; opponent reactions run after Black moves. Two-move trade reactions run before ordinary events, and game-over reviews take priority. Silent gestures keep mouths closed and play no audio. Long commentary does not block chess moves. Missing recordings can fall back to browser speech; the menu mute control covers speech and recorded audio.

## Audio coach studio

Open `/studio.html` or Menu → Coach studio. Select the working coach at the top.

- Record a microphone take or upload WAV, MP3, M4A, Ogg, FLAC or WebM. Recording stops at two minutes. Unsaved chunks are backed up in the browser per coach.
- Saved takes can be restored; trimming preserves previous takes and invalidates old timing.
- Sync lips prepares mouth timing and wording-based expressions. Optional vocal-emotion analysis and manual timelines remain available.
- Save publishes the selected audio and animation to the game.
- Coach reference images establish each coach's identity. Approve core portraits before generating reusable emotion or gesture sheets. New artwork requires review.

Generated speech uses its submitted text directly. Local microphone recordings can use transcription. The optional setup commands are `npm run speech:setup` and `npm run emotion:setup`.

### Voice and artwork services

The Fish Speech Drama 3 client uses `POST /v1/tts` with text, reference ID, WAV format and streaming disabled. Requests are serialized across coaches, with a 600-second timeout and explicit retry controls. Configure the base URL and voice reference in the studio. The default LAN URL is `http://192.168.1.84:8080`; the service must be listening on its LAN interface.

Connection settings are stored in `.voice-service.json`. `FISH_SPEECH_BASE_URL` in `.env.local` or the process environment overrides the UI value. Voice cloning references and transcripts are retained in each coach's `voice-reference/` folder for recovery after a server reset.

Artwork generation uses `OPENROUTER_API_KEY` in `.env.local` (see `.env.example`). Never prefix this server-only secret with `VITE_`. Image generation uses OpenRouter credits. Jobs run in the local Vite server; keep it running while processing.

`node scripts/fill-coach-voices.mjs` resumes configured voice batches while respecting paused batches and existing recordings. `node scripts/export-coach-animations.mjs` optionally creates shareable MP4 animation exports; these are local exports and are excluded from builds.

### Phone recording

Microphone recording requires a secure context: localhost or HTTPS. This PC's private Tailscale origin is configured in `.env.development.local`. Run the app, then `tailscale serve --bg http://127.0.0.1:5173` and connect the phone to the same Tailscale network. Inspect with `tailscale serve status`.

For another tunnel, set `COACH_TUNNEL_ORIGIN` to its exact HTTPS origin before starting Vite. Public tunnels expose studio controls to visitors; use private access for personal recording.

## Legacy tools

Legacy video conversion, keyframe and performance-analysis server utilities remain because the server, tests or explicit maintenance commands still use them. They do not add assets to the production build. `coach:convert`, `coach:rebuild`, `coach:keyframes`, `coach:analyze` and `coach:emotions` remain available for those workflows. See the archived README for their historical instructions.

### Production media storage

Runtime media stays under `public/coach/` and is not Git-ignored: selected/source recordings in `originals`, generated speech in `voice` and `voice-fill-*`, finished audio, approved portrait images, and coach manifests. These assets are required for local playback and rebuilding the app. New coaches and new phrases use these same public locations automatically.

`raw-media/` is Git-ignored and contains production material: voice-cloning references and pilots, analysis, keyframes, styled video intermediates, and optional animation exports. Stable `/coach/...` URLs let the studio read these editing resources locally. The game does not load these folders for its current selected recordings. Keep a separate backup if you want to preserve editing history or regenerate artwork. `.speech` and `.emotion` are local analysis-tool installations, not runtime game assets.

The development server reads the published approved frame-set manifest directly. Full draft/approval scans are reserved for studio APIs. It does not watch raw media, model installations, archives, or temporary outputs for page reloads.
