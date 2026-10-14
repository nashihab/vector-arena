import * as THREE from 'three';
import { io } from 'socket.io-client';
import './style.css';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#gameCanvas');
const welcomeScreen = $('#welcomeScreen');
const joinForm = $('#joinForm');
const nameInput = $('#nameInput');
const connectionStatus = $('#connectionStatus');
const playerCountEl = $('#playerCount');
const leaderboardList = $('#leaderboardList');
const gameFullScreen = $('#gameFullScreen');
const retryButton = $('#retryButton');
const resumeButton = $('#resumeButton');
const pauseScreen = $('#pauseScreen');
const healthValue = $('#healthValue');
const healthLabel = $('#healthLabel');
const healthBar = $('#healthBar');
const healthStatus = $('#healthStatus');
const ammoValue = $('#ammoValue');
const reserveValue = $('#reserveValue');
const ammoState = $('#ammoState');
const reloadHint = $('#reloadHint');
const roundMessage = $('#roundMessage');
const crosshair = $('#crosshair');
const hitmarker = $('#hitmarker');
const damageFlash = $('#damageFlash');
const announcement = $('#announcement');
const toast = $('#toast');
const killFeed = $('#killFeed');
const interactionHint = $('#interactionHint');
const mobileWarning = $('.mobile-warning');

const socket = io({ transports: ['websocket', 'polling'] });
const scene = new THREE.Scene();
scene.background = new THREE.Color('#080c12');
scene.fog = new THREE.FogExp2('#080c12', 0.014);
const camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.05, 150);
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const clock = new THREE.Clock();
const keyState = new Set();
const remotePlayers = new Map();
const tracers = [];
const impacts = [];
let arena = { size: 80, bound: 38 };
let obstacles = [];
let joined = false;
let localId = null;
let localName = 'Rookie';
let localPos = { x: 0, z: 28, yaw: 0, pitch: 0 };
let localStats = { health: 100, ammo: 30, reserve: 120, kills: 0, alive: true, reloading: false };
let lastInputSent = '';
let lastInputAt = 0;
let weaponRecoil = 0;
let muzzleUntil = 0;
let hitUntil = 0;
let damageFlashUntil = 0;
let lastAnnounceAt = 0;
let toastTimer = null;
let announceTimer = null;
let fireHeld = false;
let jumpPhase = 0;
let hurtPulse = 0;
let lockedBeforeBlur = false;

try {
  const saved = localStorage.getItem('vector-arena-callsign');
  if (saved) nameInput.value = saved;
} catch { /* Storage is optional. */ }
localName = nameInput.value || localName;

const hemi = new THREE.HemisphereLight(0x9eafc8, 0x10161e, 1.42);
scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xd9e8ff, 2.0);
keyLight.position.set(-14, 28, 9);
scene.add(keyLight);
const warmLight = new THREE.PointLight(0xff9b54, 22, 35, 2);
warmLight.position.set(-18, 5, -18);
scene.add(warmLight);
const cyanLight = new THREE.PointLight(0x3ddaff, 20, 38, 2);
cyanLight.position.set(18, 6, 18);
scene.add(cyanLight);

const mats = {
  floor: new THREE.MeshStandardMaterial({ color: 0x151d26, roughness: 0.9, metalness: 0.22 }),
  wall: new THREE.MeshStandardMaterial({ color: 0x222d38, roughness: 0.84, metalness: 0.28 }),
  wallDark: new THREE.MeshStandardMaterial({ color: 0x111923, roughness: 0.88, metalness: 0.18 }),
  cover: new THREE.MeshStandardMaterial({ color: 0x303d4a, roughness: 0.77, metalness: 0.42 }),
  coverTop: new THREE.MeshStandardMaterial({ color: 0x4a5966, roughness: 0.7, metalness: 0.4 }),
  cyan: new THREE.MeshStandardMaterial({ color: 0x44d9ff, emissive: 0x159ac0, emissiveIntensity: 1.2, roughness: 0.28, metalness: 0.35 }),
  amber: new THREE.MeshStandardMaterial({ color: 0xffaa62, emissive: 0xa84a0f, emissiveIntensity: 1.0, roughness: 0.35, metalness: 0.25 }),
  line: new THREE.MeshBasicMaterial({ color: 0x345061 }),
};

