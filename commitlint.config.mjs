// Conventional Commits enforcement (Miting).
// Used by CI (.github/workflows/ci.yml → conventions job) via
// `npx commitlint`. Spec: https://www.conventionalcommits.org/en/v1.0.0/
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "refactor", "perf", "test", "docs", "ci", "build", "chore", "revert"],
    ],
    "subject-case": [0], // allow product nouns / proper casing in subjects
    "header-max-length": [2, "always", 100],
  },
};
