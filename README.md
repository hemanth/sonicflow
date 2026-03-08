# Sonicflow Notes

Browser app for two things:

- record meetings and turn them into usable notes
- capture quick voice notes and clean them up later

Everything stays local. Audio, transcripts, notes, and model work all run in the browser.

## Run it

```bash
cd /Users/hhegadehallimadh/pp/sonicflow
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Single-file build

```bash
pnpm install
pnpm build:single
```

That writes `dist/sonicflow-single.html`.

The single-file build is meant for simple deployment. It inlines the app, styles, and worker into one HTML file. The normal multi-file app is still the better fit if you want the full PWA flow.
