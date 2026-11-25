import * as THREE from 'three';

const $ = id => document.getElementById(id);
const ARENA = 38;

const WEAPONS = {
  gs: { name: '大劍', dmg: 42, cd: 0.55, range: 4.2, speedMul: 0.85, col: 0xb8bcc4 },
  ss: { name: '單手劍', dmg: 15, cd: 0.18, range: 3.0, speedMul: 1.0, col: 0xc8ced4 },
  db: { name: '雙刀', dmg: 8, cd: 0.12, range: 2.8, speedMul: 1.1, col: 0xd0c090 },
};
// MH-style chains: press attack again in buffer window to continue
const COMBOS = {
  gs: [
    { id: 'overhead', dmg: 1.0, range: 4.2, dur: 0.72, label: null },
    { id: 'side', dmg: 1.15, range: 4.7, dur: 0.62, label: '橫斬' },
    { id: 'slam', dmg: 1.6, range: 5.1, dur: 0.88, label: '廣域砸！' },
  ],
  ss: [
    { id: 'slash', dmg: 1.0, range: 3.0, dur: 0.3, label: null },
    { id: 'back', dmg: 1.05, range: 3.15, dur: 0.32, label: null },
    { id: 'bash', dmg: 1.2, range: 2.85, dur: 0.36, label: '盾擊' },
    { id: 'rising', dmg: 1.5, range: 3.45, dur: 0.46, label: '迴旋斬！' },
  ],
  db: [
    { id: 'double', dmg: 0.95, range: 2.85, dur: 0.26, label: null },
    { id: 'cross', dmg: 1.1, range: 3.05, dur: 0.28, label: null },
    { id: 'flurry', dmg: 1.3, range: 3.25, dur: 0.4, label: '亂舞' },
    { id: 'finisher', dmg: 1.65, range: 3.55, dur: 0.48, label: '終結！' },
  ],
};
const COMBO_BUFFER = 0.32; // after swing ends, still chainable
const COMBO_LINK = 0.55;   // fraction of swing remaining when buffer opens

// ---------- persistent run state ----------
const run = { weapon: 'gs', fight: 0, pts: 0, stats: { hp: 0, atk: 0, def: 0, sta: 0, spd: 0 } };
const STAT_NAMES = { hp: '體力', atk: '攻擊', def: '防禦', sta: '耐力', spd: '速度' };

// ---------- three setup (pixel-art 3D: low-res RT + nearest upscale) ----------
const PIXEL_SCALE = 4;
let renderer, hasWebGL = true;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
} catch (e) {
  hasWebGL = false;
  const canvas = document.createElement('canvas');
  renderer = {
    domElement: canvas,
    shadowMap: { enabled: false },
    setPixelRatio() {},
    setSize(w, h) { canvas.width = w; canvas.height = h; canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; },
    setRenderTarget() {},
    render() {},
  };
  console.warn('WebGL unavailable; using canvas stub', e);
}
renderer.setPixelRatio?.(1);
if (renderer.shadowMap) renderer.shadowMap.enabled = false;
renderer.domElement.style.touchAction = 'none';
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7a8a96);
scene.fog = new THREE.Fog(0x7a8a96, 70, 130);
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 300);

let pixelRT = null;
const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const blitScene = new THREE.Scene();
const blitMat = new THREE.MeshBasicMaterial({ map: null });
blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat));

function viewSize() {
  const vv = window.visualViewport;
  return {
    w: Math.max(1, Math.round(vv ? vv.width : innerWidth)),
    h: Math.max(1, Math.round(vv ? vv.height : innerHeight)),
  };
}
let resizeTimer = 0;
function resizeNow() {
  const { w, h } = viewSize();
  const pw = Math.max(120, Math.floor(w / PIXEL_SCALE));
  const ph = Math.max(80, Math.floor(h / PIXEL_SCALE));
  if (hasWebGL && THREE.WebGLRenderTarget) {
    if (pixelRT) pixelRT.dispose();
    pixelRT = new THREE.WebGLRenderTarget(pw, ph, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    blitMat.map = pixelRT.texture;
    blitMat.needsUpdate = true;
  }
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px';
  renderer.domElement.style.height = h + 'px';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
function resize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resizeNow, 80);
}
addEventListener('resize', resize);
if (window.visualViewport) {
  visualViewport.addEventListener('resize', resize);
  visualViewport.addEventListener('scroll', () => {
    // keep canvas locked to visual viewport origin (address-bar show/hide)
    const vv = visualViewport;
    renderer.domElement.style.top = vv.offsetTop + 'px';
    renderer.domElement.style.left = vv.offsetLeft + 'px';
  });
}
resizeNow();

// block pinch / double-tap zoom
const blockZoom = e => { e.preventDefault(); };
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => addEventListener(ev, blockZoom, { passive: false }));
addEventListener('dblclick', blockZoom, { passive: false });
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

scene.add(new THREE.HemisphereLight(0xb8c4cc, 0x6a5a48, 0.95));
const sun = new THREE.DirectionalLight(0xf0e6d4, 1.1);
sun.position.set(28, 48, 18);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x5a6870, 0.4));

function pixelizeTex(t) {
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return pixelizeTex(new THREE.CanvasTexture(c));
}
// calm flat materials, limited soft palette
const std = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

// ---------- terrain height + sparse obstacles ----------
const HEIGHT_ZONES = [
  { type: 'pit', x: 14, z: -12, r: 9, y: -2.2 },
  { type: 'plat', x: -15, z: 12, r: 6.5, y: 2.5, ramp: 5.5 },
  { type: 'plat', x: 17, z: 6, r: 5, y: 1.8, ramp: 4.5 },
];
const OBSTACLES = [
  { x: -9, z: 2, r: 2.1, h: 4.8, kind: 'rock' },
  { x: 8, z: 15, r: 1.9, h: 4.2, kind: 'rock' },
  { x: 5, z: -7, r: 1.7, h: 3.6, kind: 'rock' },
  { x: -18, z: -6, r: 2.0, h: 4.4, kind: 'rock' },
  { x: 1, z: 9, r: 1.1, h: 3.0, w: 5.5, kind: 'wall', yaw: 0.35 },
  { x: -6, z: -16, r: 1.0, h: 2.8, w: 5.0, kind: 'wall', yaw: -0.7 },
];

function sampleHeight(x, z) {
  let y = 0;
  for (const zn of HEIGHT_ZONES) {
    const d = Math.hypot(x - zn.x, z - zn.z);
    if (zn.type === 'pit') {
      if (d < zn.r) {
        const t = THREE.MathUtils.smoothstep(1 - d / zn.r, 0.12, 1);
        y = Math.min(y, zn.y * t);
      }
    } else {
      const ramp = zn.ramp || 4;
      if (d < zn.r) y = Math.max(y, zn.y);
      else if (d < zn.r + ramp) {
        const t = 1 - (d - zn.r) / ramp;
        y = Math.max(y, zn.y * t);
      }
    }
  }
  return y;
}

function pushOutObstacles(pos, radius) {
  for (const o of OBSTACLES) {
    if (o.kind === 'rock') {
      const dx = pos.x - o.x, dz = pos.z - o.z;
      const d = Math.hypot(dx, dz), need = o.r + radius;
      if (d < need && d > 1e-4) {
        const push = (need - d) / d;
        pos.x += dx * push; pos.z += dz * push;
      } else if (d < need) { pos.x += need; }
    } else {
      // oriented box (wall): local X along length
      const c = Math.cos(-o.yaw), s = Math.sin(-o.yaw);
      let lx = (pos.x - o.x) * c - (pos.z - o.z) * s;
      let lz = (pos.x - o.x) * s + (pos.z - o.z) * c;
      const hw = o.w * 0.5 + radius, hd = o.r + radius;
      if (Math.abs(lx) < hw && Math.abs(lz) < hd) {
        const px = hw - Math.abs(lx), pz = hd - Math.abs(lz);
        if (px < pz) lx = Math.sign(lx || 1) * hw;
        else lz = Math.sign(lz || 1) * hd;
        pos.x = o.x + lx * c + lz * s;
        pos.z = o.z - lx * s + lz * c;
      }
    }
  }
  return pos;
}

function hitsObstacle(x, z, radius) {
  const p = { x, z };
  const before = { x, z };
  pushOutObstacles(p, radius);
  return Math.hypot(p.x - before.x, p.z - before.z) > 0.001;
}

// calm near-solid sand — minimal pattern noise
const sandMat = std(0xb59a74);
const platMat = std(0xa89070);
const pitMat = std(0x8f7a5c);

const groundGeo = new THREE.PlaneGeometry((ARENA + 4) * 2, (ARENA + 4) * 2, 64, 64);
groundGeo.rotateX(-Math.PI / 2);
{
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    if (x * x + z * z > (ARENA + 4) * (ARENA + 4)) { pos.setY(i, -4); continue; }
    pos.setY(i, sampleHeight(x, z));
  }
  groundGeo.computeVertexNormals();
}
sandMat.flatShading = false; // smoother ground; pixel RT still keeps the style
const ground = new THREE.Mesh(groundGeo, sandMat);
scene.add(ground);
// soft accent discs so platforms/pits read at a glance
for (const zn of HEIGHT_ZONES) {
  if (zn.type === 'plat') {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(zn.r * 0.95, zn.r, 0.35, 12), platMat);
    disc.position.set(zn.x, zn.y - 0.05, zn.z); scene.add(disc);
  } else {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(zn.r * 0.9, zn.r * 0.7, 0.2, 14), pitMat);
    disc.position.set(zn.x, zn.y + 0.05, zn.z); scene.add(disc);
  }
}

const wallMat = std(0x7a7064);
const wall = new THREE.Mesh(new THREE.CylinderGeometry(ARENA + 4, ARENA + 4, 10, 28, 1, true), wallMat);
wall.material.side = THREE.BackSide; wall.position.y = 5; scene.add(wall);
for (let i = 0; i < 16; i++) {
  const a = i / 16 * Math.PI * 2;
  const p = new THREE.Mesh(new THREE.BoxGeometry(2, 12, 2), wallMat);
  p.position.set(Math.cos(a) * (ARENA + 4), 6, Math.sin(a) * (ARENA + 4)); scene.add(p);
}

const rockMat = std(0x6e675c), wallRuinMat = std(0x756b5e);
for (const o of OBSTACLES) {
  if (o.kind === 'rock') {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.85, o.r, o.h, 6), rockMat);
    mesh.position.set(o.x, sampleHeight(o.x, o.z) + o.h * 0.5, o.z);
    scene.add(mesh);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(o.r * 0.7, 6, 4), rockMat);
    cap.position.set(o.x, sampleHeight(o.x, o.z) + o.h * 0.85, o.z);
    scene.add(cap);
  } else {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.r * 2), wallRuinMat);
    mesh.position.set(o.x, sampleHeight(o.x, o.z) + o.h * 0.5, o.z);
    mesh.rotation.y = o.yaw;
    scene.add(mesh);
  }
}


