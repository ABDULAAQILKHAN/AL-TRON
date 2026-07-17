# SENSE

The mobile client for AL-TRON — an always-listening voice assistant built
with Expo/React Native. Says "Altron" (or "Ultron" — see below) to wake it,
speak your request, and it answers out loud in AL-TRON's own synthesized
voice, with a live 3D animated orb reacting to mic input and conversation
state.

SENSE holds no AI provider keys itself — every LLM call and voice
synthesis happens server-side in [ALTRON_ENGINE](../ALTRON_ENGINE), which
this app talks to over a single HTTP(S) connection.

## Features

- **Real login** — a `LoginScreen` calls ALTRON_ENGINE's `POST /auth/login`
  (itself a thin proxy to AUTH-PRO) and keeps the resulting token in
  `expo-secure-store`, not baked into the JS bundle. The mic doesn't start
  listening until you're logged in, and a 401 from the gateway (expired/
  revoked token) automatically drops you back to the login screen instead of
  looping on a dead token.
- **Wake word detection** — continuous on-device speech recognition
  (`expo-speech-recognition`) listens for "Altron". Also accepts "Ultron",
  since on-device recognizers consistently mishear the invented word as the
  much more common Marvel name.
- **Streaming responses** — prompts are sent to `POST /ai/prompt/stream`
  (Server-Sent Events over `expo/fetch`, which — unlike React Native's
  built-in `fetch` — exposes a real, incrementally-readable response body).
  Interim "thinking / remembering / saving" status events play a matching
  pre-generated voice clip instead of sitting in silence.
- **AL-TRON's actual voice** — the final answer's audio (and the wake-word
  greetings / status fillers) are all pre/server-synthesized via Hume Octave
  TTS with a fixed voice, not the OS's generic TTS. The device voice
  (`expo-speech`) is only a fallback if the backend omits audio.
- **3D animated orb** (`components/AltronOrb3D.tsx`) — `@react-three/fiber`
  + custom GLSL shaders (fresnel glow, noise displacement), audio-reactive
  to mic input, with distinct idle/listening/thinking/speaking/disconnected
  states.
- **Barge-in** — you can say "Altron" again mid-response to interrupt it and
  start a new command immediately.

## Requirements

- **Node.js 20+** and npm
- **[ALTRON_ENGINE](../ALTRON_ENGINE)** running and reachable from your
  device/emulator (see its README)
- A way to build a **custom dev client** — this app uses native modules
  (`expo-speech-recognition`, `expo-gl`, `expo-audio`, `three`) that do
  **not** run in the plain Expo Go app, so you need:
  - **Android**: Android Studio + an emulator or a physical device with USB
    debugging, for `expo run:android`
  - **iOS**: a Mac with Xcode, for `expo run:ios`
- A **physical device is strongly recommended** for real use — wake-word
  detection and the mic need an actual microphone; simulators/emulators are
  fine for UI work but awkward for voice testing.

