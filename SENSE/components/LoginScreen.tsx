import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

interface LoginScreenProps {
  /** ALTRON_ENGINE base URL, e.g. http://192.168.1.19:3000 (no /ai/prompt suffix). */
  apiBaseUrl: string;
  onLogin: (token: string) => void;
}

/**
 * Real AUTH-PRO login, replacing the old workflow of manually pasting a
 * bearer token into .env. Calls the gateway's existing (already-public)
 * POST /auth/login, which just proxies to AUTH-PRO - AiController's
 * AuthProGuard is untouched, this only changes how the app obtains a token
 * to send it.
 */
export default function LoginScreen({ apiBaseUrl, onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      setError('Enter both email and password.');
      return;
    }
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch(`${apiBaseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(json?.message || `Login failed (HTTP ${response.status})`);
      }

      // TransformInterceptor wraps this as { data: { accessToken } }.
      const token: string | undefined = json?.data?.accessToken ?? json?.accessToken;
      if (!token) {
        throw new Error('Login response did not include an access token.');
      }
      onLogin(token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.center}>
          <Text style={styles.wordmark}>AL·TRON</Text>
          <Text style={styles.subWordmark}>SIGN IN</Text>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            editable={!submitting}
            returnKeyType="next"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#555"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            editable={!submitting}
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            style={({ pressed }) => [styles.button, submitting || pressed ? styles.buttonPressed : null]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>LOG IN</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  wordmark: { color: '#ffffff', fontSize: 32, fontWeight: '700', letterSpacing: 4 },
  subWordmark: { color: '#2E9BFF', fontSize: 12, letterSpacing: 3, marginTop: 4, marginBottom: 32 },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#ffffff',
    marginBottom: 12,
    fontSize: 16,
  },
  errorText: { color: '#FF3B4C', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  button: {
    backgroundColor: '#2E9BFF',
    borderRadius: 8,
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: '#000000', fontWeight: '700', letterSpacing: 2 },
});