function addBox(parent, width, height, depth, material, x, y, z, rotY = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  parent.add(mesh);
  return mesh;
}

function buildArena() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(arena.size, arena.size), mats.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.035;
  scene.add(floor);

  const grid = new THREE.GridHelper(arena.size, 64, 0x2c414f, 0x1e2c37);
  grid.position.y = 0.006;
  grid.material.transparent = true;
  grid.material.opacity = 0.62;
  scene.add(grid);

  // Floor lanes and corner markings give the arena readable scale without cluttering sightlines.
  const floorMarkMat = new THREE.MeshBasicMaterial({ color: 0x334754, transparent: true, opacity: 0.72 });
  for (const x of [-33, -17, 17, 33]) addBox(scene, 0.07, 0.008, 64, floorMarkMat, x, 0.008, 0);
  for (const z of [-33, -17, 17, 33]) addBox(scene, 64, 0.008, 0.07, floorMarkMat, 0, 0.009, z);
  const centerRing = new THREE.Mesh(new THREE.RingGeometry(5.4, 5.5, 64), new THREE.MeshBasicMaterial({ color: 0x3ed1f5, transparent: true, opacity: 0.48, side: THREE.DoubleSide }));
  centerRing.rotation.x = -Math.PI / 2;
  centerRing.position.y = 0.015;
  scene.add(centerRing);

  // Perimeter walls, with a dark cap and regularly spaced status lights.
  const wallHeight = 5.4;
  addBox(scene, arena.size + 2, wallHeight, 1.3, mats.wall, 0, wallHeight / 2, -40.3);
  addBox(scene, arena.size + 2, wallHeight, 1.3, mats.wall, 0, wallHeight / 2, 40.3);
  addBox(scene, 1.3, wallHeight, arena.size + 2, mats.wall, -40.3, wallHeight / 2, 0);
  addBox(scene, 1.3, wallHeight, arena.size + 2, mats.wall, 40.3, wallHeight / 2, 0);
  addBox(scene, arena.size, 0.18, 0.08, mats.cyan, 0, 4.6, -39.62);
  addBox(scene, arena.size, 0.18, 0.08, mats.amber, 0, 4.6, 39.62);
  addBox(scene, 0.08, 0.18, arena.size, mats.cyan, -39.62, 4.6, 0);
  addBox(scene, 0.08, 0.18, arena.size, mats.amber, 39.62, 4.6, 0);

  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x263541, roughness: 0.7, metalness: 0.48 });
  const signMat = new THREE.MeshStandardMaterial({ color: 0x18232d, emissive: 0x173e4d, emissiveIntensity: 0.48, metalness: 0.4, roughness: 0.6 });
  for (const x of [-35, 35]) {
    for (const z of [-35, 35]) {
      addBox(scene, 2.1, 6.2, 2.1, pillarMat, x, 3.1, z);
      addBox(scene, 2.2, 0.15, 2.2, x * z > 0 ? mats.cyan : mats.amber, x, 5.7, z);
    }
  }
  // Side panels and upper girders make this read like an enclosed orbital training yard.
  for (const z of [-24, -8, 8, 24]) {
    addBox(scene, 0.28, 2.9, 4.2, signMat, -39.48, 2.5, z);
    addBox(scene, 0.08, 0.08, 1.9, mats.cyan, -39.28, 3.5, z);
    addBox(scene, 0.28, 2.9, 4.2, signMat, 39.48, 2.5, z);
    addBox(scene, 0.08, 0.08, 1.9, mats.amber, 39.28, 3.5, z);
  }
  for (const x of [-24, -8, 8, 24]) {
    addBox(scene, 4.2, 2.9, 0.28, signMat, x, 2.5, -39.48);
    addBox(scene, 1.9, 0.08, 0.08, mats.cyan, x, 3.5, -39.28);
    addBox(scene, 4.2, 2.9, 0.28, signMat, x, 2.5, 39.48);
    addBox(scene, 1.9, 0.08, 0.08, mats.amber, x, 3.5, 39.28);
  }

  for (const o of obstacles) {
    const group = new THREE.Group();
    group.position.set(o.x, 0, o.z);
    scene.add(group);
    const base = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), mats.cover);
    base.position.y = o.h / 2;
    group.add(base);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.12, 0.12, o.d + 0.12), mats.coverTop);
    cap.position.y = o.h + 0.03;
    group.add(cap);
    const accent = o.accent === 'amber' ? mats.amber : mats.cyan;
    // Thin illuminated front lip and one side edge provide cover silhouettes at a glance.
    addBox(group, Math.max(0.5, o.w * 0.72), 0.055, 0.045, accent, 0, o.h - 0.12, -o.d / 2 - 0.035);
    addBox(group, 0.045, 0.055, Math.max(0.5, o.d * 0.58), accent, -o.w / 2 - 0.035, o.h - 0.12, 0);
    const labelPlate = new THREE.Mesh(new THREE.BoxGeometry(Math.min(o.w * 0.55, 2.6), 0.28, 0.045), mats.wallDark);
    labelPlate.position.set(0, Math.min(o.h - 0.3, 1.55), -o.d / 2 - 0.062);
    group.add(labelPlate);
    const labelStripe = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.045, 0.055), accent);
    labelStripe.position.set(-Math.min(o.w * 0.55, 2.6) * 0.32, labelPlate.position.y, -o.d / 2 - 0.09);
    group.add(labelStripe);
  }

  // Small luminous floor studs help navigation from a first-person viewpoint.
  for (const x of [-30, -20, 20, 30]) {
    for (const z of [-30, -20, 20, 30]) {
      addBox(scene, 0.42, 0.025, 0.42, signMat, x, 0.014, z);
    }
  }
}

