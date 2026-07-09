/**
 * MusicKit singleton initialiser.
 *
 * IMPORTANT: Replace DEV_TOKEN below with your Apple Music developer token.
 * Generate one at https://developer.apple.com/documentation/applemusicapi/generating_developer_tokens
 * Tokens are JWTs signed with your MusicKit private key and expire after at most 6 months.
 */

const DEV_TOKEN = 'REPLACE_WITH_YOUR_DEVELOPER_TOKEN';

let _instance: MusicKit.MusicKitInstance | null = null;

export async function getMusicKit(): Promise<MusicKit.MusicKitInstance> {
  if (_instance) return _instance;

  // MusicKit JS loads asynchronously via CDN script tag.
  // Wait for it to be available on window before configuring.
  await waitForMusicKit();

  _instance = window.MusicKit.configure({
    developerToken: DEV_TOKEN,
    app: {
      name: 'Jukie',
      build: '0.1.0',
      version: '0.1.0',
    },
  });

  return _instance;
}

function waitForMusicKit(timeout = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window.MusicKit !== 'undefined') {
      resolve();
      return;
    }
    const deadline = Date.now() + timeout;
    const interval = setInterval(() => {
      if (typeof window.MusicKit !== 'undefined') {
        clearInterval(interval);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(interval);
        reject(new Error('MusicKit JS did not load within timeout. Check your network or CDN script tag.'));
      }
    }, 50);
  });
}
