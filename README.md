# Workbench v1.0

Kanban + time tracking + finance desktop app. Electron (main process owns MongoDB) + React (Vite) renderer.

## Run
1. Have MongoDB running (local `mongod`, or an Atlas URI).
2. `cp .env.example .env` and set `MONGODB_URI` (and `DNS_SERVERS` if Atlas SRV lookups fail).
3. `npm install`
4. `npm run dev`      # Vite + Electron with hot reload (restart after editing `electron/`)
   `npm start`        # production build, run in Electron
   `npm run dist`     # Windows installer + portable exe in `release/`

## Features
- Kanban board with drag & drop, multi-select (Ctrl+click), bulk move / priority / delete
- Task timer with editable time logs, idle detection, Pomodoro mode, estimates, due dates, recurring tasks, blocked reasons
- Today view, Long-term goals (with real progress), Weekly review
- Analytics: capacity, allocation, 12-week trend, estimate accuracy, activity heatmap + streaks, timesheet CSV export
- Finance: monthly income / expenses / savings, category breakdown, savings pots, recurring carry-over, year overview, CSV export
- Tray app: close button hides to tray, floating timer, global shortcuts, launch at login
- Command palette (Ctrl+K), JSON backup & restore

## Shortcuts
Ctrl/Cmd+K palette | Ctrl/Cmd+N quick capture | Ctrl/Cmd+1..7 switch view | Ctrl/Cmd+Shift+T start/stop timer (global) | Ctrl/Cmd+Shift+N quick capture (global)

## Layout
- `electron/`  main process, preload bridge, Mongoose models, IPC handlers
- `src/`       React UI
