# sprintf-js 1.1.4 (Vader)

Upstream sprintf-js 1.1.3 (BSD-3-Clause, https://github.com/alexei/sprintf.js) with `src/sprintf.js` rejecting a width or precision above 10000. Fixes the unbounded-precision DoS advisory that affects every released version. Used only by build tooling (roarr, via @electron/get).
