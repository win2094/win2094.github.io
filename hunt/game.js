import * as THREE from 'three';

const $ = id => document.getElementById(id);
const ARENA = 38;

const WEAPONS = {
  gs: { name: '大劍', dmg: 42, cd: 0.7, range: 4.4, speedMul: 0.82, col: 0xb8bcc4, canBlock: true },
  ss: { name: '單手劍', dmg: 15, cd: 0.2, range: 3.1, speedMul: 1.0, col: 0xc8ced4, canBlock: true },
  db: { name: '雙刀', dmg: 8, cd: 0.08, range: 2.9, speedMul: 1.18, col: 0xd0c090, canBlock: false },
};
// Branching combos: 斬=A · 技=S
// Routes: AAA · AAS(斬斬技) · ASAA(斬技斬斬) · ASSA(斬技技斬)
const COMBO_TREE = {
  gs: {
    A:    { id: 'overhead', dmg: 1.05, range: 4.4, dur: 0.95, label: null },
    AA:   { id: 'side', dmg: 1.2, range: 4.9, dur: 0.85, label: '橫斬' },
    AAA:  { id: 'slam', dmg: 1.75, range: 5.4, dur: 1.12, label: '廣域砸！' },
    AAS:  { id: 'crush', dmg: 2.05, range: 5.7, dur: 1.18, label: '崩山斬！' }, // 斬斬技
    AS:   { id: 'guardCut', dmg: 1.25, range: 4.5, dur: 0.72, label: '格斬' },
    ASA:  { id: 'wide', dmg: 1.4, range: 5.1, dur: 0.82, label: '迴斬' },
    ASAA: { id: 'trueCharge', dmg: 2.25, range: 5.9, dur: 1.08, label: '真蓄力！' }, // 斬技斬斬
    ASS:  { id: 'spinPrep', dmg: 1.35, range: 4.8, dur: 0.7, label: '迴勢' },
    ASSA: { id: 'whirl', dmg: 2.15, range: 5.6, dur: 1.05, label: '大迴旋！' }, // 斬技技斬
  },
  ss: {
    A:    { id: 'slash', dmg: 1.0, range: 3.1, dur: 0.36, label: null },
    AA:   { id: 'back', dmg: 1.08, range: 3.25, dur: 0.38, label: '回斬' },
    AAA:  { id: 'bash', dmg: 1.25, range: 2.95, dur: 0.42, label: '盾擊' },
    AAAA: { id: 'rising', dmg: 1.55, range: 3.55, dur: 0.55, label: '迴旋斬！' },
    AAS:  { id: 'shieldBurst', dmg: 1.7, range: 3.4, dur: 0.5, label: '盾爆！' }, // 斬斬技
    AS:   { id: 'advSlash', dmg: 1.15, range: 3.2, dur: 0.34, label: '踏斬' },
    ASA:  { id: 'twist', dmg: 1.2, range: 3.3, dur: 0.36, label: '絞斬' },
    ASAA: { id: 'flourish', dmg: 1.85, range: 3.7, dur: 0.56, label: '華麗斬！' }, // 斬技斬斬
    ASS:  { id: 'bashSpin', dmg: 1.3, range: 3.1, dur: 0.4, label: '盾旋' },
    ASSA: { id: 'vault', dmg: 1.9, range: 3.8, dur: 0.58, label: '躍斬！' }, // 斬技技斬
  },
  db: {
    A:    { id: 'double', dmg: 0.95, range: 2.9, dur: 0.17, label: null },
    AA:   { id: 'cross', dmg: 1.1, range: 3.1, dur: 0.19, label: null },
    AAA:  { id: 'flurry', dmg: 1.35, range: 3.35, dur: 0.3, label: '亂舞' },
    AAAA: { id: 'finisher', dmg: 1.7, range: 3.65, dur: 0.38, label: '終結！' },
    AAS:  { id: 'bladeStorm', dmg: 1.85, range: 3.8, dur: 0.42, label: '刃嵐！' }, // 斬斬技
    AS:   { id: 'hex', dmg: 1.15, range: 3.15, dur: 0.2, label: '交叉' },
    ASA:  { id: 'rush', dmg: 1.25, range: 3.3, dur: 0.22, label: '突進' },
    ASAA: { id: 'razor', dmg: 1.95, range: 3.9, dur: 0.4, label: '剃刀！' }, // 斬技斬斬
    ASS:  { id: 'spiral', dmg: 1.4, range: 3.4, dur: 0.28, label: '螺旋' },
    ASSA: { id: 'tempest', dmg: 2.05, range: 4.0, dur: 0.44, label: '嵐斬！' }, // 斬技技斬
  },
};
// legacy linear view for debug / HUD
const COMBOS = Object.fromEntries(Object.entries(COMBO_TREE).map(([w, tree]) => {
  const linear = [];
  let r = 'A';
  while (tree[r]) { linear.push(tree[r]); r += 'A'; }
  return [w, linear];
}));
const COMBO_BUFFER = 0.36; // after swing ends, still chainable
const COMBO_LINK = 0.55;   // fraction of swing remaining when buffer opens
const DB_ATK_BUFF_T = 5;   // dual blades: +ATK window after landing a hit
const DB_ATK_BUFF_MUL = 1.4;
function comboHasBranch(route, ch) {
  return !!(COMBO_TREE[run.weapon] && COMBO_TREE[run.weapon][route + ch]);
}

// ---------- persistent run state ----------
const run = { weapon: 'gs', fight: 0, pts: 0, stats: { hp: 0, atk: 0, def: 0, sta: 0, spd: 0 } };
const STAT_NAMES = { hp: '體力', atk: '攻擊', def: '防禦', sta: '耐力', spd: '速度' };

// ---------- three setup (pixel-art 3D: low-res RT + nearest upscale) ----------
// between old 1/4 and recent 1/2 — readable chunk, not mushy
function pixelScaleFor(w, h) {
  const m = Math.min(w, h);
  if (m < 420) return 3.0;
  if (m < 720) return 2.75;
  return 2.5;
}
let PIXEL_SCALE = 2.5;
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
  PIXEL_SCALE = pixelScaleFor(w, h);
  const pw = Math.max(160, Math.floor(w / PIXEL_SCALE));
  const ph = Math.max(100, Math.floor(h / PIXEL_SCALE));
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

const obstacleMeshes = []; // for camera fade (each gets its own material)
for (const o of OBSTACLES) {
  const baseCol = o.kind === 'rock' ? 0x6e675c : 0x756b5e;
  const mat = new THREE.MeshLambertMaterial({ color: baseCol, flatShading: true, transparent: true, opacity: 1 });
  o._mat = mat;
  o._baseOpacity = 1;
  o._fade = 0;
  const parts = [];
  if (o.kind === 'rock') {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.85, o.r, o.h, 6), mat);
    mesh.position.set(o.x, sampleHeight(o.x, o.z) + o.h * 0.5, o.z);
    scene.add(mesh); parts.push(mesh);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(o.r * 1.2, o.r * 0.7, o.r * 1.2), mat);
    cap.position.set(o.x, sampleHeight(o.x, o.z) + o.h * 0.85, o.z);
    scene.add(cap); parts.push(cap);
  } else {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.r * 2), mat);
    mesh.position.set(o.x, sampleHeight(o.x, o.z) + o.h * 0.5, o.z);
    mesh.rotation.y = o.yaw;
    scene.add(mesh); parts.push(mesh);
  }
  o._meshes = parts;
  obstacleMeshes.push(...parts);
}


// ---------- player ----------
const player = new THREE.Group();
const armorMat = std(0x406080), skinMat = std(0xe0b090), leatherMat = std(0x5a3a22), metalMat = std(0x8890a0);
[armorMat, skinMat, leatherMat, metalMat].forEach(m => { m.emissive = new THREE.Color(0x000000); m.emissiveIntensity = 1; });
const playerFlashMats = [
  { m: armorMat, base: 0x406080 },
  { m: skinMat, base: 0xe0b090 },
  { m: leatherMat, base: 0x5a3a22 },
  { m: metalMat, base: 0x8890a0 },
];
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

// ---------- audio (SFX + procedural BGM, mute-aware) ----------
let actx = null, muted = false, bgmMuted = false, audioReady = false;
const BGM_VOL = 0.28;
let bgmMaster = null, bgmMode = 'off', bgmNext = 0, bgmStep = 0, bgmIntense = false;
let victoryUntil = 0;

function ensureAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    if (!bgmMaster) {
      bgmMaster = actx.createGain();
      bgmMaster.gain.value = 0;
      bgmMaster.connect(actx.destination);
      applyBgmGain(true);
    }
    audioReady = true;
  } catch (e) { }
}
function unlockAudio() {
  ensureAudio();
  if (audioReady && bgmMode === 'off') BGM.menu();
}
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  addEventListener(ev, unlockAudio, { once: true, capture: true })
);

function applyBgmGain(instant = false) {
  if (!bgmMaster || !actx) return;
  const v = (muted || bgmMuted || bgmMode === 'off') ? 0 : BGM_VOL;
  const t = actx.currentTime;
  bgmMaster.gain.cancelScheduledValues(t);
  if (instant) bgmMaster.gain.setValueAtTime(v, t);
  else { bgmMaster.gain.setValueAtTime(bgmMaster.gain.value, t); bgmMaster.gain.linearRampToValueAtTime(v, t + 0.35); }
}
function refreshMuteUI() {
  $('mute').textContent = muted ? '🔇 靜' : '🔊 聲';
  $('bgm').textContent = bgmMuted ? '🎵 關' : '🎵 樂';
}
$('mute').onclick = () => { muted = !muted; refreshMuteUI(); applyBgmGain(); ensureAudio(); };
$('bgm').onclick = () => { bgmMuted = !bgmMuted; refreshMuteUI(); applyBgmGain(); ensureAudio(); if (!bgmMuted && bgmMode === 'off') BGM.menu(); };

