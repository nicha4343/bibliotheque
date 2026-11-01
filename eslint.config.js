import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TEXTS_MESSAGE = 'Visible texts belong in src/textes/fr.ts, never hard-coded in components.';

export default defineConfig(
  { ignores: ['dist', 'dev-dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, jsxA11y.flatConfigs.recommended],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      // No-break spaces are expected inside the French texts (see src/textes/fr.ts).
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true }],
      'no-restricted-syntax': [
        'error',
        { selector: 'JSXText[value=/[A-Za-zÀ-ÿ]/]', message: TEXTS_MESSAGE },
        {
          selector: 'JSXAttribute[name.name=/^(aria-label|title|placeholder|alt)$/] > Literal[value=/[A-Za-zÀ-ÿ]/]',
          message: TEXTS_MESSAGE,
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
);
