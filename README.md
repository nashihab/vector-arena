# VECTOR//ARENA — Browser FPS

A stylized, real-time multiplayer first-person arena shooter built with Three.js, Vite, Node.js, Express, and Socket.IO. The visual direction is a dark industrial training yard with cyan/amber lighting, clean tactical HUD elements, and non-graphic combat.

## Features

- Real 3D first-person camera and procedural weapon model (no downloaded 3D assets required)
- Neon-industrial training arena with cover geometry, floor markings, fog, and lighting
- Keyboard movement, sprinting, pointer-lock mouse look, shooting, reloads, health, and respawns
- Real-time remote player avatars, tracers, hit effects, hit markers, elimination feed, and leaderboard
- Server-authoritative movement, ammo, line-of-sight checks, hit validation, damage, eliminations, and respawns
- Socket.IO multiplayer with up to 24 connected operators per process
- Responsive onboarding and HUD, per-session callsign memory, and `/health` endpoint
- Production build served by the same Express process; suitable for a Render Web Service

## Requirements

- Node.js 22.12 or later in the Node 22 line
- npm

## Run locally

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. Join with a callsign. Open another browser/profile to connect a second player.

- Vite client: `http://localhost:5173`
- Game server health: `http://localhost:3001/health`

## Controls

- **W / A / S / D** or **arrow keys** — move
- **Mouse** — aim
- **Left mouse button** — fire
- **Shift** — sprint
- **R** — reload
- **Escape** — release mouse; click “Return to match” to resume

The desktop keyboard-and-mouse layout is the primary target. The game is still browser-rendered and requires no installation for players.

## Production build

```bash
npm install
npm run build
npm start
```

Then open **http://localhost:3001**. The production server serves the `dist/` directory and Socket.IO from the same origin.

## Render deployment

Create a **Web Service** (not a Static Site), connect this repository, and use:

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Health check path:** `/health`

Vite is intentionally in `dependencies` rather than `devDependencies` so a production-only install does not remove the build tool. The repository's `.node-version` pins Node 22.

## Architecture

```text
Browser
  ├─ Three.js renders the 3D arena, first-person camera, weapon, and remote avatars
  ├─ sends movement intent and fire/reload requests through Socket.IO
  └─ predicts local motion slightly and interpolates remote player motion
           │
           ▼
Node.js + Express + Socket.IO
  ├─ owns arena collision geometry, movement, health, ammo, and respawn timing
  ├─ validates hit rays and line of sight on the server
  ├─ manages elimination counts and the live leaderboard
  └─ broadcasts player snapshots and short-lived shot effects
```

## Current scope and next improvements

This is a portfolio-ready foundation, not a hardened competitive FPS service. Current shooting uses a server-validated hitscan approximation, and movement/aim messages are bounded but require more anti-cheat work before a public competitive launch. Recommended next steps: add automated server tests, a proper capsule/obstacle raycast library, rate limits and per-IP connection caps, team or round modes, settings/accessibility options, and load tests. Persistent profiles and ranked progression can be added later without changing the basic client/server split.
