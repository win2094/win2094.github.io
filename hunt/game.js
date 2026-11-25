import * as THREE from 'three';

const $ = id => document.getElementById(id);
const ARENA = 38;

const DRAGONS = [
  { name: '火龍 雄火龍', body: 0xb3261e, belly: 0xe0a060, accent: 0x2a1a10, pattern: 'spots', horns: 'back', tail: 'club', breath: 'fire', hp: 700, dmg: 1.0, speed: 1.0 },
  { name: '角龍 黑角龍', body: 0xc8a46a, belly: 0xe8d6a8, accent: 0x5a4020, pattern: 'none', horns: 'huge', tail: 'mace', breath: 'sand', hp: 900, dmg: 1.15, speed: 1.1 },
  { name: '雷狼龍', body: 0x2d4f8a, belly: 0xe8d040, accent: 0xffe050, pattern: 'bands', horns: 'swept', tail: 'blade', breath: 'thunder', hp: 1100, dmg: 1.25, speed: 1.2 },
  { name: '轟龍', body: 0xe0b030, belly: 0xf0e0b0, accent: 0x2050a0, pattern: 'stripes', horns: 'stub', tail: 'spike', breath: 'roar', hp: 1300, dmg: 1.4, speed: 1.3 },
  { name: '黑龍 （終戰）', body: 0x15151a, belly: 0x3a2a30, accent: 0xa01020, pattern: 'veins', horns: 'crown', tail: 'long', breath: 'hellfire', hp: 2000, dmg: 1.6, speed: 1.25 },
];
const BREATH_COL = { fire: 0xff6020, sand: 0xd8c090, thunder: 0x80c0ff, roar: 0xffffff, hellfire: 0xff1030 };

const WEAPONS = {
  gs: { name: '大劍', dmg: 42, cd: 1.0, range: 4.2, speedMul: 0.85, col: 0xc0c0c8 },
  ss: { name: '單手劍', dmg: 15, cd: 0.36, range: 3.0, speedMul: 1.0, col: 0xd0d8e0 },
  db: { name: '雙刀', dmg: 8, cd: 0.17, range: 2.8, speedMul: 1.1, col: 0xe0c080 },
};

// ---------- persistent run state ----------
const run = { weapon: 'gs', fight: 0, pts: 0, stats: { hp: 0, atk: 0, def: 0, sta: 0, spd: 0 } };
const STAT_NAMES = { hp: '體力', atk: '攻擊', def: '防禦', sta: '耐力', spd: '速度' };

// ---------- three setup ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a8c8);
scene.fog = new THREE.Fog(0x87a8c8, 60, 140);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight(0xdde8ff, 0x664422, 0.9));
const sun = new THREE.DirectionalLight(0xfff0d0, 1.6);
sun.position.set(30, 50, 20); sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50 });
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
// arena
const sandTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#c9a66b'; g.fillRect(0, 0, w, h); for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${90 + Math.random() * 80},${60 + Math.random() * 50},30,0.25)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } });
sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping; sandTex.repeat.set(10, 10);
const ground = new THREE.Mesh(new THREE.CircleGeometry(ARENA + 4, 64), new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x9a8670, roughness: 0.9 });
const wall = new THREE.Mesh(new THREE.CylinderGeometry(ARENA + 4, ARENA + 4, 10, 64, 1, true), wallMat);
wall.material.side = THREE.BackSide; wall.position.y = 5; scene.add(wall);
for (let i = 0; i < 32; i++) {
  const a = i / 32 * Math.PI * 2;
  const p = new THREE.Mesh(new THREE.BoxGeometry(2, 14, 2), wallMat);
  p.position.set(Math.cos(a) * (ARENA + 4), 7, Math.sin(a) * (ARENA + 4)); p.castShadow = true; scene.add(p);
  const tier = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 2), new THREE.MeshStandardMaterial({ color: 0x7a6650 }));
  tier.position.set(Math.cos(a) * (ARENA + 9), 13, Math.sin(a) * (ARENA + 9)); tier.lookAt(0, 13, 0); scene.add(tier);
}

// ---------- audio ----------
let actx = null, muted = false;
function snd(freq, dur = 0.12, type = 'square', vol = 0.15, slide = 0) {
  if (muted) return;
  try {
    actx = actx || new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), actx.currentTime + dur);
    g.gain.setValueAtTime(vol, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
  } catch (e) { }
}
$('mute').onclick = () => { muted = !muted; $('mute').textContent = muted ? '🔇 靜' : '🔊 聲'; };

