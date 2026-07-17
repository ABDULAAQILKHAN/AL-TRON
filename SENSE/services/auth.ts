import * as SecureStore from 'expo-secure-store';

// Real AUTH-PRO access token, obtained via LoginScreen's POST /auth/login and
// persisted here - replaces the old EXPO_PUBLIC_MOCK_AUTH_TOKEN workflow of
// manually pasting a token into .env (which also required a full Metro
// restart to ever pick up, since EXPO_PUBLIC_* vars are baked in at bundle
// time, not read live). SecureStore (not AsyncStorage) because this is
// genuine session credential material.
const TOKEN_KEY = 'altron_auth_token';

export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function storeToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