> **This project pins Expo SDK 57.** Its APIs (especially `expo/fetch`,
> `expo-audio`, `expo-file-system`'s `File`/`Paths`) have changed across
> recent SDKs — see [`AGENTS.md`](AGENTS.md) and check the versioned docs at
> https://docs.expo.dev/versions/v57.0.0/ before assuming an API from
> memory or an older tutorial still applies.

## Environment variables

Copy `.env.example` to `.env`:

| Variable | Notes |
|---|---|
| `EXPO_PUBLIC_BACKEND_URL` | ALTRON_ENGINE's `/ai/prompt` URL, e.g. `http://192.168.1.19:3000/ai/prompt`. Use your machine's **LAN IP**, not `localhost` — a physical/emulated device can't reach your dev machine's loopback address. Both the `/stream` variant and the base URL used for `/auth/login` are derived from this automatically. |

`EXPO_PUBLIC_*` vars are inlined into the JS bundle **at Metro start time**,
not read live — editing `.env` requires a full restart of `npx expo start`
(not just an in-app reload) to take effect. Never put a real secret behind
that prefix; this is also why the Hume API key lives only in
ALTRON_ENGINE's `.env`, and why the auth token isn't an env var at all
anymore — see below.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# then edit .env - set EXPO_PUBLIC_BACKEND_URL to your machine's LAN IP

# 3. Make sure ALTRON_ENGINE is running and reachable at that address
#    (see ../ALTRON_ENGINE/README.md)

# 4. Build + install a custom dev client and launch it
npx expo run:android      # or: npx expo run:ios (macOS + Xcode only)
```

After the first native build, day-to-day iteration is just:

```bash
npx expo start
```

with the dev client already installed on the device — no need to rebuild
natively again unless you add/change a native module or `app.json` config.

## npm scripts

| Script | Purpose |
|---|---|
| `npm run start` | Start the Metro bundler (`expo start`) |
| `npm run android` | Build + install the native dev client and run on Android (`expo run:android`) |
| `npm run ios` | Build + install the native dev client and run on iOS (`expo run:ios`) |
| `npm run web` | Run in a browser (`expo start --web`) — the 3D orb and native voice/speech modules won't work here, useful for quick UI-only checks only |

## Permissions

Declared in `app.json` and requested at runtime on first launch:

- **Microphone** — to hear the wake word and your commands
- **Speech recognition** — on-device transcription (iOS: `NSSpeechRecognitionUsageDescription`; Android: bundled with `RECORD_AUDIO`)

## Project structure

```
App.tsx                    Entire app: state machine, mic/wake-word loop,
                            SSE streaming client, TTS playback, render
components/
  AltronOrb3D.tsx           The active 3D orb (react-three-fiber + GLSL)
  AltronOrb.tsx              Older 2D/SVG orb, unused - kept for reference
  LoginScreen.tsx            Email/password form -> POST /auth/login
services/
  auth.ts                    SecureStore wrapper for the AUTH-PRO token
  hume/base64.ts             base64 -> Uint8Array decode (no atob/Buffer dep),
                              used to write backend-synthesized MP3s to disk
assets/
  audio/                     Pre-generated Hume voice clips: thinking/
                              remembering/saving fillers + wake-word greetings
                              (see ../ALTRON_ENGINE/scripts/generate-filler-audio.js)
```

## Architecture notes

- **Auth**: `LoginScreen` posts straight to ALTRON_ENGINE's `POST
  /auth/login` (a public route that itself just proxies to AUTH-PRO — see
  `../ALTRON_ENGINE/README.md`) and stores the returned `accessToken` in
  `expo-secure-store` via `services/auth.ts`. You need an existing AUTH-PRO
  account to log in — this app has no signup screen, only login. The mic
  effect in `App.tsx` doesn't run at all until a token is present, and any
  401 from `/ai/prompt/stream` clears the stored token and drops back to
  `LoginScreen` automatically.
- **Why SSE instead of a plain request/response**: a single `/ai/prompt`
  call can take several seconds (router call, sometimes a memory search +
  specialist call on top). `/ai/prompt/stream` lets the backend push
  "thinking" / "remembering" / "saving" events as the pipeline actually
  progresses, and the app plays a matching pre-generated voice clip for
  each one instead of leaving the user in silence.
- **Two separate audio players**: `ttsPlayer` (the real response) and
  `clipPlayer` (wake-word greetings + status fillers) are kept apart on
  purpose — sharing one player would mean a short filler clip finishing
  playback could trigger the "response finished" handler and snap the UI
  back to standby mid-request.
- **Continuous listening, restart-based capture**: `expo-speech-recognition`
  resets its transcript on natural pauses, so rather than trying to slice
  the wake word out of a running transcript, the app stops and restarts a
  dedicated fresh recognition session the moment "Altron" is heard, and
  captures whatever comes next as the full command.