// ---------- player ----------
const std = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
const player = new THREE.Group();
const pBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.0, 4, 8), std(0x406080)); pBody.position.y = 1.0;
const pHead = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), std(0xe0b090)); pHead.position.y = 2.0;
const pHelm = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.4, 10), std(0x808890)); pHelm.position.y = 2.3;
player.add(pBody, pHead, pHelm);
const armR = new THREE.Group(); armR.position.set(0.55, 1.5, 0); player.add(armR);
const armL = new THREE.Group(); armL.position.set(-0.55, 1.5, 0); player.add(armL);
player.traverse(o => o.castShadow = true);
scene.add(player);

function buildWeapon(w) {
  [armR, armL].forEach(a => { while (a.children.length) a.remove(a.children[0]); });
  const m = std(WEAPONS[w].col); m.metalness = 0.6;
  const blade = (len, wid) => { const b = new THREE.Mesh(new THREE.BoxGeometry(wid, 0.08, len), m); b.position.z = len / 2 + 0.2; b.castShadow = true; return b; };
  if (w === 'gs') armR.add(blade(3.2, 0.55));
  if (w === 'ss') { armR.add(blade(1.5, 0.18)); const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 16), std(0x704020)); sh.rotation.z = Math.PI / 2; sh.position.set(-0.1, 0, 0.3); armL.add(sh); }
  if (w === 'db') { armR.add(blade(1.1, 0.14)); armL.add(blade(1.1, 0.14)); }
}

