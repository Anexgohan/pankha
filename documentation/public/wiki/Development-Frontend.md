# Frontend Architecture

For contributors working on the Pankha Fan Control dashboard - a React 19 + TypeScript single-page app built with Vite, living in the `frontend/` workspace. In production it's served directly by the backend's Express server; in development it runs on Vite's dev server with hot reload.

**Stack**: React 19, TypeScript, Vite, axios (REST), recharts (curve graphs), sonner (toasts), lucide-react (icons - the project uses no emojis in UI).

## Layout

Feature-first directories, each owning its components, hooks, and styles:

```text
frontend/src/
├── systems/        # The dashboard: SystemCard, sensors, fans, modals
├── fan-profiles/   # Profile manager + curve editor
├── deployment/     # Deployment Center step wizard + Profile Builder
├── settings/       # Settings page (tabs)
├── license/        # Subscription UI
├── components/     # Shared: InlineEdit, icons, ui/ (Select, Toaster)
├── contexts/       # Theme, SensorVisibility, DashboardSettings
├── hooks/          # useWebSocketData and friends
├── services/       # api.ts + per-area REST clients, WebSocket client
├── config/         # ui-options.json + sensor-labels.json (SSTs)
├── types/          # Shared TypeScript interfaces (types/api.ts)
└── utils/          # Formatters, sensor grouping, ordering, toast
```

## How Data Reaches the Screen

The app opens one WebSocket and subscribes to `systems:all`. It receives a `fullState` snapshot on connect, then only **deltas** - `useWebSocketData` merges each delta into React state, creating new array references so memoized components re-render exactly when their data changed. Writes go the other way: REST calls via `services/api.ts`, whose effects come back as WebSocket events (see [Development: Backend](Development-Backend) and the [API Reference](API-Reference)).

## Conventions That Bite

*   **`React.memo` comparison completeness**: `SystemCard` renders from a custom comparison function - **every field the card renders must be listed in it**. Add a field to the UI without adding it to the comparison, and the card silently stops updating when that field changes. This pairs with the backend's `DeltaComputer` field list; new per-system fields must be added to both.
*   **The in-house `<Select>`** (`components/ui/Select`): all dropdowns use it - never native `<select>` (it can't host styled option rows) and no new dropdown libraries. Searchable, groupable, keyboard-navigable.
*   **No drag-and-drop for lists**: reordering (sensors, groups) uses up/down arrow buttons - mobile-friendly, no extra dependencies. The one exception is dragging curve points in the profile editor graph.
*   **SST discipline**: every dropdown value ladder (intervals, fan steps, hysteresis, virtual-sensor operations) comes from `config/ui-options.json`, which also feeds the Windows tray (codegen) and Linux agent (build-time validation). Add values there, never inline.
*   **Plain-language UI copy**: labels and tooltips avoid jargon ("Reports its speed", not "Tach signal"); technical detail goes in tooltips, not labels.
*   **Copy/export mirrors the UI**: anything a copy-all or export produces must contain exactly the fields the screen shows.

## State

*   **Server state**: WebSocket-fed React state via `useWebSocketData` - no client state library.
*   **UI state**: contexts for theme, sensor visibility, and dashboard settings (thresholds, fonts, accent color); component-local state for everything else.

## Working On It

```bash
npm install             # once, at the repo root (npm workspaces)
npm run dev:frontend    # Vite on :5173, hot reload, proxied to backend :3000
npm run typecheck
npm run lint
```

A hard refresh (Ctrl+Shift+R) is your friend after production deployments - built assets are fingerprinted but the shell can cache.

---

## Next Steps

*   [Development: Backend](Development-Backend): the services feeding this UI.
*   [Dashboard](Dashboard): what all of this looks like to the user.
*   [Building from Source](Development-Build): full dev environment setup.
