export default [{ ignores: ['dist/**', 'node_modules/**', 'verification/**', 'releases/**', '.tmp/**'] }, {
  files: ['**/*.js', '**/*.jsx', '**/*.mjs'],
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
    globals: { __PLUGIN_VERSION__: 'readonly' },
  },
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    'no-constant-condition': 'error',
    'no-unreachable': 'error',
    'no-duplicate-imports': 'error',
    'eqeqeq': 'error',
    'no-eval': 'error',
  },
}];