function makeTextSprite(text, accent) {
  const canvasEl = document.createElement('canvas');
  canvasEl.width = 512;
  canvasEl.height = 112;
  const context = canvasEl.getContext('2d');
  context.fillStyle = 'rgba(8, 13, 19, .88)';
  context.beginPath();
  context.roundRect(6, 7, 500, 98, 14);
  context.fill();
  context.fillStyle = accent;
  context.fillRect(8, 16, 4, 80);
  context.font = '700 35px Inter, sans-serif';
  context.fillStyle = '#f0f5fa';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text.toUpperCase(), 260, 57, 455);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.8, 0.62, 1);
  sprite.position.set(0, 2.55, 0);
  return sprite;
}

function createRemotePlayer(data) {
  const root = new THREE.Group();
  const accent = new THREE.Color(data.color || '#42d7ff');
  const armorMat = new THREE.MeshStandardMaterial({ color: 0x3a4956, roughness: 0.72, metalness: 0.5 });
  const underMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.58, metalness: 0.28 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x121a22, roughness: 0.52, metalness: 0.45 });
  const visorMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.35, roughness: 0.18, metalness: 0.58 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.72, 4, 8), underMat);
  body.position.y = 0.83;
  root.add(body);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.53, 0.42, 0.29), armorMat);
  vest.position.set(0, 0.86, -0.04);
  root.add(vest);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.29, 12, 10), darkMat);
  helmet.scale.y = 0.82;
  helmet.position.set(0, 1.55, 0);
  root.add(helmet);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.105, 0.065), visorMat);
  visor.position.set(0, 1.55, -0.265);
  root.add(visor);
  addBox(root, 0.07, 0.24, 0.08, visorMat, 0, 1.12, -0.19);
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.38, 3, 6), armorMat);
  armL.position.set(-0.39, 0.87, -0.1); armL.rotation.z = -0.16; root.add(armL);
  const armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.38, 3, 6), armorMat);
  armR.position.set(0.39, 0.87, -0.16); armR.rotation.z = 0.16; root.add(armR);
  const remoteWeapon = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.65), darkMat);
  remoteWeapon.position.set(0.2, 0.98, -0.47); root.add(remoteWeapon);
  root.add(makeTextSprite(data.name || 'Operator', data.color || '#42d7ff'));
  root.position.set(data.x, 0, data.z);
  scene.add(root);
  return { root, target: { x: data.x, z: data.z, yaw: data.yaw }, data, accent, visor };
}

