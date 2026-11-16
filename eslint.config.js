import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'design', 'playwright-report', 'test-results', 'public'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'setTimeout',
          message: 'src/core must stay pure: see CLAUDE.md timing rules',
        },
        {
          name: 'setInterval',
          message: 'src/core must stay pure: see CLAUDE.md timing rules',
        },
        {
          name: 'Date',
          message: 'src/core must stay pure: see CLAUDE.md timing rules',
        },
        {
          name: 'performance',
          message: 'src/core must stay pure: see CLAUDE.md timing rules',
        },
        {
          name: 'window',
          message: 'src/core must stay pure: see CLAUDE.md timing rules',
        },
        {
          name: 'document',
          message: 'src/core must stay pure: see CLAUDE.md timing rules',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[object.name="Math"][property.name="random"]',
          message: 'src/core must stay pure: see CLAUDE.md timing rules',
        },
      ],
    },
  },
);