// ---------- dragon ----------
let dragon = null;
function patternTex(d) {
  const c = n => '#' + n.toString(16).padStart(6, '0');
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = c(d.body); g.fillRect(0, 0, w, h);
    g.fillStyle = c(d.accent); g.strokeStyle = c(d.accent);
    if (d.pattern === 'stripes') for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 14, h);
    if (d.pattern === 'bands') for (let x = 0; x < w; x += 48) { g.fillRect(x, 0, 8, h); g.fillRect(x + 14, 0, 4, h); }
    if (d.pattern === 'spots') for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 8, 0, 7); g.fill(); }
    if (d.pattern === 'veins') { g.lineWidth = 3; for (let i = 0; i < 25; i++) { g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (Math.random() - .5) * 50; y += (Math.random() - .5) * 50; g.lineTo(x, y); } g.stroke(); } }
  });
}
function buildDragon(def) {
  const root = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ map: patternTex(def), roughness: 0.6 });
  const belly = std(def.belly), horn = std(def.horns === 'crown' ? 0x401010 : 0xe8e0c8), dark = std(def.accent);
  const mk = (geo, mat, x, y, z, parent = root) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const body = mk(new THREE.SphereGeometry(1, 20, 14), skin, 0, 3.2, 0); body.scale.set(2.0, 1.8, 3.4);
  mk(new THREE.SphereGeometry(1, 16, 10), belly, 0, 2.5, 0.3).scale.set(1.6, 1.2, 2.8);
  const neck = new THREE.Group(); neck.position.set(0, 4.0, 2.8); root.add(neck);
  mk(new THREE.CylinderGeometry(0.7, 1.1, 2.8, 12), skin, 0, 0.8, 1.0, neck).rotation.x = 1.0;
  const head = new THREE.Group(); head.position.set(0, 1.6, 2.4); neck.add(head);
  mk(new THREE.BoxGeometry(1.3, 1.0, 2.0), skin, 0, 0, 0.4, head);
  mk(new THREE.BoxGeometry(1.0, 0.5, 1.4), skin, 0, -0.1, 1.7, head);
  const jaw = mk(new THREE.BoxGeometry(0.95, 0.3, 1.8), dark, 0, -0.55, 1.2, head);
  [-1, 1].forEach(s => mk(new THREE.SphereGeometry(0.13, 8, 6), std(0xffee40), 0.55 * s, 0.25, 0.9, head));
  const hornDefs = { back: [[0.4, 0.4, -0.5, 0.15, 1.2, -2.2, 0.3]], huge: [[0.55, 0.3, 0.2, 0.3, 2.6, -0.4, 1.2]], swept: [[0.45, 0.4, -0.3, 0.12, 1.6, -2.6, 0.6], [0.5, 0.0, 0.3, 0.1, 0.9, -1.6, 1.0]], stub: [[0.5, 0.5, -0.2, 0.2, 0.6, -1.2, 0.2]], crown: [[0.3, 0.5, -0.4, 0.15, 1.8, -2.0, 0.2], [0.6, 0.4, -0.2, 0.15, 1.6, -1.8, 0.7], [0.75, 0.2, 0.1, 0.12, 1.2, -1.3, 1.1]] };
  hornDefs[def.horns].forEach(([x, y, z, r, len, rx, rz]) => [-1, 1].forEach(s => { const h = mk(new THREE.ConeGeometry(r, len, 8), horn, x * s, y + len * 0.3, z, head); h.rotation.set(rx, 0, -rz * s); }));
  const legs = [];
  [[-1.4, 1.6], [1.4, 1.6], [-1.5, -1.6], [1.5, -1.6]].forEach(([x, z]) => {
    const g = new THREE.Group(); g.position.set(x, 2.6, z); root.add(g);
    mk(new THREE.CylinderGeometry(0.45, 0.35, 2.6, 8), skin, 0, -1.3, 0, g);
    mk(new THREE.BoxGeometry(0.8, 0.3, 1.0), dark, 0, -2.5, 0.2, g); legs.push(g);
  });
  const wings = [];
  [-1, 1].forEach(s => {
    const g = new THREE.Group(); g.position.set(1.4 * s, 4.4, 0.8); root.add(g);
    mk(new THREE.CylinderGeometry(0.15, 0.2, 4.5, 6), dark, 2.2 * s, 0.6, 0, g).rotation.z = -1.2 * s;
    const mem = mk(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(4.3 * s, 1.5, 0), new THREE.Vector3(3.5 * s, -1.2, -3.5)]), new THREE.MeshStandardMaterial({ color: def.belly, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }), 0, 0, 0, g);
    mem.geometry.computeVertexNormals(); wings.push(g);
  });
  // tail: chain of segments in a group that can be severed at `tailCut`
  const tailBase = new THREE.Group(); tailBase.position.set(0, 3.4, -3.0); root.add(tailBase);
  const segs = def.tail === 'long' ? 7 : 5;
  let parent = tailBase; const tailSegs = []; let tailCut = null;
  for (let i = 0; i < segs; i++) {
    const g = new THREE.Group(); g.position.z = i === 0 ? 0 : -1.5; parent.add(g);
    const r = 0.8 * (1 - i / (segs + 1));
    mk(new THREE.CylinderGeometry(r * 0.8, r, 1.7, 10), skin, 0, 0, -0.75, g).rotation.x = Math.PI / 2;
    tailSegs.push(g); parent = g;
    if (i === 1) tailCut = g;
  }
  const tip = parent;
  if (def.tail === 'club') mk(new THREE.SphereGeometry(0.7, 10, 8), dark, 0, 0, -1.7, tip);
  if (def.tail === 'mace') { const s = mk(new THREE.SphereGeometry(0.8, 10, 8), horn, 0, 0, -1.8, tip); for (let k = 0; k < 6; k++) { const sp = mk(new THREE.ConeGeometry(0.2, 0.8, 6), horn, 0, 0, 0, s); sp.rotation.set(Math.random() * 6, Math.random() * 6, 0); sp.translateY(0.8); } }
  if (def.tail === 'blade') { const b = mk(new THREE.BoxGeometry(0.15, 1.2, 2.2), std(0xffe050), 0, 0.3, -1.9, tip); b.rotation.x = 0.2; }
  if (def.tail === 'spike') for (let k = 0; k < 3; k++) { const sp = mk(new THREE.ConeGeometry(0.2, 0.9, 6), horn, 0, 0.4, -0.5 - k * 0.5, tip); sp.rotation.x = -0.6; }
  if (def.tail === 'long') mk(new THREE.ConeGeometry(0.4, 1.8, 8), dark, 0, 0, -2, tip).rotation.x = -Math.PI / 2;
  // back spines
  for (let k = 0; k < 6; k++) mk(new THREE.ConeGeometry(0.22, 0.9, 6), dark, 0, 5.1 - Math.abs(k - 2) * 0.1, 1.8 - k * 0.8);
  root.scale.setScalar(def.horns === 'crown' ? 1.15 : 1);
  scene.add(root);
  return { root, head, neck, jaw, legs, wings, tailBase, tailSegs, tailCut, tip };
}

// ---------- fight state ----------
let S = null; // per-fight state
const keys = {}; let camYaw = 0, camPitch = 0.35;
const input = { mx: 0, mz: 0, attack: false, special: false, dodge: false, potion: false };
const effects = [];

function pStats() {
  const s = run.stats;
  return { maxHp: 100 + s.hp * 20, atk: 1 + s.atk * 0.1, def: Math.pow(0.92, s.def), maxSt: 100 + s.sta * 20, spd: 7.5 * (1 + s.spd * 0.06) };
}

