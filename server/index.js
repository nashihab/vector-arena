import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.NODE_ENV === 'production' ? false : '*' },
  pingInterval: 25_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 20_000,
});

const PORT = Number(process.env.PORT) || 3001;
const TICK_RATE = 30;
const MAX_PLAYERS = 24;
const ARENA = { size: 80, bound: 38 };
const PLAYER_SPEED = 7.2;
const SPRINT_SPEED = 10.2;
const MAG_SIZE = 30;
const START_RESERVE = 120;
const SHOT_INTERVAL_MS = 115;
const RELOAD_MS = 1450;
const RESPAWN_MS = 2600;
const MAX_RANGE = 58;
const PLAYER_COLORS = ['#42d7ff', '#ff9d54', '#a9f36a', '#ff668f', '#bba2ff', '#ffe06e', '#6ef0c0', '#ff7edb'];

// Shared geometry: the client builds the visual version; the server uses it for collision and line-of-sight.
const OBSTACLES = [
  { id: 'north-mid', x: 0, z: -15, w: 12, d: 3.2, h: 2.8, accent: 'cyan' },
  { id: 'west-mid', x: -14, z: -7, w: 3.4, d: 10, h: 2.4, accent: 'amber' },
  { id: 'east-mid', x: 14, z: -7, w: 3.4, d: 10, h: 2.4, accent: 'cyan' },
  { id: 'center', x: 0, z: 0, w: 6.2, d: 6.2, h: 3.1, accent: 'amber' },
  { id: 'south-west', x: -12, z: 12, w: 10, d: 3.2, h: 2.2, accent: 'cyan' },
  { id: 'south-east', x: 12, z: 12, w: 10, d: 3.2, h: 2.2, accent: 'amber' },
  { id: 'west-side', x: -24, z: 0, w: 3.2, d: 10, h: 2.8, accent: 'cyan' },
  { id: 'east-side', x: 24, z: 0, w: 3.2, d: 10, h: 2.8, accent: 'amber' },
  { id: 'nw-cover', x: -23, z: -22, w: 7, d: 4, h: 2.3, accent: 'amber' },
  { id: 'ne-cover', x: 23, z: -22, w: 7, d: 4, h: 2.3, accent: 'cyan' },
  { id: 'sw-cover', x: -23, z: 22, w: 7, d: 4, h: 2.3, accent: 'cyan' },
  { id: 'se-cover', x: 23, z: 22, w: 7, d: 4, h: 2.3, accent: 'amber' },
  { id: 'west-inner', x: -8, z: 28, w: 3, d: 7, h: 1.8, accent: 'amber' },
  { id: 'east-inner', x: 8, z: -28, w: 3, d: 7, h: 1.8, accent: 'cyan' },
];
const players = new Map();
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const random = (min, max) => Math.random() * (max - min) + min;
const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

function cleanName(value) {
  if (typeof value !== 'string') return 'Operator';
  return Array.from(value.replace(/[<>\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 16).join('') || 'Operator';
}

function collides(x, z, radius = 0.55) {
  if (x < -ARENA.bound + radius || x > ARENA.bound - radius || z < -ARENA.bound + radius || z > ARENA.bound - radius) return true;
  return OBSTACLES.some((o) => x > o.x - o.w / 2 - radius && x < o.x + o.w / 2 + radius && z > o.z - o.d / 2 - radius && z < o.z + o.d / 2 + radius);
}

function randomSpawn() {
  for (let i = 0; i < 120; i++) {
    const x = random(-33, 33);
    const z = random(-33, 33);
    if (!collides(x, z, 1.25)) return { x, z };
  }
  return { x: -32, z: 31 };
}

function makePlayer(id, name) {
  const pos = randomSpawn();
  return {
    id, name, ...pos, yaw: random(-Math.PI, Math.PI), pitch: 0,
    health: 100, alive: true, ammo: MAG_SIZE, reserve: START_RESERVE,
    kills: 0, deaths: 0, color: PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)],
    input: { forward: 0, strafe: 0, sprint: false }, lastShotAt: 0,
    reloadUntil: 0, respawnAt: 0, nextShotAllowedAt: 0,
  };
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch,
    health: p.health, alive: p.alive, ammo: p.ammo, reserve: p.reserve,
    kills: p.kills, deaths: p.deaths, color: p.color,
    reloading: p.reloadUntil > Date.now(), respawnIn: p.alive ? 0 : Math.max(0, p.respawnAt - Date.now()),
  };
}