// ---------- player ----------
const player = new THREE.Group();
const armorMat = std(0x406080), skinMat = std(0xe0b090), leatherMat = std(0x5a3a22), metalMat = std(0x8890a0);
const limb = (r1, r2, len, mat, parent) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 8), mat); m.position.y = -len / 2; parent.add(m); return m; };
const joint = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
const rig = joint(player, 0, 1.0, 0);           // pivot at hips, used for the roll
const hips = joint(rig, 0, 0, 0);
const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.32), leatherMat); hips.add(pelvis);
const torso = joint(hips, 0, 0.12, 0);
const pBody = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.36), armorMat); pBody.position.y = 0.38; torso.add(pBody);
const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.08), metalMat); chestPlate.position.set(0, 0.5, 0.2); torso.add(chestPlate);
const neckJ = joint(torso, 0, 0.78, 0);
const pHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skinMat); pHead.position.y = 0.2; neckJ.add(pHead);
const pHelm = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), metalMat); pHelm.position.y = 0.24; neckJ.add(pHelm);
const crest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.4), std(0xa02020)); crest.position.set(0, 0.5, -0.02); neckJ.add(crest);
const mkArm = s => {
  const sh = joint(torso, 0.4 * s, 0.68, 0);
  sh.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), metalMat));
  limb(0.1, 0.09, 0.36, armorMat, sh);
  const el = joint(sh, 0, -0.36, 0); limb(0.085, 0.07, 0.32, skinMat, el);
  const hand = joint(el, 0, -0.34, 0); hand.add(new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), leatherMat));
  return { sh, el, hand };
};
const R = mkArm(1), L = mkArm(-1);
const mkLeg = s => {
  const hip = joint(hips, 0.16 * s, -0.1, 0); limb(0.12, 0.1, 0.45, leatherMat, hip);
  const kn = joint(hip, 0, -0.45, 0); limb(0.1, 0.08, 0.42, armorMat, kn);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.3), leatherMat); foot.position.set(0, -0.44, 0.06); kn.add(foot);
  return { hip, kn };
};
const LL = mkLeg(-1), LR = mkLeg(1);
const armR = R.hand, armL = L.hand;
scene.add(player);

function buildWeapon(w) {
  [armR, armL].forEach(a => { while (a.children.length) a.remove(a.children[0]); });
  const m = std(WEAPONS[w].col);
  const blade = (len, wid) => { const g = new THREE.Group(); const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.35), std(0x3a2a1a)); hilt.position.z = -0.05; g.add(hilt); const guard = new THREE.Mesh(new THREE.BoxGeometry(wid * 1.6 + 0.1, 0.08, 0.06), std(0x806030)); guard.position.z = 0.12; g.add(guard); const b = new THREE.Mesh(new THREE.BoxGeometry(wid, 0.08, len), m); b.position.z = len / 2 + 0.12; g.add(b); return g; };
  if (w === 'gs') armR.add(blade(3.2, 0.55));
  if (w === 'ss') { armR.add(blade(1.5, 0.18)); const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 12), std(0x704020)); sh.rotation.z = Math.PI / 2; sh.position.set(-0.12, 0, 0.05); armL.add(sh); }
  if (w === 'db') { armR.add(blade(1.1, 0.14)); armL.add(blade(1.1, 0.14)); }
}


// ---------- colours / elements ----------
const COLOR_DEFS = {
  beige: { hex: 0xc4b08a, belly: 0xe4d8c0, accent: 0x8a7a5a, name: '米', elem: null },
  red:   { hex: 0xa82820, belly: 0xd8a070, accent: 0x5a2018, name: '紅', elem: 'fire' },
  green: { hex: 0x3a7040, belly: 0xa0b888, accent: 0x204028, name: '綠', elem: 'poison' },
  blue:  { hex: 0x2a5080, belly: 0x98b8d0, accent: 0x183048, name: '藍', elem: 'lightning' },
  black: { hex: 0x1c1c24, belly: 0x3a3a48, accent: 0x505060, name: '黑', elem: 'blast' },
};
const ELEM_COL = { fire: 0xff6020, poison: 0x60c040, lightning: 0x80c0ff, blast: 0x606070 };
const PLAYER_H = 2.0;

function playerPower() {
  const s = run.stats;
  return 80 + (s.hp + s.atk + s.def + s.sta + s.spd) * 25 + run.fight * 18;
}
function estimatePower(def) {
  let p = 40;
  if (def.legs === 'quad') p += 28;
  if (def.horns) p += 22;
  if (def.wings) p += 32;
  p += (def.size - 1.5) * 18;
  def.colors.forEach(c => { if (c !== 'beige') p += 16; });
  if (def.colors.length > 1) p += 10;
  p += def.hp / 25 + def.dmg * 40;
  return p;
}
function traitLabel(def) {
  const parts = [
    def.legs === 'quad' ? '四足' : '兩足',
    def.horns ? '有角' : '無角',
    def.wings ? '有翼' : '無翼',
    def.colors.map(c => COLOR_DEFS[c].name).join('/'),
    def.size.toFixed(1) + 'x',
  ];
  return parts.join('・');
}
function generateDragon(fight, budget, forceBasic = false) {
  const def = {
    legs: 'biped', horns: false, wings: false, size: 1.6,
    colors: ['beige'], hp: 220, dmg: 0.75, speed: 0.95, aggro: 0.35, windMul: 1.6,
    name: '初生龍', body: COLOR_DEFS.beige.hex, belly: COLOR_DEFS.beige.belly, accent: COLOR_DEFS.beige.accent,
  };
  if (forceBasic || fight === 0) {
    def.size = 1.5 + Math.random() * 0.25;
    def.hp = 200 + Math.random() * 80;
    def.dmg = 0.7 + Math.random() * 0.15;
    def.traits = traitLabel(def);
    def.power = estimatePower(def);
    return def;
  }
  let spent = 40;
  const unlock = Math.min(1, fight / 8 + (budget - 80) / 400);
  // legs
  if (unlock > 0.15 && Math.random() < 0.35 + unlock * 0.4 && spent + 28 < budget) {
    def.legs = 'quad'; spent += 28; def.dmg += 0.15; def.speed += 0.05;
  }
  // horns
  if (unlock > 0.25 && Math.random() < 0.3 + unlock * 0.35 && spent + 22 < budget) {
    def.horns = true; spent += 22; def.dmg += 0.12; def.speed += 0.08;
  }
  // wings
  if (unlock > 0.4 && Math.random() < 0.25 + unlock * 0.3 && spent + 32 < budget) {
    def.wings = true; spent += 32; def.aggro += 0.1;
  }
  // size
  const maxSize = Math.min(6, 1.6 + unlock * 4.2);
  def.size = 1.55 + Math.random() * (maxSize - 1.55);
  spent += (def.size - 1.5) * 18;
  // colours
  const pool = ['beige', 'red', 'green', 'blue', 'black'];
  const unlocked = pool.filter((c, i) => c === 'beige' || unlock > 0.12 * i);
  def.colors = [unlocked[Math.floor(Math.random() * unlocked.length)] || 'beige'];
  if (def.colors[0] !== 'beige') spent += 16;
  if (unlock > 0.55 && Math.random() < 0.4 && spent + 26 < budget) {
    const other = unlocked.filter(c => c !== def.colors[0] && c !== 'beige');
    if (other.length) { def.colors.push(other[Math.floor(Math.random() * other.length)]); spent += 26; }
  }
  // remaining budget → HP / dmg
  const rem = Math.max(20, budget - spent);
  def.hp = 180 + rem * 4.5 + fight * 40;
  def.dmg = 0.7 + rem / 180 + (def.horns ? 0.15 : 0) + (def.legs === 'quad' ? 0.1 : 0);
  def.speed = 0.9 + (def.horns ? 0.15 : 0) + unlock * 0.2;
  def.aggro = Math.min(1, 0.35 + unlock * 0.55);
  def.windMul = Math.max(1.05, 1.65 - unlock * 0.5);
  const c0 = COLOR_DEFS[def.colors[0]], c1 = COLOR_DEFS[def.colors[1] || def.colors[0]];
  def.body = c0.hex; def.belly = c0.belly; def.accent = c1.accent;
  def.name = (def.wings ? '翼' : '') + (def.horns ? '角' : '') + (def.legs === 'quad' ? '獸' : '龍') + def.colors.map(c => COLOR_DEFS[c].name).join('');
  def.traits = traitLabel(def);
  def.power = estimatePower(def);
  // soft clamp
  if (def.power > budget * 1.05) {
    const s = budget / def.power;
    def.hp *= s; def.dmg *= Math.sqrt(s); def.power = estimatePower(def);
  }
  return def;
}
function generateEncounter(fight) {
  const pwr = playerPower();
  const cap = pwr * 1.2;
  let count = 1;
  if (pwr > 260 && fight >= 4 && Math.random() < 0.4) count = 2;
  if (pwr > 380 && fight >= 7 && Math.random() < 0.25) count = Math.min(3, count + 1);
  if (fight === 0) count = 1;
  const defs = [];
  let left = cap;
  for (let i = 0; i < count; i++) {
    const share = left / (count - i) * (0.9 + Math.random() * 0.15);
    const d = generateDragon(fight, share, fight === 0 && i === 0);
    defs.push(d);
    left = Math.max(40, left - d.power);
  }
  return defs;
}

