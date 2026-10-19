# Next edit

Off by default (Settings > Editor > "Suggest the next edit").

After a pause in typing, Vader asks a model what change the person is most likely to make next near the cursor, and the editor draws it
(old lines in red, new lines beside them). Tab accepts, Esc dismisses. It is the "edit somewhere near the cursor" that Cursor calls Tab, built on the
editor's own inline-edit support, with no patching of Monaco.

What is sent: the file name (last three path parts), about 100 lines around the cursor with a 15-line stretch marked as the part the model may rewrite,
and up to 3000 characters of the person's last twelve edits. Nothing else. The model is the one chosen for Apply (the chat model unless set otherwise).

Where it stays quiet (`common/nextEdit/nextEditGate.ts`): while typing (350 ms pause), with text selected, while the suggestion list is open,
on the line where the person just pressed Esc (2.5 s), within 1.5 s of the last ask, and after 20 asks in a minute.
Files over 300,000 characters and files not on disk are skipped.

What is thrown away (`common/nextEdit/nextEditRequest.ts`): an answer that is a placeholder ("... existing code ..."), that deletes most of the region,
is three times as long, changes only blanks, or arrives after the file changed.

Limits: it costs one model request per suggestion. There is no local fast model built in yet, so latency is the chosen model's latency.
Tests: `test/nextEditE2E.mjs` (trail, request, answer, gate). The provider glue (`browser/nextEditService.ts`) is type-checked but has not been
exercised in a running editor yet.