function snd(freq, dur = 0.12, type = 'square', vol = 0.15, slide = 0) {
  if (muted) return;
  try {
    ensureAudio();
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
    ensureAudio();
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
  hitLight: () => { snd(220, 0.07, 'square', 0.1, 120); noiseBurst(0.04, 0.06, 450); },
  hitHeavy: () => { snd(110, 0.16, 'sawtooth', 0.16, -40); snd(180, 0.1, 'square', 0.1); noiseBurst(0.1, 0.12, 220); },
  hitSever: () => { snd(90, 0.22, 'sawtooth', 0.18, -50); snd(320, 0.12, 'square', 0.1, 200); noiseBurst(0.14, 0.14, 180); },
  painRoar: () => { snd(55, 0.45, 'sawtooth', 0.2, -25); snd(80, 0.35, 'square', 0.1, 30); noiseBurst(0.2, 0.1, 90); },
  enrage: () => { snd(60, 0.7, 'sawtooth', 0.22, 40); snd(100, 0.5, 'square', 0.12, -20); noiseBurst(0.25, 0.12, 140); },
  pinRoar: () => { snd(48, 0.85, 'sawtooth', 0.26, 35); snd(70, 0.7, 'square', 0.16, -20); snd(110, 0.45, 'sawtooth', 0.12, 60); noiseBurst(0.35, 0.16, 100); },
  roll: () => snd(500, 0.08, 'triangle', 0.06, -200),
  roar: () => { snd(70, 0.55, 'sawtooth', 0.18, -30); snd(90, 0.4, 'square', 0.08, 40); },
  stomp: () => { snd(55, 0.15, 'sine', 0.16, -20); noiseBurst(0.08, 0.1, 120); },
  flap: () => snd(180, 0.12, 'triangle', 0.05, -80),
  windBlast: () => { noiseBurst(0.35, 0.18, 160); snd(140, 0.28, 'triangle', 0.12, -90); snd(90, 0.22, 'sine', 0.1, -40); },
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

// MH-style hunting BGM: taiko/drums + low brass ostinato + heroic melody; calmer menu loop
const NOTE = { C2: 65.41, D2: 73.42, E2: 82.41, F2: 87.31, G2: 98.00, A2: 110, Bb2: 116.54, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196, A3: 220, Bb3: 233.08, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, Bb4: 466.16, C5: 523.25 };
function bgmTone(freq, when, dur, type, vol, dest) {
  if (!actx || !freq) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(vol, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.05, dur));
  o.connect(g).connect(dest); o.start(when); o.stop(when + dur + 0.05);
}
function bgmDrum(when, kind, dest) {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  const f0 = kind === 'taiko' ? 90 : kind === 'tom' ? 140 : 55;
  o.type = 'sine'; o.frequency.setValueAtTime(f0, when);
  o.frequency.exponentialRampToValueAtTime(35, when + (kind === 'taiko' ? 0.22 : 0.12));
  g.gain.setValueAtTime(kind === 'taiko' ? 0.55 : 0.35, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + (kind === 'taiko' ? 0.28 : 0.14));
  o.connect(g).connect(dest);
  o.start(when); o.stop(when + 0.35);
  // noise snap
  const n = actx.createBuffer(1, actx.sampleRate * 0.08, actx.sampleRate);
  const d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / d.length * 8);
  const src = actx.createBufferSource(), f = actx.createBiquadFilter(), ng = actx.createGain();
  f.type = 'lowpass'; f.frequency.value = kind === 'taiko' ? 400 : 800;
  ng.gain.setValueAtTime(kind === 'taiko' ? 0.22 : 0.12, when);
  ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.08);
  src.buffer = n; src.connect(f).connect(ng).connect(dest); src.start(when);
}
function scheduleBgmBar(when, mode, intense) {
  if (!bgmMaster || muted || bgmMuted) return;
  const bus = bgmMaster;
  if (mode === 'menu') {
    const beat = 0.55;
    const pad = [NOTE.C3, NOTE.G3, NOTE.Bb3, NOTE.F3];
    for (let i = 0; i < 4; i++) {
      const t = when + i * beat;
      bgmTone(pad[i], t, beat * 1.1, 'triangle', 0.07, bus);
      bgmTone(pad[i] * 0.5, t, beat * 1.1, 'sine', 0.05, bus);
      if (i % 2 === 0) bgmDrum(t, 'soft', bus);
    }
    const mel = [NOTE.G4, 0, NOTE.F4, NOTE.D4, NOTE.C4, 0, NOTE.Bb3, NOTE.C4];
    mel.forEach((f, i) => { if (f) bgmTone(f, when + i * beat * 0.5, beat * 0.45, 'sine', 0.06, bus); });
    return 4 * beat;
  }
  if (mode === 'victory') {
    const notes = [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5, NOTE.G4, NOTE.C5];
    notes.forEach((f, i) => {
      const t = when + i * 0.18;
      bgmTone(f, t, 0.35, 'square', 0.12, bus);
      bgmTone(f * 0.5, t, 0.4, 'triangle', 0.08, bus);
    });
    bgmDrum(when, 'taiko', bus); bgmDrum(when + 0.36, 'taiko', bus);
    return 1.4;
  }
  // battle / intense — driving hunting theme
  const bpm = intense ? 148 : 118;
  const beat = 60 / bpm;
  const bars = 2;
  // taiko pattern
  for (let b = 0; b < bars * 4; b++) {
    const t = when + b * beat;
    if (b % 4 === 0) bgmDrum(t, 'taiko', bus);
    else if (b % 4 === 2) bgmDrum(t, 'tom', bus);
    else if (intense && (b % 4 === 1 || b % 4 === 3)) bgmDrum(t + beat * 0.5, 'soft', bus);
    if (intense && b % 2 === 0) bgmDrum(t + beat * 0.5, 'tom', bus);
  }
  // low brass ostinato
  const ost = intense
    ? [NOTE.C2, NOTE.C2, NOTE.G2, NOTE.Bb2, NOTE.C2, 155.56, NOTE.F2, NOTE.G2]
    : [NOTE.C2, NOTE.C2, NOTE.G2, NOTE.G2, NOTE.Bb2, NOTE.Bb2, NOTE.F2, NOTE.F2];
  ost.forEach((f, i) => {
    const t = when + i * beat;
    bgmTone(f, t, beat * 0.95, 'sawtooth', intense ? 0.1 : 0.07, bus);
    bgmTone(f * 1.5, t, beat * 0.9, 'triangle', intense ? 0.05 : 0.035, bus);
  });
  // heroic melody (C minor hunting rise)
  const mel = intense
    ? [NOTE.C4, 311.13, NOTE.G4, NOTE.Bb4, NOTE.G4, NOTE.F4, 311.13, NOTE.C4,
      NOTE.D4, NOTE.F4, NOTE.G4, NOTE.Bb4, NOTE.C5, NOTE.Bb4, NOTE.G4, NOTE.F4]
    : [NOTE.C4, 0, NOTE.G4, 0, NOTE.Bb4, NOTE.G4, NOTE.F4, 0,
      311.13, NOTE.F4, NOTE.G4, 0, NOTE.Bb3, NOTE.C4, NOTE.D4, 311.13];
  mel.forEach((f, i) => {
    if (!f) return;
    const t = when + i * (beat * 0.5);
    bgmTone(f, t, beat * 0.42, 'square', intense ? 0.09 : 0.065, bus);
    bgmTone(f * 2, t, beat * 0.3, 'triangle', 0.03, bus);
  });
  if (intense) {
    bgmTone(NOTE.G4, when, bars * 4 * beat, 'sine', 0.025, bus);
    bgmTone(NOTE.C5, when + beat * 2, bars * 2 * beat, 'sine', 0.02, bus);
  }
  return bars * 4 * beat;
}
function tickBgm() {
  if (!audioReady || !actx || !bgmMaster) return;
  if (bgmMode === 'off' || muted || bgmMuted) return;
  const now = actx.currentTime;
  if (bgmMode === 'victory' && victoryUntil && now > victoryUntil) {
    BGM.menu();
    return;
  }
  if (now + 0.15 < bgmNext) return;
  const mode = bgmMode === 'battle' && bgmIntense ? 'intense' : bgmMode;
  const dur = scheduleBgmBar(Math.max(now + 0.05, bgmNext), mode === 'intense' ? 'battle' : mode, mode === 'intense' || bgmIntense);
  bgmNext = Math.max(now + 0.05, bgmNext) + (dur || 1);
  bgmStep++;
}
const BGM = {
  set(mode) {
    ensureAudio();
    if (!audioReady) return;
    if (mode === bgmMode && mode !== 'victory') return;
    bgmMode = mode;
    bgmNext = actx ? actx.currentTime + 0.05 : 0;
    bgmStep = 0;
    if (mode === 'victory') victoryUntil = (actx?.currentTime || 0) + 2.2;
    else victoryUntil = 0;
    applyBgmGain();
    tickBgm();
  },
  menu() { bgmIntense = false; BGM.set('menu'); },
  battle() { bgmIntense = false; BGM.set('battle'); },
  victory() { BGM.set('victory'); },
  off() { bgmMode = 'off'; applyBgmGain(); },
  setIntense(on) {
    if (bgmIntense === !!on) return;
    bgmIntense = !!on;
    if (bgmMode === 'battle') { /* pattern flips on next bar */ }
  },
};


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
  const belly = std(def.belly), hornMat = std(0xe8e0c8), dark = std(def.accent), clawMat = std(0x2a2420);
  const mk = (geo, mat, x, y, z, parent = root, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m;
  };
  const biped = def.legs === 'biped';
  // hunched muscular body — faceted boxes, not spheres (exaggerated silhouette)
  const bodyY = biped ? 4.0 : 3.1;
  const chest = mk(new THREE.BoxGeometry(1, 1, 1), skin, 0, bodyY + 0.45, biped ? 0.2 : 0.7, root, biped ? 2.35 : 2.7, biped ? 2.15 : 1.75, biped ? 2.2 : 3.1);
  chest.rotation.x = biped ? -0.35 : -0.18; // deep menacing hunch
  mk(new THREE.BoxGeometry(1, 1, 1), belly, 0, bodyY - 0.2, biped ? 0.5 : 0.95, root, biped ? 1.6 : 1.85, biped ? 1.25 : 1.05, biped ? 1.6 : 2.4);
  // shoulders / scapula plates — wide & high
  [-1, 1].forEach(s => {
    const sh = mk(new THREE.BoxGeometry(1.15, 0.85, 1.25), dark, 1.35 * s, bodyY + 1.05, biped ? -0.05 : 0.25, root);
    sh.rotation.z = -0.45 * s; sh.rotation.x = -0.2;
  });
  // tall dorsal spines / plates along back
  for (let i = 0; i < 7; i++) {
    const plate = mk(new THREE.BoxGeometry(0.14, 1.25 - i * 0.1, 0.65), dark, 0, bodyY + 1.65 - i * 0.04, (biped ? 1.0 : 1.8) - i * 0.6);
    plate.rotation.x = -0.25;
  }
  // long S-curved neck (segmented boxes)
  const neck = new THREE.Group(); neck.position.set(0, bodyY + (biped ? 1.35 : 1.0), biped ? 1.7 : 2.8); root.add(neck);
  mk(new THREE.BoxGeometry(1.05, 0.95, 1.25), skin, 0, 0.2, 0.15, neck).rotation.x = 0.45;
  mk(new THREE.BoxGeometry(0.9, 0.8, 1.35), skin, 0, 0.75, 1.1, neck).rotation.x = 0.65;
  mk(new THREE.BoxGeometry(0.78, 0.68, 1.2), skin, 0, 1.35, 2.05, neck).rotation.x = 0.4;
  mk(new THREE.BoxGeometry(0.7, 0.55, 0.9), skin, 0, 1.7, 2.85, neck).rotation.x = 0.2;
  // wedge head + brow ridges + jaw
  const head = new THREE.Group(); head.position.set(0, biped ? 1.95 : 2.05, biped ? 3.35 : 3.85); neck.add(head);
  mk(new THREE.BoxGeometry(1.55, 0.95, 1.65), skin, 0, 0.15, 0.1, head); // cranium
  mk(new THREE.BoxGeometry(1.15, 0.6, 1.85), skin, 0, -0.02, 1.45, head); // long snout wedge
  mk(new THREE.BoxGeometry(0.75, 0.4, 0.85), skin, 0, -0.05, 2.55, head); // tip
  // brow ridges
  [-1, 1].forEach(s => {
    const brow = mk(new THREE.BoxGeometry(0.45, 0.28, 0.7), dark, 0.48 * s, 0.48, 0.35, head);
    brow.rotation.z = -0.4 * s; brow.rotation.x = -0.25;
  });
  const jaw = mk(new THREE.BoxGeometry(0.85, 0.28, 1.55), dark, 0, -0.48, 1.2, head);
  // fangs
  [-1, 1].forEach(s => mk(new THREE.BoxGeometry(0.1, 0.28, 0.12), clawMat, 0.28 * s, -0.55, 1.85, head));
  // glowing slit eyes
  [-1, 1].forEach(s => mk(new THREE.BoxGeometry(0.14, 0.1, 0.08), std(0xffee40), 0.42 * s, 0.22, 0.85, head));
  if (def.horns) {
    // large sharp swept-back horns (boxes) — readable at range
    [-1, 1].forEach(s => {
      const h1 = mk(new THREE.BoxGeometry(0.32, 2.1, 0.32), hornMat, 0.5 * s, 1.25, -0.25, head);
      h1.rotation.set(-0.85, 0, -0.5 * s);
      const h2 = mk(new THREE.BoxGeometry(0.2, 1.2, 0.2), hornMat, 0.75 * s, 0.7, 0.4, head);
      h2.rotation.set(-0.35, 0, -1.0 * s);
    });
  } else {
    // small brow spikes even without big horns — keeps head angular
    [-1, 1].forEach(s => {
      const sp = mk(new THREE.BoxGeometry(0.16, 0.55, 0.16), dark, 0.4 * s, 0.7, -0.1, head);
      sp.rotation.set(-0.5, 0, -0.35 * s);
    });
  }
  // clawed limbs — thick thighs, boxy segments
  const legs = [];
  const addLeg = (x, z, front) => {
    const g = new THREE.Group(); g.position.set(x, bodyY - (front ? 0.15 : 0.35), z); root.add(g);
    // thigh
    mk(new THREE.BoxGeometry(0.75, 1.35, 0.85), skin, 0, -0.55, 0, g);
    // shin
    mk(new THREE.BoxGeometry(0.55, 1.2, 0.6), dark, 0, -1.55, 0.05, g);
    // foot + claws
    mk(new THREE.BoxGeometry(0.85, 0.28, 1.15), clawMat, 0, -2.2, 0.25, g);
    [-0.28, 0, 0.28].forEach(cx => mk(new THREE.BoxGeometry(0.12, 0.12, 0.4), clawMat, cx, -2.28, 0.75, g));
    legs.push(g);
  };
  if (biped) {
    addLeg(-0.7, 0.15, true); addLeg(0.7, 0.15, true);
  } else {
    addLeg(-1.25, 1.35, true); addLeg(1.25, 1.35, true);
    addLeg(-1.35, -1.4, false); addLeg(1.35, -1.4, false);
  }
  // membrane wings with finger bones
  const wings = [];
  if (def.wings) {
    const wingMat = new THREE.MeshLambertMaterial({ color: def.belly, side: THREE.DoubleSide, transparent: true, opacity: 0.8, flatShading: true });
    [-1, 1].forEach(s => {
      const g = new THREE.Group(); g.position.set(1.35 * s, bodyY + 1.0, 0.2); root.add(g);
      // arm bone
      const arm = mk(new THREE.BoxGeometry(0.22, 0.22, 2.6), dark, 1.1 * s, 0.35, -0.2, g);
      arm.rotation.z = -1.05 * s; arm.rotation.x = -0.25;
      // finger bones
      [[2.4, 1.1, -0.3], [2.8, 0.2, -1.2], [2.2, -0.7, -2.0]].forEach(([fx, fy, fz], fi) => {
        const bone = mk(new THREE.BoxGeometry(0.1, 0.1, 1.8 - fi * 0.2), dark, fx * s * 0.55, fy, fz * 0.5, g);
        bone.rotation.z = -0.9 * s; bone.rotation.x = -0.15 - fi * 0.2;
      });
      // membrane panels (faceted triangles as thin boxes)
      const mem1 = mk(new THREE.BoxGeometry(2.8, 0.06, 2.2), wingMat, 1.5 * s, 0.2, -0.9, g);
      mem1.rotation.z = -0.85 * s; mem1.rotation.x = -0.35;
      const mem2 = mk(new THREE.BoxGeometry(2.2, 0.06, 1.8), wingMat, 1.3 * s, -0.35, -1.8, g);
      mem2.rotation.z = -0.7 * s; mem2.rotation.x = -0.55;
      wings.push(g);
    });
  }
  // long tapered spiked tail ending in a blade
  const tailBase = new THREE.Group(); tailBase.position.set(0, bodyY - 0.35, biped ? -1.5 : -2.5); root.add(tailBase);
  let parent = tailBase; const tailSegs = []; let tailCut = null;
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const g = new THREE.Group(); g.position.z = i === 0 ? 0 : -1.2; parent.add(g);
    const w = 0.85 * (1 - i / (segs + 0.5));
    mk(new THREE.BoxGeometry(w, w * 0.85, 1.35), skin, 0, 0, -0.65, g);
    // top spikes
    if (i < 5) mk(new THREE.BoxGeometry(0.1, 0.55 - i * 0.06, 0.35), dark, 0, w * 0.55, -0.5, g);
    tailSegs.push(g); parent = g; if (i === 1) tailCut = g;
  }
  // blade tip
  const blade = mk(new THREE.BoxGeometry(0.15, 0.7, 1.2), dark, 0, 0, -1.4, parent);
  blade.rotation.y = 0.15;

  // scale: size is multiple of player height; base mesh ~6.5 units tall
  const scale = (def.size * PLAYER_H) / 6.5;
  root.scale.setScalar(scale);
  scene.add(root);
  return {
    def, root, head, neck, jaw, legs, wings, tailBase, tailSegs, tailCut,
    scale, bodyR: 2.6 * scale, headR: 1.5 * scale, flyY: 0,
    hp: def.hp, maxHp: def.hp, tailHp: def.hp * 0.22, severed: false, flinch: 0,
    stagger: 0, painRoarCd: 0, enraged: false, limp: false,
    pinT: 0, pinHits: 0, pinRoarCd: 0, hyperArmor: 0, // anti-stunlock pressure roar
    stuckT: 0, lastPos: new THREE.Vector3(), steerSide: Math.random() < 0.5 ? 1 : -1,
    ai: { state: 'idle', t: 1.2 + Math.random(), atk: null, dir: new THREE.Vector3(), hit: false, lastAtk: '', phase: 0, breathShots: 0, goal: null },
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
  BGM.menu();
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
    combo: 0, comboStep: 0, atkBuf: false, comboWin: 0, comboId: '', comboRoute: '', pendingInput: null, atkHold: 0, atkBoostT: 0,
    stunT: 0, // dragon pin-roar stun (can't move/attack)
    debuffs: { poison: 0, slow: 0, dark: 0 }, camShake: 0, hitFlash: 0, hurtFx: 0, over: false, introT: 2.0, winPending: false,
  };
  $('dname').textContent = list.length > 1 ? `第${run.fight + 1}戰：${list.length} 龍` : `第${run.fight + 1}戰：${primary.def.name}`;
  $('dtraits').textContent = list.length > 1 ? list.map(d => d.traits).join(' ｜ ') : primary.def.traits;
  $('pname').textContent = `獵人（${WEAPONS[run.weapon].name}）`;
  showMsg(list.length > 1 ? `第${run.fight + 1}戰\n${list.length} 隻龍` : `第${run.fight + 1}戰\n${primary.def.name}`, 2);
  ['title', 'stats', 'over', 'preview'].forEach(id => $(id).classList.add('hidden'));
  $('help')?.classList.add('hidden');
  SFX.roar();
  BGM.battle();
  BGM.setIntense(list.length > 1);
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
  if (shareNow && !padPrev.share) { muted = !muted; refreshMuteUI(); applyBgmGain(); }
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
  BGM.menu();
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
  BGM.menu();
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
  let blocked = false;
  if (S.block && facing && S.st > 0) { dmg *= 0.15; S.st -= 20; blocked = true; snd(900, 0.08, 'triangle'); showMsg('格擋！', 0.6); }
  else { SFX.hit(); S.hurtT = 0.4; }
  S.hp -= dmg; S.invuln = 0.55; S.drinkT = 0;
  // brief hit feedback — shake scales with damage, red flash a couple of blinks
  const shake = blocked ? Math.min(0.18, 0.06 + dmg * 0.008) : Math.min(0.42, 0.1 + dmg * 0.012);
  S.camShake = Math.max(S.camShake, shake);
  if (!blocked) {
    S.hitFlash = Math.max(S.hitFlash || 0, 0.32);
    S.hurtFx = Math.max(S.hurtFx || 0, Math.min(0.35, 0.12 + dmg * 0.01));
  }
  if (opts.poison) S.debuffs.poison = Math.max(S.debuffs.poison, 5);
  if (opts.slow) S.debuffs.slow = Math.max(S.debuffs.slow, 4);
  if (opts.dark) { S.debuffs.dark = Math.max(S.debuffs.dark, 3.5); S.camShake = Math.max(S.camShake, 0.45); SFX.blast(); }
  const away = tmp.copy(player.position).sub(src).setY(0);
  if (away.lengthSq() > 0.01) { away.normalize().multiplyScalar(dmg > 10 ? 2.5 : 1); player.position.add(away); }
  if (S.hp <= 0) {
    S.hp = 0; S.over = true; SFX.lose(); BGM.menu();
    setTimeout(() => { $('otitle').textContent = '狩獵失敗'; $('otext').textContent = '龍太強喇…'; $('over').classList.remove('hidden'); }, 1000);
  }
}

