// Expo's default config (monorepo-aware) + Rive rigs as bundleable assets (`require('x.riv')`).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'riv'])];

module.exports = config;
