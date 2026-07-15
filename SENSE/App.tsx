import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import axios from 'axios';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorCode,
  type ExpoSpeechRecognitionOptions,
} from 'expo-speech-recognition';

// --- Gateway config ------------------------------------------------------
// Both values come from `.env` (see `.env.example`). EXPO_PUBLIC_* vars are
// inlined into the JS bundle by Expo at build time - never put real secrets
// behind that prefix, only dev-time convenience values like these.
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://<YOUR_BACKEND_IP>:3000/ai/prompt';
const MOCK_AUTH_TOKEN = process.env.EXPO_PUBLIC_MOCK_AUTH_TOKEN ?? 'mock-dev-token';

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
// Safety net in case Speech.speak()'s onDone/onError never fire for some
// reason - long enough to never cut off a real response early.
const SPEAKING_FALLBACK_MS = 20000;

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
};

type GatewayStatus =
  | 'initializing'
  | 'standby'
  | 'acknowledging'
  | 'active'
  | 'transmitting'
  | 'speaking'
  | 'error';

const STATUS_CONFIG: Record<GatewayStatus, { icon: string; label: string; accent: string }> = {
  initializing: { icon: '⚙️', label: 'INITIALIZING SYSTEMS', accent: '#555555' },
  standby: { icon: '🔵', label: "STANDBY // LISTENING FOR 'ALTRON'", accent: '#2E9BFF' },
  acknowledging: { icon: '🟣', label: 'YES, BOSS', accent: '#B388FF' },
  active: { icon: '🔴', label: 'ACTIVE // RECORDING YOUR PROMPT', accent: '#FF3B4C' },
  transmitting: { icon: '🟡', label: 'PROCESSING // TALKING TO THE GATEWAY', accent: '#F5C542' },
  speaking: { icon: '🔊', label: 'SPEAKING...', accent: '#5EEAD4' },
  error: { icon: '⛔', label: 'SYSTEM FAULT', accent: '#FF3B4C' },
};

export default function App() {
  const [status, setStatus] = useState<GatewayStatus>('initializing');
  const [rawTranscript, setRawTranscript] = useState('');
  const [activePrompt, setActivePrompt] = useState('');
  const [responseText, setResponseText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

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
   * `returnToStandby` this does NOT need to restart it.
   */
  const finishSpeaking = useCallback(() => {
    console.log(`${LOG_TAG} finishSpeaking()`);
    void Speech.stop();
    clearResetTimer();
    setResponseText('');
    setStatus('standby');
  }, [clearResetTimer]);

  /** Speaks `text` aloud while keeping the mic live so "Altron" can barge in. */
  const speakResponse = useCallback(
    (text: string) => {
      console.log(`${LOG_TAG} speaking response aloud`);
      setStatus('speaking');
      shouldBeListeningRef.current = true;
      ExpoSpeechRecognitionModule.start(RECOGNITION_OPTIONS);

      clearResetTimer();
      resetTimerRef.current = setTimeout(() => {
        console.log(`${LOG_TAG} speaking fallback timeout - forcing reset`);
        finishSpeaking();
      }, SPEAKING_FALLBACK_MS);

      Speech.speak(text, {
        pitch: SPEECH_PITCH,
        rate: SPEECH_RATE,
        onDone: () => {
          console.log(`${LOG_TAG} speech finished`);
          finishSpeaking();
        },
        onStopped: () => {
          // Fires from our own Speech.stop() calls (barge-in or tap-to-skip);
          // whichever caller stopped it already owns the resulting state change.
          console.log(`${LOG_TAG} speech stopped`);
        },
        onError: (error) => {
          console.log(`${LOG_TAG} speech error:`, error.message);
          finishSpeaking();
        },
      });
    },
    [clearResetTimer, finishSpeaking],
  );

  const submitPrompt = useCallback(
    async (prompt: string) => {
      console.log(`${LOG_TAG} submitPrompt() ->`, JSON.stringify(prompt));
      shouldBeListeningRef.current = false;
      ExpoSpeechRecognitionModule.stop();
      setStatus('transmitting');

      try {
        const { data } = await axios.post(
          BACKEND_URL,
          { prompt },
          {
            headers: {
              Authorization: `Bearer ${MOCK_AUTH_TOKEN}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          },
        );

        // AL-TRON's TransformInterceptor wraps responses as { data: {...} };
        // fall back to a flat shape too in case that ever changes.
        const completion: string | undefined = data?.data?.completion ?? data?.completion;
        console.log(`${LOG_TAG} gateway responded:`, completion);
        const text = completion || 'AL-TRON returned an empty response.';
        setResponseText(text);
        speakResponse(text);
      } catch (err) {
        const message = axios.isAxiosError(err)
          ? (err.response?.data?.message ?? err.message)
          : (err as Error).message;
        console.log(`${LOG_TAG} gateway request failed:`, message);
        setErrorMessage(String(message));
        setStatus('error');
        scheduleReturnToStandby();
      }
    },
    [scheduleReturnToStandby, speakResponse],
  );

  /**
   * Fires on both the wake word and a manual badge tap. Acknowledges
   * instantly ("YES, BOSS") and restarts the recognizer for a dedicated
   * fresh segment - the `end` handler brings us into 'active' once that
   * segment is actually live, which is the safe moment to start talking.
   */
  const triggerCapture = useCallback(
    (source: 'voice' | 'manual') => {
      console.log(`${LOG_TAG} capture triggered (${source}) - acknowledging + restarting mic for a clean session`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      triggerWakeFlash();
      pendingCaptureStartRef.current = true;
      shouldBeListeningRef.current = true;
      setStatus('acknowledging');
      ExpoSpeechRecognitionModule.stop();
    },
    [triggerWakeFlash],
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
            styles.statusBadge,
            { borderColor: config.accent },
            canTapToSpeak && pressed ? styles.statusBadgePressed : null,
          ]}
        >
          <Text style={styles.statusIcon}>{config.icon}</Text>
        </Pressable>
        <Text
          style={[
            styles.statusLabel,
            { color: config.accent },
            status === 'acknowledging' ? styles.acknowledgingLabel : null,
          ]}
        >
          {config.label}
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
  statusBadge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  statusBadgePressed: {
    opacity: 0.6,
    transform: [{ scale: 0.96 }],
  },
  statusIcon: {
    fontSize: 48,
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