function updateRemotePlayer(data, dt) {
  let entry = remotePlayers.get(data.id);
  if (!entry) {
    entry = createRemotePlayer(data);
    remotePlayers.set(data.id, entry);
  }
  entry.data = data;
  entry.target.x = data.x;
  entry.target.z = data.z;
  entry.target.yaw = data.yaw;
  const blend = 1 - Math.exp(-13 * Math.max(dt, 0.001));
  entry.root.position.x += (entry.target.x - entry.root.position.x) * blend;
  entry.root.position.z += (entry.target.z - entry.root.position.z) * blend;
  const yawDelta = Math.atan2(Math.sin(entry.target.yaw - entry.root.rotation.y), Math.cos(entry.target.yaw - entry.root.rotation.y));
  entry.root.rotation.y += yawDelta * blend;
  entry.root.visible = data.alive;
  entry.visor.material.emissiveIntensity = data.health < 40 ? 2.2 : 1.35;
}

function createWeapon() {
  const weapon = new THREE.Group();
  const matte = new THREE.MeshStandardMaterial({ color: 0x141b23, roughness: 0.43, metalness: 0.72 });
  const armor = new THREE.MeshStandardMaterial({ color: 0x35424d, roughness: 0.5, metalness: 0.68 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x090d12, roughness: 0.96, metalness: 0.08 });
  const cyan = new THREE.MeshStandardMaterial({ color: 0x4ce0ff, emissive: 0x1685a1, emissiveIntensity: 1.35, metalness: 0.58, roughness: 0.24 });
  addBox(weapon, 0.23, 0.16, 0.49, matte, 0, 0, 0.01);
  addBox(weapon, 0.16, 0.12, 0.25, rubber, 0, -0.015, 0.31);
  addBox(weapon, 0.13, 0.24, 0.16, rubber, 0, -0.14, 0.095, -0.08);
  addBox(weapon, 0.17, 0.12, 0.12, armor, 0, 0.075, -0.08);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.49, 10), matte);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, -0.005, -0.39);
  weapon.add(barrel);
  const barrelEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 10), armor);
  barrelEnd.rotation.x = Math.PI / 2;
  barrelEnd.position.set(0, -0.005, -0.64);
  weapon.add(barrelEnd);
  addBox(weapon, 0.27, 0.055, 0.24, armor, 0, 0.105, -0.025);
  addBox(weapon, 0.11, 0.06, 0.065, cyan, 0, 0.143, -0.08);
  addBox(weapon, 0.065, 0.055, 0.055, cyan, 0, 0.12, -0.24);
  addBox(weapon, 0.025, 0.115, 0.07, rubber, 0, 0.085, -0.18);
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.37), armor);
  forearm.position.set(0.22, -0.235, -0.05); forearm.rotation.z = -0.18; weapon.add(forearm);
  const glove = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), rubber);
  glove.position.set(0.17, -0.18, -0.14); weapon.add(glove);
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 7), new THREE.MeshBasicMaterial({ color: 0xffc36e, transparent: true, opacity: 0.96 }));
  muzzle.position.set(0, -0.005, -0.72);
  muzzle.visible = false;
  weapon.add(muzzle);
  weapon.position.set(0.34, -0.31, -0.5);
  camera.add(weapon);
  return { weapon, muzzle };
}

const weaponRig = createWeapon();
scene.add(camera);

function setConnection(text, state = '') {
  connectionStatus.className = `connection-pill ${state}`.trim();
  const label = connectionStatus.querySelector('span:last-child');
  if (label) label.textContent = text;
}

function showToast(text, type = '') {
  toast.textContent = text;
  toast.className = `toast visible ${type}`.trim();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2500);
}

function showAnnouncement(text) {
  if (!text) return;
  announcement.textContent = text.toUpperCase();
  announcement.classList.add('visible');
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => announcement.classList.remove('visible'), 2100);
}

