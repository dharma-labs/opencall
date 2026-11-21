import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Mobile shell configuration.
 *
 * The Android WebView is served from `https://localhost`, which counts as a
 * secure context — without it `navigator.mediaDevices` is missing and voice and
 * video calls cannot start at all.
 */
const config: CapacitorConfig = {
  appId: 'app.opencall.mobile',
  appName: 'OpenCall',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#08080c',
  },
  ios: {
    contentInset: 'always',
    backgroundColor: '#08080c',
  },
};

export default config;
