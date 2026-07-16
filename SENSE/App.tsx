import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorCode,
  type ExpoSpeechRecognitionOptions,
} from 'expo-speech-recognition';
import AltronOrb3D, { type OrbVoiceState } from './components/AltronOrb3D';
import { base64ToUint8Array } from './services/hume/base64';

// --- Gateway config ------------------------------------------------------
// Both values come from `.env` (see `.env.example`). EXPO_PUBLIC_* vars are
// inlined into the JS bundle by Expo at build time - never put real secrets
// behind that prefix, only dev-time convenience values like these.
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://<YOUR_BACKEND_IP>:3000/ai/prompt';
const MOCK_AUTH_TOKEN = process.env.EXPO_PUBLIC_MOCK_AUTH_TOKEN ?? 'mock-dev-token';
// /ai/prompt/stream is the SSE sibling of /ai/prompt (see ai.controller.ts) -
// same route, same auth, just chunked so interim status events can arrive
// before the final result.
const STREAM_URL = BACKEND_URL.replace(/\/prompt\/?$/, '/prompt/stream');

// Mirrors ALTRON_ENGINE's PromptStatusStage ('remembering' | 'saving'),
// plus 'thinking' which the backend emits the instant a request lands
// (before the router has even decided which branch to take).
type PromptStatusStage = 'thinking' | 'remembering' | 'saving';

// Pre-synthesized once via Hume (same fixed voice as real responses - see
// ALTRON_ENGINE/scripts/generate-filler-audio.js) and bundled as static
// assets so playing one is instant, not another network round trip.
const STATUS_FILLER_AUDIO: Record<PromptStatusStage, number> = {
  thinking: require('./assets/audio/thinking.mp3'),
  remembering: require('./assets/audio/remembering.mp3'),
  saving: require('./assets/audio/saving.mp3'),
};

const PROCESSING_LABELS: Record<PromptStatusStage, string> = {
  thinking: 'THINKING...',
  remembering: 'REMEMBERING...',
  saving: 'SAVING...',
};

// ALTRON_ENGINE now synthesizes speech server-side (Hume Octave TTS) and
// returns it as base64 MP3 in the /ai/prompt response's `audio` field - the
// app no longer holds a Hume API key at all. `writeAudioToTempFile` just
// decodes+writes whatever the backend already gave us.
let previousAudioFileUri: string | null = null;
let audioFileCounter = 0;

function writeAudioToTempFile(base64Mp3: string): string {
  const bytes = base64ToUint8Array(base64Mp3);
  audioFileCounter += 1;
  const file = new File(Paths.cache, `altron-response-${Date.now()}-${audioFileCounter}.mp3`);
  file.write(bytes);

  if (previousAudioFileUri) {
    try {
      new File(previousAudioFileUri).delete();
    } catch {
      // Best-effort cleanup - cache dir is OS-evictable anyway.
    }
  }
  previousAudioFileUri = file.uri;
  return file.uri;
}

// "Altron" isn't a real word, and it's acoustically near-identical to
// "Ultron" (a very well-known proper noun from the Avengers films) - on-device
// logs confirm the recognizer's language model consistently favors "Ultron"
// over the essentially-unknown "Altron". Accept both rather than fight it.
const WAKE_WORD_VARIANTS = ['altron', 'ultron'];

function containsWakeWord(text: string): boolean {
  const lower = text.toLowerCase();
  return WAKE_WORD_VARIANTS.some((variant) => lower.includes(variant));
}

// How long a finished error stays on screen before returning to standby.
const AUTO_RESET_MS = 6000;

// A slightly deeper, slightly faster voice reads more "AI-authoritative"
// than the platform default (1.0 / 1.0).
const SPEECH_PITCH = 0.9;
const SPEECH_RATE = 1.1;