function snapshot() {
  const list = [...players.values()].map(publicPlayer);
  return {
    players: list,
    playerCount: list.length,
    leaderboard: [...list].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).slice(0, 8),
    serverTime: Date.now(),
  };
}

function lineBlocked(from, dir, distance) {
  for (let t = 0.35; t < distance; t += 0.35) {
    const x = from.x + dir.x * t;
    const y = from.y + dir.y * t;
    const z = from.z + dir.z * t;
    if (y < 0 || y > 30) continue;
    for (const o of OBSTACLES) {
      if (y < o.h + 0.12 && x > o.x - o.w / 2 && x < o.x + o.w / 2 && z > o.z - o.d / 2 && z < o.z + o.d / 2) return true;
    }
    if (Math.abs(x) > ARENA.bound || Math.abs(z) > ARENA.bound) return true;
  }
  return false;
}

function fireShot(shooter) {
  const now = Date.now();
  if (!shooter.alive || now < shooter.nextShotAllowedAt || shooter.reloadUntil > now) return;
  if (shooter.ammo <= 0) {
    io.to(shooter.id).emit('combat-notice', { kind: 'empty', text: 'MAG EMPTY — PRESS R TO RELOAD' });
    return;
  }
  shooter.nextShotAllowedAt = now + SHOT_INTERVAL_MS;
  shooter.ammo -= 1;
  const cp = Math.cos(shooter.pitch);
  const dir = { x: -Math.sin(shooter.yaw) * cp, y: Math.sin(shooter.pitch), z: -Math.cos(shooter.yaw) * cp };
  const origin = { x: shooter.x, y: 1.56, z: shooter.z };
  let end = { x: origin.x + dir.x * MAX_RANGE, y: origin.y + dir.y * MAX_RANGE, z: origin.z + dir.z * MAX_RANGE };
  let nearest = null;
  let nearestDistance = MAX_RANGE;

  for (const target of players.values()) {
    if (target.id === shooter.id || !target.alive) continue;
    const to = { x: target.x - origin.x, y: 1.02 - origin.y, z: target.z - origin.z };
    const along = to.x * dir.x + to.y * dir.y + to.z * dir.z;
    if (along <= 0 || along > nearestDistance) continue;
    const perpSq = (to.x * to.x + to.y * to.y + to.z * to.z) - along * along;
    // A forgiving capsule approximation; server, not the browser, decides hits.
    if (perpSq > 0.74 * 0.74) continue;
    if (lineBlocked(origin, dir, along)) continue;
    nearest = target;
    nearestDistance = along;
  }

  let hit = false;
  let killed = false;
  if (nearest) {
    hit = true;
    end = { x: origin.x + dir.x * nearestDistance, y: origin.y + dir.y * nearestDistance, z: origin.z + dir.z * nearestDistance };
    nearest.health = Math.max(0, nearest.health - 34);
    io.to(nearest.id).emit('you-were-hit', { health: nearest.health, from: shooter.name });
    io.to(shooter.id).emit('hit-confirmation', { damage: 34, target: nearest.name, killed: nearest.health <= 0 });
    if (nearest.health <= 0) {
      killed = true;
      nearest.alive = false;
      nearest.respawnAt = now + RESPAWN_MS;
      nearest.deaths += 1;
      shooter.kills += 1;
      io.emit('kill-feed', { killer: shooter.name, victim: nearest.name, killerId: shooter.id, victimId: nearest.id });
    }
  } else {
    // Stop tracers at the first obstacle along the shot ray.
    for (let t = 1; t <= MAX_RANGE; t += 0.5) {
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      if (OBSTACLES.some((o) => y < o.h && x > o.x - o.w / 2 && x < o.x + o.w / 2 && z > o.z - o.d / 2 && z < o.z + o.d / 2)) {
        end = { x, y, z };
        break;
      }
    }
  }
  io.emit('shot-fx', { shooterId: shooter.id, from: origin, to: end, color: shooter.color, hit, killed, time: now });
  io.to(shooter.id).emit('combat-state', { ammo: shooter.ammo, reserve: shooter.reserve });
}