function updateHitFlash(dt) {
  if (!S) {
    playerFlashMats.forEach(({ m, base }) => {
      m.color.setHex(base); m.emissive.setHex(0x000000); m.emissiveIntensity = 1;
    });
    const hf = $('hurtflash'); if (hf) hf.style.opacity = '0';
    return;
  }
  if (S.hitFlash > 0) S.hitFlash -= dt;
  if (S.hurtFx > 0) S.hurtFx -= dt;
  if (S.camShake > 0) S.camShake = Math.max(0, S.camShake - dt * 2.8); // brief decay
  // ~3 red blinks over the hitFlash window (on/off steps)
  const elapsed = Math.max(0, 0.32 - S.hitFlash);
  const blink = S.hitFlash > 0 && (Math.floor(elapsed * 14) % 2 === 0);
  const drink = S.drinkT > 0 && S.hitFlash <= 0;
  playerFlashMats.forEach(({ m, base }) => {
    if (blink) {
      m.color.setHex(0xc03030);
      m.emissive.setHex(0xff4040);
      m.emissiveIntensity = 1.6;
    } else if (drink) {
      m.color.setHex(base);
      m.emissive.setHex(0x224422);
      m.emissiveIntensity = 1;
    } else {
      m.color.setHex(base);
      m.emissive.setHex(0x000000);
      m.emissiveIntensity = 1;
    }
  });
  const hf = $('hurtflash');
  if (hf) hf.style.opacity = S.hurtFx > 0 ? String(Math.min(0.65, 0.22 + S.hurtFx * 1.4)) : '0';
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

  const isCharge = S.comboId === 'charge';
  const isFinisher = !!(label && (label.includes('！') || label.includes('!')));
  const isHeavy = mult >= 1.35 || isCharge || isFinisher;
  const isCrit = best.kind === 'head' || (isCharge && mult >= 2.2);
  let dmg = w.dmg * mult * S.ps.atk * (best.kind === 'head' ? 1.35 : 1);
  if (S.atkBoostT > 0) dmg *= DB_ATK_BUFF_MUL;
  if (isCrit && best.kind !== 'head') dmg *= 1.15;
  const prevHp = bestD.hp;
  bestD.hp -= dmg;
  // Dual Blades trade-off: landing hits grants +ATK for a few seconds (no block)
  if (run.weapon === 'db') {
    const fresh = S.atkBoostT <= 0;
    S.atkBoostT = DB_ATK_BUFF_T;
    if (fresh && !label) showMsg('攻↑！', 0.55);
  }
  const impact = best.p.clone().setY(player.position.y + 1.6 + Math.random() * 0.8);

  // camera shake scales with damage / charged / finisher
  const shake = Math.min(0.72, 0.12 + dmg * 0.008 + (isHeavy ? 0.14 : 0) + (isCharge ? 0.18 : 0) + (isCrit ? 0.08 : 0));
  if (S) S.camShake = Math.max(S.camShake || 0, shake);

  // hit SFX
  if (isHeavy || isCharge) SFX.hitHeavy();
  else SFX.hitLight();

  // sparks / slash trail / particles
  spawnHitBurst(impact, best.kind === 'tail' ? 0xe8d090 : (isHeavy ? 0xff6040 : 0xff9070), isHeavy ? 10 : 6);
  spawnSlashTrail(impact, front, isHeavy);

  // floating damage number
  spawnDmgNumber(impact, Math.round(dmg), { crit: isCrit, heavy: isHeavy, tail: best.kind === 'tail' });

  // pain / flinch / stagger
  applyDragonPain(bestD, dmg, isHeavy, prevHp);

  if (label) showMsg(label, 0.5);
  if (best.kind === 'tail') {
    bestD.tailHp -= dmg;
    if (bestD.tailHp <= 0 && !bestD.severed) severTail(bestD);
  }
  if (bestD.hp <= 0) {
    bestD.hp = 0; bestD.ai.state = 'dead'; bestD.ai.t = 2;
    SFX.painRoar();
    if (livingDragons().length === 0 && !S.over) {
      S.over = true; S.winPending = true; SFX.win(); BGM.victory();
      showMsg('狩獵成功！', 2.5);
      setTimeout(() => {
        run.pts += 5 + (dragons.length > 1 ? 3 : 0);
        $('stitle').textContent = `勝利！`;
        showStats();
      }, 1800);
    }
  }
}

function applyDragonPain(d, dmg, heavy, prevHp) {
  const pct = d.hp / d.maxHp;
  const wasAbove = prevHp / d.maxHp;
  // hyper armor after pin-roar: take damage but don't get locked again
  if (d.hyperArmor > 0) {
    d.flinch = Math.max(d.flinch, 0.12);
    return;
  }
  // flinch always; stagger on heavy or when already hurt
  d.flinch = Math.max(d.flinch, heavy ? 0.55 : 0.28);
  const wasPinned = d.stagger > 0.05 || d.ai.atk === 'stagger' || d.ai.state === 'rec';
  if (heavy || dmg > d.maxHp * 0.08) {
    d.stagger = Math.max(d.stagger, heavy ? 0.85 : 0.45);
    // interrupt current attack into brief stun
    if (d.ai.state === 'wind' || d.ai.state === 'act') {
      d.ai.state = 'rec'; d.ai.t = Math.max(d.ai.t, 0.55); d.ai.atk = 'stagger';
    }
  }
  // rapid pressure (esp. dual blades) — every hit builds pin meter; locked hits build faster
  d.pinHits = (d.pinHits || 0) + 1;
  d.pinT = (d.pinT || 0) + (wasPinned || d.stagger > 0 ? (heavy ? 0.55 : 0.4) : (heavy ? 0.35 : 0.26));
  tryDragonPinRoar(d);
  // crossing into low HP → limp + enrage roar
  if (!d.enraged && pct <= 0.3 && wasAbove > 0.3) {
    d.enraged = true; d.limp = true;
    SFX.enrage();
    showMsg('狂怒！', 1.2);
    d.stagger = Math.max(d.stagger, 1.1);
  } else if (pct <= 0.3) {
    d.limp = true;
  }
  // pain roar on heavy hits (cooldown)
  if ((heavy || pct <= 0.3) && d.painRoarCd <= 0) {
    SFX.painRoar();
    d.painRoarCd = heavy ? 1.8 : 2.4;
    d.jaw.rotation.x = 0.7;
  }
}

