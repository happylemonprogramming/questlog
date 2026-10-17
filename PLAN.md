# Plan

Where Questlog is headed, and what's done. Questlog was called Offerdex until October 2026.

## Decisions

- **The desktop app is the product.** Only a desktop app can fill in forms on any site, run Claude Code, Codex and OpenCode over ACP, and keep files on disk. The web build stays as a lighter way to try it.
- **Your files live in a folder you own**, `~/Documents/Questlog` by default, as Markdown, JSON and CSS. IndexedDB is a cache of it. Chats and settings stay in the app's own data folder.
- **History without git to install:** isomorphic-git, shown only as History and Undo. It lives in the app's data folder, not the workspace, because Documents is often synced by OneDrive or iCloud. PDFs are left out.
- **Install from GitHub alone**, no domain: a raw `install.sh` / `install.ps1` that downloads from GitHub Releases and checks SHA-256 sums, and a `questlog` command with `update` and `uninstall`. The same pattern as Spectra.
- **Brand: Questlog**, in the spirit of Zelda's quest log: calm, an adventurer's map. Aged parchment and walnut ink by day, the same map by lamplight at night, aged gold for progress, Pirata One for headings and sepia on art (after Treasures' Adventure theme). Body text stays in Inter so it reads easily. Not lemon-themed; Bountyboard was set aside as too aggressive for something meant for anyone.
- **Prepare in a batch, send with one press.** The guide fills each form once and saves its answers (`save_application`, kept as `application.json` in the job's folder). The user reviews them under Ready to submit, and Submit replays them into a fresh form, checks required fields and presses the form's submit button. The submit path (`form:submit`) is reachable only from that button, never from an agent tool; the agent's `click_form` still refuses submit buttons. Multi-page forms are saved and replayed page by page. A system notification says when a long guide turn finishes while the window is in the background.
- **An image library, used by name.** Pages may only show inline data: images, so nothing loads from elsewhere, but agents can't reproduce base64 and shouldn't try. Pictures live in `images/<name>.<ext>` as real files (originals in `images/originals/`), documents refer to `image:<name>`, and the name becomes a data: URL only when the page is drawn or printed. The agent adds them from a URL (fetched by the main process, in a cookie-less session), a shared folder or SVG it writes, and edits them on a canvas (trim, crop, resize, remove background, recolor, invert, grayscale, adjust, rotate, flip, pad, round, convert), seeing a preview after each step.
- **Fast by measurement.** A harness in a hidden Electron on a copy of real data times startup, page switches and per-keystroke main-thread work. Fixes so far: the chat box keeps its own text and long chats show the latest 40 messages; job rows are memoized, compute signs once, build their hover actions on hover and skip off-screen layout; the log builds 40 rows at a time and filters a beat behind the search box. `npm run app` runs the production build on the dev server's address, so it keeps the same chats and settings.
- **Signs instead of logos.** Company logos fetched from the web were unreliable and said nothing useful; initials said less. Each quest now carries signs in fixed slots (remote, pay against your floor, the guide's read on fit, flags, long shot, resume ready, new this week), which double as filters on the log and the board. Nothing is fetched for them.
- **Gamification lowers stress:** points reward effort, never outcomes, and are never taken away; weekly rather than daily streaks, where one quiet week is a rest; a clear stopping point each day; no leaderboards.

## Done

- Security: agent tools approved only by exact name, local file reads always ask, any submitting button refused, CSS-escape URL bypass closed, bad regexes caught.
- Rename to Questlog, with the old data folder and backups carried over.
- Workspace folder with outside-edit watching, history, Undo and Clear history.
- Local folders the agent may read, and a git-history summary for building the career record (proposals only, confirmed by the user).
- One-line installers, the `questlog` command, and a release workflow.
- New identity, and the Journal: chapters, weekly quest, runs, keepsakes, and a rest-at-camp end to the day.
- The game screen: a heads-up bar with hearts for the day, a ring for the week and the chapter's experience bar; Camp with the active quest as objectives and the guide in a dialog box; framed panels with a gold cursor; the quest sheet with its road of stages; cards drawn one at a time when choosing; chapter numbers in Roman numerals.

## Next

- Put each job's PDFs in its folder in the workspace, next to the documents they come from.
- Test the installers and packaged app on macOS and Windows, and decide about code signing if SmartScreen or Gatekeeper get in the way.
- Offer to install OpenCode from the installer, so people without a subscription can start with its free models.
- Opt-in accountability partners over Nostr.
- A browser extension, if people want form filling without the desktop app.