io.on('connection', (socket) => {
  socket.emit('arena-data', { arena: ARENA, obstacles: OBSTACLES });

  socket.on('join', (payload = {}) => {
    if (players.has(socket.id)) {
      const existing = players.get(socket.id);
      existing.name = cleanName(payload.name);
      socket.emit('joined', { id: socket.id, player: publicPlayer(existing) });
      return;
    }
    if (players.size >= MAX_PLAYERS) {
      socket.emit('game-full');
      return;
    }
    const player = makePlayer(socket.id, cleanName(payload.name));
    players.set(socket.id, player);
    socket.emit('joined', { id: socket.id, player: publicPlayer(player) });
    io.emit('announcement', { text: `${player.name} deployed to the arena` });
  });

  socket.on('input', (input = {}) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || !input || typeof input !== 'object') return;
    p.input.forward = clamp(Number(input.forward) || 0, -1, 1);
    p.input.strafe = clamp(Number(input.strafe) || 0, -1, 1);
    p.input.sprint = Boolean(input.sprint);
    if (Number.isFinite(input.yaw)) p.yaw = wrapAngle(input.yaw);
    if (Number.isFinite(input.pitch)) p.pitch = clamp(input.pitch, -1.22, 1.22);
  });

  socket.on('shoot', () => {
    const p = players.get(socket.id);
    if (p) fireShot(p);
  });

  socket.on('reload', () => {
    const p = players.get(socket.id);
    const now = Date.now();
    if (!p || !p.alive || p.reloadUntil > now || p.ammo >= MAG_SIZE || p.reserve <= 0) return;
    p.reloadUntil = now + RELOAD_MS;
    socket.emit('reload-started', { duration: RELOAD_MS });
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    if (p) {
      players.delete(socket.id);
      io.emit('announcement', { text: `${p.name} left the arena` });
    }
  });
});

function step(dt) {
  const now = Date.now();
  for (const p of players.values()) {
    if (!p.alive) {
      if (now >= p.respawnAt) {
        const pos = randomSpawn();
        p.x = pos.x; p.z = pos.z; p.health = 100; p.alive = true;
        p.ammo = MAG_SIZE; p.reserve = Math.max(p.reserve, 60); p.reloadUntil = 0;
        io.to(p.id).emit('combat-notice', { kind: 'respawn', text: 'REDEPLOYED', x: p.x, z: p.z });
      }
      continue;
    }

    if (p.reloadUntil && now >= p.reloadUntil) {
      const needed = MAG_SIZE - p.ammo;
      const loaded = Math.min(needed, p.reserve);
      p.ammo += loaded;
      p.reserve -= loaded;
      p.reloadUntil = 0;
      io.to(p.id).emit('combat-state', { ammo: p.ammo, reserve: p.reserve });
    }

    let forward = p.input.forward;
    let strafe = p.input.strafe;
    const len = Math.hypot(forward, strafe);
    if (len > 1) { forward /= len; strafe /= len; }
    const speed = p.input.sprint ? SPRINT_SPEED : PLAYER_SPEED;
    const dx = (-Math.sin(p.yaw) * forward + Math.cos(p.yaw) * strafe) * speed * dt;
    const dz = (-Math.cos(p.yaw) * forward - Math.sin(p.yaw) * strafe) * speed * dt;
    const nextX = p.x + dx;
    const nextZ = p.z + dz;
    if (!collides(nextX, p.z)) p.x = nextX;
    if (!collides(p.x, nextZ)) p.z = nextZ;
  }
}

setInterval(() => {
  step(1 / TICK_RATE);
  io.emit('state', snapshot());
}, 1000 / TICK_RATE);

app.get('/health', (_req, res) => res.json({ ok: true, players: players.size, maxPlayers: MAX_PLAYERS, game: 'VECTOR//ARENA' }));

if (process.env.NODE_ENV === 'production') {
  const distPath = join(here, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*path', (_req, res) => res.sendFile(join(distPath, 'index.html')));
} else {
  app.get('/', (_req, res) => res.status(200).send('VECTOR//ARENA server online. Start the Vite client on port 5173.'));
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`VECTOR//ARENA server listening on port ${PORT}`);
  console.log(`Arena: ${ARENA.size}×${ARENA.size} | max players: ${MAX_PLAYERS}`);
});
