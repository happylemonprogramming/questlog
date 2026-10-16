# Questlog

A calm quest log for your job search. Questlog tracks the roles you're after, writes and designs a resume for each one from your own career record, fills in application forms for you to review, and keeps it all as plain files in a folder you own. There's no account and no server.

Looking for work can feel futile. Questlog is built to make it feel like steady progress instead: one quest at a time, points for the effort you put in (never taken away when a company says no), and a clear place to stop each day.

## Install

macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/happylemonprogramming/questlog/main/scripts/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/happylemonprogramming/questlog/main/scripts/install.ps1 | iex
```

Then run `questlog`, or open it from your app launcher. `questlog update` updates it and `questlog uninstall` removes it; your files stay. See [docs/install.md](docs/install.md) for details.

Questlog's agent is a coding agent you may already have: [Claude Code](https://claude.com/claude-code), [Codex](https://github.com/openai/codex) or [OpenCode](https://opencode.ai). OpenCode includes free models, so you can start without a subscription. Any OpenAI-compatible provider works too.

## What it does

- **Camp:** every quest lined up, in two piles. **Get ready to submit** has the guide make each resume and fill in each form, without sending anything. **Ready to submit** lists the ones it's done: open one to read the resume and every answer, answer anything left for you, and press **Submit**. Questlog fills a fresh copy of the form from those answers, checks nothing required is empty and sends it; if anything is off it stops and shows you the form instead. Only your press sends an application; the guide can't. A daily goal shows as hearts in the heads-up bar; when they're full, camp says so and lets you rest. Up next holds about five quests, and a one-card review trims or refills it.
- **The look:** a game screen, not a dashboard. Framed panels, a gold cursor on whatever you're pointing at, a guide who speaks in a dialog box, chapters and points for effort in the journal. Parchment by day, lamplit walnut by night.
- **Quests:** every role you're tracking, as a list, a pipeline you drag cards across, a world map, or ranked moonshots. Each one carries signs in fixed slots so a row tells you what matters at a glance: remote, pay against your floor, the guide's read on fit, flags, long shot, resume ready, new this week. The same signs filter the log and the board, with search, stage and batch on top. A listing leads with Apply and the verdict; fit, posting, documents and notes fold away.
- **Journal:** your progress as a story. Points for tracking roles, writing for them, sending them, following up and interviewing; chapters as they add up; a weekly quest; a run of active weeks where one quiet week is a rest, not a break; and keepsakes, including one for hearing no and keeping going.
- **Documents:** resumes, cover letters and short answers, each rendered as one page with a live fit check. Every resume is written for its listing from your career record, using only facts you've confirmed, and designed for that company: the agent looks at the company's website and starts from its real colors and type. Each document carries its own stylesheet, so you or the agent can redesign it completely.
- **Fills in application forms:** the Apply pane loads any career site, including Workday and LinkedIn. The agent reads the form (iframes included), fills it in, picks from dropdowns, moves between steps and attaches your resume as an exact PDF. **It never submits.** Any button that would send the application is refused; you review and press Submit yourself. Questions it can't answer truthfully are left for you and listed in the chat.
- **Reads your work:** grant the agent a folder and it can look through your projects, or summarize your git history on this computer, to propose entries for your career record. Nothing it finds goes into a resume until you confirm it.
- **Your files:** everything lives in `~/Documents/Questlog` (or wherever you choose) as Markdown, JSON and CSS you can read, back up and edit. Changes you make there show up in the app. Every change is kept in a history you can undo, with nothing to install; the history lives outside the folder, so OneDrive and iCloud can't damage it.

## Your folder

```
Questlog/
  profile/about.md        name and contact
  profile/career.md       your full career record; every resume is written from it
  profile/rules.md        what you're looking for: pay, places, roles, deal-breakers
  jobs/acme-senior-engineer/
    job.md                details at the top, your notes below
    posting.md            the posting
    resume.json, resume.css, letter.json, letter.css, answer-why-acme.md
  documents/              documents not tied to one job