function addKillFeed(data) {
  const row = document.createElement('div');
  row.className = `kill-row ${data.killerId === localId ? 'kill-row-local' : ''} ${data.victimId === localId ? 'kill-row-victim' : ''}`;
  const killer = document.createElement('strong'); killer.textContent = data.killer;
  const icon = document.createElement('span'); icon.className = 'kill-symbol'; icon.textContent = '✕';
  const victim = document.createElement('span'); victim.textContent = data.victim;
  row.append(killer, icon, victim);
  killFeed.prepend(row);
  while (killFeed.children.length > 4) killFeed.lastElementChild.remove();
  setTimeout(() => row.remove(), 6200);
}

function updateLeaderboard(list) {
  leaderboardList.replaceChildren();
  if (!list.length) {
    const li = document.createElement('li'); li.className = 'empty-leaderboard'; li.textContent = 'Waiting for operators…'; leaderboardList.append(li); return;
  }
  for (let i = 0; i < Math.min(list.length, 8); i++) {
    const p = list[i];
    const li = document.createElement('li');
    li.className = `leader-row ${p.id === localId ? 'is-you' : ''}`;
    const rank = document.createElement('span'); rank.className = 'leader-rank'; rank.textContent = String(i + 1).padStart(2, '0');
    const dot = document.createElement('span'); dot.className = 'leader-dot'; dot.style.background = p.color;
    const name = document.createElement('span'); name.className = 'leader-name'; name.textContent = p.name + (p.id === localId ? ' / YOU' : '');
    const score = document.createElement('span'); score.className = 'leader-score'; score.textContent = String(p.kills).padStart(2, '0');
    li.append(rank, dot, name, score); leaderboardList.append(li);
  }
}

function updateHUD(player = localStats) {
  const hp = Math.max(0, Math.round(player.health ?? 100));
  healthValue.textContent = String(hp);
  healthLabel.textContent = `${hp}%`;
  healthBar.style.width = `${hp}%`;
  healthBar.classList.toggle('critical', hp <= 35);
  healthStatus.textContent = hp <= 35 ? 'CRITICAL — FIND COVER' : hp <= 65 ? 'DAMAGE SUSTAINED' : 'COMBAT READY';
  ammoValue.textContent = String(player.ammo ?? 30).padStart(2, '0');
  reserveValue.textContent = String(player.reserve ?? 120).padStart(3, '0');
  ammoState.textContent = player.reloading ? 'RELOADING' : (player.ammo ?? 30) <= 4 ? 'LOW AMMO' : 'READY';
  ammoState.classList.toggle('warning-text', Boolean(player.reloading || player.ammo <= 4));
  reloadHint.textContent = player.reloading ? 'RELOADING…' : ((player.ammo ?? 30) <= 4 ? 'R — RELOAD' : 'R — RELOAD');
}