// ---------- audio (richer SFX, mute-aware) ----------
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
function noiseBurst(dur, vol, freq = 400) {
  if (muted) return;
  try {
    actx = actx || new AudioContext();
    const n = actx.createBuffer(1, actx.sampleRate * dur, actx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / d.length * 5);
    const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    f.type = 'bandpass'; f.frequency.value = freq;
    g.gain.value = vol;
    src.buffer = n; src.connect(f).connect(g).connect(actx.destination); src.start();
  } catch (e) { }
}
const SFX = {
  slash: () => snd(280, 0.08, 'square', 0.1, 200),
  hit: () => { snd(160, 0.09, 'square', 0.12); noiseBurst(0.05, 0.08, 300); },
  roll: () => snd(500, 0.08, 'triangle', 0.06, -200),
  roar: () => { snd(70, 0.55, 'sawtooth', 0.18, -30); snd(90, 0.4, 'square', 0.08, 40); },
  stomp: () => { snd(55, 0.15, 'sine', 0.16, -20); noiseBurst(0.08, 0.1, 120); },
  flap: () => snd(180, 0.12, 'triangle', 0.05, -80),
  fire: () => { snd(220, 0.25, 'sawtooth', 0.12, 120); noiseBurst(0.2, 0.1, 600); },
  poison: () => snd(340, 0.2, 'triangle', 0.1, -60),
  lightning: () => { snd(900, 0.08, 'square', 0.12); snd(600, 0.15, 'sawtooth', 0.08, -400); },
  blast: () => { noiseBurst(0.3, 0.16, 200); snd(80, 0.3, 'sawtooth', 0.14, -40); },
  poisonTick: () => snd(420, 0.06, 'sine', 0.05),
  potion: () => snd(700, 0.3, 'sine', 0.1, 300),
  win: () => { snd(440, 0.15, 'square', 0.1); setTimeout(() => snd(660, 0.2, 'square', 0.1), 120); },
  lose: () => snd(120, 0.6, 'sawtooth', 0.14, -80),
  foot: () => snd(90, 0.05, 'triangle', 0.04),
};
$('mute').onclick = () => { muted = !muted; $('mute').textContent = muted ? '🔇 靜' : '🔊 聲'; };


// ---------- procedural dragon mesh ----------
let dragons = []; // active fight dragons
let titleDragon = null;

function patternTex(def) {
  const c = n => '#' + n.toString(16).padStart(6, '0');
  const c0 = COLOR_DEFS[def.colors[0]], c1 = COLOR_DEFS[def.colors[1] || def.colors[0]];
  return canvasTex(24, 24, (g, w, h) => {
    g.fillStyle = c(c0.hex); g.fillRect(0, 0, w, h);
    if (def.colors.length > 1) {
      g.fillStyle = c(c1.hex);
      for (let x = 0; x < w; x += 6) g.fillRect(x, 0, 3, h);
    } else if (def.colors[0] !== 'beige') {
      g.fillStyle = c(c0.accent);
      for (let i = 0; i < 5; i++) g.fillRect(4 + (i % 3) * 7, 4 + Math.floor(i / 3) * 10, 2, 2);
    }
  });
}

function buildDragon(def) {
  const root = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ map: patternTex(def), flatShading: true });
  const belly = std(def.belly), hornMat = std(0xe0d8c0), dark = std(def.accent);
  const mk = (geo, mat, x, y, z, parent = root) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const biped = def.legs === 'biped';
  // body
  const bodyY = biped ? 3.6 : 2.8;
  const body = mk(new THREE.SphereGeometry(1, 10, 8), skin, 0, bodyY, 0);
  body.scale.set(biped ? 1.6 : 2.0, biped ? 2.2 : 1.6, biped ? 2.2 : 3.2);
  mk(new THREE.SphereGeometry(1, 8, 6), belly, 0, bodyY - 0.5, biped ? 0.2 : 0.3).scale.set(biped ? 1.2 : 1.5, biped ? 1.4 : 1.1, biped ? 1.6 : 2.6);
  // neck + head
  const neck = new THREE.Group(); neck.position.set(0, bodyY + (biped ? 1.2 : 0.9), biped ? 1.4 : 2.4); root.add(neck);
  mk(new THREE.CylinderGeometry(0.55, 0.9, biped ? 2.0 : 2.4, 8), skin, 0, 0.6, biped ? 0.5 : 0.9, neck).rotation.x = biped ? 0.6 : 1.0;
  const head = new THREE.Group(); head.position.set(0, biped ? 1.4 : 1.5, biped ? 1.5 : 2.2); neck.add(head);
  mk(new THREE.BoxGeometry(1.2, 0.95, 1.7), skin, 0, 0, 0.3, head);
  mk(new THREE.BoxGeometry(0.9, 0.45, 1.2), skin, 0, -0.1, 1.4, head);
  const jaw = mk(new THREE.BoxGeometry(0.85, 0.28, 1.4), dark, 0, -0.5, 1.0, head);
  [-1, 1].forEach(s => mk(new THREE.SphereGeometry(0.12, 6, 5), std(0xffee40), 0.45 * s, 0.2, 0.7, head));
  if (def.horns) {
    [[0.4, 0.45, -0.2, 0.18, 1.4, -0.8, 0.5], [0.55, 0.3, 0.1, 0.12, 0.9, -0.3, 0.9]].forEach(([x, y, z, r, len, rx, rz]) => {
      [-1, 1].forEach(s => { const h = mk(new THREE.ConeGeometry(r, len, 6), hornMat, x * s, y + len * 0.25, z, head); h.rotation.set(rx, 0, -rz * s); });
    });
  }
  // legs
  const legs = [];
  if (biped) {
    [[-0.55, 0.3], [0.55, 0.3]].forEach(([x, z]) => {
      const g = new THREE.Group(); g.position.set(x, bodyY - 0.4, z); root.add(g);
      mk(new THREE.CylinderGeometry(0.38, 0.32, 2.2, 6), skin, 0, -1.1, 0, g);
      mk(new THREE.BoxGeometry(0.7, 0.28, 1.0), dark, 0, -2.2, 0.15, g); legs.push(g);
    });
  } else {
    [[-1.3, 1.4], [1.3, 1.4], [-1.4, -1.5], [1.4, -1.5]].forEach(([x, z]) => {
      const g = new THREE.Group(); g.position.set(x, bodyY - 0.2, z); root.add(g);
      mk(new THREE.CylinderGeometry(0.4, 0.32, 2.2, 6), skin, 0, -1.1, 0, g);
      mk(new THREE.BoxGeometry(0.7, 0.25, 0.9), dark, 0, -2.2, 0.15, g); legs.push(g);
    });
  }
  // wings
  const wings = [];
  if (def.wings) {
    [-1, 1].forEach(s => {
      const g = new THREE.Group(); g.position.set(1.2 * s, bodyY + 0.8, 0.4); root.add(g);
      mk(new THREE.CylinderGeometry(0.12, 0.16, 3.8, 5), dark, 1.8 * s, 0.5, 0, g).rotation.z = -1.15 * s;
      const wgeo = new THREE.BufferGeometry();
      wgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        0, 0, 0, 3.6 * s, 1.2, 0, 2.8 * s, -0.9, -2.8,
      ]), 3));
      wgeo.setIndex([0, 1, 2]);
      wgeo.computeVertexNormals();
      mk(wgeo, new THREE.MeshLambertMaterial({ color: def.belly, side: THREE.DoubleSide, transparent: true, opacity: 0.85, flatShading: true }), 0, 0, 0, g);
      wings.push(g);
    });
  }
  // tail
  const tailBase = new THREE.Group(); tailBase.position.set(0, bodyY - 0.2, biped ? -1.6 : -2.8); root.add(tailBase);
  let parent = tailBase; const tailSegs = []; let tailCut = null;
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    const g = new THREE.Group(); g.position.z = i === 0 ? 0 : -1.35; parent.add(g);
    const r = 0.7 * (1 - i / (segs + 1));
    mk(new THREE.CylinderGeometry(r * 0.75, r, 1.5, 8), skin, 0, 0, -0.7, g).rotation.x = Math.PI / 2;
    tailSegs.push(g); parent = g; if (i === 1) tailCut = g;
  }
  mk(new THREE.SphereGeometry(0.55, 8, 6), dark, 0, 0, -1.5, parent);
  for (let k = 0; k < 4; k++) mk(new THREE.ConeGeometry(0.18, 0.7, 5), dark, 0, bodyY + 1.4 - Math.abs(k - 1.5) * 0.1, 0.6 - k * 0.7);

  // scale: size is multiple of player height; base mesh ~6 units tall
  const scale = (def.size * PLAYER_H) / 6;
  root.scale.setScalar(scale);
  scene.add(root);
  return {
    def, root, head, neck, jaw, legs, wings, tailBase, tailSegs, tailCut,
    scale, bodyR: 2.8 * scale, headR: 1.4 * scale, flyY: 0,
    hp: def.hp, maxHp: def.hp, tailHp: def.hp * 0.22, severed: false, flinch: 0,
    ai: { state: 'idle', t: 1.8 + Math.random(), atk: null, dir: new THREE.Vector3(), hit: false, lastAtk: '', phase: 0 },
  };
}

function clearDragons() {
  dragons.forEach(d => { if (d.root.parent) scene.remove(d.root); });
  dragons = [];
  if (titleDragon) { scene.remove(titleDragon.root); titleDragon = null; }
}

function livingDragons() { return dragons.filter(d => d.hp > 0); }
function nearestDragon() {
  let best = null, bd = 1e9;
  for (const d of livingDragons()) {
    const dist = flatDist(player.position, d.root.position);
    if (dist < bd) { bd = dist; best = d; }
  }
  return best;
}

// ---------- fight flow ----------
let S = null;
let pendingDefs = null;
const keys = {}; let camYaw = 0, camPitch = 0.35;
const input = { mx: 0, mz: 0, attack: false, special: false, dodge: false, potion: false };
const effects = [];
let projectiles = [];

function pStats() {
  const s = run.stats;
  return { maxHp: 100 + s.hp * 20, atk: 1 + s.atk * 0.1, def: Math.pow(0.92, s.def), maxSt: 100 + s.sta * 20, spd: 13.5 * (1 + s.spd * 0.06) };
}

function showPreview(defs) {
  pendingDefs = defs;
  $('ptitle').textContent = defs.length > 1 ? `第${run.fight + 1}戰 · ${defs.length} 隻龍` : `第${run.fight + 1}戰`;
  $('pcard').innerHTML = defs.map((d, i) =>
    `<div style="margin:10px 0;padding:10px 14px;border:2px solid #fff4;border-radius:12px;background:#0006">
      <b>${defs.length > 1 ? (i + 1) + '. ' : ''}${d.name}</b><br>${d.traits}<br>
      <span style="opacity:.8">體力 ${Math.round(d.hp)} · 攻擊 ×${d.dmg.toFixed(2)}</span>
    </div>`
  ).join('');
  ['title', 'stats', 'over'].forEach(id => $(id).classList.add('hidden'));
  $('preview').classList.remove('hidden');
  $('help')?.classList.add('hidden');
}