```

PDFs are made again whenever they're needed, so deleting them is safe. **Settings → Your files** opens the folder, moves it, and shows the history with Undo.

## The agent

Pick it in **Settings → Agent**:

- **Claude Code, Codex, OpenCode or Goose**, connected over the [Agent Client Protocol](https://agentclientprotocol.com). Each uses the login and models you already have. Questlog's tools reach the agent as an MCP server, so it works the app the same way whichever you pick. Claude Code is limited to Questlog's tools plus web search. If another agent wants to use its own tools (a shell, reading or editing files), you're asked first. Agents run in an empty folder of their own.
- **The built-in agent**, with any OpenAI-compatible endpoint:

| Provider | Base URL |
| --- | --- |
| OpenRouter | `https://openrouter.ai/api/v1` |
| OpenAI | `https://api.openai.com/v1` |
| Ollama | `http://127.0.0.1:11434/v1` |
| [Meridian](https://github.com/rynfar/meridian) (Claude subscription) | `http://127.0.0.1:3456/v1` |

API keys stay on your computer and are left out of exports.

The agent can read public Greenhouse, Ashby and Lever job boards, save and judge listings against your rules, write and design documents, fill in forms, and read folders you grant it. It never submits an application or contacts anyone.

## Bring your data

Drop files on **Settings → Data**: a `.zip` of a job-search folder, a Questlog or Offerdex backup (`.json`), an ai-job-search `seen_jobs.json`, or a tracker CSV with `date,company,role,status,…` columns. Imports merge with what's there and never move a listing back a stage. Files Questlog doesn't recognize are kept for the agent, which reads them and fills in your profile, listings and documents without inventing anything. A `README.md` or `CONTEXT.md` at the top of a zip helps it understand the rest.

## In a browser

The same app also runs as a web page, as a lighter way to try it. Data stays in the browser's IndexedDB (export it from Settings → Data), the agent is the built-in one, and application forms can't be filled in for you: browsers don't let one site reach into another's page. Greenhouse, Ashby, Lever, BambooHR and Workable forms still open inside the app, with copy buttons for your answers.

## Develop

```bash
npm install
npm --prefix desktop install
npm run desktop       # dev server and the desktop window; closing the window stops both
npm run dev           # just the web app, at http://localhost:5173
npm run build         # typecheck and production build of the web app
npm run desktop:dist  # package the desktop app into desktop/dist
npm run geo           # refresh the map data in public/geo (optional; it's committed)
```

Releases are built by GitHub Actions when a `v*` tag is pushed; see [docs/install.md](docs/install.md).

The stack is Vite, React 18, TypeScript, Tailwind and Dexie, with Electron for the desktop. The built-in agent loop is [Porygon](https://jsr.io/@porygon/core), installed from JSR through `.npmrc`.

| Path | Contents |
| --- | --- |
| `src/agent/` | tools, system prompt, runtime |
| `src/lib/db.ts` | IndexedDB schema (a cache of the folder on the desktop) |
| `src/lib/disk.ts` | the folder's file formats, and keeping it and the cache in step |
| `src/lib/quest.ts` | points, chapters, runs and keepsakes |
| `src/lib/boards.ts` | job-board clients |
| `src/lib/geo.ts` | location matching and map framing |
| `src/components/Sheet.tsx` | resume and letter renderer |
| `src/lib/design.ts` | per-document designs: sanitizing, shadow-root stylesheets, markup guide |
| `src/agent/formTools.ts` | form tools: read, fill, attach, click |
| `desktop/src/main.ts` | Electron main process: window, `app://` origin, PDFs |
| `desktop/src/workspace.ts` | the folder: confined reads and writes, watching for outside edits |
| `desktop/src/history.ts` | the folder's history, with isomorphic-git |
| `desktop/src/local.ts` | folders the user granted the agent, and git history |
| `desktop/src/forms.ts` | the script that reads and fills forms in the page |
| `desktop/src/agents.ts` | ACP client for Claude Code, Codex, OpenCode and Goose |
| `desktop/src/mcp-bridge.ts` | the MCP server agents launch to reach Questlog's tools |

Questlog was called Offerdex. The desktop app moves its old data folder across on first start, and imports accept Offerdex backups.

## License

AGPL-3.0-or-later, the same license as Porygon.

Map data: place names from [GeoNames](https://www.geonames.org/) (CC BY 4.0), country shapes from [Natural Earth](https://www.naturalearthdata.com/) (public domain) via world-atlas, US state shapes from the US Census Bureau via us-atlas. Typefaces: Pirata One, Inter and JetBrains Mono (SIL Open Font License). The parchment theme follows [Treasures](https://gitlab.com/chad.curtis/treasures)'s Adventure theme.