socket.on('connect', () => setConnection('ONLINE', 'connected'));
socket.on('disconnect', () => {
  setConnection('RECONNECTING', 'disconnected');
  if (joined) showToast('Connection lost. Reconnecting to server…', 'warning');
});
socket.on('connect_error', () => setConnection('RECONNECTING', 'disconnected'));
socket.on('arena-data', (data) => {
  if (data?.arena) arena = data.arena;
  if (Array.isArray(data?.obstacles)) obstacles = data.obstacles;
  // Arena is built once after its collision geometry arrives.
  if (!scene.userData.arenaBuilt) {
    buildArena();
    scene.userData.arenaBuilt = true;
  }
});
socket.on('joined', ({ id, player }) => {
  localId = id;
  localName = player?.name || localName;
  if (player) {
    localPos = { x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch || 0 };
    localStats = { ...localStats, health: player.health, ammo: player.ammo, reserve: player.reserve, alive: player.alive };
    updateHUD(localStats);
  }
  joined = true;
  welcomeScreen.classList.add('hidden');
  gameFullScreen.classList.add('hidden');
  roundMessage.textContent = document.pointerLockElement === canvas ? '' : 'CLICK TO CAPTURE MOUSE';
  try { localStorage.setItem('vector-arena-callsign', localName); } catch { /* Optional. */ }
  showAnnouncement(`${localName} deployed`);
  if (document.pointerLockElement === canvas) pauseScreen.classList.add('hidden');
  else pauseScreen.classList.remove('hidden');
});
socket.on('game-full', () => gameFullScreen.classList.remove('hidden'));
socket.on('state', (data) => {
  if (!data || !Array.isArray(data.players)) return;
  playerCountEl.textContent = String(data.playerCount ?? data.players.length);
  const mine = data.players.find((p) => p.id === localId);
  if (mine) {
    localStats = { health: mine.health, ammo: mine.ammo, reserve: mine.reserve, kills: mine.kills, alive: mine.alive, reloading: mine.reloading };
    // Soft correction maintains responsive prediction while keeping movement server-authoritative.
    if (joined && mine.alive) {
      localPos.x += (mine.x - localPos.x) * 0.17;
      localPos.z += (mine.z - localPos.z) * 0.17;
    }
    updateHUD(localStats);
    if (!mine.alive) {
      roundMessage.textContent = 'ELIMINATED — REDEPLOYING';
      roundMessage.classList.add('round-message-alert');
    } else if (roundMessage.classList.contains('round-message-alert')) {
      roundMessage.textContent = document.pointerLockElement === canvas ? '' : 'CLICK TO CAPTURE MOUSE';
      roundMessage.classList.remove('round-message-alert');
    }
  }
  updateLeaderboard(data.leaderboard || []);
  const activeIds = new Set();
  for (const p of data.players) {
    if (p.id === localId) continue;
    activeIds.add(p.id);
    updateRemotePlayer(p, 1 / 30);
  }
  for (const [id, entry] of remotePlayers) {
    if (!activeIds.has(id)) {
      scene.remove(entry.root);
      entry.root.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
        }
      });
      remotePlayers.delete(id);
    }
  }
});
socket.on('announcement', ({ text }) => showAnnouncement(text));
socket.on('kill-feed', addKillFeed);
socket.on('hit-confirmation', ({ damage, target, killed }) => {
  hitUntil = performance.now() + (killed ? 360 : 190);
  hitmarker.classList.add('active');
  hitmarker.classList.toggle('kill', Boolean(killed));
  showToast(killed ? `ELIMINATED ${target.toUpperCase()}  +100` : `HIT CONFIRMED  −${damage} HP`, killed ? 'success' : '');
});
socket.on('you-were-hit', () => {
  damageFlashUntil = performance.now() + 170;
  damageFlash.classList.add('active');
});
socket.on('combat-notice', ({ text, kind, x, z }) => {
  if (kind === 'respawn') {
    if (Number.isFinite(x)) localPos.x = x;
    if (Number.isFinite(z)) localPos.z = z;
    roundMessage.classList.remove('round-message-alert');
    roundMessage.textContent = document.pointerLockElement === canvas ? '' : 'CLICK TO CAPTURE MOUSE';
  }
  showToast(text, kind === 'empty' ? 'warning' : '');
});
socket.on('combat-state', (state) => {
  localStats = { ...localStats, ...state };
  updateHUD(localStats);
});
socket.on('reload-started', () => {
  localStats.reloading = true;
  updateHUD(localStats);
  weaponRecoil = Math.max(weaponRecoil, 0.04);
  showToast('RELOADING MAGAZINE');
});
socket.on('shot-fx', (event) => {
  if (!event?.from || !event?.to) return;
  const points = [new THREE.Vector3(event.from.x, event.from.y, event.from.z), new THREE.Vector3(event.to.x, event.to.y, event.to.z)];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: event.shooterId === localId ? 0xffdf9b : new THREE.Color(event.color || '#ff9d54'), transparent: true, opacity: event.shooterId === localId ? 0.92 : 0.65, depthWrite: false });
  const line = new THREE.Line(geometry, material);
  scene.add(line);
  tracers.push({ line, expires: performance.now() + (event.shooterId === localId ? 115 : 85) });
  if (event.hit) {
    const impactMaterial = new THREE.MeshBasicMaterial({ color: event.killed ? 0xff526c : 0xffcb80, transparent: true, opacity: 0.95 });
    const spark = new THREE.Mesh(new THREE.SphereGeometry(event.killed ? 0.15 : 0.09, 7, 6), impactMaterial);
    spark.position.copy(points[1]);
    scene.add(spark);
    impacts.push({ mesh: spark, expires: performance.now() + 260 });
  }
});

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!socket.connected) {
    showToast('Server connection is still starting up.', 'warning');
    socket.connect();
    return;
  }
  localName = nameInput.value.replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, 16) || 'Operator';
  nameInput.value = localName;
  socket.emit('join', { name: localName });
  try {
    const request = canvas.requestPointerLock?.();
    if (request?.catch) request.catch(() => {});
  } catch { /* The browser can still start with a click-to-focus prompt. */ }
});
retryButton.addEventListener('click', () => {
  gameFullScreen.classList.add('hidden');
  if (socket.connected) socket.emit('join', { name: localName }); else socket.connect();
});
resumeButton.addEventListener('click', () => {
  pauseScreen.classList.add('hidden');
  try { const request = canvas.requestPointerLock?.(); if (request?.catch) request.catch(() => {}); } catch { /* Browser fallback. */ }
});

