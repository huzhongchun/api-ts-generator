module.exports = {
  root: true,
  extends: [
    'airbnb-base/legacy',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
    'prettier'
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  settings: {
    'import/parsers': {
      'babel-eslint': ['.js', '.jsx'],
      '@typescript-eslint/parser': ['.ts', '.tsx']
    },
    'import/extensions': ['.js', '.jsx', '.ts', '.tsx']
  },
  rules: {
    'max-classes-per-file': 0,
    'prettier/prettier': 'error',
    'no-var': 'error', // 禁止使用 var
    'no-shadow': 0, // 警告变量声明与外层作用域的变量同名
    'object-curly-newline': [
      'error',
      {
        ImportDeclaration: { multiline: true },
        ExportDeclaration: { multiline: true }
      }
    ], // 强制大括号内换行符的一致性
    'linebreak-style': [0, 'error', 'windows'], // 强制使用一致的换行符风格
    '@typescript-eslint/member-delimiter-style': [
      'error',
      {
        multiline: {
          delimiter: 'semi',
          requireLast: true
        },
        singleline: {
          delimiter: 'semi',
          requireLast: false
        }
      }
    ],
    '@typescript-eslint/explicit-function-return-type': 0,
    '@typescript-eslint/no-empty-function': 0,
    'max-len': 0,
    'no-plusplus': ['error', { allowForLoopAfterthoughts: true }], // 禁止使用一元运算符
    camelcase: 1,
    'func-names': 0,
    '@typescript-eslint/no-explicit-any': 0,
    'no-console': 0,
    '@typescript-eslint/explicit-module-boundary-types': 0,
    '@typescript-eslint/no-shadow': 0,
    'no-underscore-dangle': 0 // yapi接口返回的字段包含下划线
  },
  globals: {
    getRegExp: true
  }
};
