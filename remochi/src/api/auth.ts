/**
 * Auth service — wraps MusicKit authorize / unauthorize.
 *
 * authorize()    → opens Apple's sign-in popup, resolves with music user token
 * unauthorize()  → clears the user session
 * isAuthorized() → synchronous check against the current MusicKit instance
 * getUserToken() → returns the raw music user token (for server-side use if needed)
 */
import { getMusicKit } from './musickit';

export async function authorize(): Promise<string> {
  const mk = await getMusicKit();
  const token = await mk.authorize();
  return token;
}

export async function unauthorize(): Promise<void> {
  const mk = await getMusicKit();
  await mk.unauthorize();
}

export async function isAuthorized(): Promise<boolean> {
  const mk = await getMusicKit();
  return mk.isAuthorized;
}

export async function getUserToken(): Promise<string | null> {
  const mk = await getMusicKit();
  return mk.musicUserToken;
}
