module.exports = {
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ["./tsconfig.json", "./src/worker/tsconfig.json"],
  },
  plugins: ["@typescript-eslint"],
  rules: {
    // worker messages carry `type: string`, not the FFMessageType enum, so
    // switches on it always compare a string to enum members.
    "@typescript-eslint/no-unsafe-enum-comparison": "off",
  },
};