// Spoken locally the instant the wake word fires - NOT part of the model's
// answer. Keep this in sync with ALTRON_ENGINE/src/modules/persona/persona.service.ts's
// history of this list; the backend no longer injects a greeting into the
// model's reply, so this is the only place it happens now. Each greeting is
// pre-synthesized via Hume (same fixed voice as everything else - see
// ALTRON_ENGINE/scripts/generate-filler-audio.js) and bundled as a static
// asset, so playing one on wake-word detection is instant and sounds like
// AL-TRON rather than falling back to the device's native TTS voice.
const WAKE_ACK_GREETINGS: { text: string; audio: number }[] = [
  { text: 'hey bro', audio: require('./assets/audio/greetings/hey-bro.mp3') },
  { text: 'yes boss', audio: require('./assets/audio/greetings/yes-boss.mp3') },
  { text: 'boliye janab', audio: require('./assets/audio/greetings/boliye-janab.mp3') },
  { text: 'kese h sir', audio: require('./assets/audio/greetings/kese-h-sir.mp3') },
  { text: 'hmmmmmmmmmm', audio: require('./assets/audio/greetings/hmmmmmmmmmm.mp3') },
];

function pickRandomGreeting(): { text: string; audio: number } {
  return WAKE_ACK_GREETINGS[Math.floor(Math.random() * WAKE_ACK_GREETINGS.length)];
}

// Safety net in case Speech.speak()'s onDone/onError never fire for some
// reason. A fixed value here is a trap: any response long enough to speak
// past it gets cut off mid-sentence, which is exactly what happened with a
// ~75-word reply (dates and dollar figures get spoken out in full, which is
// much slower than reading the text). Scale the timeout to the actual text
// instead, with a floor for short replies and a ceiling so a genuinely
// broken onDone can't hang the UI forever.
const SPEAKING_FALLBACK_MIN_MS = 10000;
const SPEAKING_FALLBACK_MAX_MS = 90000;
const SPEAKING_FALLBACK_BUFFER_MS = 6000;
// Conservative words/sec estimate - real TTS throughput varies by engine and
// dips further on numbers/punctuation, so this deliberately underestimates
// speed (overestimates duration) rather than risk cutting speech off again.
const SPEECH_WORDS_PER_SECOND = 2.2;

function estimateSpeakingDurationMs(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const estimatedMs = (wordCount / SPEECH_WORDS_PER_SECOND) * 1000 + SPEAKING_FALLBACK_BUFFER_MS;
  return Math.min(SPEAKING_FALLBACK_MAX_MS, Math.max(SPEAKING_FALLBACK_MIN_MS, estimatedMs));
}

// Prefix every debug log so they're easy to grep out of Metro's console noise.
const LOG_TAG = '[SENSE]';

// Errors that mean the mic genuinely can't be used - everything else
// ('no-speech', 'aborted', 'speech-timeout', ...) is routine noise in an
// always-on listener and is silently absorbed by the restart-on-`end` loop.
const FATAL_SPEECH_ERRORS = new Set<ExpoSpeechRecognitionErrorCode>([
  'not-allowed',
  'service-not-allowed',
  'audio-capture',
  'language-not-supported',
]);

const RECOGNITION_OPTIONS: ExpoSpeechRecognitionOptions = {
  lang: 'en-US',
  interimResults: true,
  continuous: true,
  contextualStrings: ['Altron'],
  volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
};

// expo-speech-recognition's `volumechange` reports roughly -2 (inaudible) to
// 10 (loud) - normalize to 0..1 for the orb's `amplitude` prop.
function normalizeMicVolume(value: number): number {
  return Math.max(0, Math.min(1, (value + 2) / 12));
}

type GatewayStatus =
  | 'initializing'
  | 'standby'
  | 'acknowledging'
  | 'active'
  | 'transmitting'
  | 'speaking'
  | 'error';

