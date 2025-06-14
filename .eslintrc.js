module.exports = {
  parser: "@babel/eslint-parser",
  env: { browser: true, es2021: true, node: true },
  extends: [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "prettier"
  ],
  plugins: ["react", "react-hooks"],
  rules: {
    // 必要に応じて追加ルール
    "react-hooks/exhaustive-deps": "error",
    "no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
  },
  settings: { react: { version: "detect" } }
};
