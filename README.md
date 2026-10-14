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