function startFight(defs) {
  clearDragons();
  effects.splice(0).forEach(e => scene.remove(e.obj));
  projectiles.splice(0).forEach(p => scene.remove(p.mesh));
  scene.children.filter(o => o.userData.severed).forEach(o => scene.remove(o));
  const list = defs || pendingDefs || generateEncounter(run.fight);
  pendingDefs = null;
  buildWeapon(run.weapon);
  const ps = pStats();
  const slots = list.length === 1 ? [[0, 18]] : list.length === 2 ? [[-10, 16], [10, 16]] : [[0, 18], [-12, 12], [12, 12]];
  dragons = list.map((def, i) => {
    const d = buildDragon(def);
    const [x, z] = slots[i] || [0, 18];
    d.root.position.set(x, sampleHeight(x, z), z);
    d.root.rotation.y = Math.PI;
    return d;
  });
  player.position.set(0, sampleHeight(0, -16), -16); player.rotation.y = 0; camYaw = 0;
  const primary = dragons[0];
  S = {
    ps, hp: ps.maxHp, st: ps.maxSt, potions: 3, cd: 0, swing: 0, swingDur: 0, charge: -1, block: false, dodgeT: 0, invuln: 0, drinkT: 0, hurtT: 0,
    combo: 0, comboStep: 0, atkBuf: false, comboWin: 0, comboId: '',
    debuffs: { poison: 0, slow: 0, dark: 0 }, camShake: 0, over: false, introT: 2.0, winPending: false,
  };
  $('dname').textContent = list.length > 1 ? `第${run.fight + 1}戰：${list.length} 龍` : `第${run.fight + 1}戰：${primary.def.name}`;
  $('dtraits').textContent = list.length > 1 ? list.map(d => d.traits).join(' ｜ ') : primary.def.traits;
  $('pname').textContent = `獵人（${WEAPONS[run.weapon].name}）`;
  showMsg(list.length > 1 ? `第${run.fight + 1}戰\n${list.length} 隻龍` : `第${run.fight + 1}戰\n${primary.def.name}`, 2);
  ['title', 'stats', 'over', 'preview'].forEach(id => $(id).classList.add('hidden'));
  $('help')?.classList.add('hidden');
  SFX.roar();
}

let msgT = 0;
function showMsg(t, d = 1.5) { $('msg').innerText = t; msgT = d; }


// ---------- input ----------
const pad = { mx: 0, mz: 0, attack: false, special: false, connected: false, id: '', lookX: 0, lookY: 0 };
const padPrev = { dodge: false, potion: false, options: false, share: false, lookBtn: false };
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyJ') input.attack = true;
  if (e.code === 'KeyK') input.special = true;
  if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') { input.dodge = true; e.preventDefault(); }
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
// touch: show on coarse/touch / no-hover devices; gamepad can be used at the same time
const isTouch = matchMedia('(pointer:coarse)').matches || matchMedia('(hover: none)').matches
  || 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
if (isTouch) $('touch').classList.remove('hidden');
const stick = $('stick'), knob = $('knob'); let stickId = null;
function stickMove(e) {
  const r = stick.getBoundingClientRect(), half = r.width / 2, maxR = half * 0.82;
  let dx = e.clientX - r.left - half, dy = e.clientY - r.top - half;
  const l = Math.hypot(dx, dy); if (l > maxR) { dx *= maxR / l; dy *= maxR / l; }
  knob.style.transform = `translate(${dx}px,${dy}px)`;
  input.mx = dx / maxR; input.mz = dy / maxR;
}
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

// Gamepad API — DualSense / DualShock / generic standard mapping
// 0 Cross/A attack · 1 Circle/B roll · 2 Square · 3 Triangle potion
// 4 L1/LB special · 5 R1/RB attack · 8 Share mute · 9 Options restart
// axes 0/1 left move · 2/3 right look · 12–15 d-pad look fallback
function gpBtn(gp, i) { const b = gp.buttons[i]; return !!(b && (b.pressed || b.value > 0.5)); }
function deadzone(v, z = 0.18) { return Math.abs(v) < z ? 0 : v; }
function setPadStatus(on, label) {
  const el = $('padstatus');
  if (!el) return;
  el.classList.toggle('on', !!on);
  if (on) el.textContent = label || '手掣已連接';
}
function refreshPadPresence() {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (let i = 0; i < list.length; i++) if (list[i] && list[i].connected) { gp = list[i]; break; }
  const was = pad.connected;
  pad.connected = !!gp;
  pad.id = gp ? (gp.id || 'gamepad') : '';
  if (pad.connected !== was || (pad.connected && !$('padstatus')?.classList.contains('on'))) setPadStatus(pad.connected, '手掣已連接');
  return gp;
}
addEventListener('gamepadconnected', e => {
  pad.connected = true;
  pad.id = (e.gamepad && e.gamepad.id) || 'gamepad';
  setPadStatus(true, '手掣已連接');
});
addEventListener('gamepaddisconnected', () => {
  refreshPadPresence();
  if (!pad.connected) {
    pad.mx = pad.mz = 0; pad.attack = pad.special = false; pad.lookX = pad.lookY = 0;
    setPadStatus(false);
  }
});

function pollGamepad(dt) {
  const gp = refreshPadPresence();
  if (!gp) { pad.mx = pad.mz = 0; pad.attack = pad.special = false; pad.lookX = pad.lookY = 0; return; }
  const ax = gp.axes || [];
  pad.mx = deadzone(ax[0] || 0);
  pad.mz = deadzone(ax[1] || 0);
  // attack: Cross/A or R1/RB
  pad.attack = gpBtn(gp, 0) || gpBtn(gp, 5);
  // special/block: L1/LB
  pad.special = gpBtn(gp, 4);
  // roll: Circle/B (edge)
  const dodgeNow = gpBtn(gp, 1);
  if (dodgeNow && !padPrev.dodge) input.dodge = true;
  padPrev.dodge = dodgeNow;
  // potion: Triangle/Y (edge)
  const potNow = gpBtn(gp, 3);
  if (potNow && !padPrev.potion) input.potion = true;
  padPrev.potion = potNow;
  // look: right stick if present, else d-pad, else face Square + held look via buttons 12-15 / 2
  let lx = 0, ly = 0;
  const hasRight = ax.length >= 4;
  if (hasRight) { lx = deadzone(ax[2] || 0); ly = deadzone(ax[3] || 0); }
  if (!lx && !ly) {
    if (gpBtn(gp, 14)) lx -= 1; // d-pad left
    if (gpBtn(gp, 15)) lx += 1;
    if (gpBtn(gp, 12)) ly -= 1; // up
    if (gpBtn(gp, 13)) ly += 1;
  }
  if (!hasRight && !lx && !ly) {
    // no right stick / d-pad activity: Square + face as coarse look (hold Square then use Cross/Circle)
    if (gpBtn(gp, 2)) {
      if (gpBtn(gp, 0)) ly += 1; if (gpBtn(gp, 1)) lx += 1; if (gpBtn(gp, 3)) ly -= 1;
    }
  }
  pad.lookX = lx; pad.lookY = ly;
  if (lx || ly) {
    camYaw -= lx * 2.4 * dt;
    camPitch = THREE.MathUtils.clamp(camPitch + ly * 1.6 * dt, 0.05, 1.1);
  }
  // Options → restart to title; Share → mute
  const optNow = gpBtn(gp, 9);
  if (optNow && !padPrev.options) goTitle();
  padPrev.options = optNow;
  const shareNow = gpBtn(gp, 8);
  if (shareNow && !padPrev.share) { muted = !muted; $('mute').textContent = muted ? '🔇 靜' : '🔊 聲'; }
  padPrev.share = shareNow;
}


// ---------- UI panels ----------
function spawnTitleDragon() {
  if (titleDragon) { scene.remove(titleDragon.root); titleDragon = null; }
  titleDragon = buildDragon(generateDragon(0, 80, true));
  titleDragon.root.position.set(0, sampleHeight(0, 10), 10);
}
function goTitle() {
  S = null; clearDragons(); pendingDefs = null;
  ['stats', 'over', 'preview'].forEach(id => $(id).classList.add('hidden'));
  $('title').classList.remove('hidden');
  $('help')?.classList.remove('hidden');
  spawnTitleDragon();
}
document.querySelectorAll('#title button').forEach(b => b.onclick = () => {
  run.weapon = b.dataset.w; run.fight = 0; run.pts = 0;
  for (const k in run.stats) run.stats[k] = 0;
  snd(440); showPreview(generateEncounter(0));
});
$('pgo').onclick = () => { snd(520, 0.1, 'square', 0.08); startFight(pendingDefs || generateEncounter(run.fight)); };
$('restart').onclick = () => goTitle();
$('oagain').onclick = () => { $('over').classList.add('hidden'); showPreview(generateEncounter(run.fight)); };
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
$('snext').onclick = () => {
  run.fight++;
  $('stats').classList.add('hidden');
  showPreview(generateEncounter(run.fight));
};


// ---------- combat helpers ----------
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
function worldPos(o, v = new THREE.Vector3()) { return o.getWorldPosition(v); }
function flatDist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

