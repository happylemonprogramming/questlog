# Offerdex

A job-search workspace that runs entirely in your browser: listings, a pipeline, ranked long shots, and resumes and cover letters you can tailor with an AI assistant. There's no account and no server. Everything is stored in IndexedDB on your device, and you can export it as one JSON file at any time.

## What it does

- **Today:** what to apply to next, grouped into batches, plus moonshots and recent activity.
- **Listings and Pipeline:** every role you're tracking, with stage, pay, fit notes and flags. Drag cards between stages.
- **Map:** your listings on a globe or flat map, merged into bubbles where they crowd together and colored by how far along each one is. It opens on the stretch of the world that holds the most listings. Chips name the countries left off screen, and tapping one flies there. Free-text locations like "Emeryville or Santa Clara, CA (on-site)" or "Greater Houston" are matched against a place list that ships with the app, so locations are never sent to a geocoding service. The map works offline after the first visit.
- **Moonshots:** a separately ranked list of long shots.
- **Documents:** resumes, cover letters and short application answers, rendered as a one-page drawing sheet with a live page-fit check. Each resume and letter carries its own stylesheet, so you or the assistant can redesign it completely (type, color, layout, columns) in the Design tab, the way you'd edit a resume website's CSS. Export goes through the browser's print-to-PDF, which keeps the real text layer that applicant tracking systems read.
- **Assistant:** a chat panel on every page, powered by [Porygon](https://jsr.io/@porygon/core). It can:
  - read public Greenhouse, Ashby and Lever job boards
  - save and evaluate listings against your rules
  - tailor documents using only the facts in your profile and base resume

  It never submits an application.
- **Apply here:** opens a listing's application form inside Offerdex, with one-tap copy buttons above it for your contact details, answers and cover letter, and a link to the resume PDF. Greenhouse, Ashby, Lever, BambooHR and Workable forms load in the frame. Workday, LinkedIn, iCIMS and SmartRecruiters block framing, so those open in a new tab. The assistant can't see or fill the form; you paste and submit.
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

## License

AGPL-3.0-or-later, the same license as Porygon.

Map data: place names from [GeoNames](https://www.geonames.org/) (CC BY 4.0), country shapes from [Natural Earth](https://www.naturalearthdata.com/) (public domain) via world-atlas, US state shapes from the US Census Bureau via us-atlas.