/** When a dragon is repeatedly pinned and can't move, roar to stun the player and counter */
function tryDragonPinRoar(d) {
  if (!S || S.over || d.hp <= 0 || d.ai.state === 'dead') return false;
  if ((d.pinRoarCd || 0) > 0) return false;
  // ~1.2s of pressure or 5 rapid hits while being locked down
  if ((d.pinT || 0) < 1.2 && (d.pinHits || 0) < 5) return false;

  d.stagger = 0;
  d.flinch = 0;
  d.pinT = 0;
  d.pinHits = 0;
  d.pinRoarCd = 7.5;
  d.hyperArmor = 1.35;
  d.jaw.rotation.x = 0.9;
  d.neck.rotation.x = -0.35;

  // stun player 2s — open a counter window
  applyRoarStun(d, 2.0);
  SFX.pinRoar();
  showMsg('咆哮！', 1.3);
  if (S) S.camShake = Math.max(S.camShake || 0, 0.62);

  // immediate aggressive counter wind-up
  const dist = flatDist(player.position, d.root.position);
  const pick = dist < 7 ? (Math.random() < 0.5 ? 'bite' : (Math.random() < 0.5 ? 'slamL' : 'slamR'))
    : (d.def.legs === 'quad' ? 'charge' : (dragonElems(d.def).length ? 'breath' : 'bite'));
  d.ai.state = 'wind';
  d.ai.atk = pick;
  d.ai.lastAtk = pick;
  d.ai.hit = false;
  d.ai.breathShots = 0;
  d.ai.t = Math.max(0.35, (ATK[pick]?.wind || 0.8) * 0.55 * (d.def.windMul || 1));
  $('tele').textContent = '⚠ 咆哮反擊！';
  return true;
}

function applyRoarStun(d, dur) {
  if (!S || S.over) return;
  S.stunT = Math.max(S.stunT || 0, dur);
  S.swing = 0; S.charge = -1; S.atkHold = 0; S.block = false;
  resetCombo();
  // shove player back so the dragon has space to swing
  const away = tmp.copy(player.position).sub(d.root.position).setY(0);
  if (away.lengthSq() < 0.01) away.set(-Math.sin(d.root.rotation.y), 0, -Math.cos(d.root.rotation.y));
  away.normalize().multiplyScalar(3.2);
  player.position.add(away);
  pushOutObstacles(player.position, 0.7);
  let rr = Math.hypot(player.position.x, player.position.z);
  if (rr > ARENA) { player.position.x *= ARENA / rr; player.position.z *= ARENA / rr; }
  player.position.y = sampleHeight(player.position.x, player.position.z);
  showMsg('被咆哮震懾！', 1.6);
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
  SFX.hitSever();
  spawnHitBurst(wp.clone(), 0xc04030, 14);
  spawnDmgNumber(wp.clone().add(new THREE.Vector3(0, 1, 0)), '斷尾', { tail: true });
  d.flinch = Math.max(d.flinch, 0.7);
  d.stagger = Math.max(d.stagger, 1.0);
  if (S) S.camShake = Math.max(S.camShake || 0, 0.55);
}

function spawnSpark(p, col) {
  if (effects.length > 48) return;
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85 }));
  m.position.copy(p); scene.add(m);
  effects.push({ obj: m, t: 0.32, v: new THREE.Vector3((Math.random() - .5) * 6, 2 + Math.random() * 4, (Math.random() - .5) * 6), kind: 'spark' });
}

function spawnHitBurst(p, col, n = 8) {
  for (let i = 0; i < n; i++) {
    if (effects.length > 48) break;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.2 + Math.random() * 0.25, 0.2 + Math.random() * 0.25, 0.2 + Math.random() * 0.25),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95 })
    );
    m.position.copy(p); scene.add(m);
    effects.push({
      obj: m, t: 0.28 + Math.random() * 0.2, kind: 'spark',
      v: new THREE.Vector3((Math.random() - .5) * 10, 3 + Math.random() * 6, (Math.random() - .5) * 10),
    });
  }
  // bright impact flash
  if (effects.length < 50) {
    const flash = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.15), new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.9 }));
    flash.position.copy(p); scene.add(flash);
    effects.push({ obj: flash, t: 0.14, v: new THREE.Vector3(0, 0.5, 0), grow: true, kind: 'flash' });
  }
}

function spawnSlashTrail(at, dir, heavy) {
  if (effects.length > 48) return;
  const trail = new THREE.Mesh(
    new THREE.BoxGeometry(heavy ? 0.25 : 0.15, heavy ? 1.4 : 0.9, heavy ? 2.4 : 1.6),
    new THREE.MeshBasicMaterial({ color: heavy ? 0xffe0a0 : 0xffffff, transparent: true, opacity: 0.75 })
  );
  trail.position.copy(at);
  trail.position.addScaledVector(dir, 0.8);
  trail.lookAt(at.x + dir.x, at.y, at.z + dir.z);
  scene.add(trail);
  effects.push({ obj: trail, t: 0.18, v: dir.clone().multiplyScalar(2), grow: false, kind: 'trail' });
}

/** Expanding dust / wind rings for takeoff pressure blast */
function spawnWindBlastVfx(origin, range) {
  const dustCol = 0xc8b890;
  const ringCol = 0xdde8f0;
  for (let i = 0; i < 3; i++) {
    if (effects.length > 52) break;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.8 + i * 0.15, 0.08 + i * 0.02, 6, 20),
      new THREE.MeshBasicMaterial({ color: ringCol, transparent: true, opacity: 0.7 - i * 0.12 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(origin.x, origin.y + 0.15 + i * 0.12, origin.z);
    ring.scale.setScalar(0.35 + i * 0.1);
    scene.add(ring);
    effects.push({ obj: ring, t: 0.5 + i * 0.08, v: new THREE.Vector3(0, 0.4, 0), grow: true, kind: 'ring' });
  }
  const n = 14;
  for (let i = 0; i < n; i++) {
    if (effects.length > 56) break;
    const ang = (i / n) * Math.PI * 2 + Math.random() * 0.2;
    const dust = new THREE.Mesh(
      new THREE.BoxGeometry(0.35 + Math.random() * 0.35, 0.2, 0.35 + Math.random() * 0.35),
      new THREE.MeshBasicMaterial({ color: dustCol, transparent: true, opacity: 0.85 })
    );
    dust.position.set(origin.x, origin.y + 0.2, origin.z);
    scene.add(dust);
    const spd = 6 + Math.random() * 5 + range * 0.15;
    effects.push({
      obj: dust, t: 0.45 + Math.random() * 0.2, kind: 'spark',
      v: new THREE.Vector3(Math.sin(ang) * spd, 1.5 + Math.random() * 2.5, Math.cos(ang) * spd),
    });
  }
}

/** Winged takeoff: push player away with readable wind pressure (no HP damage) */
function takeoffWindBlast(d) {
  const origin = d.root.position.clone();
  origin.y = sampleHeight(origin.x, origin.z) + 0.25;
  const range = 9 + d.scale * 2.8;
  spawnWindBlastVfx(origin, range);
  SFX.windBlast();
  if (S) S.camShake = Math.max(S.camShake || 0, 0.38);
  showMsg('氣壓！', 0.55);
  if (!S || S.over) return { range, pushed: false, force: 0 };
  const dist = flatDist(player.position, d.root.position);
  if (dist >= range) return { range, pushed: false, force: 0, dist };
  const away = tmp.copy(player.position).sub(d.root.position).setY(0);
  if (away.lengthSq() < 0.01) away.set(-Math.sin(d.root.rotation.y), 0, -Math.cos(d.root.rotation.y));
  const falloff = 1 - dist / range;
  const force = (5 + d.scale * 2) * (0.4 + falloff * 0.6);
  away.normalize().multiplyScalar(force);
  player.position.add(away);
  pushOutObstacles(player.position, 0.7);
  let rr = Math.hypot(player.position.x, player.position.z);
  if (rr > ARENA) { player.position.x *= ARENA / rr; player.position.z *= ARENA / rr; }
  player.position.y = sampleHeight(player.position.x, player.position.z);
  // interrupt wind-ups; pure knockback (dodge i-frames still work vs damage, but wind still shoves)
  if (S.charge >= 0) S.charge = -1;
  S.hurtT = Math.max(S.hurtT, 0.22);
  return { range, pushed: true, force, dist };
}

const floaters = [];
function spawnDmgNumber(worldPos3, amount, opts = {}) {
  const el = document.createElement('div');
  el.className = 'dmg' + (opts.crit ? ' crit' : '') + (opts.heavy ? ' heavy' : '') + (opts.tail ? ' tail' : '');
  el.textContent = typeof amount === 'number' ? (opts.crit ? critMark(amount) : String(amount)) : String(amount);
  el.style.color = opts.crit ? '#ffcf40' : opts.tail ? '#e8d090' : opts.heavy ? '#ff8060' : '#fff';
  $('floaters')?.appendChild(el);
  floaters.push({ el, pos: worldPos3.clone(), t: 0.9, vy: 1.8 + Math.random() * 0.6 });
}
function critMark(n) { return n + '!'; }

function updateFloaters(dt) {
  const { w, h } = viewSize();
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t -= dt; f.pos.y += f.vy * dt; f.vy -= 2 * dt;
    const ndc = f.pos.clone().project(camera);
    if (ndc.z > 1 || f.t <= 0) { f.el.remove(); floaters.splice(i, 1); continue; }
    const x = (ndc.x * 0.5 + 0.5) * w;
    const y = (-ndc.y * 0.5 + 0.5) * h;
    f.el.style.left = x + 'px';
    f.el.style.top = y + 'px';
    f.el.style.opacity = String(Math.min(1, f.t * 2));
    f.el.style.transform = `translate(-50%,-50%) scale(${optsScale(f)})`;
  }
}
function optsScale(f) {
  return f.el.classList.contains('crit') ? 1.15 : 1;
}

function spawnProjectile(origin, dir, kind, dmg) {
  const col = ELEM_COL[kind] || 0xffffff;
  // big, readable orbs — player must dodge on timing, not pixel-hunt
  let mesh;
  if (kind === 'lightning') {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 1.8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.92 }));
  } else if (kind === 'blast') {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85 }));
  } else if (kind === 'poison') {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.15, 1.15), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.88 }));
  } else {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.5), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.92 }));
  }
  mesh.position.copy(origin); scene.add(mesh);
  const spd = kind === 'blast' ? 28 : kind === 'lightning' ? 38 : kind === 'poison' ? 30 : 34;
  const v = dir.clone();
  if (v.lengthSq() < 1e-6) v.set(0, -0.1, 1);
  v.normalize().multiplyScalar(spd);
  const hitR = kind === 'blast' ? 3.2 : kind === 'lightning' ? 2.6 : 2.9;
  projectiles.push({ mesh, v, t: 2.0, kind, dmg, hit: false, hitR });
  // muzzle flash spark
  spawnSpark(origin.clone(), col);
  if (kind === 'fire') SFX.fire();
  else if (kind === 'poison') SFX.poison();
  else if (kind === 'lightning') SFX.lightning();
  else if (kind === 'blast') SFX.blast();
}

/** Layered dust sheets + grit under a charging quadruped */
function spawnChargeDust(d) {
  const origin = d.root.position.clone();
  const gy = sampleHeight(origin.x, origin.z);
  const bx = -(d.ai.dir.x || 0), bz = -(d.ai.dir.z || 1);
  const dustCol = [0xc4a878, 0xb89868, 0xd0b890];
  for (let layer = 0; layer < 3; layer++) {
    if (effects.length > 54) break;
    const sheet = new THREE.Mesh(
      new THREE.BoxGeometry(2.4 + layer * 1.1, 0.1 + layer * 0.1, 1.6 + layer * 0.7),
      new THREE.MeshBasicMaterial({ color: dustCol[layer], transparent: true, opacity: 0.62 - layer * 0.14 })
    );
    sheet.position.set(
      origin.x + bx * (0.8 + layer * 0.9),
      gy + 0.12 + layer * 0.28,
      origin.z + bz * (0.8 + layer * 0.9)
    );
    sheet.rotation.y = Math.atan2(d.ai.dir.x, d.ai.dir.z);
    scene.add(sheet);
    effects.push({
      obj: sheet, t: 0.38 + layer * 0.1, kind: 'dust', grow: true,
      v: new THREE.Vector3(bx * (2 + layer), 0.6 + layer * 0.5, bz * (2 + layer)),
    });
  }
  for (let i = 0; i < 6; i++) {
    if (effects.length > 56) break;
    const grit = new THREE.Mesh(
      new THREE.BoxGeometry(0.3 + Math.random() * 0.35, 0.2, 0.3 + Math.random() * 0.35),
      new THREE.MeshBasicMaterial({ color: dustCol[i % 3], transparent: true, opacity: 0.8 })
    );
    grit.position.set(origin.x + (Math.random() - 0.5) * 2, gy + 0.2, origin.z + (Math.random() - 0.5) * 2);
    scene.add(grit);
    effects.push({
      obj: grit, t: 0.35 + Math.random() * 0.2, kind: 'spark',
      v: new THREE.Vector3(bx * (4 + Math.random() * 5) + (Math.random() - 0.5) * 3, 2 + Math.random() * 3, bz * (4 + Math.random() * 5) + (Math.random() - 0.5) * 3),
    });
  }
}

