import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'site/_site/**', 'figma-plugin/code.js'] },
  js.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['figma-plugin/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { figma: 'readonly', __html__: 'readonly' } },
  },
  {
    files: ['figma-plugin/src/plugin.js'],
    languageOptions: { globals: { KIT: 'readonly', buildKit: 'readonly' } },
  },
];
