import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // The Python services keep their virtualenv inside the repo, and torch,
  // matplotlib and yt-dlp all ship browser JS in theirs. Linting those is 95
  // problems about other people's vendored code and none about ours.
  globalIgnores([".next/**", "**/.venv/**", "**/site-packages/**"]),
]);
