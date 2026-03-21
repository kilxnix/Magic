const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Add engine as an extra node_modules path
config.watchFolders = [
  path.resolve(__dirname, '../engine/src'),
];

// Allow importing from engine
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '../engine/node_modules'),
];

module.exports = config;
