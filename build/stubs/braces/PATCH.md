# braces 3.0.4 (Vader)

Upstream braces 3.0.3 (MIT, https://github.com/micromatch/braces) with one change: `lib/parse.js` throws a SyntaxError when braces nest more than `MAX_DEPTH` (200) levels, because `expand()` recurses once per level and 4,900 nested braces overflow the call stack (GHSA-vfj7-8cjw-p6xm, affects every released version, no upstream fix).
Used only by build and test tooling (gulp, tailwind, mocha); `braces` is not part of the installer. Differential test: `src/vs/workbench/contrib/vader/test/bracesPatchE2E.mjs`.
