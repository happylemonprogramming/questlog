# Offerdex

A job-search workspace that runs entirely in your browser: listings, a pipeline, ranked long shots, and resumes and cover letters you can tailor with an AI assistant. There's no account and no server. Everything is stored in IndexedDB on your device, and you can export it as one JSON file at any time.

## What it does

- **Today:** one application at a time, in three steps (tailor the resume, fill in the form, mark it sent), with a daily goal. Next up holds about five roles; a one-card review trims or refills it. Everything else waits behind "See everything".
- **Jobs:** every role you're tracking, as a list, a pipeline you drag cards across, a map, or ranked moonshots. A listing leads with Apply and the verdict; fit, posting, documents and notes fold away.
- **Company logos:** taken from each company's own website, even for jobs found on LinkedIn or a job board. Each logo is a request to Google's favicon service; turn them off in Settings to show initials instead.
- **Map view:** your listings on a globe or flat map, merged into bubbles where they crowd together and colored by how far along each one is. It opens on the stretch of the world that holds the most listings. Chips name the countries left off screen, and tapping one flies there. Free-text locations like "Emeryville or Santa Clara, CA (on-site)" or "Greater Houston" are matched against a place list that ships with the app, so locations are never sent to a geocoding service. The map works offline after the first visit.
- **Moonshots view:** a separately ranked list of long shots.
- **Documents:** resumes, cover letters and short application answers, rendered as a one-page drawing sheet with a live page-fit check. Each resume and letter carries its own stylesheet, so you or the assistant can redesign it completely (type, color, layout, columns) in the Design tab, the way you'd edit a resume website's CSS. Export goes through the browser's print-to-PDF, which keeps the real text layer that applicant tracking systems read.
- **Assistant:** a chat panel on every page, powered by [Porygon](https://jsr.io/@porygon/core). It can:
  - read public Greenhouse, Ashby and Lever job boards
  - save and evaluate listings against your rules
  - tailor documents using only the facts in your profile and base resume

  It never submits an application.
- **Apply here:** opens a listing's application form inside Offerdex, with one-tap copy buttons above it for your contact details, answers and cover letter, and a link to the resume PDF. Greenhouse, Ashby, Lever, BambooHR and Workable forms load in the frame. Workday, LinkedIn, iCIMS and SmartRecruiters block framing, so those open in a new tab. In the browser the agent can't see or fill the form; you paste and submit. The desktop app fills it in for you (below).
- **Phones:** below 1024px wide, the app shows one pane at a time: the page, the assistant, or the application. Switch between them with the tab bar. All three stay loaded, so a chat or a half-filled form survives switching.

## Bring your own model

Any OpenAI-compatible endpoint works. Pick one in **Settings → AI provider**:

| Provider | Base URL |
| --- | --- |
| [Meridian](https://github.com/rynfar/meridian) (Claude subscription) | `http://127.0.0.1:3456/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| OpenAI | `https://api.openai.com/v1` |
| Ollama | `http://127.0.0.1:11434/v1` |

The assistant's tools always run in your browser. With Meridian, the proxy hands tool calls back to the page instead of running them, so the model never gets shell or file access on your machine. Meridian accepts requests from any web page, so consider setting `MERIDIAN_API_KEY` and entering the same key in Offerdex.

API keys are stored only in this browser and are left out of exports.

## Desktop app

`desktop/` wraps the same app in Electron and adds what a browser tab can't do:

- **Fills in application forms.** The Apply pane loads any career site, including Workday and LinkedIn. The agent reads the form's fields (iframes included), fills them in, picks from dropdowns and autocompletes, moves between steps, and attaches your resume or cover letter. **It never submits.** Submit buttons are refused, and you review and press Submit yourself. Questions it can't answer truthfully, such as legal attestations, are left for you and listed in the chat.
- **Exact PDFs.** Resumes and letters print to PDF with the same engine that shows them, so the file matches the preview and keeps real text for applicant tracking systems. There's no print dialog.
- **Your coding agent as the agent.** In **Settings → Agent**, pick Claude Code, Codex or OpenCode (or Goose), connected over the [Agent Client Protocol](https://agentclientprotocol.com). Each uses the login and models you already have, and OpenCode includes free models. Offerdex's tools reach the agent as an MCP server, so it works the app exactly as the built-in agent does. Claude Code is limited to Offerdex's tools plus web search; if another agent wants to run its own tools (a shell, file edits), you're asked first. Agents run in an empty folder of their own.

The desktop app keeps its own copy of your data. Move it across with **Settings → Data** (export from the browser, import on the desktop).

```bash
npm --prefix desktop install
npm run dev                 # the web app, which the desktop app loads in development
npm run desktop             # build the shell and open it
npm run desktop:dist        # package it (AppImage, dmg or exe) into desktop/dist
```

The packaged app doesn't carry its own copy of Claude Code or Codex. It uses the ones on your PATH, so install and log in to them first (`claude`, `codex login`, `opencode auth login`).

## Bring your data

Drop files on **Settings → Data**:

- a **`.zip`** of your job-search folder
- an Offerdex backup (`.json`)
- an ai-job-search `seen_jobs.json`
- a tracker CSV with `date,company,role,status,…` columns

Imports merge with what's already there and never move a listing back to an earlier stage.

A zip can hold anything: notes, postings, tailored resumes, cover letters, form answers. Files Offerdex recognizes import directly. The rest are kept in IndexedDB, and the assistant reads them and fills in your profile, working notes, listings and documents. It doesn't invent anything that isn't in the files. **Documents → Sources** shows every uploaded file and what it was used for. A `README.md` or `CONTEXT.md` at the top of the zip helps the assistant understand the rest.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck and production build
npm run geo        # refresh the map data in public/geo (optional; it's committed)
```

The stack is Vite, React 18, TypeScript, Tailwind and Dexie. The agent loop is `@porygon/core`, installed from JSR through `.npmrc`.

Main source files:

| Path | Contents |
| --- | --- |
| `src/agent/` | tools, system prompt, runtime |
| `src/lib/db.ts` | IndexedDB schema |
| `src/lib/boards.ts` | job-board clients |
| `src/lib/geo.ts` | location matching and map framing |
| `src/components/Sheet.tsx` | resume and letter renderer |
| `src/styles/sheet.css` | default drawing-sheet design |
| `src/lib/design.ts` | per-document designs: sanitizing, shadow-root stylesheets, markup guide |
| `src/agent/formTools.ts` | desktop form tools: read, fill, attach, click |
| `desktop/src/main.ts` | Electron main process: window, `app://` origin, PDFs |
| `desktop/src/forms.ts` | the script that reads and fills forms in the page |
| `desktop/src/agents.ts` | ACP client for Claude Code, Codex, OpenCode and Goose |
| `desktop/src/mcp-bridge.ts` | the MCP server agents launch to reach Offerdex's tools |

## License

AGPL-3.0-or-later, the same license as Porygon.

Map data: place names from [GeoNames](https://www.geonames.org/) (CC BY 4.0), country shapes from [Natural Earth](https://www.naturalearthdata.com/) (public domain) via world-atlas, US state shapes from the US Census Bureau via us-atlas.
