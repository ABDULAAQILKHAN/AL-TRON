// Self-contained base64 decoder - deliberately not relying on `atob`/`Buffer`
// being present in the Hermes global scope, which isn't guaranteed across RN
// versions without a polyfill. Only decode is needed: mic chunks from
// @siteed/audio-studio already arrive as base64 strings we forward as-is;
// this is only used to turn Hume's base64 WAV `audio_output` chunks into
// bytes for writing to a temp file.
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === '=') break;
    const value = BASE64_CHARS.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}