function startFight() {
  if (dragon) scene.remove(dragon.root);
  effects.splice(0).forEach(e => scene.remove(e.obj));
  scene.children.filter(o => o.userData.severed).forEach(o => scene.remove(o));
  const def = DRAGONS[run.fight], ps = pStats();
  dragon = buildDragon(def);
  buildWeapon(run.weapon);
  dragon.root.position.set(0, 0, 18); dragon.root.rotation.y = Math.PI;
  player.position.set(0, 0, -16); player.rotation.y = 0; camYaw = 0;
  S = {
    def, ps, hp: ps.maxHp, st: ps.maxSt, potions: 3, cd: 0, swing: 0, charge: -1, block: false, dodgeT: 0, invuln: 0, drinkT: 0, hurtT: 0,
    dhp: def.hp, dmax: def.hp, tailHp: def.hp * 0.22, severed: false,
    ai: { state: 'idle', t: 1.5, atk: null, dir: new THREE.Vector3(), hit: false }, over: false, introT: 2,
  };
  $('dname').textContent = `第${run.fight + 1}戰：${def.name}`;
  $('pname').textContent = `獵人（${WEAPONS[run.weapon].name}）`;
  showMsg(`第${run.fight + 1}戰\n${def.name}`, 2);
  ['title', 'stats', 'over'].forEach(id => $(id).classList.add('hidden'));
}

let msgT = 0;
function showMsg(t, d = 1.5) { $('msg').innerText = t; msgT = d; }

// ---------- input ----------
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyJ') input.attack = true;
  if (e.code === 'KeyK') input.special = true;
  if (e.code === 'Space') input.dodge = true;
  if (e.code === 'KeyQ') input.potion = true;
});
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'KeyJ') input.attack = false; if (e.code === 'KeyK') input.special = false; });
const cv = renderer.domElement;
cv.addEventListener('contextmenu', e => e.preventDefault());
let drag = null;
cv.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') { if (e.button === 0) input.attack = true; if (e.button === 2) input.special = true; }
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
addEventListener('pointerup', e => {
  if (e.pointerType === 'mouse') { if (e.button === 0) input.attack = false; if (e.button === 2) input.special = false; }
  if (drag && drag.id === e.pointerId) drag = null;
});
addEventListener('pointermove', e => {
  if (drag && drag.id === e.pointerId) {
    camYaw -= (e.clientX - drag.x) * 0.006; camPitch = THREE.MathUtils.clamp(camPitch + (e.clientY - drag.y) * 0.004, 0.05, 1.1);
    drag.x = e.clientX; drag.y = e.clientY;
  }
});
// touch controls
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (isTouch) $('touch').classList.remove('hidden');
const stick = $('stick'), knob = $('knob'); let stickId = null;
function stickMove(e) { const r = stick.getBoundingClientRect(); let dx = e.clientX - r.left - 110, dy = e.clientY - r.top - 110; const l = Math.hypot(dx, dy); if (l > 90) { dx *= 90 / l; dy *= 90 / l; } knob.style.transform = `translate(${dx}px,${dy}px)`; input.mx = dx / 90; input.mz = dy / 90; }
stick.addEventListener('pointerdown', e => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); stickMove(e); e.stopPropagation(); });
stick.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
const stickEnd = e => { if (e.pointerId === stickId) { stickId = null; input.mx = input.mz = 0; knob.style.transform = ''; } };
stick.addEventListener('pointerup', stickEnd); stick.addEventListener('pointercancel', stickEnd);
document.querySelectorAll('.ab').forEach(b => {
  const a = b.dataset.a;
  b.addEventListener('pointerdown', e => { e.stopPropagation(); b.setPointerCapture(e.pointerId); input[a] = true; });
  const up = () => { if (a === 'attack' || a === 'special') input[a] = false; };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
});

