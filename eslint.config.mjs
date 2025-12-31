import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  // TypeScript files
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.json",
        tsconfigRootDir: process.cwd(),
      },
    },
    plugins: {
      "@typescript-eslint": typescriptEslint,
    },
    rules: {
      // TypeScript-specific rules
      "@typescript-eslint/naming-convention": [
        "warn",
        { selector: "default", format: ["camelCase"] },
        {
          selector: "variableLike",
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
        },
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "enumMember", format: ["UPPER_CASE", "PascalCase"] },
        { selector: "import", format: ["camelCase", "PascalCase"] },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-definitions": ["warn", "interface"],

      // General best practices
      curly: "warn",
      eqeqeq: ["warn", "always"],
      "no-throw-literal": "warn",
      semi: ["warn", "always"],
      "no-unused-vars": "off", // handled by TS rule
    },
  },
  // JavaScript files
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      curly: "warn",
      eqeqeq: ["warn", "always"],
      "no-throw-literal": "warn",
      semi: ["warn", "always"],
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  // Common ignore patterns
  {
    ignores: ["node_modules", "dist", "out", "**/*.d.ts", ".vscode", ".github"],
  },
];