function hurtPlayer(amount, src, opts = {}) {
  if (!S || S.invuln > 0 || S.over) return;
  const d = nearestDragon();
  const dmgMul = d ? d.def.dmg : 1;
  let dmg = amount * dmgMul * S.ps.def * (d && d.severed ? 0.75 : 1);
  const toSrc = Math.atan2(src.x - player.position.x, src.z - player.position.z);
  const facing = Math.abs(((toSrc - player.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 1.2;
  if (S.block && facing && S.st > 0) { dmg *= 0.15; S.st -= 20; snd(900, 0.08, 'triangle'); showMsg('格擋！', 0.6); }
  else { SFX.hit(); S.hurtT = 0.4; }
  S.hp -= dmg; S.invuln = 0.55; S.drinkT = 0;
  if (opts.poison) S.debuffs.poison = Math.max(S.debuffs.poison, 5);
  if (opts.slow) S.debuffs.slow = Math.max(S.debuffs.slow, 4);
  if (opts.dark) { S.debuffs.dark = Math.max(S.debuffs.dark, 3.5); S.camShake = Math.max(S.camShake, 0.45); SFX.blast(); }
  const away = tmp.copy(player.position).sub(src).setY(0);
  if (away.lengthSq() > 0.01) { away.normalize().multiplyScalar(dmg > 10 ? 2.5 : 1); player.position.add(away); }
  if (S.hp <= 0) {
    S.hp = 0; S.over = true; SFX.lose();
    setTimeout(() => { $('otitle').textContent = '狩獵失敗'; $('otext').textContent = '龍太強喇…'; $('over').classList.remove('hidden'); }, 1000);
  }
}

function doHit(mult, label, rangeMul = 1) {
  const w = WEAPONS[run.weapon];
  const reach = (rangeMul || 1) * w.range;
  const front = tmp.set(Math.sin(player.rotation.y), 0, Math.cos(player.rotation.y));
  const hitPt = tmp2.copy(player.position).addScaledVector(front, reach * 0.55);
  hitPt.y = 0;
  let best = null, bd = 1e9, bestD = null;
  for (const d of livingDragons()) {
    if (d.ai.state === 'fly' || d.ai.state === 'dive') continue; // aerial — harder to hit unless dive
    const parts = [
      { kind: 'body', p: worldPos(d.root).setY(0), r: d.bodyR },
      { kind: 'head', p: worldPos(d.head).setY(0), r: d.headR },
    ];
    if (!d.severed) d.tailSegs.slice(1).forEach(s => parts.push({ kind: 'tail', p: worldPos(s).setY(0), r: 1.1 * d.scale }));
    for (const c of parts) {
      const dist = flatDist(hitPt, c.p) - c.r;
      if (dist < bd) { bd = dist; best = c; bestD = d; }
    }
  }
  // winged diving can be hit
  for (const d of livingDragons()) {
    if (d.ai.state !== 'dive') continue;
    const p = worldPos(d.root).setY(0);
    const dist = flatDist(hitPt, p) - d.bodyR;
    if (dist < bd) { bd = dist; best = { kind: 'body', p }; bestD = d; }
  }
  if (!best || !bestD || bd > reach * 0.55) { snd(300, 0.05, 'triangle', 0.05); return; }
  let dmg = w.dmg * mult * S.ps.atk * (best.kind === 'head' ? 1.35 : 1);
  bestD.hp -= dmg;
  if (mult >= 1.4) bestD.flinch = 0.35;
  spawnSpark(best.p.clone().setY(player.position.y + 2.2), best.kind === 'tail' ? 0xe8d090 : 0xc05050);
  SFX.hit();
  if (label) showMsg(label, 0.5);
  if (best.kind === 'tail') {
    bestD.tailHp -= dmg;
    if (bestD.tailHp <= 0 && !bestD.severed) severTail(bestD);
  }
  if (bestD.hp <= 0) {
    bestD.hp = 0; bestD.ai.state = 'dead'; bestD.ai.t = 2;
    SFX.roar();
    if (livingDragons().length === 0 && !S.over) {
      S.over = true; S.winPending = true; SFX.win();
      showMsg('狩獵成功！', 2.5);
      setTimeout(() => {
        run.pts += 5 + (dragons.length > 1 ? 3 : 0);
        $('stitle').textContent = `勝利！`;
        showStats();
      }, 1800);
    }
  }
}

function severTail(d) {
  d.severed = true;
  const cut = d.tailCut;
  if (!cut || !cut.parent) return;
  const wp = worldPos(cut), wq = cut.getWorldQuaternion(new THREE.Quaternion()), ws = cut.getWorldScale(new THREE.Vector3());
  cut.parent.remove(cut);
  cut.position.copy(wp); cut.quaternion.copy(wq); cut.scale.copy(ws);
  cut.userData.severed = true; cut.userData.vy = 4; cut.userData.spin = (Math.random() - .5) * 4;
  scene.add(cut);
  showMsg('斷尾！', 1.6);
  SFX.hit();
  spawnSpark(wp.clone(), 0x8a3030);
}

function spawnSpark(p, col) {
  if (effects.length > 12) return;
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 4, 3), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7 }));
  m.position.copy(p); scene.add(m);
  effects.push({ obj: m, t: 0.28, v: new THREE.Vector3((Math.random() - .5) * 4, Math.random() * 3, (Math.random() - .5) * 4) });
}

function spawnProjectile(origin, dir, kind, dmg) {
  const col = ELEM_COL[kind] || 0xffffff;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(kind === 'blast' ? 0.7 : 0.45, 6, 5), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.75 }));
  mesh.position.copy(origin); scene.add(mesh);
  projectiles.push({ mesh, v: dir.clone().normalize().multiplyScalar(kind === 'blast' ? 16 : 20), t: 1.4, kind, dmg, hit: false });
  if (kind === 'fire') SFX.fire();
  else if (kind === 'poison') SFX.poison();
  else if (kind === 'lightning') SFX.lightning();
  else if (kind === 'blast') SFX.blast();
}

// ---------- dragon AI ----------
const ATK = {
  bite:    { name: '咬！', wind: 1.2, act: 0.38, rec: 1.0, range: 8 },
  slamL:   { name: '左撞！', wind: 1.3, act: 0.5, rec: 1.1, range: 7 },
  slamR:   { name: '右撞！', wind: 1.3, act: 0.5, rec: 1.1, range: 7 },
  tail:    { name: '甩尾！', wind: 1.4, act: 0.7, rec: 1.2, range: 10 },
  charge:  { name: '衝撞！', wind: 1.55, act: 1.25, rec: 1.45, range: 40 },
  breath:  { name: '吐息！', wind: 1.6, act: 1.0, rec: 1.3, range: 22 },
  takeoff: { name: '起飛！', wind: 0.9, act: 0.8, rec: 0.4, range: 99 },
  dive:    { name: '俯衝！', wind: 1.2, act: 1.1, rec: 1.2, range: 99 },
};

function idleCd(def) {
  const lo = 1.4 + (1 - def.aggro) * 1.1;
  const hi = 2.1 + (1 - def.aggro) * 1.3;
  return lo + Math.random() * (hi - lo);
}

function pickAtk(d, dist, ang) {
  const def = d.def;
  const behind = Math.abs(ang) > 1.7;
  const side = Math.abs(ang) > 0.9 && Math.abs(ang) < 1.7;
  const elems = def.colors.map(c => COLOR_DEFS[c].elem).filter(Boolean);
  let pick;
  if (def.legs === 'biped') {
    if (behind && dist < 11) pick = 'tail';
    else if (side && dist < 8) pick = ang > 0 ? 'slamR' : 'slamL';
    else if (dist < 7) pick = 'bite';
    else if (elems.length && dist < 18 && Math.random() < 0.45) pick = 'breath';
    else if (dist < 10) pick = Math.random() < 0.5 ? 'bite' : (ang > 0 ? 'slamR' : 'slamL');
    else pick = elems.length ? 'breath' : 'bite';
  } else {
    if (behind && dist < 12) pick = 'tail';
    else if (dist < 8 && Math.random() < 0.35) pick = 'tail';
    else if (elems.length && dist > 8 && dist < 20 && Math.random() < 0.4) pick = 'breath';
    else pick = 'charge';
  }
  if (def.wings && d.ai.state === 'idle' && dist > 6 && Math.random() < 0.22 + def.aggro * 0.15 && d.ai.lastAtk !== 'dive') {
    pick = 'takeoff';
  }
  if (pick === d.ai.lastAtk && pick !== 'charge') {
    pick = pick === 'bite' ? 'tail' : pick === 'breath' ? (def.legs === 'quad' ? 'charge' : 'bite') : 'bite';
  }
  return pick;
}

