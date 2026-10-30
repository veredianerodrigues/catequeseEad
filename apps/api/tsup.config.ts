import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  noExternal: ["@quiz/shared"],
  clean: true,
});
