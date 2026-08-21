import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    // Never recurse into git worktrees (e.g. .claude/worktrees/*): they contain a full
    // copy of this repo, so the default glob would double-run every test file against the
    // single shared test DB and collide on unique constraints.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
