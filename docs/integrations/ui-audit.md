# Interface audit against the boards (2026-10-20)

How the real window was compared with the boards of the design canvas, what was found, what was changed, and what still differs. The method matters more than the list:
the pieces (chat, shell, Add-ons, Settings) had each been tested alone, with stand-ins for their neighbours, so no test had ever looked at the window as a person sees it.

## Method

- `test/windowUiE2E.mjs` mounts the real shell, the real chat and the real Add-ons page together at 1440 x 900 (only the markdown with its code editors and the apply buttons are stand-ins) and photographs 18 states: conversation, plan, edit, gate, All agents, Add-ons and an add-on's page, Review, Browser, Terminal, parallel run, new chat, error, running, paused, finished, stopped, the `/` menu, the `@` menu.
- Each real photograph was put beside its board and read for layout, the order and size of elements, colour and type, and for anything the board shows that the app does not (or the reverse).
- The words of the boards were searched for in the source to find copy that exists only on a board.

## Faults the whole-window view found (real defects, not taste)

1. **A long conversation pushed the message box out of the window.** `.fl` (flex 1) had no `min-height: 0`, so the page grew to the height of the conversation instead of scrolling it. Fixed in `shell.css`.
2. **The top of a long conversation could not be scrolled to** when the message column was bottom-aligned with `justify-content: flex-end`; it now rests at the bottom with `margin-top: auto`.
3. **The Model column of All agents showed the model chosen now for every task.** The model each task ran with is now recorded on the conversation (`ThreadType.model`).
4. **"No chats in vader-app yet" was shown over a list of chats in vader-app.** The new-chat page now says "New chat in vader-app" and what the current mode does there.
5. **The checkpoints list opened off the left edge** once the footer under the message box was left-aligned.
6. **Add-ons lost its styles when it was moved into the window** (its utility classes only apply inside the Vader scope); caught by looking at an add-on's own page.

## Changed to match the boards

Message column and message box (R01), edit card with numbered lines and marked words (no editor started), plan marks, "Explored" folding, checkpoint line, the files-waiting row, the window strip (R01/R08/R22; Windows and macOS), All agents (models, Sub-agents, branch filter), terminal names, Add-ons front page (A01) and its update badge, first-run marks and strip, Privacy lists `.vaderignore`, "Jump to the newest message" and Copy on an answer (shown only when useful).

## Still different from the boards, on purpose or for lack of a backend

- "Take over" in the Browser tab: the agent's browser is automated and has no window to hand over.
- The language selector on the first screen: there is one language.
- The parallel run is a table at the top of All agents, not a page of the parent conversation.
- "Add a message for after this step" (board) is "after this run" in the app, because a queued message really waits for the run to end.
- Review states of board S05 not built: "You edited it too" (two versions to choose between), an image that has no line diff, "Undo the rejection".
- Board S12/S14 states without their own card: "The model declined this request", "Out of disk space for the task's copy", "No answer for 90 seconds" with Stop/Wait, "The page crashed", "Too many terminals".
- The Files tab that appears in board R02 only.

## Not verified here

The packaged app was not run. The window strip depends on the system drawing the window controls over the page (Windows, macOS); that is the one part that cannot be seen in a browser harness.

## Second pass: the whole window beside the whole board (2026-10-20)

Every board was put beside the real page at the same size (1440 x 900; the shell, Settings and first-run tests were at 862 high, which made the pictures look unlike the boards). Side-by-side pictures of 38 pages are made by the tests plus `scratchpad` scripts and kept in `ui-compare/`.

Changed: Settings frame and widths; Connected agents, Skills, MCP servers, Memory (two equal columns); Add-ons filters and the Installed page; item pages (checks, framed second button); first-run panels (R22 to R24); the frame of buttons inside the window (a real fault, see the changelog); the error card.

Not changed, and why: the examples of the boards (their names, numbers and files) are not copied; "Trust" per MCP server (no score is kept for a server added by hand); the Updates tab of Skills (a skill that changed at its source already shows Read); a language selector on the first screen (one language); "Works in its own copy of this folder" on the project step (true only when the per-task copy is on, so the text stays the one that is always true); the Works with chips of an extension page (the source gives none).