function requestLock() {
  if (!joined || document.pointerLockElement === canvas) return;
  try { const request = canvas.requestPointerLock?.(); if (request?.catch) request.catch(() => {}); } catch { /* Browser fallback. */ }
}
canvas.addEventListener('click', () => {
  if (joined && document.pointerLockElement !== canvas) requestLock();
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    pauseScreen.classList.add('hidden');
    interactionHint.classList.add('hint-dim');
    roundMessage.textContent = '';
  } else if (joined) {
    pauseScreen.classList.remove('hidden');
    interactionHint.classList.remove('hint-dim');
    keyState.clear();
    fireHeld = false;
  }
});
document.addEventListener('pointerlockerror', () => showToast('Click the arena to enable mouse look.', 'warning'));
document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== canvas || !joined || !localStats.alive) return;
  const sensitivity = 0.00215;
  localPos.yaw -= event.movementX * sensitivity;
  localPos.yaw = Math.atan2(Math.sin(localPos.yaw), Math.cos(localPos.yaw));
  localPos.pitch = Math.max(-1.22, Math.min(1.22, localPos.pitch - event.movementY * sensitivity));
});

function normalizeKey(event, down) {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'shift', 'r'].includes(key)) event.preventDefault();
  if (down) keyState.add(key); else keyState.delete(key);
  if (down && key === 'r' && joined) socket.emit('reload');
}
window.addEventListener('keydown', (event) => normalizeKey(event, true));
window.addEventListener('keyup', (event) => normalizeKey(event, false));
window.addEventListener('blur', () => { keyState.clear(); fireHeld = false; });
document.addEventListener('contextmenu', (event) => { if (joined) event.preventDefault(); });
window.addEventListener('mousedown', (event) => {
  if (event.button === 0 && joined && document.pointerLockElement === canvas && localStats.alive) {
    fireHeld = true;
    fireOnce();
  }
});
window.addEventListener('mouseup', (event) => { if (event.button === 0) fireHeld = false; });

function fireOnce() {
  if (!joined || !localStats.alive || document.pointerLockElement !== canvas) return;
  socket.emit('shoot');
  weaponRecoil = Math.min(weaponRecoil + 0.12, 0.22);
  muzzleUntil = performance.now() + 54;
  weaponRig.muzzle.visible = true;
  weaponRig.muzzle.scale.setScalar(0.7 + Math.random() * 0.75);
}

function getInputAxis() {
  let forward = 0;
  let strafe = 0;
  if (keyState.has('w') || keyState.has('arrowup')) forward += 1;
  if (keyState.has('s') || keyState.has('arrowdown')) forward -= 1;
  if (keyState.has('d') || keyState.has('arrowright')) strafe += 1;
  if (keyState.has('a') || keyState.has('arrowleft')) strafe -= 1;
  const length = Math.hypot(forward, strafe);
  if (length > 1) { forward /= length; strafe /= length; }
  return { forward, strafe, sprint: keyState.has('shift') && forward > 0 };
}