function updateOneDragon(d, dt, t) {
  const ai = d.ai, def = d.def, root = d.root;
  const toP = tmp.copy(player.position).sub(root.position).setY(0);
  const dist = toP.length();
  const wantYaw = Math.atan2(toP.x, toP.z);
  const turn = (target, rate) => {
    let diff = ((target - root.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    root.rotation.y += THREE.MathUtils.clamp(diff, -rate * dt, rate * dt);
    return diff;
  };
  const fwd = new THREE.Vector3(Math.sin(root.rotation.y), 0, Math.cos(root.rotation.y));
  let walk = 0;
  d.jaw.rotation.x = Math.max(0, d.jaw.rotation.x - dt * 2);
  if (d.flinch > 0) { d.flinch -= dt; root.rotation.z = Math.sin(t * 30) * 0.08; }
  else root.rotation.z *= 0.9;

  ai.t -= dt;
  if (ai.state === 'dead') {
    root.rotation.z = Math.min(root.rotation.z + dt, Math.PI / 2 * 0.85);
    root.position.y = Math.max(sampleHeight(root.position.x, root.position.z) - 1, root.position.y - dt);
    return;
  }
  if (S.over) return;

  // flying states
  if (ai.state === 'fly') {
    d.flyY = Math.min(d.flyY + dt * 6, 8 + d.scale * 2);
    root.position.y = sampleHeight(root.position.x, root.position.z) + d.flyY;
    turn(wantYaw, 1.5);
    root.position.addScaledVector(fwd, 3 * dt);
    if (d.wings[0]) d.wings.forEach((w, i) => { w.rotation.z = Math.sin(t * 8) * 0.5 * (i ? 1 : -1); });
    if (Math.random() < dt * 1.2) SFX.flap();
    $('tele').textContent = '⚠ 飛行中';
    if (ai.t <= 0) { ai.state = 'wind'; ai.atk = 'dive'; ai.t = ATK.dive.wind * def.windMul; ai.hit = false; }
    animateDragonPose(d, dt, t, 0);
    return;
  }

  if (ai.state === 'idle') {
    const diff = turn(wantYaw, 1.5 * def.speed);
    const chase = (def.legs === 'quad' ? 4.2 : 3.4) + def.aggro * 2;
    if (dist > 9) { root.position.addScaledVector(fwd, chase * def.speed * dt); walk = 1; if (Math.random() < dt * 2) SFX.foot(); }
    if (ai.t <= 0) {
      const pick = pickAtk(d, dist, diff);
      ai.atk = pick; ai.lastAtk = pick;
      if (pick === 'takeoff') {
        ai.state = 'wind'; ai.t = ATK.takeoff.wind; ai.hit = false; SFX.flap();
      } else {
        ai.state = 'wind'; ai.t = ATK[pick].wind * def.windMul; ai.hit = false;
        if (pick === 'charge' || pick === 'roar') SFX.roar();
        else SFX.roar();
      }
    }
  } else if (ai.state === 'wind') {
    const A = ATK[ai.atk] || ATK.bite;
    $('tele').textContent = '⚠ ' + A.name;
    if (ai.atk === 'takeoff') {
      d.jaw.rotation.x = 0.3;
      if (ai.t <= 0) { ai.state = 'fly'; ai.t = 2.2 + Math.random() * 1.2; d.flyY = 0; }
    } else {
      if (ai.atk !== 'tail' && ai.atk !== 'slamL' && ai.atk !== 'slamR' && ai.t > A.wind * def.windMul * 0.3) turn(wantYaw, 1.6);
      if (ai.atk === 'bite') d.neck.rotation.x = -0.4;
      if (ai.atk === 'tail') { root.rotation.y -= dt * 0.3; d.tailBase.rotation.y = 0.85; }
      if (ai.atk === 'slamL') root.rotation.y -= dt * 0.5;
      if (ai.atk === 'slamR') root.rotation.y += dt * 0.5;
      if (ai.atk === 'charge') { root.position.y = sampleHeight(root.position.x, root.position.z) + Math.abs(Math.sin(t * 10)) * 0.1; d.jaw.rotation.x = 0.35; }
      if (ai.atk === 'breath') { d.neck.rotation.x = -0.55; d.jaw.rotation.x = 0.4; }
      if (ai.atk === 'dive') { d.neck.rotation.x = 0.5; }
      if (ai.t <= 0) {
        ai.state = 'act'; ai.t = A.act; ai.dir.copy(fwd);
        if (ai.atk === 'charge') SFX.stomp();
      }
    }
  } else if (ai.state === 'act') {
    const A = ATK[ai.atk] || ATK.bite;
    const hornBonus = def.horns ? 1.3 : 1;
    if (ai.atk === 'bite') {
      d.neck.rotation.x = 0.45; d.jaw.rotation.x = 0.55;
      root.position.addScaledVector(ai.dir, 5 * dt);
      const hp = worldPos(d.head);
      if (!ai.hit && flatDist(hp, player.position) < 2.6 * d.scale + 0.5) { ai.hit = true; hurtPlayer(18, hp); }
    } else if (ai.atk === 'slamL' || ai.atk === 'slamR') {
      const side = ai.atk === 'slamL' ? 1 : -1;
      root.rotation.y += side * dt * 2.2;
      root.position.addScaledVector(new THREE.Vector3(Math.cos(root.rotation.y), 0, -Math.sin(root.rotation.y)).multiplyScalar(side), 6 * dt);
      if (!ai.hit && dist < 4.5 * d.scale) { ai.hit = true; hurtPlayer(16, root.position); SFX.stomp(); }
    } else if (ai.atk === 'tail') {
      root.rotation.y += (Math.PI * 2 / A.act) * dt; d.tailBase.rotation.y = -0.5;
      const reach = (d.severed ? 5 : 9) * d.scale;
      if (!ai.hit && dist < reach && dist > 1.5) {
        const tip = worldPos(d.tailSegs[d.severed ? 1 : d.tailSegs.length - 1]);
        if (flatDist(tip, player.position) < 2.8 * d.scale) { ai.hit = true; hurtPlayer(22, root.position); }
      }
    } else if (ai.atk === 'charge') {
      const spd = 18 * def.speed * hornBonus;
      root.position.addScaledVector(ai.dir, spd * dt); walk = 2;
      if (Math.random() < dt * 4) SFX.stomp();
      if (!ai.hit && dist < 3.5 * d.scale) { ai.hit = true; hurtPlayer(28 * hornBonus, root.position); }
      const before = { x: root.position.x, z: root.position.z };
      pushOutObstacles(root.position, 2.5 * d.scale);
      if (Math.abs(root.position.x - before.x) + Math.abs(root.position.z - before.z) > 0.02) {
        ai.state = 'rec'; ai.t = 1.6; showMsg('撞石！', 0.6); SFX.stomp();
      }
    } else if (ai.atk === 'breath') {
      d.neck.rotation.x = -0.15; d.jaw.rotation.x = 0.55;
      const mouth = worldPos(d.head).addScaledVector(fwd, 1.5 * d.scale);
      if (ai.t > A.act * 0.5 && Math.random() < 0.08) {
        const elems = def.colors.map(c => COLOR_DEFS[c].elem).filter(Boolean);
        const kind = elems[Math.floor(Math.random() * elems.length)] || 'fire';
        spawnProjectile(mouth, ai.dir.clone().setY(-0.05), kind, 12);
      }
    } else if (ai.atk === 'dive') {
      d.flyY = Math.max(0, d.flyY - dt * 14);
      root.position.y = sampleHeight(root.position.x, root.position.z) + d.flyY;
      root.position.addScaledVector(ai.dir, 14 * dt);
      turn(wantYaw, 0.8);
      if (!ai.hit && d.flyY < 2.5 && dist < 4 * d.scale) { ai.hit = true; hurtPlayer(26, root.position); SFX.stomp(); }
      if (d.flyY <= 0.1) { ai.t = 0; d.flyY = 0; }
    }
    if (ai.t <= 0) {
      if (ai.atk === 'dive') { ai.state = 'rec'; ai.t = ATK.dive.rec; d.flyY = 0; }
      else { ai.state = 'rec'; ai.t = A.rec * (1.05 + (1 - def.aggro) * 0.2); }
    }
  } else if (ai.state === 'rec') {
    if (ai.atk === 'charge') root.position.addScaledVector(ai.dir, Math.max(0, ai.t) * 5 * dt);
    d.neck.rotation.x *= 0.9;
    if (ai.t <= 0) { ai.state = 'idle'; ai.t = idleCd(def); }
  }

  // arena + height (when not flying high)
  if (ai.state !== 'fly' && !(ai.state === 'act' && ai.atk === 'dive' && d.flyY > 0.5)) {
    const r = Math.hypot(root.position.x, root.position.z);
    if (r > ARENA - 4) {
      root.position.x *= (ARENA - 4) / r; root.position.z *= (ARENA - 4) / r;
      if (ai.atk === 'charge' && ai.state === 'act') { ai.state = 'rec'; ai.t = 1.4; SFX.stomp(); }
    }
    if (ai.state !== 'fly') {
      pushOutObstacles(root.position, 2.4 * d.scale);
      root.position.y = sampleHeight(root.position.x, root.position.z) + d.flyY;
    }
  }
  // body push player
  if (dist < 2.8 * d.scale && ai.state !== 'fly') {
    const push = tmp.copy(player.position).sub(root.position).setY(0);
    if (push.lengthSq() > 0.01) player.position.addScaledVector(push.normalize(), 2.8 * d.scale - dist);
  }
  animateDragonPose(d, dt, t, walk);
}

function animateDragonPose(d, dt, t, walk) {
  const breath = Math.sin(t * 2.2) * 0.04;
  d.root.scale.y = d.scale * (1 + breath);
  // head track player
  const toP = tmp.copy(player.position).sub(d.root.position);
  const localYaw = Math.atan2(toP.x, toP.z) - d.root.rotation.y;
  let ly = ((localYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  ly = THREE.MathUtils.clamp(ly, -0.6, 0.6);
  d.head.rotation.y = lerp(d.head.rotation.y, ly, 1 - Math.exp(-dt * 4));
  d.head.rotation.x = lerp(d.head.rotation.x, THREE.MathUtils.clamp(-toP.y * 0.02, -0.3, 0.3), 1 - Math.exp(-dt * 3));
  // gait
  const ph = t * (walk === 2 ? 12 : walk ? 6 : 0);
  d.legs.forEach((l, i) => {
    const biped = d.def.legs === 'biped';
    if (!walk) { l.rotation.x = lerp(l.rotation.x, 0, 1 - Math.exp(-dt * 8)); return; }
    const off = biped ? (i ? Math.PI : 0) : (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI * 0.5 : 0);
    l.rotation.x = Math.sin(ph + off) * (walk === 2 ? 0.55 : 0.4);
  });
  // wings idle / flap
  if (d.wings.length) {
    const flying = d.ai.state === 'fly' || (d.ai.state === 'act' && d.ai.atk === 'dive');
    d.wings.forEach((w, i) => {
      const base = flying ? Math.sin(t * 9) * 0.55 : Math.sin(t * 2) * 0.12;
      w.rotation.z = base * (i ? 1 : -1) + (d.ai.state === 'wind' ? (i ? 0.35 : -0.35) : 0);
    });
  }
  // tail sway
  d.tailBase.rotation.y = Math.sin(t * 1.8) * 0.22 + (d.ai.state === 'wind' && d.ai.atk === 'tail' ? 0.6 : 0);
  d.tailSegs.forEach((s, i) => { if (i) s.rotation.y = Math.sin(t * 2.2 - i * 0.5) * 0.1; });
  // neck idle
  if (d.ai.state === 'idle' || d.ai.state === 'rec') d.neck.rotation.x = lerp(d.neck.rotation.x, Math.sin(t * 1.5) * 0.08, 1 - Math.exp(-dt * 3));
}

function updateDragons(dt, t) {
  $('tele').textContent = '';
  for (const d of dragons) updateOneDragon(d, dt, t);
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.t -= dt; p.mesh.position.addScaledVector(p.v, dt); p.v.y -= 6 * dt;
    if (!p.hit && flatDist(p.mesh.position, player.position) < 1.6) {
      p.hit = true;
      const opts = { poison: p.kind === 'poison', slow: p.kind === 'lightning', dark: p.kind === 'blast' };
      hurtPlayer(p.dmg, p.mesh.position, opts);
      if (p.kind === 'blast') S.camShake = Math.max(S.camShake, 0.5);
      scene.remove(p.mesh); projectiles.splice(i, 1); continue;
    }
    if (p.t <= 0 || p.mesh.position.y < sampleHeight(p.mesh.position.x, p.mesh.position.z) - 0.5) {
      if (p.kind === 'blast' && !p.hit && flatDist(p.mesh.position, player.position) < 5) {
        hurtPlayer(p.dmg * 0.7, p.mesh.position, { dark: true });
        S.camShake = Math.max(S.camShake, 0.4);
      }
      scene.remove(p.mesh); projectiles.splice(i, 1);
    }
  }
}

function updateDebuffs(dt) {
  if (!S) return;
  if (S.debuffs.poison > 0) {
    S.debuffs.poison -= dt;
    S.hp -= 6 * dt * S.ps.def;
    if (Math.random() < dt * 2) SFX.poisonTick();
    if (S.hp <= 0 && !S.over) { S.hp = 0; S.over = true; SFX.lose(); setTimeout(() => { $('otitle').textContent = '狩獵失敗'; $('otext').textContent = '中毒身亡…'; $('over').classList.remove('hidden'); }, 800); }
  }
  if (S.debuffs.slow > 0) S.debuffs.slow -= dt;
  if (S.debuffs.dark > 0) S.debuffs.dark -= dt;
  if (S.camShake > 0) S.camShake -= dt;
}


// ---------- player update ----------
let attackHeldPrev = false, prevSwing = 0;
function attackPressed() {
  const held = !!(input.attack || pad.attack);
  const press = held && !attackHeldPrev;
  attackHeldPrev = held;
  return press;
}
function resetCombo() {
  if (!S) return;
  S.combo = 0; S.comboStep = 0; S.comboId = ''; S.atkBuf = false; S.comboWin = 0;
}
function beginComboHit(step) {
  const chain = COMBOS[run.weapon];
  const hit = chain[step];
  if (!hit || !S) return;
  S.comboStep = step; S.combo = step + 1; S.comboId = hit.id;
  S.cd = Math.max(0.05, WEAPONS[run.weapon].cd * 0.35);
  S.swing = S.swingDur = hit.dur;
  S.atkBuf = false; S.comboWin = 0;
  const nd = nearestDragon();
  if (nd) {
    const v = tmp.copy(nd.root.position).sub(player.position);
    if (v.length() < 14) player.rotation.y = Math.atan2(v.x, v.z);
  }
  doHit(hit.dmg, hit.label, hit.range / WEAPONS[run.weapon].range);
  SFX.slash();
}
function updatePlayer(dt) {
  const w = WEAPONS[run.weapon];
  const chain = COMBOS[run.weapon];
  S.cd -= dt; S.invuln -= dt; S.dodgeT -= dt; S.hurtT -= dt; S.swing -= dt;
  if (S.comboWin > 0) S.comboWin -= dt;
  const press = attackPressed();
  let mx = input.mx + pad.mx + ((keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0));
  let mz = input.mz + pad.mz + ((keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0));
  const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
  const specialHeld = input.special || pad.special;
  const cy = Math.cos(camYaw), sy = Math.sin(camYaw);
  const dir = new THREE.Vector3(-mx * cy - mz * sy, 0, mx * sy - mz * cy);
  let speed = S.ps.spd * w.speedMul * (S.debuffs.slow > 0 ? 0.75 : 1);
  if (S.charge >= 0 || S.block) speed *= 0.35;
  if (S.drinkT > 0) speed *= 0.3;
  if (S.swing > 0) speed *= 0.55;
  const tryMove = (from, moveVec, dist) => {
    const p = { x: from.x + moveVec.x * dist, z: from.z + moveVec.z * dist };
    pushOutObstacles(p, 0.7);
    let rr = Math.hypot(p.x, p.z); if (rr > ARENA) { p.x *= ARENA / rr; p.z *= ARENA / rr; }
    const h0 = sampleHeight(from.x, from.z), h1 = sampleHeight(p.x, p.z);
    if (h1 - h0 > 1.35) return { x: from.x, z: from.z };
    return p;
  };
  if (S.dodgeT > 0) {
    const p = tryMove(player.position, S.dodgeDir, ROLL_DIST / ROLL_T * dt);
    player.position.x = p.x; player.position.z = p.z;
  } else if (dir.lengthSq() > 0.01 && S.hurtT <= 0) {
    const p = tryMove(player.position, dir, speed * dt);
    player.position.x = p.x; player.position.z = p.z;
    S.moveAmt = Math.min(1, dir.length()) * speed;
    if (S.swing <= 0) player.rotation.y = Math.atan2(dir.x, dir.z);
  } else S.moveAmt = 0;
  player.position.y = sampleHeight(player.position.x, player.position.z);
  if (input.dodge) {
    input.dodge = false;
    if (S.st >= 25 && S.dodgeT <= 0 && S.hurtT <= 0) {
      S.st -= 25; S.dodgeT = ROLL_T; S.invuln = 0.38;
      S.dodgeDir = dir.lengthSq() > 0.01 ? dir.clone().normalize() : new THREE.Vector3(Math.sin(player.rotation.y), 0, Math.cos(player.rotation.y));
      player.rotation.y = Math.atan2(S.dodgeDir.x, S.dodgeDir.z);
      SFX.roll(); S.charge = -1; S.swing = 0; S.drinkT = 0; resetCombo();
    }
  }
  if (S.dodgeT > 0 || dir.lengthSq() <= 0.01 || S.hurtT > 0) S.moveAmt = 0;
  if (input.potion) { input.potion = false; if (S.potions > 0 && S.drinkT <= 0 && S.hp < S.ps.maxHp) { S.potions--; S.drinkT = 1.0; SFX.potion(); resetCombo(); } }
  if (S.drinkT > 0) { S.drinkT -= dt; S.hp = Math.min(S.ps.maxHp, S.hp + S.ps.maxHp * 0.4 * dt); }
  const faceDragon = () => { const nd = nearestDragon(); if (!nd) return; const v = tmp.copy(nd.root.position).sub(player.position); if (v.length() < 14) player.rotation.y = Math.atan2(v.x, v.z); };
  S.block = false;
  if (run.weapon === 'gs') {
    if (specialHeld && S.cd <= 0 && S.swing <= 0) { if (S.charge < 0) { S.charge = 0; faceDragon(); resetCombo(); } S.charge = Math.min(1.6, S.charge + dt); }
    else if (S.charge >= 0) { const c = S.charge; S.charge = -1; S.cd = w.cd * 1.3; S.swing = S.swingDur = 0.55; S.comboId = 'charge'; doHit(1 + c * 1.6, c > 1.2 ? '蓄力斬！' : null); resetCombo(); }
  } else if (run.weapon === 'ss') {
    if (specialHeld && S.st > 0 && S.swing <= 0) { S.block = true; S.st -= 8 * dt; if (S.combo > 0) resetCombo(); }
  } else if (run.weapon === 'db') {
    if (specialHeld && S.st > 5 && S.cd <= 0 && S.swing <= 0) { faceDragon(); S.st -= 6; S.cd = 0.1; S.swing = S.swingDur = 0.3; S.comboId = 'demon'; doHit(0.9, null); resetCombo(); }
  }

  // --- combo input ---
  if (S.swing > 0 && press && (S.swing / S.swingDur) <= COMBO_LINK) S.atkBuf = true;
  // swing ended this frame
  if (prevSwing > 0 && S.swing <= 0) {
    if (S.atkBuf && S.comboStep + 1 < chain.length) beginComboHit(S.comboStep + 1);
    else if (S.comboStep + 1 < chain.length) S.comboWin = COMBO_BUFFER;
    else resetCombo();
  }
  prevSwing = Math.max(0, S.swing);
  // buffer window after swing
  if (S.comboWin > 0 && press && S.dodgeT <= 0 && S.drinkT <= 0 && S.charge < 0 && !S.block) {
    if (S.comboStep + 1 < chain.length) beginComboHit(S.comboStep + 1);
    else resetCombo();
  } else if (S.combo > 0 && S.swing <= 0 && S.comboWin <= 0 && !S.atkBuf) {
    resetCombo();
  }
  // fresh chain
  if (press && S.swing <= 0 && S.comboWin <= 0 && S.dodgeT <= 0 && S.cd <= 0 && S.drinkT <= 0 && S.charge < 0 && !S.block && S.combo === 0) {
    beginComboHit(0);
  }

  if (!specialHeld && !S.block && S.dodgeT <= 0 && S.charge < 0) S.st = Math.min(S.ps.maxSt, S.st + 28 * dt);
  animatePlayer(dt);
  pBody.material.emissive.setHex(S.invuln > 0 && S.hurtT > 0 ? 0x553333 : S.drinkT > 0 ? 0x335533 : 0);
}

const ROLL_T = 0.5, ROLL_DIST = 11.5; // ~1.8× prior distance to match faster walk
const lerp = THREE.MathUtils.lerp;
let walkPh = 0;
function animatePlayer(dt) {
  const wpn = run.weapon, move = S.moveAmt || 0;
  walkPh += dt * (4 + move * 1.3);
  const stride = Math.min(1, move / 6);
  const sw = Math.sin(walkPh);
  // base pose: walk/run cycle
  const pose = {
    hipL: sw * 0.9 * stride, hipR: -sw * 0.9 * stride,
    knL: Math.max(0, -Math.cos(walkPh)) * 1.2 * stride + 0.05, knR: Math.max(0, Math.cos(walkPh)) * 1.2 * stride + 0.05,
    shR: [-sw * 0.6 * stride - 0.2, 0, 0.15], shL: [sw * 0.6 * stride - 0.2, 0, -0.15],
    elR: -0.4, elL: -0.4, handR: [0, 0, 0], handL: [0, 0, 0],
    torso: [0.15 * stride, 0, 0], bob: Math.abs(Math.cos(walkPh)) * 0.08 * stride, rigX: 0,
  };
  if (wpn === 'gs') { pose.shR = [-0.5, 0.2, -0.5]; pose.shL = [-0.6, -0.3, 0.6]; pose.elR = -1.2; pose.elL = -1.3; pose.handR = [0.4, 0, 0]; }
  if (S.block) { pose.shL = [-1.5, 0, 0.3]; pose.elL = -1.4; pose.handL = [0, -1.3, 0]; pose.torso = [0.1, 0.25, 0]; pose.hipL = -0.4; pose.knL = 0.5; pose.hipR = 0.3; pose.knR = 0.3; }
  if (S.charge >= 0) { // great sword charge: blade overhead, wobbling as it fills
    const q = Math.min(1, S.charge / 1.6), shake = q > 0.95 ? Math.sin(performance.now() / 25) * 0.05 : 0;
    pose.shR = [-2.9 - q * 0.2 + shake, 0, -0.35]; pose.shL = [-2.9 - q * 0.2 + shake, 0, 0.35]; pose.elR = pose.elL = -0.3; pose.handR = [1.2, 0, 0];
    pose.torso = [-0.25 * q, 0, 0]; pose.hipL = -0.5; pose.knL = 0.6; pose.hipR = 0.4; pose.knR = 0.2;
  }
  if (S.swing > 0) {
    const p = 1 - S.swing / Math.max(0.001, S.swingDur);
    const e = p < 0.35 ? p / 0.35 : 1;
    const id = S.comboId || '';
    if (wpn === 'gs' || id === 'charge') {
      if (id === 'side') {
        pose.shR = [-1.2, 0, lerp(1.8, -1.4, e)]; pose.shL = [-0.8, 0, 0.4]; pose.elR = -0.3; pose.elL = -0.8;
        pose.torso = [0.15, lerp(0.7, -0.7, e), 0]; pose.hipL = -0.4; pose.knL = 0.5; pose.hipR = 0.35;
      } else if (id === 'slam') {
        const wind = Math.min(1, p / 0.22), down = THREE.MathUtils.smoothstep(p, 0.2, 0.5);
        const a = lerp(lerp(-0.4, -3.1, wind), 0.55, down);
        pose.shR = [a, 0, -0.5]; pose.shL = [a, 0, 0.5]; pose.elR = pose.elL = -0.2; pose.handR = [lerp(1.3, 0.3, down), 0, 0];
        pose.torso = [lerp(-0.4, 0.85, down), 0, 0]; pose.hipL = -0.9 * down; pose.knL = 1.2 * down; pose.hipR = 0.6 * down; pose.bob = -0.35 * down;
      } else { // overhead / charge release
        const wind = Math.min(1, p / 0.25), down = THREE.MathUtils.smoothstep(p, 0.2, 0.45);
        const a = lerp(lerp(-0.5, -3.0, wind), 0.2, down);
        pose.shR = [a, 0, -0.35]; pose.shL = [a, 0, 0.35]; pose.elR = pose.elL = -0.25; pose.handR = [lerp(1.2, 0.5, down), 0, 0];
        pose.torso = [lerp(-0.3, 0.6, down), 0, 0]; pose.hipL = -0.7 * down; pose.knL = 1.0 * down; pose.hipR = 0.5 * down; pose.knR = 0.4 * down; pose.bob = -0.25 * down;
      }
    } else if (wpn === 'ss') {
      if (id === 'back') { pose.shR = [-1.4, 0, lerp(-0.5, 1.5, e)]; pose.torso = [0.1, lerp(-0.5, 0.55, e), 0]; }
      else if (id === 'bash') { pose.shL = [-1.6, 0, lerp(0.2, 1.2, e)]; pose.elL = -0.4; pose.handL = [0, -0.8, 0]; pose.shR = [-0.8, 0, -0.3]; pose.torso = [0.2, 0.3, 0]; pose.hipL = -0.6; pose.knL = 0.7; }
      else if (id === 'rising') { pose.shR = [lerp(-2.6, -0.2, e), 0, lerp(-0.2, 1.2, e)]; pose.shL = [-1.0, 0, 0.4]; pose.torso = [lerp(-0.2, 0.45, e), e * Math.PI * 1.2, 0]; pose.bob = Math.sin(e * Math.PI) * 0.25; }
      else { pose.shR = [-1.4, 0, lerp(1.6, -0.3, e)]; pose.torso = [0.1, lerp(0.5, -0.5, e), 0]; }
      pose.elR = pose.elR ?? -0.2; if (id !== 'bash') { pose.elR = -0.2; pose.hipL = -0.5; pose.knL = 0.5; pose.hipR = 0.3; if (!S.block) { pose.shL = pose.shL || [-0.9, 0, 0.3]; pose.elL = -1.0; } }
    } else {
      if (id === 'cross') {
        pose.shR = [-1.3, 0, lerp(1.5, -1.2, e)]; pose.shL = [-1.3, 0, lerp(-1.5, 1.2, e)];
        pose.elR = pose.elL = -0.15; pose.torso = [0.15, 0, 0];
      } else if (id === 'flurry') {
        pose.shR = [-1.3, 0, 1.3 - Math.sin(p * Math.PI * 3) * 0.5]; pose.shL = [-1.3, 0, -1.3 + Math.sin(p * Math.PI * 3) * 0.5];
        pose.elR = pose.elL = -0.1; pose.torso = [0.25, p * Math.PI * 3, 0.2]; pose.hipL = -0.35; pose.knL = 0.45; pose.hipR = 0.35; pose.knR = 0.45;
      } else if (id === 'finisher') {
        pose.shR = [-1.5, 0, lerp(1.6, -1.6, e)]; pose.shL = [-1.5, 0, lerp(-1.6, 1.6, e)];
        pose.elR = pose.elL = -0.05; pose.torso = [0.3, e * Math.PI * 2.2, 0.25]; pose.bob = Math.sin(e * Math.PI) * 0.2;
      } else { // double slash
        pose.shR = [-1.1, 0, lerp(1.2, -0.4, e)]; pose.shL = [-1.1, 0, lerp(-0.3, 1.1, e)];
        pose.elR = pose.elL = -0.2; pose.torso = [0.15, lerp(0.3, -0.3, e), 0];
      }
      pose.handR = [0.25, 0, 0]; pose.handL = [0.25, 0, 0];
    }
  }
  if (S.drinkT > 0) { pose.shR = [-2.2, 0, -0.6]; pose.elR = -1.9; pose.torso = [-0.3, 0, 0]; }
  if (S.hurtT > 0) { pose.torso = [-0.5, 0, 0]; pose.shR[0] -= 0.6; pose.shL[0] -= 0.6; }
  if (S.dodgeT > 0) { // forward roll: tuck and spin the whole rig around the hips
    const p = 1 - S.dodgeT / ROLL_T;
    pose.rigX = p * Math.PI * 2; pose.bob = -Math.sin(p * Math.PI) * 0.45;
    pose.hipL = pose.hipR = -1.9; pose.knL = pose.knR = 2.2; pose.torso = [0.7, 0, 0];
    pose.shR = [-1.0, 0, 0.3]; pose.shL = [-1.0, 0, -0.3]; pose.elR = pose.elL = -1.6;
  }
  const k = 1 - Math.exp(-dt * 22), sk = (o, v) => { o.x = lerp(o.x, v[0], k); o.y = lerp(o.y, v[1], k); o.z = lerp(o.z, v[2], k); };
  LL.hip.rotation.x = lerp(LL.hip.rotation.x, pose.hipL, k); LR.hip.rotation.x = lerp(LR.hip.rotation.x, pose.hipR, k);
  LL.kn.rotation.x = lerp(LL.kn.rotation.x, pose.knL, k); LR.kn.rotation.x = lerp(LR.kn.rotation.x, pose.knR, k);
  sk(R.sh.rotation, pose.shR); sk(L.sh.rotation, pose.shL);
  R.el.rotation.x = lerp(R.el.rotation.x, pose.elR, k); L.el.rotation.x = lerp(L.el.rotation.x, pose.elL, k);
  sk(R.hand.rotation, pose.handR); sk(L.hand.rotation, pose.handL);
  // spin and roll are set directly so they don't lag behind the motion
  const spinning = S.swing > 0 && (S.comboId === 'flurry' || S.comboId === 'finisher' || S.comboId === 'rising');
  torso.rotation.x = lerp(torso.rotation.x, pose.torso[0], k); torso.rotation.z = lerp(torso.rotation.z, pose.torso[2], k);
  torso.rotation.y = spinning ? pose.torso[1] : lerp(torso.rotation.y, pose.torso[1], k);
  rig.rotation.x = pose.rigX;
  rig.position.y = 1.0 + (S.dodgeT > 0 ? pose.bob : lerp(rig.position.y - 1.0, pose.bob, k));
}



// ---------- loop ----------
const clock = new THREE.Clock();
let time = 0;
function hud() {
  if (!S) return;
  $('php').style.width = (S.hp / S.ps.maxHp * 100) + '%';
  $('pst').style.width = (S.st / S.ps.maxSt * 100) + '%';
  const alive = livingDragons();
  const focus = nearestDragon() || dragons[0];
  if (focus) {
    const totalMax = dragons.reduce((a, d) => a + d.maxHp, 0);
    const totalHp = dragons.reduce((a, d) => a + Math.max(0, d.hp), 0);
    $('dhp').style.width = (totalHp / totalMax * 100) + '%';
    $('tail').textContent = focus.severed ? '尾：已斷' : `尾：${Math.ceil(Math.max(0, focus.tailHp) / (focus.maxHp * 0.22) * 100)}%`;
  }
  let pot = `藥水 ×${S.potions}`;
  if (S.charge >= 0) pot += ` · 蓄力`;
  else if (S.combo > 1) pot += ` · 連擊 ${S.combo}`;
  $('pot').textContent = pot;
  // debuff icons
  const db = $('debuffs');
  if (db) {
    const bits = [];
    if (S.debuffs.poison > 0) bits.push(`<div class="db" style="color:#8d8">毒 ${S.debuffs.poison.toFixed(1)}s</div>`);
    if (S.debuffs.slow > 0) bits.push(`<div class="db" style="color:#8cf">緩 ${S.debuffs.slow.toFixed(1)}s</div>`);
    if (S.debuffs.dark > 0) bits.push(`<div class="db" style="color:#ccc">暗 ${S.debuffs.dark.toFixed(1)}s</div>`);
    db.innerHTML = bits.join('');
  }
  const vig = $('vignette');
  if (vig) vig.style.opacity = S.debuffs.dark > 0 ? '0.55' : '0';
}
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05); time += dt;
  pollGamepad(dt);
  if (S) {
    if (!S.over) {
      if (S.introT > 0) S.introT -= dt;
      else { updateDragons(dt, time); updateProjectiles(dt); }
      updatePlayer(dt);
      updateDebuffs(dt);
    } else {
      updateDragons(dt, time);
    }
  } else if (titleDragon) {
    titleDragon.root.rotation.y += dt * 0.2;
    animateDragonPose(titleDragon, dt, time, 0);
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i]; e.t -= dt; e.obj.position.addScaledVector(e.v, dt);
    if (e.grow) e.obj.scale.multiplyScalar(1 + dt * 2.5); else e.v.y -= 15 * dt;
    e.obj.material.opacity = Math.max(0, e.t * 1.5);
    if (e.t <= 0) { scene.remove(e.obj); effects.splice(i, 1); }
  }
  scene.children.forEach(o => {
    if (o.userData.severed && o.position.y > 0.6) {
      o.userData.vy -= 20 * dt; o.position.y = Math.max(0.6, o.position.y + o.userData.vy * dt);
      o.rotation.y += o.userData.spin * dt;
      if (o.position.y <= 0.6) o.rotation.set(0, o.rotation.y, 0);
    }
  });
  // camera
  const target = S ? player.position : new THREE.Vector3(0, 0, 10);
  if (!S) camYaw += dt * 0.15;
  const big = S && dragons.length ? Math.max(...dragons.map(d => d.def.size)) : 2;
  const dist = 10 + Math.max(0, big - 1.5) * 2.2;
  const lookY = target.y + 2.2 + Math.max(0, big - 2) * 0.4;
  let shakeX = 0, shakeY = 0;
  if (S && S.camShake > 0) { shakeX = (Math.random() - 0.5) * S.camShake * 0.8; shakeY = (Math.random() - 0.5) * S.camShake * 0.5; }
  camera.position.set(
    target.x - Math.sin(camYaw) * dist * Math.cos(camPitch) + shakeX,
    lookY + Math.sin(camPitch) * dist * 0.85 + shakeY,
    target.z - Math.cos(camYaw) * dist * Math.cos(camPitch)
  );
  camera.lookAt(target.x, lookY, target.z);
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('msg').textContent = ''; }
  hud();
  if (hasWebGL && pixelRT) {
    renderer.setRenderTarget(pixelRT); renderer.clear(); renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.clear(); renderer.render(blitScene, blitCam);
  } else renderer.render(scene, camera);
}
spawnTitleDragon();
frame();
window.__hunt = {
  run, get S() { return S; }, player, get dragons() { return dragons; }, get living() { return livingDragons(); },
  startFight, showPreview, generateEncounter, generateDragon, playerPower, estimatePower,
  pad, pollGamepad, COMBOS, sampleHeight, OBSTACLES, COLOR_DEFS, SFX, nearestDragon, beginComboHit, resetCombo, PIXEL_SCALE, pStats,
  goTitle, spawnTitleDragon,
};