// ---------- dragon AI ----------
const ATK = {
  bite:    { name: '咬！', wind: 1.05, act: 0.38, rec: 0.85, range: 8 },
  slamL:   { name: '左撞！', wind: 1.15, act: 0.5, rec: 0.95, range: 7 },
  slamR:   { name: '右撞！', wind: 1.15, act: 0.5, rec: 0.95, range: 7 },
  tail:    { name: '甩尾！', wind: 1.25, act: 0.7, rec: 1.0, range: 10 },
  charge:  { name: '衝撞！', wind: 1.35, act: 1.25, rec: 1.25, range: 40 },
  breath:  { name: '吐息！', wind: 1.1, act: 1.35, rec: 1.15, range: 28 },
  takeoff: { name: '起飛！', wind: 1.15, act: 0.8, rec: 0.4, range: 99 },
  dive:    { name: '俯衝！', wind: 1.2, act: 1.1, rec: 1.2, range: 99 },
};

function idleCd(def) {
  const lo = 0.9 + (1 - def.aggro) * 0.7;
  const hi = 1.5 + (1 - def.aggro) * 0.9;
  return lo + Math.random() * (hi - lo);
}

function dragonElems(def) {
  return def.colors.map(c => COLOR_DEFS[c].elem).filter(Boolean);
}

function pickAtk(d, dist, ang) {
  const def = d.def;
  const behind = Math.abs(ang) > 1.7;
  const side = Math.abs(ang) > 0.9 && Math.abs(ang) < 1.7;
  const elems = dragonElems(def);
  const canBreath = elems.length > 0;
  let pick;
  // coloured dragons: breathe often at mid/long range
  if (canBreath && dist >= 6 && dist <= 26) {
    const breathChance = dist > 12 ? 0.72 : 0.55;
    if (Math.random() < breathChance && d.ai.lastAtk !== 'breath') pick = 'breath';
  }
  if (!pick) {
    if (def.legs === 'biped') {
      if (behind && dist < 11) pick = 'tail';
      else if (side && dist < 8) pick = ang > 0 ? 'slamR' : 'slamL';
      else if (dist < 6.5) pick = 'bite';
      else if (canBreath) pick = 'breath';
      else if (dist < 10) pick = Math.random() < 0.5 ? 'bite' : (ang > 0 ? 'slamR' : 'slamL');
      else pick = 'bite';
    } else {
      if (behind && dist < 12) pick = 'tail';
      else if (canBreath && dist >= 7) pick = 'breath';
      else if (dist < 9 && Math.random() < 0.3) pick = 'tail';
      else pick = 'charge';
    }
  }
  // wings: occasional takeoff, but don't steal breath
  if (def.wings && pick !== 'breath' && dist > 8 && dist < 16 && Math.random() < 0.14 + def.aggro * 0.1
    && d.ai.lastAtk !== 'dive' && d.ai.lastAtk !== 'takeoff') {
    pick = 'takeoff';
  }
  // avoid repeating same melee; never cancel breath into melee just for variety
  if (pick === d.ai.lastAtk && pick !== 'charge' && pick !== 'breath') {
    if (canBreath && dist >= 7) pick = 'breath';
    else pick = pick === 'bite' ? 'tail' : 'bite';
  }
  return pick;
}

/** Sample whether a point (with radius) is blocked; returns push vector length */
function blockedAt(x, z, radius) {
  const p = { x, z };
  pushOutObstacles(p, radius);
  return Math.hypot(p.x - x, p.z - z);
}

/** Steer toward a world XZ target while sliding around obstacles */
function steerMove(d, wantX, wantZ, speed, dt) {
  const root = d.root;
  const radius = 2.2 * d.scale;
  const dx = wantX - root.position.x, dz = wantZ - root.position.z;
  const len = Math.hypot(dx, dz) || 1;
  let fx = dx / len, fz = dz / len;
  // probe ahead + left/right
  const look = 3.5 + d.scale;
  const ahead = blockedAt(root.position.x + fx * look, root.position.z + fz * look, radius);
  if (ahead > 0.05) {
    const lx = -fz, lz = fx; // left perpendicular
    const leftClear = blockedAt(root.position.x + (fx * 0.4 + lx * d.steerSide) * look, root.position.z + (fz * 0.4 + lz * d.steerSide) * look, radius);
    const rightClear = blockedAt(root.position.x + (fx * 0.4 - lx * d.steerSide) * look, root.position.z + (fz * 0.4 - lz * d.steerSide) * look, radius);
    if (leftClear < rightClear) { fx = fx * 0.35 + lx * d.steerSide; fz = fz * 0.35 + lz * d.steerSide; }
    else { fx = fx * 0.35 - lx * d.steerSide; fz = fz * 0.35 - lz * d.steerSide; d.steerSide *= -1; }
    const n = Math.hypot(fx, fz) || 1; fx /= n; fz /= n;
  }
  const before = { x: root.position.x, z: root.position.z };
  root.position.x += fx * speed * dt;
  root.position.z += fz * speed * dt;
  pushOutObstacles(root.position, radius);
  const moved = Math.hypot(root.position.x - before.x, root.position.z - before.z);
  // stuck detection
  if (moved < speed * dt * 0.15 && speed > 0.5) d.stuckT += dt;
  else d.stuckT = Math.max(0, d.stuckT - dt * 0.5);
  if (d.stuckT > 1.0) {
    d.steerSide *= -1;
    d.stuckT = 0;
    // sidestep burst
    root.position.x += -fz * d.steerSide * 2.5;
    root.position.z += fx * d.steerSide * 2.5;
    pushOutObstacles(root.position, radius);
    d.ai.goal = null; // repath
  }
  return moved;
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
  if (d.painRoarCd > 0) d.painRoarCd -= dt;
  if (d.pinRoarCd > 0) d.pinRoarCd -= dt;
  if (d.hyperArmor > 0) d.hyperArmor -= dt;
  if (d.flinch > 0) { d.flinch -= dt; root.rotation.z = Math.sin(t * 28) * 0.12; root.rotation.x = Math.sin(t * 20) * 0.06; }
  else { root.rotation.z *= 0.9; root.rotation.x *= 0.9; }
  if (d.stagger > 0) {
    d.stagger -= dt;
    // stuck under hits — pin pressure builds even without new hits
    d.pinT = (d.pinT || 0) + dt;
    if (tryDragonPinRoar(d)) {
      // roared free — fall through into normal AI this frame
    } else {
      // brief stun — hold still in pain pose
      d.neck.rotation.x = lerp(d.neck.rotation.x, 0.45, 1 - Math.exp(-dt * 6));
      d.jaw.rotation.x = Math.max(d.jaw.rotation.x, 0.55);
      root.rotation.z = Math.sin(t * 18) * 0.1;
      if (ai.state !== 'dead' && ai.state !== 'fly') {
        ai.state = 'rec'; ai.t = Math.max(ai.t, 0.2); ai.atk = 'stagger';
      }
      animateDragonPose(d, dt, t, 0);
      root.position.y = sampleHeight(root.position.x, root.position.z) + d.flyY;
      return;
    }
  } else if ((d.pinT || 0) > 0 && d.hyperArmor <= 0) {
    d.pinT = Math.max(0, d.pinT - dt * 0.9);
    if (d.pinT <= 0) d.pinHits = 0;
  }

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
    const diff = turn(wantYaw, 1.8 * def.speed);
    // positioning: close in, circle/flank, or retreat to breath range
    const elems = dragonElems(def);
    const ideal = elems.length ? 12 : (def.legs === 'quad' ? 8 : 6);
    if (!ai.goal || Math.random() < dt * 0.4) {
      const side = d.steerSide;
      if (dist > ideal + 4) {
        ai.goal = { x: player.position.x, z: player.position.z }; // chase
      } else if (dist < ideal - 3 && elems.length) {
        // retreat to breath range
        const bx = root.position.x - toP.x / (dist || 1) * 8;
        const bz = root.position.z - toP.z / (dist || 1) * 8;
        ai.goal = { x: bx, z: bz };
      } else {
        // circle / flank
        const ang = Math.atan2(root.position.x - player.position.x, root.position.z - player.position.z) + side * 0.7;
        ai.goal = { x: player.position.x + Math.sin(ang) * ideal, z: player.position.z + Math.cos(ang) * ideal };
      }
    }
    let spd = ((def.legs === 'quad' ? 5.2 : 4.2) + def.aggro * 2.2) * def.speed;
    if (d.limp) spd *= 0.62; // hobbled when low HP
    if (ai.goal) {
      const gd = Math.hypot(ai.goal.x - root.position.x, ai.goal.z - root.position.z);
      if (gd > 1.2) {
        steerMove(d, ai.goal.x, ai.goal.z, spd, dt);
        walk = d.limp ? 0.55 : 1;
        if (Math.random() < dt * (d.limp ? 1.2 : 2)) SFX.foot();
      }
    }
    if (ai.t <= 0) {
      const pick = pickAtk(d, dist, diff);
      ai.atk = pick; ai.lastAtk = pick; ai.breathShots = 0;
      if (pick === 'takeoff') {
        ai.state = 'wind'; ai.t = ATK.takeoff.wind; ai.hit = false; SFX.flap();
      } else {
        ai.state = 'wind'; ai.t = ATK[pick].wind * def.windMul; ai.hit = false;
        SFX.roar();
      }
    }
  } else if (ai.state === 'wind') {
    const A = ATK[ai.atk] || ATK.bite;
    $('tele').textContent = '⚠ ' + A.name;
    if (ai.atk === 'takeoff') {
      // readable telegraph: crouch + wing raise before lift-off blast
      d.jaw.rotation.x = 0.3;
      const windFull = ATK.takeoff.wind;
      const windP = 1 - Math.max(0, ai.t) / Math.max(0.001, windFull);
      d.crouchY = -0.22 * Math.min(1, windP);
      if (d.wings[0]) d.wings.forEach((w, i) => {
        const side = i ? 1 : -1;
        w.rotation.z = lerp(w.rotation.z, side * (0.35 + windP * 0.85), 1 - Math.exp(-dt * 6));
      });
      if (Math.random() < dt * 2.5) SFX.flap();
      if (ai.t <= 0) {
        d.crouchY = 0;
        takeoffWindBlast(d);
        ai.state = 'fly'; ai.t = 2.2 + Math.random() * 1.2; d.flyY = 0.6;
      }
    } else {
      // track during wind-up; breath locks aim at the commit frame below
      if (ai.atk !== 'tail' && ai.atk !== 'slamL' && ai.atk !== 'slamR') turn(wantYaw, 2.2);
      if (ai.atk === 'bite') d.neck.rotation.x = -0.4;
      if (ai.atk === 'tail') { root.rotation.y -= dt * 0.3; d.tailBase.rotation.y = 0.85; }
      if (ai.atk === 'slamL') root.rotation.y -= dt * 0.5;
      if (ai.atk === 'slamR') root.rotation.y += dt * 0.5;
      if (ai.atk === 'charge') { root.position.y = sampleHeight(root.position.x, root.position.z) + Math.abs(Math.sin(t * 10)) * 0.1; d.jaw.rotation.x = 0.35; }
      if (ai.atk === 'breath') { d.neck.rotation.x = -0.45; d.jaw.rotation.x = 0.55; }
      if (ai.atk === 'dive') { d.neck.rotation.x = 0.5; }
      if (ai.t <= 0) {
        // commit: final face; breath locks 3D aim at player (not sky / flat horizontal)
        if (ai.atk === 'breath') {
          root.rotation.y = wantYaw;
          const mouth = worldPos(d.head);
          mouth.y += 0.35 * d.scale;
          const target = tmp2.set(player.position.x, player.position.y + 1.15, player.position.z);
          ai.dir.copy(target).sub(mouth);
          if (ai.dir.lengthSq() < 0.01) ai.dir.set(Math.sin(root.rotation.y), -0.15, Math.cos(root.rotation.y));
          ai.dir.normalize();
        } else {
          ai.dir.set(Math.sin(root.rotation.y), 0, Math.cos(root.rotation.y));
        }
        ai.state = 'act'; ai.t = A.act;
        ai.breathShots = 0;
        if (ai.atk === 'charge') SFX.stomp();
      }
    }
  } else if (ai.state === 'act') {
    const A = ATK[ai.atk] || ATK.bite;
    const hornBonus = def.horns ? 1.3 : 1;
    if (ai.atk === 'bite') {
      d.neck.rotation.x = 0.45; d.jaw.rotation.x = 0.55;
      steerMove(d, root.position.x + ai.dir.x * 4, root.position.z + ai.dir.z * 4, 6, dt);
      const hp = worldPos(d.head);
      if (!ai.hit && flatDist(hp, player.position) < 2.6 * d.scale + 0.5) { ai.hit = true; hurtPlayer(18, hp); }
    } else if (ai.atk === 'slamL' || ai.atk === 'slamR') {
      const side = ai.atk === 'slamL' ? 1 : -1;
      root.rotation.y += side * dt * 2.2;
      const sx = Math.cos(root.rotation.y) * side, sz = -Math.sin(root.rotation.y) * side;
      steerMove(d, root.position.x + sx * 4, root.position.z + sz * 4, 7, dt);
      if (!ai.hit && dist < 4.5 * d.scale) { ai.hit = true; hurtPlayer(16, root.position); SFX.stomp(); }
    } else if (ai.atk === 'tail') {
      root.rotation.y += (Math.PI * 2 / A.act) * dt; d.tailBase.rotation.y = -0.5;
      const reach = (d.severed ? 5 : 9) * d.scale;
      if (!ai.hit && dist < reach && dist > 1.5) {
        const tip = worldPos(d.tailSegs[d.severed ? 1 : d.tailSegs.length - 1]);
        if (flatDist(tip, player.position) < 2.8 * d.scale) { ai.hit = true; hurtPlayer(22, root.position); }
      }
    } else if (ai.atk === 'charge') {
      // quadrupeds charge much faster with layered dust kickup
      const quad = def.legs === 'quad';
      const spd = (quad ? 30 : 18) * def.speed * hornBonus;
      const before = { x: root.position.x, z: root.position.z };
      steerMove(d, root.position.x + ai.dir.x * 12, root.position.z + ai.dir.z * 12, spd, dt);
      walk = quad ? 3.2 : 2;
      if (quad && Math.random() < dt * 14) spawnChargeDust(d);
      else if (!quad && Math.random() < dt * 5) spawnChargeDust(d);
      if (Math.random() < dt * (quad ? 7 : 4)) SFX.stomp();
      if (!ai.hit && dist < 3.5 * d.scale) { ai.hit = true; hurtPlayer(28 * hornBonus, root.position); }
      const moved = Math.hypot(root.position.x - before.x, root.position.z - before.z);
      if (moved < spd * dt * 0.18) {
        ai.state = 'rec'; ai.t = 1.1; showMsg('撞石！', 0.5); SFX.stomp(); d.steerSide *= -1;
      }
    } else if (ai.atk === 'breath') {
      // locked 3D aim from commit — do NOT track player mid-breath
      d.neck.rotation.x = -0.15; d.jaw.rotation.x = 0.7;
      const elapsed = A.act - ai.t;
      const elems = dragonElems(def);
      const schedule = [0.12, 0.38, 0.64];
      while (ai.breathShots < schedule.length && elapsed >= schedule[ai.breathShots]) {
        const kind = elems[ai.breathShots % elems.length] || elems[0] || 'fire';
        const mouth = worldPos(d.head);
        mouth.y += 0.35 * d.scale;
        const aim = tmp2.copy(ai.dir);
        if (aim.lengthSq() < 0.01) aim.set(Math.sin(root.rotation.y), -0.2, Math.cos(root.rotation.y));
        spawnProjectile(mouth, aim, kind, 16);
        showMsg(kind === 'fire' ? '火球！' : kind === 'poison' ? '毒液！' : kind === 'lightning' ? '雷球！' : '暗爆！', 0.45);
        ai.breathShots++;
      }
    } else if (ai.atk === 'dive') {
      d.flyY = Math.max(0, d.flyY - dt * 14);
      root.position.y = sampleHeight(root.position.x, root.position.z) + d.flyY;
      steerMove(d, player.position.x, player.position.z, 14, dt);
      turn(wantYaw, 1.2);
      if (!ai.hit && d.flyY < 2.5 && dist < 4 * d.scale) { ai.hit = true; hurtPlayer(26, root.position); SFX.stomp(); }
      if (d.flyY <= 0.1) { ai.t = 0; d.flyY = 0; }
    }
    if (ai.t <= 0) {
      if (ai.atk === 'dive') { ai.state = 'rec'; ai.t = ATK.dive.rec; d.flyY = 0; }
      else { ai.state = 'rec'; ai.t = A.rec * (1.0 + (1 - def.aggro) * 0.15); }
    }
  } else if (ai.state === 'rec') {
    if (ai.atk === 'charge') steerMove(d, root.position.x + ai.dir.x * 3, root.position.z + ai.dir.z * 3, Math.max(0, ai.t) * 4, dt);
    d.neck.rotation.x *= 0.9;
    if (ai.t <= 0) { ai.state = 'idle'; ai.t = idleCd(def); ai.goal = null; }
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
      root.position.y = sampleHeight(root.position.x, root.position.z) + d.flyY + (d.crouchY || 0);
    }
  }
  if (!(ai.state === 'wind' && ai.atk === 'takeoff')) d.crouchY = 0;
  // body push player
  if (dist < 2.8 * d.scale && ai.state !== 'fly') {
    const push = tmp.copy(player.position).sub(root.position).setY(0);
    if (push.lengthSq() > 0.01) player.position.addScaledVector(push.normalize(), 2.8 * d.scale - dist);
  }
  animateDragonPose(d, dt, t, walk);
}

