import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.clear25.app',
  appName: 'CLEAR25',
  webDir: 'www',

  // Load from your hosted website
  server: {
    url: 'https://clear25.xyz',
    cleartext: false
  },

  ios: {
    // Allow navigation to your domain
    allowsLinkPreview: true,
    scrollEnabled: true,
  }
};

export default config;