const STATUS_CONFIG: Record<GatewayStatus, { label: string; accent: string }> = {
  initializing: { label: 'INITIALIZING SYSTEMS', accent: '#555555' },
  standby: { label: "STANDBY // LISTENING FOR 'ALTRON'", accent: '#2E9BFF' },
  acknowledging: { label: 'YES, BOSS', accent: '#B388FF' },
  active: { label: 'ACTIVE // RECORDING YOUR PROMPT', accent: '#FF3B4C' },
  transmitting: { label: 'PROCESSING // TALKING TO THE GATEWAY', accent: '#F5C542' },
  speaking: { label: 'SPEAKING...', accent: '#5EEAD4' },
  error: { label: 'SYSTEM FAULT', accent: '#FF3B4C' },
};

/** Drives AltronOrb3D's animation - maps the app's state machine onto the orb's voice-state vocabulary. */
function toOrbVoiceState(status: GatewayStatus): OrbVoiceState {
  switch (status) {
    case 'active':
    case 'acknowledging':
      return 'listening';
    case 'transmitting':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    case 'error':
      return 'disconnected';
    default:
      return 'idle';
  }
}

export default function App() {
  const [status, setStatus] = useState<GatewayStatus>('initializing');
  const [rawTranscript, setRawTranscript] = useState('');
  const [activePrompt, setActivePrompt] = useState('');
  const [responseText, setResponseText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  // Drives AltronOrb3D's audio-reactive scale/glow/displacement. Reflects the
  // mic's input level (real signal while the user is talking); during
  // 'speaking' this is ambient/echo level, not the TTS output's own level -
  // Hume's own playback amplitude will be the correct source for that once wired in.
  const [micAmplitude, setMicAmplitude] = useState(0);

  // Single reused player for Hume TTS responses - `.replace()` swaps the
  // source each turn rather than constructing a new native player per turn.
  const ttsPlayer = useAudioPlayer();
  const ttsStatus = useAudioPlayerStatus(ttsPlayer);
  // Separate player for short pre-generated clips - wake-word greetings and
  // the "thinking/remembering/saving" status fillers - kept apart from
  // ttsPlayer so its own `didJustFinish` doesn't trip the "real response
  // finished" effect below and snap the UI back to standby early.
  const clipPlayer = useAudioPlayer();
  const [processingStage, setProcessingStage] = useState<PromptStatusStage | null>(null);

  // Refs mirror state that native event callbacks need to read without
  // forcing those callbacks to be re-created (and re-subscribed) every render.
  const statusRef = useRef<GatewayStatus>('initializing');
  // True whenever the mic *should* be running. Cleared right before a
  // deliberate stop (transmitting, unmount) so the `end` event that follows
  // knows not to auto-restart the loop.
  const shouldBeListeningRef = useRef(false);
  // Set right before we stop() the recognizer specifically to get a fresh
  // "command capture" session (triggered by either the wake word or a manual
  // tap) - tells the `end` handler to resume into 'active' instead of its
  // normal "back to standby" behaviour. Continuous sessions reset their
  // transcript on every natural pause, so a segment that contained "altron"
  // is gone by the time the command arrives - the only reliable fix is to
  // start a brand new segment dedicated to capturing just the command.
  const pendingCaptureStartRef = useRef(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Soft purple screen flash fired the instant the wake word is heard.
  const wakeFlashOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const triggerWakeFlash = useCallback(() => {
    wakeFlashOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(wakeFlashOpacity, {
        toValue: 0.35,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(wakeFlashOpacity, {
        toValue: 0,
        duration: 450,
        useNativeDriver: true,
      }),
    ]).start();
  }, [wakeFlashOpacity]);

  /** Clean slate, mic definitely stopped -> start a fresh continuous session. */
  const returnToStandby = useCallback(() => {
    console.log(`${LOG_TAG} returnToStandby() - resetting state and restarting mic`);
    clearResetTimer();
    pendingCaptureStartRef.current = false;
    setRawTranscript('');
    setActivePrompt('');
    setResponseText('');
    setErrorMessage('');
    shouldBeListeningRef.current = true;
    setStatus('standby');
    ExpoSpeechRecognitionModule.start(RECOGNITION_OPTIONS);
  }, [clearResetTimer]);

  const scheduleReturnToStandby = useCallback(() => {
    clearResetTimer();
    resetTimerRef.current = setTimeout(returnToStandby, AUTO_RESET_MS);
  }, [clearResetTimer, returnToStandby]);

  /**
   * Ends a speaking session, whether it finished naturally, errored, timed
   * out, or was dismissed by a tap. Always stops any in-flight speech (a
   * harmless no-op if it already finished) and hands back to standby - the
   * mic was already running for barge-in detection throughout, so unlike
   * `returnToStandby` this does NOT need to restart it. Stops both the Hume
   * player and the expo-speech fallback since either could be the one active.
   */
  const finishSpeaking = useCallback(() => {
    console.log(`${LOG_TAG} finishSpeaking()`);
    void Speech.stop();
    ttsPlayer.pause();
    clearResetTimer();
    setResponseText('');
    setStatus('standby');
  }, [clearResetTimer, ttsPlayer]);

  /** Plays the pre-generated filler clip for `stage` and updates the on-screen label to match. */
  const speakStatus = useCallback(
    (stage: PromptStatusStage) => {
      console.log(`${LOG_TAG} status filler:`, stage);
      setProcessingStage(stage);
      clipPlayer.pause();
      clipPlayer.replace(STATUS_FILLER_AUDIO[stage]);
      clipPlayer.play();
    },
    [clipPlayer],
  );

  // The player's own "finished" signal - matches expo-speech's old onDone callback.
  useEffect(() => {
    if (ttsStatus.didJustFinish) {
      console.log(`${LOG_TAG} speech finished`);
      finishSpeaking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsStatus.didJustFinish]);

  /**
   * Plays `audioBase64` (Hume Octave TTS, synthesized server-side by
   * ALTRON_ENGINE - see finalizeTurn there) while keeping the mic live so
   * "Altron" can barge in. Falls back to the device's built-in voice if the
   * backend omitted `audio` (Hume outage server-side) or local playback
   * setup fails, so that means a robotic voice, not total silence.
   */
  const speakResponse = useCallback(
    (text: string, audioBase64?: string) => {
      console.log(`${LOG_TAG} speaking response aloud`);
      clipPlayer.pause();
      setProcessingStage(null);
      setStatus('speaking');
      shouldBeListeningRef.current = true;
      ExpoSpeechRecognitionModule.start(RECOGNITION_OPTIONS);

      const fallbackMs = estimateSpeakingDurationMs(text);
      console.log(`${LOG_TAG} speaking fallback timeout set to ${fallbackMs}ms for ${text.length} chars`);
      clearResetTimer();
      resetTimerRef.current = setTimeout(() => {
        console.log(`${LOG_TAG} speaking fallback timeout - forcing reset`);
        finishSpeaking();
      }, fallbackMs);

      if (audioBase64) {
        try {
          const uri = writeAudioToTempFile(audioBase64);
          ttsPlayer.replace({ uri });
          ttsPlayer.play();
          return;
        } catch (error) {
          console.log(`${LOG_TAG} failed to play backend audio, falling back to device voice:`, (error as Error).message);
        }
      } else {
        console.log(`${LOG_TAG} no audio in gateway response - using device voice`);
      }

      Speech.speak(text, { pitch: SPEECH_PITCH, rate: SPEECH_RATE, onDone: finishSpeaking, onError: finishSpeaking });
    },
    [clearResetTimer, clipPlayer, finishSpeaking, ttsPlayer],
  );

  /**
   * Streams /ai/prompt/stream and reacts to each SSE frame as it arrives:
   * `status` events play the matching pre-generated filler clip (via
   * speakStatus) so the wait isn't silent, and the final `result` event
   * hands off to speakResponse exactly like the old single-shot call did.
   * expo/fetch (not RN's built-in fetch) is required here - it's the one
   * that exposes a real, incrementally-readable `response.body` stream.
   */
  const submitPrompt = useCallback(
    async (prompt: string) => {
      console.log(`${LOG_TAG} submitPrompt() ->`, JSON.stringify(prompt));
      shouldBeListeningRef.current = false;
      ExpoSpeechRecognitionModule.stop();
      setProcessingStage(null);
      setStatus('transmitting');

      const controller = new AbortController();
      // Generous vs. the old 30s: the pipeline can chain a router call +
      // memory search + specialist call, and status events already prove
      // the connection is alive rather than the client sitting in the dark.
      const abortTimer = setTimeout(() => controller.abort(), 45000);

      try {
        const response = await expoFetch(STREAM_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${MOCK_AUTH_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prompt }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Gateway responded ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let gotResult = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');

            const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data: '));
            if (!dataLine) continue;
            const event = JSON.parse(dataLine.slice('data: '.length));
            console.log(`${LOG_TAG} stream event:`, event.type, event.stage ?? '');

            if (event.type === 'status') {
              speakStatus(event.stage as PromptStatusStage);
            } else if (event.type === 'result') {
              gotResult = true;
              const completion: string | undefined = event.payload?.completion;
              const audio: string | undefined = event.payload?.audio;
              console.log(`${LOG_TAG} gateway responded:`, completion, audio ? '(+audio)' : '(no audio)');
              const text = completion || 'AL-TRON returned an empty response.';
              setResponseText(text);
              speakResponse(text, audio);
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          }
        }

        if (!gotResult) {
          throw new Error('Gateway stream ended without a result');
        }
      } catch (err) {
        const message = (err as Error).name === 'AbortError' ? 'Gateway request timed out' : (err as Error).message;
        console.log(`${LOG_TAG} gateway request failed:`, message);
        clipPlayer.pause();
        setProcessingStage(null);
        setErrorMessage(String(message));
        setStatus('error');
        scheduleReturnToStandby();
      } finally {
        clearTimeout(abortTimer);
      }
    },
    [clipPlayer, scheduleReturnToStandby, speakResponse, speakStatus],
  );

  /**
   * Fires on both the wake word and a manual badge tap. Acknowledges
   * instantly ("YES, BOSS") and restarts the recognizer for a dedicated
   * fresh segment - the `end` handler brings us into 'active' once that
   * segment is actually live, which is the safe moment to start talking.
   */
  const triggerCapture = useCallback(
    (source: 'voice' | 'manual') => {
      const greeting = pickRandomGreeting();
      console.log(`${LOG_TAG} capture triggered (${source}) - speaking "${greeting.text}", restarting mic for a clean session`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      triggerWakeFlash();
      clipPlayer.pause();
      clipPlayer.replace(greeting.audio);
      clipPlayer.play();
      pendingCaptureStartRef.current = true;
      shouldBeListeningRef.current = true;
      setStatus('acknowledging');
      ExpoSpeechRecognitionModule.stop();
    },
    [clipPlayer, triggerWakeFlash],
  );

  /** Manual trigger: tapping the standby badge instead of waiting to hear "Altron". */
  const startManualListening = useCallback(() => {
    if (statusRef.current !== 'standby') {
      return;
    }
    triggerCapture('manual');
  }, [triggerCapture]);

  // --- Permission + first mic start on mount ------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        console.log(`${LOG_TAG} permission result:`, permission);
        if (cancelled) return;
        if (!permission.granted) {
          setErrorMessage('Microphone / speech recognition permission was denied.');
          setStatus('error');
          return;
        }
        // iOS: allows the mic and TTS playback to run concurrently - without
        // this, barge-in (hearing "Altron" while Hume's response is playing)
        // may not work correctly.
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          interruptionMode: 'mixWithOthers',
        });
        shouldBeListeningRef.current = true;
        setStatus('standby');
        ExpoSpeechRecognitionModule.start(RECOGNITION_OPTIONS);
      } catch (err) {
        console.log(`${LOG_TAG} permission/start error:`, (err as Error).message);
        if (!cancelled) {
          setErrorMessage((err as Error).message);
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      shouldBeListeningRef.current = false;
      clearResetTimer();
      ExpoSpeechRecognitionModule.stop();
      void Speech.stop();
      ttsPlayer.pause();
      clipPlayer.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Continuous listen loop: restart the session whenever it ends and we -
  // still want the mic on. This is what makes listening "continuous" even on
  // devices/OS versions where a single native session can't run forever, and
  // it's also the single place that turns a pending capture request into a
  // live 'active' session (see `pendingCaptureStartRef` above).
  useSpeechRecognitionEvent('end', () => {
    console.log(
      `${LOG_TAG} recognition 'end' event - shouldListen=${shouldBeListeningRef.current} pendingCapture=${pendingCaptureStartRef.current}`,
    );
    if (!shouldBeListeningRef.current) {
      return;
    }

    if (pendingCaptureStartRef.current) {
      pendingCaptureStartRef.current = false;
      setRawTranscript('');
      setActivePrompt('');
      setStatus('active');
      console.log(`${LOG_TAG} command capture session started`);
      ExpoSpeechRecognitionModule.start(RECOGNITION_OPTIONS);
      return;
    }

    setRawTranscript('');
    setActivePrompt('');
    // While speaking, a segment boundary just means the barge-in listener
    // needs a fresh session underneath - the UI should keep saying "speaking"
    // (Speech.speak() is still going) rather than flash back to standby.
    if (statusRef.current !== 'speaking') {
      setStatus('standby');
    }
    ExpoSpeechRecognitionModule.start(RECOGNITION_OPTIONS);
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    setMicAmplitude(normalizeMicVolume(event.value));
  });

  useSpeechRecognitionEvent('error', (event) => {
    console.log(`${LOG_TAG} recognition error:`, event.error, event.message);
    if (!FATAL_SPEECH_ERRORS.has(event.error)) {
      // Routine - e.g. silence timeouts. The `end` event that follows will
      // transparently restart the loop.
      return;
    }
    shouldBeListeningRef.current = false;
    clearResetTimer();
    setErrorMessage(`${event.error}: ${event.message}`);
    setStatus('error');
  });

  // --- Wake-word detection + command capture ------------------------------
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript ?? '';
    setRawTranscript(transcript);
    console.log(
      `${LOG_TAG} result status=${statusRef.current} isFinal=${event.isFinal} transcript=${JSON.stringify(transcript)}`,
    );

    if (statusRef.current === 'standby' || statusRef.current === 'speaking') {
      if (!containsWakeWord(transcript)) {
        return;
      }
      console.log(`${LOG_TAG} wake word detected ->`, JSON.stringify(transcript));
      if (statusRef.current === 'speaking') {
        console.log(`${LOG_TAG} barge-in - cutting off speech`);
        void Speech.stop();
        ttsPlayer.pause();
      }
      triggerCapture('voice');
      return;
    }

    if (statusRef.current === 'active') {
      // This is always a fresh segment dedicated to the command (see
      // `pendingCaptureStartRef`), so the whole transcript IS the prompt -
      // no wake-word slicing needed here.
      const prompt = transcript.trim();
      setActivePrompt(prompt);

      if (event.isFinal) {
        if (prompt) {
          void submitPrompt(prompt);
        } else {
          // Nothing usable was captured - restart clean rather than risk
          // re-triggering on stale transcript text.
          console.log(`${LOG_TAG} final result was empty - discarding capture`);
          shouldBeListeningRef.current = true;
          ExpoSpeechRecognitionModule.stop();
        }
      }
    }
  });

  const config = STATUS_CONFIG[status];
  const statusLabel =
    status === 'transmitting' && processingStage ? PROCESSING_LABELS[processingStage] : config.label;
  const canDismiss = status === 'speaking' || status === 'error';
  const canTapToSpeak = status === 'standby';
  const showDebugTranscript =
    (status === 'standby' || status === 'active' || status === 'speaking') && rawTranscript.length > 0;
  const dismiss = status === 'speaking' ? finishSpeaking : returnToStandby;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.wordmark}>AL·TRON</Text>
        <Text style={styles.subWordmark}>SENSE INTERFACE</Text>
      </View>

      <Pressable
        style={styles.center}
        disabled={!canDismiss}
        onPress={dismiss}
      >
        <Pressable
          disabled={!canTapToSpeak}
          onPress={startManualListening}
          style={({ pressed }) => [
            styles.orbWrapper,
            canTapToSpeak && pressed ? styles.statusBadgePressed : null,
          ]}
        >
          <AltronOrb3D voiceState={toOrbVoiceState(status)} amplitude={micAmplitude} />
        </Pressable>
        <Text
          style={[
            styles.statusLabel,
            { color: config.accent },
            status === 'acknowledging' ? styles.acknowledgingLabel : null,
          ]}
        >
          {statusLabel}
        </Text>
        {canTapToSpeak ? <Text style={styles.tapHint}>TAP THE CIRCLE TO SPEAK MANUALLY</Text> : null}

        {status === 'active' ? (
          <Text style={styles.transcript} numberOfLines={4}>
            {activePrompt || '...'}
          </Text>
        ) : null}

        {status === 'transmitting' ? <View style={styles.divider} /> : null}

        {status === 'speaking' ? (
          <View style={styles.responseCard}>
            <Text style={styles.responseText}>{responseText}</Text>
          </View>
        ) : null}

        {status === 'error' ? (
          <View style={styles.responseCard}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {showDebugTranscript ? (
          <View style={styles.debugPanel}>
            <Text style={styles.debugLabel}>DEBUG // RAW TRANSCRIPT</Text>
            <Text style={styles.debugText}>{rawTranscript}</Text>
          </View>
        ) : null}
      </Pressable>

      <View style={styles.footer}>
        <Text style={styles.footerText}>GITHUB MODELS GATEWAY // ONLINE</Text>
      </View>

      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.wakeFlash, { opacity: wakeFlashOpacity }]}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    paddingTop: 24,
    alignItems: 'center',
  },
  wordmark: {
    color: '#F2F2F2',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 6,
  },
  subWordmark: {
    color: '#666666',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 4,
    marginTop: 4,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  orbWrapper: {
    marginBottom: 28,
  },
  statusBadgePressed: {
    opacity: 0.6,
    transform: [{ scale: 0.96 }],
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
  },
  acknowledgingLabel: {
    fontSize: 26,
    letterSpacing: 3,
  },
  tapHint: {
    marginTop: 10,
    color: '#4A4A4A',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
  },
  transcript: {
    marginTop: 24,
    color: '#F2F2F2',
    fontSize: 20,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 28,
  },
  divider: {
    marginTop: 24,
    width: 60,
    height: 2,
    backgroundColor: '#F5C542',
  },
  responseCard: {
    marginTop: 28,
    borderLeftWidth: 3,
    borderLeftColor: '#FF3B4C',
    paddingLeft: 16,
    paddingVertical: 4,
  },
  responseText: {
    color: '#F2F2F2',
    fontSize: 17,
    lineHeight: 25,
  },
  errorText: {
    color: '#FF6B78',
    fontSize: 15,
    lineHeight: 22,
  },
  debugPanel: {
    marginTop: 32,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#1E1E1E',
    width: '100%',
  },
  debugLabel: {
    color: '#5A5A5A',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 6,
    textAlign: 'center',
  },
  debugText: {
    color: '#8A8A8A',
    fontSize: 13,
    textAlign: 'center',
    fontFamily: 'monospace',
  },
  footer: {
    paddingBottom: 20,
    alignItems: 'center',
  },
  footerText: {
    color: '#3A3A3A',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 3,
  },
  wakeFlash: {
    backgroundColor: '#B388FF',
  },
});
