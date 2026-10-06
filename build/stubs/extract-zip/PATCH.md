# extract-zip 2.0.2 (Vader)

Upstream extract-zip 2.0.1 (BSD-2-Clause, https://github.com/maxogden/extract-zip) with one change in `index.js`: a symlink entry whose target resolves outside the extraction directory (or is absolute) aborts the extraction. Fixes the symlink path-traversal advisories that affect every released version. Used only by build tooling, on archives downloaded from official sources.
