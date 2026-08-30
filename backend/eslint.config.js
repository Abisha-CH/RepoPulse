// ESLint 9 flat config. Uses typescript-eslint's recommended ruleset.
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'eslint.config.js'],
  },
  ...tseslint.configs.recommended,
);