function animateDragonPose(d, dt, t, walk) {
  const breath = Math.sin(t * (d.limp ? 3.2 : 2.2)) * (d.limp ? 0.06 : 0.04);
  d.root.scale.y = d.scale * (1 + breath);
  // pain / stagger pose overrides
  if (d.stagger > 0 || (d.flinch > 0.15 && d.ai.atk === 'stagger')) {
    d.neck.rotation.x = lerp(d.neck.rotation.x, 0.55, 1 - Math.exp(-dt * 8));
    d.head.rotation.x = lerp(d.head.rotation.x, 0.35, 1 - Math.exp(-dt * 6));
    d.head.rotation.y = lerp(d.head.rotation.y, Math.sin(t * 12) * 0.2, 1 - Math.exp(-dt * 5));
    d.jaw.rotation.x = Math.max(d.jaw.rotation.x, 0.65);
    d.legs.forEach((l, i) => { l.rotation.x = lerp(l.rotation.x, (i % 2 ? 0.35 : -0.25), 1 - Math.exp(-dt * 6)); });
    d.tailBase.rotation.y = Math.sin(t * 10) * 0.35;
    return;
  }
  // head track player
  const toP = tmp.copy(player.position).sub(d.root.position);
  const localYaw = Math.atan2(toP.x, toP.z) - d.root.rotation.y;
  let ly = ((localYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  ly = THREE.MathUtils.clamp(ly, -0.6, 0.6);
  d.head.rotation.y = lerp(d.head.rotation.y, ly, 1 - Math.exp(-dt * 4));
  d.head.rotation.x = lerp(d.head.rotation.x, THREE.MathUtils.clamp(-toP.y * 0.02, -0.3, 0.3) + (d.limp ? 0.15 : 0), 1 - Math.exp(-dt * 3));
  // gait — limp = uneven shuffle
  const gaitRate = walk === 2 ? 12 : walk ? (d.limp ? 4 : 6) : 0;
  const ph = t * gaitRate;
  d.legs.forEach((l, i) => {
    const biped = d.def.legs === 'biped';
    if (!walk) { l.rotation.x = lerp(l.rotation.x, d.limp ? (i % 2 ? 0.2 : -0.1) : 0, 1 - Math.exp(-dt * 8)); return; }
    const off = biped ? (i ? Math.PI : 0) : (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI * 0.5 : 0);
    const amp = (walk === 2 ? 0.55 : 0.4) * (d.limp ? 0.7 : 1);
    // limp: one side lags
    const limpBias = d.limp && (i === 0 || i === 2) ? 0.25 : 0;
    l.rotation.x = Math.sin(ph + off) * amp + limpBias;
  });
  // wings idle / flap
  if (d.wings.length) {
    const flying = d.ai.state === 'fly' || (d.ai.state === 'act' && d.ai.atk === 'dive');
    d.wings.forEach((w, i) => {
      const base = flying ? Math.sin(t * 9) * 0.55 : Math.sin(t * 2) * 0.12;
      w.rotation.z = base * (i ? 1 : -1) + (d.ai.state === 'wind' ? (i ? 0.35 : -0.35) : 0);
      if (d.limp) w.rotation.z += (i ? 0.15 : -0.15);
    });
  }
  // tail sway
  d.tailBase.rotation.y = Math.sin(t * 1.8) * 0.22 + (d.ai.state === 'wind' && d.ai.atk === 'tail' ? 0.6 : 0);
  d.tailSegs.forEach((s, i) => { if (i) s.rotation.y = Math.sin(t * 2.2 - i * 0.5) * 0.1; });
  // neck idle / hunched when limping
  if (d.ai.state === 'idle' || d.ai.state === 'rec') {
    const neckIdle = Math.sin(t * 1.5) * 0.08 + (d.limp ? 0.2 : 0);
    d.neck.rotation.x = lerp(d.neck.rotation.x, neckIdle, 1 - Math.exp(-dt * 3));
  }
}

function updateDragons(dt, t) {
  $('tele').textContent = '';
  for (const d of dragons) updateOneDragon(d, dt, t);
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.t -= dt;
    p.mesh.position.addScaledVector(p.v, dt);
    p.v.y -= (p.kind === 'lightning' ? 1.2 : 3.2) * dt; // lighter drop so locked aim stays readable
    if (p.v.lengthSq() > 0.01) p.mesh.lookAt(p.mesh.position.x + p.v.x, p.mesh.position.y + p.v.y, p.mesh.position.z + p.v.z);
    if (Math.random() < dt * 8) spawnSpark(p.mesh.position.clone(), ELEM_COL[p.kind] || 0xffffff);
    const hitR = p.hitR || (p.kind === 'blast' ? 3.2 : 2.9);
    const py = player.position.y + 1.1;
    const dist3 = Math.hypot(p.mesh.position.x - player.position.x, p.mesh.position.y - py, p.mesh.position.z - player.position.z);
    if (!p.hit && dist3 < hitR) {
      p.hit = true;
      const opts = { poison: p.kind === 'poison', slow: p.kind === 'lightning', dark: p.kind === 'blast' };
      hurtPlayer(p.dmg, p.mesh.position, opts);
      if (p.kind === 'blast') S.camShake = Math.max(S.camShake, 0.5);
      spawnSpark(p.mesh.position.clone(), ELEM_COL[p.kind] || 0xffffff);
      scene.remove(p.mesh); projectiles.splice(i, 1); continue;
    }
    if (p.t <= 0 || p.mesh.position.y < sampleHeight(p.mesh.position.x, p.mesh.position.z) - 0.5) {
      if (p.kind === 'blast' && !p.hit && flatDist(p.mesh.position, player.position) < 5.5) {
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
    if (S.hp <= 0 && !S.over) { S.hp = 0; S.over = true; SFX.lose(); BGM.menu(); setTimeout(() => { $('otitle').textContent = '狩獵失敗'; $('otext').textContent = '中毒身亡…'; $('over').classList.remove('hidden'); }, 800); }
  }
  if (S.debuffs.slow > 0) S.debuffs.slow -= dt;
  if (S.debuffs.dark > 0) S.debuffs.dark -= dt;
}


// ---------- player update ----------
let attackHeldPrev = false, specialHeldPrev = false, prevSwing = 0;
function attackPressed() {
  const held = !!(input.attack || pad.attack);
  const press = held && !attackHeldPrev;
  attackHeldPrev = held;
  return press;
}
function specialPressed() {
  const held = !!(input.special || pad.special);
  const press = held && !specialHeldPrev;
  specialHeldPrev = held;
  return press;
}
function resetCombo() {
  if (!S) return;
  S.combo = 0; S.comboStep = 0; S.comboId = ''; S.comboRoute = '';
  S.atkBuf = false; S.pendingInput = null; S.comboWin = 0;
}
function beginComboRoute(ch) {
  if (!S) return false;
  const route = (S.comboRoute || '') + ch;
  const hit = COMBO_TREE[run.weapon]?.[route];
  if (!hit) return false;
  S.comboRoute = route;
  S.comboStep = route.length - 1;
  S.combo = route.length;
  S.comboId = hit.id;
  S.cd = Math.max(0.05, WEAPONS[run.weapon].cd * 0.35);
  S.swing = S.swingDur = hit.dur;
  S.atkBuf = false; S.pendingInput = null; S.comboWin = 0;
  const nd = nearestDragon();
  if (nd) {
    const v = tmp.copy(nd.root.position).sub(player.position);
    if (v.length() < 14) player.rotation.y = Math.atan2(v.x, v.z);
  }
  doHit(hit.dmg, hit.label, hit.range / WEAPONS[run.weapon].range);
  SFX.slash();
  return true;
}
/** @deprecated linear step API — maps to pure-A route */
function beginComboHit(step) {
  if (!S) return;
  S.comboRoute = 'A'.repeat(Math.max(0, step));
  beginComboRoute('A');
}
function updatePlayer(dt) {
  const w = WEAPONS[run.weapon];
  S.cd -= dt; S.invuln -= dt; S.dodgeT -= dt; S.hurtT -= dt; S.swing -= dt;
  if (S.comboWin > 0) S.comboWin -= dt;
  if (S.stunT > 0) S.stunT -= dt;
  const press = attackPressed();
  const spPress = specialPressed();
  let mx = input.mx + pad.mx + ((keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0));
  let mz = input.mz + pad.mz + ((keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0));
  const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
  const specialHeld = input.special || pad.special;
  const stunned = S.stunT > 0;
  const inCombo = !stunned && (S.combo > 0 || S.swing > 0 || S.comboWin > 0);
  const cy = Math.cos(camYaw), sy = Math.sin(camYaw);
  const dir = new THREE.Vector3(-mx * cy - mz * sy, 0, mx * sy - mz * cy);
  let speed = S.ps.spd * w.speedMul * (S.debuffs.slow > 0 ? 0.75 : 1);
  if (S.charge >= 0 || S.block) speed *= 0.35;
  if (S.drinkT > 0) speed *= 0.3;
  if (S.swing > 0) speed *= 0.55;
  // roar stun: freeze controls so the dragon can counter
  if (stunned) {
    input.dodge = false; input.potion = false;
    S.block = false; S.charge = -1; S.atkHold = 0; S.moveAmt = 0;
    S.swing = 0; resetCombo();
    player.position.y = sampleHeight(player.position.x, player.position.z);
    if (!specialHeld && S.dodgeT <= 0) S.st = Math.min(S.ps.maxSt, S.st + 28 * dt);
    $('tele').textContent = `⚠ 震懾 ${S.stunT.toFixed(1)}s`;
    animatePlayer(dt);
    return;
  }
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
  if (S.atkBoostT > 0) S.atkBoostT = Math.max(0, S.atkBoostT - dt);
  const atkHeld = !!(input.attack || pad.attack);
  S.block = false;

  // Idle special: GS/SnS guard · DB demon — NOT while mid-combo (技 is a combo branch there)
  if (!inCombo && S.charge < 0) {
    if (run.weapon === 'gs' || run.weapon === 'ss') {
      if (specialHeld && S.st > 0 && S.swing <= 0 && S.dodgeT <= 0 && S.drinkT <= 0) {
        S.block = true; S.st -= 8 * dt; S.atkHold = 0;
      }
    } else if (run.weapon === 'db') {
      if (specialHeld && S.st > 5 && S.cd <= 0 && S.swing <= 0 && S.dodgeT <= 0 && S.drinkT <= 0) {
        faceDragon(); S.st -= 6; S.cd = 0.08; S.swing = S.swingDur = 0.22; S.comboId = 'demon';
        doHit(0.95, null); resetCombo();
      }
    }
  }

  // GS: hold attack from idle = charge; tap = start combo
  if (run.weapon === 'gs' && !S.block) {
    if (atkHeld && S.combo === 0 && S.swing <= 0 && S.cd <= 0 && S.dodgeT <= 0 && S.drinkT <= 0 && S.comboWin <= 0) {
      S.atkHold += dt;
      if (S.atkHold >= 0.32) {
        if (S.charge < 0) { S.charge = 0; faceDragon(); resetCombo(); }
        S.charge = Math.min(1.6, S.charge + dt);
      }
    } else if (S.charge >= 0) {
      const c = S.charge; S.charge = -1; S.atkHold = 0;
      S.cd = w.cd * 1.3; S.swing = S.swingDur = 0.78; S.comboId = 'charge';
      doHit(1 + c * 1.6, c > 1.2 ? '蓄力斬！' : null); resetCombo();
    } else if (!atkHeld && S.atkHold > 0 && S.atkHold < 0.32) {
      S.atkHold = 0;
      if (S.cd <= 0 && S.dodgeT <= 0 && S.drinkT <= 0 && S.combo === 0 && S.swing <= 0)
        beginComboRoute('A');
    } else if (!atkHeld) {
      S.atkHold = 0;
    }
  }

  // --- branching combo input (斬=A / 技=S) ---
  const canChain = S.dodgeT <= 0 && S.drinkT <= 0 && S.charge < 0 && !S.block;
  if (S.swing > 0 && (S.swing / S.swingDur) <= COMBO_LINK && canChain) {
    if (press) S.pendingInput = 'A';
    if (spPress) S.pendingInput = 'S';
  }
  if (prevSwing > 0 && S.swing <= 0) {
    const route = S.comboRoute || '';
    if (S.pendingInput && comboHasBranch(route, S.pendingInput)) beginComboRoute(S.pendingInput);
    else if (comboHasBranch(route, 'A') || comboHasBranch(route, 'S')) S.comboWin = COMBO_BUFFER;
    else resetCombo();
    S.pendingInput = null;
  }
  prevSwing = Math.max(0, S.swing);
  if (S.comboWin > 0 && canChain) {
    if (press) {
      if (!beginComboRoute('A')) resetCombo();
    } else if (spPress) {
      if (!beginComboRoute('S')) resetCombo();
    }
  } else if (S.combo > 0 && S.swing <= 0 && S.comboWin <= 0 && !S.pendingInput) {
    resetCombo();
  }
  // fresh chain (non-GS)
  if (run.weapon !== 'gs' && press && S.swing <= 0 && S.comboWin <= 0 && canChain && S.cd <= 0 && S.combo === 0) {
    beginComboRoute('A');
  }

  if (!specialHeld && !S.block && S.dodgeT <= 0 && S.charge < 0) S.st = Math.min(S.ps.maxSt, S.st + 28 * dt);
  animatePlayer(dt);
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
  if (wpn === 'gs') { pose.shR = [-0.55, 0.35, -0.65]; pose.shL = [-0.7, -0.35, 0.75]; pose.elR = -1.35; pose.elL = -1.4; pose.handR = [0.55, 0, 0.1]; pose.torso = [0.08, 0, 0.05]; }
  else if (wpn === 'ss') { pose.shR = [-0.35, 0.1, 0.25]; pose.shL = [-0.85, 0, 0.55]; pose.elR = -0.55; pose.elL = -1.15; pose.handL = [0, -0.4, 0]; }
  else if (wpn === 'db') { pose.shR = [-0.45, 0.2, 0.55]; pose.shL = [-0.45, -0.2, -0.55]; pose.elR = pose.elL = -0.35; pose.handR = [0.2, 0, 0]; pose.handL = [0.2, 0, 0]; pose.torso = [0.05, 0, 0.08]; }
  // roar stun: reeling pose, can't act
  if (S.stunT > 0) {
    const shake = Math.sin(performance.now() / 40) * 0.08;
    pose.shR = [-1.6 + shake, 0.3, -0.6]; pose.shL = [-1.6 - shake, -0.3, 0.6];
    pose.elR = -0.8; pose.elL = -0.8; pose.handR = [0.2, 0, 0]; pose.handL = [0.2, 0, 0];
    pose.torso = [-0.45, shake * 2, 0]; pose.hipL = -0.35; pose.knL = 0.55; pose.hipR = 0.4; pose.knR = 0.4;
    pose.bob = -0.05;
  }
  // Guard: GS braces the greatsword; SnS raises the shield
  if (S.block) {
    if (wpn === 'gs') {
      pose.shR = [-1.35, 0.2, 0.85]; pose.shL = [-1.45, -0.15, 0.95]; pose.elR = -0.55; pose.elL = -0.65;
      pose.handR = [0.9, 0.2, 0]; pose.handL = [0.2, -0.4, 0]; pose.torso = [0.15, 0.35, 0];
      pose.hipL = -0.55; pose.knL = 0.7; pose.hipR = 0.4; pose.knR = 0.35; pose.bob = -0.08;
    } else {
      pose.shL = [-1.75, 0.1, 0.55]; pose.elL = -1.55; pose.handL = [0, -1.45, 0.2];
      pose.shR = [-0.9, 0, -0.35]; pose.elR = -0.7; pose.torso = [0.12, 0.4, 0];
      pose.hipL = -0.5; pose.knL = 0.6; pose.hipR = 0.35; pose.knR = 0.35;
    }
  }
  if (S.charge >= 0) { // great sword charge: towering wind-up, shakes near full
    const q = Math.min(1, S.charge / 1.6), shake = q > 0.85 ? Math.sin(performance.now() / 22) * (0.04 + q * 0.06) : 0;
    pose.shR = [-3.15 - q * 0.35 + shake, 0.15, -0.55]; pose.shL = [-3.15 - q * 0.35 + shake, -0.1, 0.55];
    pose.elR = pose.elL = -0.15; pose.handR = [1.45, 0.1, 0];
    pose.torso = [-0.45 * q, 0, 0]; pose.hipL = -0.7; pose.knL = 0.85; pose.hipR = 0.55; pose.knR = 0.25; pose.bob = 0.12 * q;
  }
  if (S.swing > 0) {
    const p = 1 - S.swing / Math.max(0.001, S.swingDur);
    const e = p < 0.28 ? p / 0.28 : 1; // snappy strike phase, long follow-through after
    const follow = THREE.MathUtils.smoothstep(p, 0.45, 1); // settle after impact
    const id = S.comboId || '';
    if (wpn === 'gs' || id === 'charge') {
      if (id === 'side' || id === 'wide') {
        const swing = THREE.MathUtils.smoothstep(p, 0.18, 0.48);
        pose.shR = [lerp(-1.6, 0.4, swing), 0.2, lerp(2.4, -2.1, swing)];
        pose.shL = [-1.1, -0.2, lerp(1.2, -0.3, swing)]; pose.elR = lerp(-0.15, -0.5, swing); pose.elL = -0.9;
        pose.handR = [lerp(1.1, 0.4, swing), 0, 0];
        pose.torso = [0.25, lerp(1.15, -1.2, swing), lerp(0.15, -0.2, swing)];
        pose.hipL = -0.65; pose.knL = 0.8; pose.hipR = 0.55; pose.knR = 0.35;
        pose.bob = lerp(0.05, -0.12, follow);
      } else if (id === 'slam' || id === 'crush' || id === 'trueCharge') {
        const wind = Math.min(1, p / 0.32), down = THREE.MathUtils.smoothstep(p, 0.28, 0.52);
        const a = lerp(lerp(-0.55, id === 'trueCharge' ? -3.6 : -3.45, wind), 0.85, down);
        pose.shR = [a, 0.1, -0.7]; pose.shL = [a, -0.1, 0.7]; pose.elR = pose.elL = lerp(-0.1, -0.35, down);
        pose.handR = [lerp(1.55, 0.2, down), 0, 0];
        pose.torso = [lerp(-0.65, 1.15, down), 0, 0];
        pose.hipL = -1.15 * down; pose.knL = 1.45 * down; pose.hipR = 0.85 * down; pose.knR = 0.55 * down;
        pose.bob = lerp(0.2 * wind, -0.55 * down, Math.max(wind, down));
      } else if (id === 'guardCut' || id === 'spinPrep') {
        pose.shR = [lerp(-2.4, 0.2, e), 0.3, lerp(1.6, -1.8, e)]; pose.shL = [-1.4, -0.2, 0.7];
        pose.elR = -0.2; pose.elL = -0.9; pose.handR = [lerp(1.1, 0.3, e), 0, 0];
        pose.torso = [0.2, lerp(0.6, -0.9, e), 0.1]; pose.hipL = -0.7; pose.knL = 0.85; pose.bob = -0.1 * e;
      } else if (id === 'whirl') {
        pose.shR = [lerp(-2.8, 0.5, e), 0.2, lerp(2.0, -2.2, e)]; pose.shL = [lerp(-2.2, -0.4, e), -0.2, lerp(-0.5, 1.6, e)];
        pose.elR = pose.elL = -0.15; pose.torso = [0.35, e * Math.PI * 2.2, 0.15];
        pose.hipL = -0.8; pose.knL = 1.0; pose.hipR = 0.6; pose.bob = Math.sin(e * Math.PI) * 0.35;
      } else { // overhead / charge
        const wind = Math.min(1, p / 0.3), down = THREE.MathUtils.smoothstep(p, 0.26, 0.5);
        const a = lerp(lerp(-0.6, -3.35, wind), 0.45, down);
        pose.shR = [a, 0.1, -0.5]; pose.shL = [a, -0.1, 0.5]; pose.elR = pose.elL = -0.12;
        pose.handR = [lerp(1.4, 0.35, down), 0, 0];
        pose.torso = [lerp(-0.55, 0.95, down), 0, 0];
        pose.hipL = -0.95 * down; pose.knL = 1.25 * down; pose.hipR = 0.7 * down; pose.knR = 0.55 * down;
        pose.bob = lerp(0.15 * wind, -0.4 * down, Math.max(wind, down));
      }
    } else if (wpn === 'ss') {
      if (id === 'back' || id === 'twist' || id === 'advSlash') {
        pose.shR = [lerp(-2.1, -0.4, e), 0.2, lerp(-1.3, 2.0, e)]; pose.elR = lerp(-0.1, -0.55, e);
        pose.handR = [lerp(0.9, 0.2, e), 0, 0]; pose.shL = [-1.1, 0, 0.55]; pose.elL = -1.15;
        pose.torso = [lerp(-0.25, 0.35, e), lerp(-0.95, 0.9, e), 0];
        pose.hipL = lerp(0.35, -0.55, e); pose.knL = lerp(0.2, 0.7, e); pose.hipR = lerp(-0.3, 0.4, e);
        pose.bob = Math.sin(e * Math.PI) * 0.12;
      } else if (id === 'bash' || id === 'bashSpin' || id === 'shieldBurst') {
        const punch = THREE.MathUtils.smoothstep(p, 0.15, 0.45);
        pose.shL = [lerp(-2.0, -0.55, punch), 0.2, lerp(-0.2, 1.55, punch)]; pose.elL = lerp(-0.2, -0.7, punch);
        pose.handL = [0, lerp(-0.4, -1.2, punch), 0]; pose.shR = [-1.0, 0, -0.45]; pose.elR = -0.6;
        pose.torso = [lerp(-0.15, 0.55, punch), lerp(-0.2, id === 'bashSpin' ? Math.PI : 0.55, punch), 0];
        pose.hipL = -0.85 * punch; pose.knL = 1.0 * punch; pose.hipR = 0.5 * punch; pose.bob = -0.18 * punch;
      } else if (id === 'rising' || id === 'flourish' || id === 'vault') {
        pose.shR = [lerp(-2.9, 0.15, e), 0.15, lerp(-0.4, 1.65, e)]; pose.elR = lerp(-0.05, -0.45, e);
        pose.shL = [lerp(-1.4, -0.7, e), 0, lerp(0.2, 0.9, e)]; pose.elL = -1.0;
        pose.torso = [lerp(-0.35, 0.65, e), e * Math.PI * (id === 'vault' ? 2.1 : 1.65), lerp(0.1, -0.15, e)];
        pose.hipL = -0.4; pose.knL = 0.55; pose.hipR = 0.35; pose.knR = 0.45;
        pose.bob = Math.sin(e * Math.PI) * (id === 'vault' ? 0.55 : 0.42);
      } else { // slash opener
        pose.shR = [lerp(-2.35, -0.25, e), 0.25, lerp(2.05, -1.1, e)]; pose.elR = lerp(-0.05, -0.5, e);
        pose.handR = [lerp(1.0, 0.25, e), 0, 0]; pose.shL = [-1.05, 0, 0.6]; pose.elL = -1.2;
        pose.torso = [0.18, lerp(0.85, -0.75, e), 0.08];
        pose.hipL = -0.55; pose.knL = 0.65; pose.hipR = 0.4; pose.knR = 0.3;
        pose.bob = Math.sin(e * Math.PI) * 0.1;
      }
    } else {
      // Dual Blades
      if (id === 'demon' || id === 'spiral' || id === 'bladeStorm' || id === 'tempest') {
        const spins = id === 'tempest' ? 5.5 : id === 'bladeStorm' ? 4.8 : 3.2;
        pose.shR = [-1.7, 0.35, 1.85 - Math.sin(p * Math.PI * spins) * 1.1];
        pose.shL = [-1.7, -0.35, -1.85 + Math.sin(p * Math.PI * spins) * 1.1];
        pose.elR = pose.elL = -0.02; pose.torso = [0.4, p * Math.PI * spins, 0.32];
        pose.hipL = -0.55; pose.knL = 0.7; pose.hipR = 0.55; pose.knR = 0.7;
        pose.bob = Math.sin(p * Math.PI * 2) * 0.18;
      } else if (id === 'cross' || id === 'hex') {
        pose.shR = [lerp(-1.85, -0.2, e), 0.35, lerp(2.1, -1.85, e)];
        pose.shL = [lerp(-1.85, -0.2, e), -0.35, lerp(-2.1, 1.85, e)];
        pose.elR = pose.elL = -0.05; pose.torso = [0.3, lerp(0.4, -0.4, e), 0.25];
        pose.hipL = lerp(0.45, -0.45, e); pose.knL = 0.55; pose.hipR = lerp(-0.45, 0.45, e); pose.knR = 0.55;
        pose.bob = Math.sin(e * Math.PI) * 0.14;
      } else if (id === 'flurry' || id === 'rush') {
        const wave = Math.sin(p * Math.PI * 5);
        pose.shR = [-1.75, 0.4, 1.7 - wave * 1.15]; pose.shL = [-1.75, -0.4, -1.7 + wave * 1.15];
        pose.elR = pose.elL = 0.05; pose.handR = [0.35, 0, 0]; pose.handL = [0.35, 0, 0];
        pose.torso = [0.4, p * Math.PI * 4.2, 0.35];
        pose.hipL = -0.55; pose.knL = 0.7; pose.hipR = 0.55; pose.knR = 0.7;
        pose.bob = 0.08 + Math.abs(wave) * 0.12;
      } else if (id === 'finisher' || id === 'razor') {
        pose.shR = [lerp(-2.2, 0.35, e), 0.45, lerp(2.2, -2.3, e)];
        pose.shL = [lerp(-2.2, 0.35, e), -0.45, lerp(-2.2, 2.3, e)];
        pose.elR = pose.elL = 0.1; pose.torso = [lerp(-0.2, 0.55, e), e * Math.PI * 2.8, 0.4];
        pose.hipL = -0.7; pose.knL = 0.9; pose.hipR = 0.7; pose.knR = 0.9;
        pose.bob = Math.sin(e * Math.PI) * 0.48;
      } else { // double
        pose.shR = [lerp(-1.5, -0.15, e), 0.25, lerp(1.65, -0.85, e)];
        pose.shL = [lerp(-0.6, -1.55, e), -0.25, lerp(-0.5, 1.55, e)];
        pose.elR = pose.elL = -0.1; pose.torso = [0.28, lerp(0.55, -0.55, e), 0.2];
        pose.hipL = -0.7; pose.knL = 0.85; pose.hipR = 0.55; pose.knR = 0.65; pose.bob = -0.1;
      }
      pose.handR = pose.handR || [0.3, 0, 0]; pose.handL = pose.handL || [0.3, 0, 0];
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
  const spinning = S.swing > 0 && /flurry|finisher|rising|demon|whirl|flourish|vault|bladeStorm|tempest|bashSpin|spiral|razor/.test(S.comboId || '');
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
  else if (S.comboRoute) pot += ` · ${S.comboRoute.replace(/A/g, '斬').replace(/S/g, '技')}`;
  else if (S.combo > 1) pot += ` · 連擊 ${S.combo}`;
  if (S.atkBoostT > 0) pot += ` · 攻↑`;
  if (S.stunT > 0) pot += ` · 震懾`;
  $('pot').textContent = pot;
  // debuff / buff icons
  const db = $('debuffs');
  if (db) {
    const bits = [];
    if (S.stunT > 0) bits.push(`<div class="db" style="color:#ff8080;border-color:#ff8080aa">震懾 ${S.stunT.toFixed(1)}s</div>`);
    if (S.atkBoostT > 0) bits.push(`<div class="db" style="color:#ffb040;border-color:#ffb040aa">攻↑ ${S.atkBoostT.toFixed(1)}s</div>`);
    if (S.debuffs.poison > 0) bits.push(`<div class="db" style="color:#8d8">毒 ${S.debuffs.poison.toFixed(1)}s</div>`);
    if (S.debuffs.slow > 0) bits.push(`<div class="db" style="color:#8cf">緩 ${S.debuffs.slow.toFixed(1)}s</div>`);
    if (S.debuffs.dark > 0) bits.push(`<div class="db" style="color:#ccc">暗 ${S.debuffs.dark.toFixed(1)}s</div>`);
    db.innerHTML = bits.join('');
  }
  const vig = $('vignette');
  if (vig) vig.style.opacity = S.debuffs.dark > 0 ? '0.55' : '0';
}
function syncBgmIntensity() {
  if (!S || S.over || bgmMode !== 'battle') return;
  const alive = livingDragons();
  const multi = dragons.length > 1;
  const enraged = alive.some(d => d.hp / d.maxHp < 0.35);
  BGM.setIntense(multi || enraged);
}
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05); time += dt;
  pollGamepad(dt);
  tickBgm();
  updateHitFlash(dt);
  if (S) {
    if (!S.over) {
      if (S.introT > 0) S.introT -= dt;
      else { updateDragons(dt, time); updateProjectiles(dt); }
      updatePlayer(dt);
      updateDebuffs(dt);
      syncBgmIntensity();
    } else {
      updateDragons(dt, time);
    }
  } else if (titleDragon) {
    titleDragon.root.rotation.y += dt * 0.2;
    animateDragonPose(titleDragon, dt, time, 0);
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i]; e.t -= dt; e.obj.position.addScaledVector(e.v, dt);
    if (e.grow) e.obj.scale.multiplyScalar(1 + dt * 3.5);
    else if (e.kind !== 'trail') e.v.y -= 18 * dt;
    if (e.kind === 'trail') e.obj.scale.z = Math.max(0.1, e.obj.scale.z * (1 - dt * 4));
    e.obj.material.opacity = Math.max(0, e.t * (e.kind === 'flash' ? 4 : 1.8));
    if (e.obj.rotation && e.kind === 'spark') e.obj.rotation.x += dt * 8;
    if (e.t <= 0) { scene.remove(e.obj); effects.splice(i, 1); }
  }
  updateFloaters(dt);
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
  updateObstacleFade(dt, target.x, lookY, target.z);
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('msg').textContent = ''; }
  hud();
  if (hasWebGL && pixelRT) {
    renderer.setRenderTarget(pixelRT); renderer.clear(); renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.clear(); renderer.render(blitScene, blitCam);
  } else renderer.render(scene, camera);
}

/** Fade obstacles that sit between camera and look-at (~30% opacity) */
function updateObstacleFade(dt, lookX, lookY, lookZ) {
  const cam = camera.position;
  const toLookX = lookX - cam.x, toLookY = lookY - cam.y, toLookZ = lookZ - cam.z;
  const lookLen = Math.hypot(toLookX, toLookY, toLookZ) || 1;
  const lx = toLookX / lookLen, ly = toLookY / lookLen, lz = toLookZ / lookLen;
  for (const o of OBSTACLES) {
    if (!o._mat) continue;
    // closest point on camera→player segment to obstacle center
    const ox = o.x - cam.x, oy = (sampleHeight(o.x, o.z) + o.h * 0.5) - cam.y, oz = o.z - cam.z;
    const t = THREE.MathUtils.clamp((ox * lx + oy * ly + oz * lz) / lookLen, 0.05, 0.92);
    const cx = cam.x + lx * t * lookLen, cy = cam.y + ly * t * lookLen, cz = cam.z + lz * t * lookLen;
    const rad = o.kind === 'rock' ? o.r + 1.4 : Math.max(o.w * 0.5, o.r) + 1.0;
    const near = Math.hypot(o.x - cx, (sampleHeight(o.x, o.z) + o.h * 0.5) - cy, o.z - cz) < rad + 1.8;
    const want = near ? 1 : 0;
    o._fade = THREE.MathUtils.lerp(o._fade || 0, want, 1 - Math.exp(-10 * dt));
    const opacity = THREE.MathUtils.lerp(1, 0.28, o._fade);
    o._mat.opacity = opacity;
    o._mat.transparent = opacity < 0.99;
    o._mat.depthWrite = opacity > 0.85;
  }
}
spawnTitleDragon();
frame();
window.__hunt = {
  run, get S() { return S; }, player, get dragons() { return dragons; }, get living() { return livingDragons(); },
  startFight, showPreview, generateEncounter, generateDragon, playerPower, estimatePower,
  pad, pollGamepad, WEAPONS, COMBOS, COMBO_TREE, sampleHeight, OBSTACLES, COLOR_DEFS, SFX, BGM, nearestDragon, beginComboHit, beginComboRoute, resetCombo,
  get PIXEL_SCALE() { return PIXEL_SCALE; }, pStats, DB_ATK_BUFF_T, DB_ATK_BUFF_MUL,
  goTitle, spawnTitleDragon, hurtPlayer, ensureAudio, spawnProjectile, pickAtk, dragonElems,
  doHit, spawnHitBurst, spawnDmgNumber, applyDragonPain, tryDragonPinRoar, applyRoarStun, beginComboHit, severTail, animatePlayer, buildWeapon,
  takeoffWindBlast, spawnWindBlastVfx, spawnChargeDust, ATK,
  get muted() { return muted; }, get bgmMuted() { return bgmMuted; }, get bgmMode() { return bgmMode; },
  get projectiles() { return projectiles; }, get effects() { return effects; }, get floaters() { return floaters; },
};
