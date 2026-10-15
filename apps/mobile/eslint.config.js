// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'scripts/*'],
  },
  {
    rules: {
      // Hooks rules stay on; the React Compiler is enabled so exhaustive deps are informative, not fatal.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]);