// ---------- UI panels ----------
document.querySelectorAll('#title button').forEach(b => b.onclick = () => { run.weapon = b.dataset.w; run.fight = 0; run.pts = 0; for (const k in run.stats) run.stats[k] = 0; snd(440); startFight(); });
$('restart').onclick = () => { S = null; ['stats', 'over'].forEach(id => $(id).classList.add('hidden')); $('title').classList.remove('hidden'); };
$('oagain').onclick = () => startFight();
function showStats() {
  $('stats').classList.remove('hidden');
  const render = () => {
    $('spts').textContent = `可分配點數：${run.pts}`;
    $('slist').innerHTML = '';
    for (const k in run.stats) {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<span style="min-width:120px">${STAT_NAMES[k]}</span><button>−</button><b style="min-width:60px">${run.stats[k]}</b><button>＋</button>`;
      const [minus, plus] = row.querySelectorAll('button');
      minus.onclick = () => { if (run.stats[k] > run.base[k]) { run.stats[k]--; run.pts++; render(); } };
      plus.onclick = () => { if (run.pts > 0) { run.stats[k]++; run.pts--; render(); } };
      $('slist').appendChild(row);
    }
  };
  run.base = { ...run.stats };
  render();
}
$('snext').onclick = () => { run.fight++; startFight(); };

// ---------- combat helpers ----------
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
function worldPos(o, v = new THREE.Vector3()) { return o.getWorldPosition(v); }
function flatDist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

function hurtPlayer(amount, src) {
  if (S.invuln > 0 || S.over) return;
  let dmg = amount * S.def.dmg * S.ps.def * (S.severed ? 0.75 : 1);
  const toSrc = Math.atan2(src.x - player.position.x, src.z - player.position.z);
  const facing = Math.abs(((toSrc - player.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 1.2;
  if (S.block && facing && S.st > 0) { dmg *= 0.15; S.st -= 20; snd(900, 0.08, 'triangle'); showMsg('格擋！', 0.6); }
  else { snd(120, 0.2, 'sawtooth', 0.2, -60); S.hurtT = 0.4; }
  S.hp -= dmg; S.invuln = 0.6; S.drinkT = 0;
  const away = tmp.copy(player.position).sub(src).setY(0).normalize().multiplyScalar(dmg > 10 ? 3 : 1);
  player.position.add(away);
  if (S.hp <= 0) { S.hp = 0; S.over = true; setTimeout(() => { $('otitle').textContent = '狩獵失敗'; $('otext').textContent = `${S.def.name} 太強喇…`; $('over').classList.remove('hidden'); }, 1200); }
}

function doHit(mult, label) {
  const w = WEAPONS[run.weapon];
  const front = tmp.set(Math.sin(player.rotation.y), 0, Math.cos(player.rotation.y));
  const hitPt = tmp2.copy(player.position).addScaledVector(front, w.range * 0.6);
  // candidate parts: body, head, tail
  const parts = [
    { kind: 'body', p: worldPos(dragon.root).setY(0), r: 3.4 },
    { kind: 'head', p: worldPos(dragon.head).setY(0), r: 1.8 },
  ];
  if (!S.severed) dragon.tailSegs.slice(1).forEach(s => parts.push({ kind: 'tail', p: worldPos(s).setY(0), r: 1.4 }));
  let best = null, bd = 1e9;
  for (const c of parts) { const d = flatDist(hitPt, c.p) - c.r; if (d < bd) { bd = d; best = c; } }
  if (!best || bd > w.range * 0.6) { snd(300, 0.05, 'triangle', 0.05); return; }
  let dmg = w.dmg * mult * S.ps.atk * (best.kind === 'head' ? 1.4 : 1);
  S.dhp -= dmg;
  spawnSpark(best.p.clone().setY(2.5), best.kind === 'tail' ? 0xffe080 : 0xff4040);
  snd(best.kind === 'head' ? 220 : 180, 0.08, 'square', 0.12);
  if (label) showMsg(label, 0.6);
  if (best.kind === 'tail') {
    S.tailHp -= dmg;
    if (S.tailHp <= 0) severTail();
  }
  if (S.dhp <= 0 && !S.over) {
    S.dhp = 0; S.over = true; S.ai.state = 'dead'; snd(200, 1.0, 'sawtooth', 0.2, -150);
    showMsg('狩獵成功！', 3);
    setTimeout(() => {
      if (run.fight >= DRAGONS.length - 1) { $('otitle').textContent = '🏆 全部討伐！'; $('otext').textContent = '你係鬥技場最強獵人！'; $('oagain').textContent = '再挑戰終戰'; $('over').classList.remove('hidden'); }
      else { run.pts += 5; $('stitle').textContent = `勝利！下一戰：${DRAGONS[run.fight + 1].name}`; showStats(); }
    }, 2500);
  }
}

function severTail() {
  S.severed = true;
  const cut = dragon.tailCut;
  const wp = worldPos(cut), wq = cut.getWorldQuaternion(new THREE.Quaternion()), ws = cut.getWorldScale(new THREE.Vector3());
  cut.parent.remove(cut);
  cut.position.copy(wp); cut.quaternion.copy(wq); cut.scale.copy(ws);
  cut.userData.severed = true; cut.userData.vy = 4; cut.userData.spin = (Math.random() - 0.5) * 4;
  scene.add(cut);
  showMsg('斷尾成功！龍攻擊力下降', 2.2);
  snd(600, 0.4, 'sawtooth', 0.2, -400);
  for (let i = 0; i < 6; i++) spawnSpark(wp.clone(), 0xa01010);
}

function spawnSpark(p, col) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4), new THREE.MeshBasicMaterial({ color: col, transparent: true }));
  m.position.copy(p); scene.add(m);
  effects.push({ obj: m, t: 0.4, v: new THREE.Vector3((Math.random() - .5) * 8, Math.random() * 6, (Math.random() - .5) * 8) });
}
function spawnBreath(origin, dir, col) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85 }));
  m.position.copy(origin); scene.add(m);
  effects.push({ obj: m, t: 0.9, v: dir.clone().multiplyScalar(24).add(new THREE.Vector3((Math.random() - .5) * 3, (Math.random() - .5) * 2, (Math.random() - .5) * 3)), grow: true });
}

// ---------- dragon AI ----------
const ATTACKS = {
  bite:   { name: '咬！', wind: 0.8, act: 0.35, rec: 0.9, range: 9 },
  tail:   { name: '甩尾！', wind: 0.9, act: 0.7, rec: 1.0, range: 10 },
  charge: { name: '衝撞！', wind: 1.1, act: 1.4, rec: 1.3, range: 40 },
  breath: { name: '吐息！', wind: 1.2, act: 1.2, rec: 1.2, range: 22 },
};
function updateDragon(dt, t) {
  const ai = S.ai, d = dragon.root, def = S.def;
  const toP = tmp.copy(player.position).sub(d.position).setY(0);
  const dist = toP.length();
  const wantYaw = Math.atan2(toP.x, toP.z);
  const turn = (target, rate) => { let diff = ((target - d.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI; d.rotation.y += THREE.MathUtils.clamp(diff, -rate * dt, rate * dt); return diff; };
  const fwd = new THREE.Vector3(Math.sin(d.rotation.y), 0, Math.cos(d.rotation.y));
  let walk = 0;
  dragon.jaw.rotation.x = 0; dragon.neck.rotation.x = 0; dragon.tailBase.rotation.y = Math.sin(t * 2) * 0.25;
  $('tele').textContent = '';
  ai.t -= dt;
  if (ai.state === 'dead') { d.rotation.z = Math.min(d.rotation.z + dt, Math.PI / 2 * 0.9); d.position.y = Math.max(d.position.y - dt, -1); return; }
  if (S.over) return;
  if (ai.state === 'idle') {
    const diff = turn(wantYaw, 2.0 * def.speed);
    if (dist > 8) { d.position.addScaledVector(fwd, 5 * def.speed * dt); walk = 1; }
    if (ai.t <= 0) {
      let pick;
      const r = Math.random();
      const behind = Math.abs(diff) > 1.6;
      if (behind && dist < 11) pick = 'tail';
      else if (dist < 8) pick = r < 0.5 ? 'bite' : r < 0.8 ? 'tail' : 'breath';
      else if (dist < 20) pick = r < 0.5 ? 'breath' : 'charge';
      else pick = 'charge';
      ai.atk = pick; ai.state = 'wind'; ai.t = ATTACKS[pick].wind / Math.sqrt(def.speed); ai.hit = false;
      snd(90, 0.4, 'sawtooth', 0.12, 40);
    }
  } else if (ai.state === 'wind') {
    const A = ATTACKS[ai.atk];
    $('tele').textContent = '⚠ ' + A.name;
    if (ai.atk !== 'tail') turn(wantYaw, 3);
    if (ai.atk === 'bite') dragon.neck.rotation.x = -0.4;
    if (ai.atk === 'tail') { d.rotation.y -= dt * 0.6; dragon.tailBase.rotation.y = 0.8; }
    if (ai.atk === 'charge') { d.position.y = Math.abs(Math.sin(t * 20)) * 0.15; }
    if (ai.atk === 'breath') { dragon.neck.rotation.x = -0.6; dragon.jaw.rotation.x = 0.3; }
    if (ai.t <= 0) { ai.state = 'act'; ai.t = A.act; ai.dir.copy(fwd); if (ai.atk === 'tail') ai.spin = 0; snd(ai.atk === 'breath' ? 160 : 70, 0.5, 'sawtooth', 0.2, -40); }
  } else if (ai.state === 'act') {
    const A = ATTACKS[ai.atk];
    if (ai.atk === 'bite') {
      dragon.neck.rotation.x = 0.5; dragon.jaw.rotation.x = 0.5;
      d.position.addScaledVector(ai.dir, 6 * dt);
      const hp = worldPos(dragon.head);
      if (!ai.hit && flatDist(hp, player.position) < 3.0) { ai.hit = true; hurtPlayer(25, hp); }
    } else if (ai.atk === 'tail') {
      const sp = Math.PI * 2 / A.act; d.rotation.y += sp * dt; dragon.tailBase.rotation.y = -0.5;
      const reach = S.severed ? 6.5 : 10;
      if (!ai.hit && dist < reach && dist > 2) {
        const tipP = worldPos(dragon.tailSegs[S.severed ? 1 : dragon.tailSegs.length - 1]);
        if (flatDist(tipP, player.position) < 3.0 || flatDist(worldPos(dragon.tailSegs[1]), player.position) < 2.5) { ai.hit = true; hurtPlayer(30, d.position); }
      }
    } else if (ai.atk === 'charge') {
      d.position.addScaledVector(ai.dir, 22 * def.speed * dt); walk = 2;
      if (!ai.hit && dist < 4.0) { ai.hit = true; hurtPlayer(35, d.position); }
    } else if (ai.atk === 'breath') {
      dragon.neck.rotation.x = -0.1; dragon.jaw.rotation.x = 0.6;
      const mouth = worldPos(dragon.head).addScaledVector(fwd, 2);
      if (Math.random() < 0.7) spawnBreath(mouth, ai.dir.clone().setY(-0.15).normalize(), BREATH_COL[def.breath]);
      const rel = tmp2.copy(player.position).sub(d.position).setY(0);
      const ang = rel.angleTo(ai.dir);
      if (!ai.hit && ang < 0.4 && rel.length() < A.range) { ai.hit = true; hurtPlayer(30, d.position); }
    }
    if (ai.t <= 0) { ai.state = 'rec'; ai.t = A.rec; d.position.y = 0; }
  } else if (ai.state === 'rec') {
    if (ai.atk === 'charge') d.position.addScaledVector(ai.dir, Math.max(0, ai.t) * 8 * dt);
    if (ai.t <= 0) { ai.state = 'idle'; ai.t = 0.6 + Math.random() * 1.4 / def.speed; }
  }
  // keep in arena
  const r = Math.hypot(d.position.x, d.position.z);
  if (r > ARENA - 4) { d.position.x *= (ARENA - 4) / r; d.position.z *= (ARENA - 4) / r; if (ai.atk === 'charge' && ai.state === 'act') { ai.state = 'rec'; ai.t = 1.5; snd(60, 0.5, 'sawtooth', 0.2); } }
  // anim
  const ph = t * (walk === 2 ? 14 : 7);
  dragon.legs.forEach((l, i) => l.rotation.x = walk ? Math.sin(ph + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.5 : 0);
  dragon.wings.forEach((w, i) => w.rotation.z = Math.sin(t * 2) * 0.1 * (i ? 1 : -1) + (ai.state === 'wind' ? (i ? 0.4 : -0.4) : 0));
  dragon.tailSegs.forEach((s, i) => { if (i) s.rotation.y = Math.sin(t * 2.5 - i * 0.6) * 0.12; });
  // body collision with player
  if (dist < 3.8) player.position.addScaledVector(toP.normalize(), 3.8 - dist);
}

// ---------- player update ----------
function updatePlayer(dt) {
  const w = WEAPONS[run.weapon];
  S.cd -= dt; S.invuln -= dt; S.dodgeT -= dt; S.hurtT -= dt; S.swing -= dt;
  let mx = input.mx + ((keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0));
  let mz = input.mz + ((keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0));
  const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
  const cy = Math.cos(camYaw), sy = Math.sin(camYaw);
  // camera looks along -(sin yaw, cos yaw) from behind → forward = (sin,cos) of camYaw
  const dir = new THREE.Vector3(-mx * cy - mz * sy, 0, mx * sy - mz * cy);
  let speed = S.ps.spd * w.speedMul;
  if (S.charge >= 0 || S.block) speed *= 0.35;
  if (S.drinkT > 0) speed *= 0.3;
  if (S.dodgeT > 0) { player.position.addScaledVector(S.dodgeDir, 16 * dt); }
  else if (dir.lengthSq() > 0.01 && S.hurtT <= 0) {
    player.position.addScaledVector(dir, speed * dt);
    if (S.swing <= 0) player.rotation.y = Math.atan2(dir.x, dir.z);
  }
  // dodge
  if (input.dodge) {
    input.dodge = false;
    if (S.st >= 25 && S.dodgeT <= 0) { S.st -= 25; S.dodgeT = 0.3; S.invuln = 0.4; S.dodgeDir = dir.lengthSq() > 0.01 ? dir.clone().normalize() : new THREE.Vector3(-Math.sin(player.rotation.y), 0, -Math.cos(player.rotation.y)); snd(500, 0.08, 'triangle', 0.06); S.charge = -1; }
  }
  // potion
  if (input.potion) { input.potion = false; if (S.potions > 0 && S.drinkT <= 0 && S.hp < S.ps.maxHp) { S.potions--; S.drinkT = 1.0; snd(700, 0.3, 'sine', 0.1, 300); } }
  if (S.drinkT > 0) { S.drinkT -= dt; S.hp = Math.min(S.ps.maxHp, S.hp + S.ps.maxHp * 0.4 * dt); }
  // auto-face dragon when attacking
  const faceDragon = () => { const v = tmp.copy(dragon.root.position).sub(player.position); if (v.length() < 14) player.rotation.y = Math.atan2(v.x, v.z); };
  S.block = false;
  if (run.weapon === 'gs') {
    if (input.special && S.cd <= 0) { if (S.charge < 0) { S.charge = 0; faceDragon(); } S.charge = Math.min(1.6, S.charge + dt); if (S.charge >= 1.6 && Math.random() < 0.1) snd(1000, 0.03); }
    else if (S.charge >= 0) { const c = S.charge; S.charge = -1; S.cd = w.cd * 1.3; S.swing = 0.5; doHit(1 + c * 1.6, c > 1.2 ? '蓄力斬！' : null); }
  } else if (run.weapon === 'ss') {
    if (input.special && S.st > 0) { S.block = true; S.st -= 8 * dt; }
  } else if (run.weapon === 'db') {
    if (input.special && S.st > 5 && S.cd <= 0) { faceDragon(); S.st -= 6; S.cd = 0.1; S.swing = 0.15; doHit(0.9, null); }
  }
  if (input.attack && S.cd <= 0 && S.drinkT <= 0 && S.charge < 0 && !S.block) {
    faceDragon(); S.cd = w.cd; S.swing = Math.min(0.5, w.cd * 0.8); doHit(1);
    if (run.weapon === 'gs') input.attack = false;
  }
  if (!input.special && !S.block && S.dodgeT <= 0 && S.charge < 0) S.st = Math.min(S.ps.maxSt, S.st + 28 * dt);
  const r = Math.hypot(player.position.x, player.position.z);
  if (r > ARENA) { player.position.x *= ARENA / r; player.position.z *= ARENA / r; }
  // arm animation
  const sw = S.swing > 0 ? S.swing / Math.max(0.15, w.cd * 0.8) : 0;
  armR.rotation.x = S.charge >= 0 ? -2.4 : -0.3 - Math.sin(sw * Math.PI) * 1.6 + (sw ? 1.0 : 0);
  armL.rotation.x = run.weapon === 'db' ? -0.3 - Math.sin(sw * Math.PI + 1) * 1.4 : (S.block ? -1.5 : -0.2);
  if (run.weapon === 'gs') armR.rotation.y = sw ? 0.8 - sw * 1.6 : 0.3;
  pBody.rotation.x = S.dodgeT > 0 ? 0.8 : 0;
  pBody.material.emissive.setHex(S.invuln > 0 && S.hurtT > 0 ? 0x660000 : S.drinkT > 0 ? 0x004400 : 0);
}

// ---------- loop ----------
const clock = new THREE.Clock();
let time = 0;
function hud() {
  if (!S) return;
  $('php').style.width = (S.hp / S.ps.maxHp * 100) + '%';
  $('pst').style.width = (S.st / S.ps.maxSt * 100) + '%';
  $('dhp').style.width = (S.dhp / S.dmax * 100) + '%';
  $('pot').textContent = `藥水 ×${S.potions}` + (S.charge >= 0 ? `　蓄力 ${'▮'.repeat(Math.floor(S.charge / 0.4) + 1)}` : '');
  $('tail').textContent = S.severed ? '尾：已斷 ✂' : `尾：${Math.ceil(Math.max(0, S.tailHp) / (S.dmax * 0.22) * 100)}%`;
}
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05); time += dt;
  if (S && dragon) {
    if (!S.over || S.ai.state === 'dead') { if (S.introT > 0) S.introT -= dt; else updateDragon(dt, time); }
    if (!S.over) updatePlayer(dt);
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i]; e.t -= dt; e.obj.position.addScaledVector(e.v, dt);
    if (e.grow) e.obj.scale.multiplyScalar(1 + dt * 2.5); else e.v.y -= 15 * dt;
    e.obj.material.opacity = Math.max(0, e.t * 1.5);
    if (e.t <= 0) { scene.remove(e.obj); effects.splice(i, 1); }
  }
  scene.children.forEach(o => { if (o.userData.severed && o.position.y > 0.6) { o.userData.vy -= 20 * dt; o.position.y = Math.max(0.6, o.position.y + o.userData.vy * dt); o.rotation.y += o.userData.spin * dt; if (o.position.y <= 0.6) o.rotation.set(0, o.rotation.y, 0); } });
  // camera
  const target = S ? player.position : new THREE.Vector3(0, 0, 10);
  if (!S) camYaw += dt * 0.15;
  const dist = 13;
  camera.position.set(target.x - Math.sin(camYaw) * dist * Math.cos(camPitch), 2 + Math.sin(camPitch) * dist, target.z - Math.cos(camYaw) * dist * Math.cos(camPitch));
  camera.lookAt(target.x, target.y + 2.5, target.z);
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('msg').textContent = ''; }
  hud();
  renderer.render(scene, camera);
}
// title backdrop dragon
dragon = buildDragon(DRAGONS[0]); dragon.root.position.set(0, 0, 10);
frame();
window.__hunt = { run, get S() { return S; }, startFight, severTail };