function collidesClient(x, z, radius = 0.55) {
  if (x < -arena.bound + radius || x > arena.bound - radius || z < -arena.bound + radius || z > arena.bound - radius) return true;
  return obstacles.some((o) => x > o.x - o.w / 2 - radius && x < o.x + o.w / 2 + radius && z > o.z - o.d / 2 - radius && z < o.z + o.d / 2 + radius);
}

function sendInput(now) {
  if (!joined || !socket.connected || now - lastInputAt < 45) return;
  lastInputAt = now;
  const input = { ...getInputAxis(), yaw: localPos.yaw, pitch: localPos.pitch };
  const packed = `${input.forward.toFixed(2)},${input.strafe.toFixed(2)},${input.sprint},${input.yaw.toFixed(3)},${input.pitch.toFixed(3)}`;
  if (packed !== lastInputSent) {
    socket.emit('input', input);
    lastInputSent = packed;
  } else if (input.forward || input.strafe) socket.emit('input', input);
}

function makeResize() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', makeResize);

function render() {
  requestAnimationFrame(render);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  if (joined && localStats.alive) {
    const axis = getInputAxis();
    if (document.pointerLockElement === canvas) {
      const speed = axis.sprint ? 10.2 : 7.2;
      const forwardX = -Math.sin(localPos.yaw);
      const forwardZ = -Math.cos(localPos.yaw);
      const rightX = Math.cos(localPos.yaw);
      const rightZ = -Math.sin(localPos.yaw);
      const dx = (forwardX * axis.forward + rightX * axis.strafe) * speed * dt;
      const dz = (forwardZ * axis.forward + rightZ * axis.strafe) * speed * dt;
      if (!collidesClient(localPos.x + dx, localPos.z)) localPos.x += dx;
      if (!collidesClient(localPos.x, localPos.z + dz)) localPos.z += dz;
      if (axis.forward || axis.strafe) jumpPhase += dt * (axis.sprint ? 15 : 10);
      else jumpPhase *= Math.max(0, 1 - dt * 7);
      weaponRecoil *= Math.exp(-dt * 10);
    }
    sendInput(now);
  }

  const moving = keyState.has('w') || keyState.has('a') || keyState.has('s') || keyState.has('d');
  const bob = moving && document.pointerLockElement === canvas ? Math.sin(jumpPhase) * 0.018 : 0;
  camera.position.set(localPos.x, 1.62 + bob, localPos.z);
  camera.rotation.set(localPos.pitch, localPos.yaw, 0, 'YXZ');
  weaponRig.weapon.position.y = -0.31 + (moving ? Math.abs(Math.sin(jumpPhase * 0.5)) * 0.012 : 0);
  weaponRig.weapon.position.z = -0.5 + weaponRecoil;
  weaponRig.weapon.rotation.x = moving ? Math.sin(jumpPhase * 0.5) * 0.018 : 0;
  if (now > muzzleUntil) weaponRig.muzzle.visible = false;
  if (now > hitUntil) { hitmarker.classList.remove('active', 'kill'); }
  if (now > damageFlashUntil) damageFlash.classList.remove('active');

  for (let i = tracers.length - 1; i >= 0; i--) {
    if (now >= tracers[i].expires) {
      scene.remove(tracers[i].line);
      tracers[i].line.geometry.dispose();
      tracers[i].line.material.dispose();
      tracers.splice(i, 1);
    }
  }
  for (let i = impacts.length - 1; i >= 0; i--) {
    const item = impacts[i];
    if (now >= item.expires) {
      scene.remove(item.mesh);
      item.mesh.geometry.dispose(); item.mesh.material.dispose();
      impacts.splice(i, 1);
    } else {
      const remaining = (item.expires - now) / 260;
      item.mesh.scale.setScalar(0.6 + (1 - remaining) * 1.5);
      item.mesh.material.opacity = remaining;
    }
  }

  renderer.render(scene, camera);
}

if (window.matchMedia('(pointer: coarse)').matches) mobileWarning.classList.add('visible');
render();
