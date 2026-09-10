export default [{ ignores: ['dist/**', 'node_modules/**', 'config.js'] }, {
  files: ['**/*.js'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-constant-condition': 'error',
    'no-unreachable': 'error',
    'no-duplicate-imports': 'error',
    'eqeqeq': 'error',
    'no-eval': 'error',
  },
}];
