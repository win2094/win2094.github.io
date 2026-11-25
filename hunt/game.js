import * as THREE from 'three';

const $ = id => document.getElementById(id);
const ARENA = 38;

// aggro 0→1 across fights: longer idle early, shorter late; windMul stretches telegraphs early
const DRAGONS = [
  { name: '火龍 雄火龍', body: 0xb3261e, belly: 0xe0a060, accent: 0x2a1a10, pattern: 'spots', horns: 'back', tail: 'club', breath: 'fire', hp: 700, dmg: 1.0, speed: 1.0, aggro: 0.35, windMul: 1.7 },
  { name: '角龍 黑角龍', body: 0xc8a46a, belly: 0xe8d6a8, accent: 0x5a4020, pattern: 'none', horns: 'huge', tail: 'mace', breath: 'sand', hp: 900, dmg: 1.15, speed: 1.05, aggro: 0.5, windMul: 1.5 },
  { name: '雷狼龍', body: 0x2d4f8a, belly: 0xe8d040, accent: 0xffe050, pattern: 'bands', horns: 'swept', tail: 'blade', breath: 'thunder', hp: 1100, dmg: 1.25, speed: 1.1, aggro: 0.65, windMul: 1.35 },
  { name: '轟龍', body: 0xe0b030, belly: 0xf0e0b0, accent: 0x2050a0, pattern: 'stripes', horns: 'stub', tail: 'spike', breath: 'roar', hp: 1300, dmg: 1.4, speed: 1.15, aggro: 0.8, windMul: 1.2 },
  { name: '黑龍 （終戰）', body: 0x15151a, belly: 0x3a2a30, accent: 0xa01020, pattern: 'veins', horns: 'crown', tail: 'long', breath: 'hellfire', hp: 2000, dmg: 1.6, speed: 1.2, aggro: 1.0, windMul: 1.05 },
];
const BREATH_COL = { fire: 0xff6020, sand: 0xd8c090, thunder: 0x80c0ff, roar: 0xffffff, hellfire: 0xff1030 };

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

// ---------- dragon ----------
let dragon = null;
function patternTex(d) {
  const c = n => '#' + n.toString(16).padStart(6, '0');
  // quieter low-res patterns — fewer marks, softer accent
  return canvasTex(24, 24, (g, w, h) => {
    g.fillStyle = c(d.body); g.fillRect(0, 0, w, h);
    g.fillStyle = c(d.accent);
    if (d.pattern === 'stripes') for (let x = 2; x < w; x += 8) g.fillRect(x, 0, 2, h);
    if (d.pattern === 'bands') for (let x = 3; x < w; x += 10) g.fillRect(x, 0, 1, h);
    if (d.pattern === 'spots') for (let i = 0; i < 6; i++) g.fillRect(4 + (i % 3) * 7, 4 + Math.floor(i / 3) * 10, 2, 2);
    if (d.pattern === 'veins') { g.fillRect(8, 2, 1, 10); g.fillRect(14, 8, 1, 12); g.fillRect(4, 14, 8, 1); }
  });
}
function buildDragon(def) {
  const root = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ map: patternTex(def), flatShading: true });
  const belly = std(def.belly), horn = std(def.horns === 'crown' ? 0x401010 : 0xe8e0c8), dark = std(def.accent);
  const mk = (geo, mat, x, y, z, parent = root) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const body = mk(new THREE.SphereGeometry(1, 12, 8), skin, 0, 3.2, 0); body.scale.set(2.0, 1.8, 3.4);
  mk(new THREE.SphereGeometry(1, 10, 8), belly, 0, 2.5, 0.3).scale.set(1.6, 1.2, 2.8);
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
    const mem = mk(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(4.3 * s, 1.5, 0), new THREE.Vector3(3.5 * s, -1.2, -3.5)]), new THREE.MeshLambertMaterial({ color: def.belly, side: THREE.DoubleSide, transparent: true, opacity: 0.9, flatShading: true }), 0, 0, 0, g);
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
  // ~1.8× former base speed so walk/run feel responsive on phone
  return { maxHp: 100 + s.hp * 20, atk: 1 + s.atk * 0.1, def: Math.pow(0.92, s.def), maxSt: 100 + s.sta * 20, spd: 13.5 * (1 + s.spd * 0.06) };
}

function startFight() {
  if (dragon) scene.remove(dragon.root);
  effects.splice(0).forEach(e => scene.remove(e.obj));
  scene.children.filter(o => o.userData.severed).forEach(o => scene.remove(o));
  const def = DRAGONS[run.fight], ps = pStats();
  dragon = buildDragon(def);
  buildWeapon(run.weapon);
  dragon.root.position.set(0, sampleHeight(0, 18), 18); dragon.root.rotation.y = Math.PI;
  player.position.set(0, sampleHeight(0, -16), -16); player.rotation.y = 0; camYaw = 0;
  S = {
    def, ps, hp: ps.maxHp, st: ps.maxSt, potions: 3, cd: 0, swing: 0, swingDur: 0, charge: -1, block: false, dodgeT: 0, invuln: 0, drinkT: 0, hurtT: 0,
    combo: 0, comboStep: 0, atkBuf: false, comboWin: 0, comboId: '',
    dhp: def.hp, dmax: def.hp, tailHp: def.hp * 0.22, severed: false,
    ai: { state: 'idle', t: 2.4 + (1 - def.aggro) * 1.2, atk: null, dir: new THREE.Vector3(), hit: false, lastAtk: '' }, over: false, introT: 2.2,
  };
  $('dname').textContent = `第${run.fight + 1}戰：${def.name}`;
  $('pname').textContent = `獵人（${WEAPONS[run.weapon].name}）`;
  showMsg(`第${run.fight + 1}戰\n${def.name}`, 2);
  ['title', 'stats', 'over'].forEach(id => $(id).classList.add('hidden'));
  $('help')?.classList.add('hidden');
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
// touch: always show on coarse/touch devices; gamepad can be used at the same time
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
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
  if (optNow && !padPrev.options) { S = null; ['stats', 'over'].forEach(id => $(id).classList.add('hidden')); $('title').classList.remove('hidden'); $('help')?.classList.remove('hidden'); }
  padPrev.options = optNow;
  const shareNow = gpBtn(gp, 8);
  if (shareNow && !padPrev.share) { muted = !muted; $('mute').textContent = muted ? '🔇 靜' : '🔊 聲'; }
  padPrev.share = shareNow;
}

// ---------- UI panels ----------
document.querySelectorAll('#title button').forEach(b => b.onclick = () => { run.weapon = b.dataset.w; run.fight = 0; run.pts = 0; for (const k in run.stats) run.stats[k] = 0; snd(440); startFight(); });
$('restart').onclick = () => { S = null; ['stats', 'over'].forEach(id => $(id).classList.add('hidden')); $('title').classList.remove('hidden'); $('help')?.classList.remove('hidden'); };
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

function doHit(mult, label, rangeMul = 1) {
  const w = WEAPONS[run.weapon];
  const reach = (rangeMul || 1) * w.range;
  const front = tmp.set(Math.sin(player.rotation.y), 0, Math.cos(player.rotation.y));
  const hitPt = tmp2.copy(player.position).addScaledVector(front, reach * 0.6);
  hitPt.y = 0;
  // candidate parts: body, head, tail
  const parts = [
    { kind: 'body', p: worldPos(dragon.root).setY(0), r: 3.4 },
    { kind: 'head', p: worldPos(dragon.head).setY(0), r: 1.8 },
  ];
  if (!S.severed) dragon.tailSegs.slice(1).forEach(s => parts.push({ kind: 'tail', p: worldPos(s).setY(0), r: 1.4 }));
  let best = null, bd = 1e9;
  for (const c of parts) { const d = flatDist(hitPt, c.p) - c.r; if (d < bd) { bd = d; best = c; } }
  if (!best || bd > reach * 0.6) { snd(300, 0.05, 'triangle', 0.05); return; }
  let dmg = w.dmg * mult * S.ps.atk * (best.kind === 'head' ? 1.4 : 1);
  S.dhp -= dmg;
  spawnSpark(best.p.clone().setY(player.position.y + 2.2), best.kind === 'tail' ? 0xe8d090 : 0xc05050);
  snd(best.kind === 'head' ? 220 : 180, 0.08, 'square', 0.1);
  if (label) showMsg(label, 0.55);
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
  for (let i = 0; i < 2; i++) spawnSpark(wp.clone(), 0x8a3030);
}

function spawnSpark(p, col) {
  if (effects.length > 10) return; // keep scene calm
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 4, 3), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7 }));
  m.position.copy(p); scene.add(m);
  effects.push({ obj: m, t: 0.28, v: new THREE.Vector3((Math.random() - .5) * 4, Math.random() * 3, (Math.random() - .5) * 4) });
}
function spawnBreath(origin, dir, col) {
  if (effects.length > 14) return;
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 5, 4), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55 }));
  m.position.copy(origin); scene.add(m);
  effects.push({ obj: m, t: 0.7, v: dir.clone().multiplyScalar(22).add(new THREE.Vector3((Math.random() - .5) * 1.5, (Math.random() - .5), (Math.random() - .5) * 1.5)), grow: true });
}

// ---------- dragon AI ----------
const ATTACKS = {
  bite:   { name: '咬！', wind: 1.35, act: 0.4, rec: 1.15, range: 9 },
  tail:   { name: '甩尾！', wind: 1.5, act: 0.75, rec: 1.25, range: 10 },
  charge: { name: '衝撞！', wind: 1.7, act: 1.35, rec: 1.55, range: 40 },
  breath: { name: '吐息！', wind: 1.85, act: 1.15, rec: 1.45, range: 22 },
};
function idleCooldown(def) {
  // 1.5–3s+ between attacks; early dragons linger, late ones press harder
  const lo = 1.5 + (1 - def.aggro) * 1.2;
  const hi = 2.2 + (1 - def.aggro) * 1.4;
  return lo + Math.random() * (hi - lo);
}
function pickAttack(def, dist, behind, lastAtk) {
  // Distance-driven, low randomness; avoid repeating the same move
  let pick;
  if (behind && dist < 12) pick = 'tail';
  else if (dist < 7.5) pick = def.aggro < 0.55 ? 'bite' : (Math.random() < 0.7 ? 'bite' : 'tail');
  else if (dist < 14) {
    if (def.aggro < 0.45) pick = 'bite';
    else if (def.aggro < 0.7) pick = Math.random() < 0.65 ? 'breath' : 'bite';
    else pick = Math.random() < 0.55 ? 'breath' : (Math.random() < 0.5 ? 'charge' : 'bite');
  } else if (dist < 22) {
    pick = def.aggro < 0.5 ? (Math.random() < 0.7 ? 'breath' : 'charge') : (Math.random() < 0.45 ? 'breath' : 'charge');
  } else pick = 'charge';
  if (pick === lastAtk) {
    if (pick === 'bite') pick = dist < 10 ? 'tail' : 'breath';
    else if (pick === 'breath') pick = dist > 12 ? 'charge' : 'bite';
    else if (pick === 'charge') pick = 'breath';
    else pick = 'bite';
  }
  return pick;
}
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
    const diff = turn(wantYaw, 1.6 * def.speed);
    const chase = 3.2 + def.aggro * 2.2;
    if (dist > 9) { d.position.addScaledVector(fwd, chase * def.speed * dt); walk = 1; }
    else if (dist < 5 && def.aggro > 0.6) { d.position.addScaledVector(fwd, -1.5 * dt); walk = 1; }
    if (ai.t <= 0) {
      const pick = pickAttack(def, dist, Math.abs(diff) > 1.55, ai.lastAtk);
      ai.atk = pick; ai.lastAtk = pick; ai.state = 'wind';
      ai.t = ATTACKS[pick].wind * (def.windMul || 1); ai.hit = false;
      snd(90, 0.4, 'sawtooth', 0.12, 40);
    }
  } else if (ai.state === 'wind') {
    const A = ATTACKS[ai.atk];
    $('tele').textContent = '⚠ ' + A.name;
    // Lock facing during most of telegraph; slight track only early in wind
    if (ai.atk !== 'tail' && ai.t > A.wind * (def.windMul || 1) * 0.35) turn(wantYaw, 1.8);
    if (ai.atk === 'bite') dragon.neck.rotation.x = -0.45;
    if (ai.atk === 'tail') { d.rotation.y -= dt * 0.35; dragon.tailBase.rotation.y = 0.9; }
    if (ai.atk === 'charge') { d.position.y = Math.abs(Math.sin(t * 12)) * 0.12; }
    if (ai.atk === 'breath') { dragon.neck.rotation.x = -0.65; dragon.jaw.rotation.x = 0.35; }
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
      d.position.addScaledVector(ai.dir, 20 * def.speed * dt); walk = 2;
      if (!ai.hit && dist < 4.0) { ai.hit = true; hurtPlayer(35, d.position); }
    } else if (ai.atk === 'breath') {
      dragon.neck.rotation.x = -0.1; dragon.jaw.rotation.x = 0.6;
      const mouth = worldPos(dragon.head).addScaledVector(fwd, 2);
      if (Math.random() < 0.35) spawnBreath(mouth, ai.dir.clone().setY(-0.15).normalize(), BREATH_COL[def.breath]);
      const rel = tmp2.copy(player.position).sub(d.position).setY(0);
      const ang = rel.angleTo(ai.dir);
      if (!ai.hit && ang < 0.35 && rel.length() < A.range) { ai.hit = true; hurtPlayer(30, d.position); }
    }
    if (ai.t <= 0) { ai.state = 'rec'; ai.t = A.rec * (1.05 + (1 - def.aggro) * 0.25); }
  } else if (ai.state === 'rec') {
    if (ai.atk === 'charge') d.position.addScaledVector(ai.dir, Math.max(0, ai.t) * 6 * dt);
    if (ai.t <= 0) { ai.state = 'idle'; ai.t = idleCooldown(def); }
  }
  // keep in arena + crash into obstacles while charging
  const r = Math.hypot(d.position.x, d.position.z);
  if (r > ARENA - 4) { d.position.x *= (ARENA - 4) / r; d.position.z *= (ARENA - 4) / r; if (ai.atk === 'charge' && ai.state === 'act') { ai.state = 'rec'; ai.t = 1.5; snd(60, 0.5, 'sawtooth', 0.2); } }
  const before = { x: d.position.x, z: d.position.z };
  pushOutObstacles(d.position, 3.2);
  if ((ai.state === 'act' || ai.state === 'wind') && ai.atk === 'charge' && (Math.abs(d.position.x - before.x) + Math.abs(d.position.z - before.z)) > 0.02) {
    ai.state = 'rec'; ai.t = 1.8; ai.hit = true; snd(70, 0.45, 'sawtooth', 0.18); showMsg('撞石！', 0.7);
  }
  d.position.y = sampleHeight(d.position.x, d.position.z);
  // anim
  const ph = t * (walk === 2 ? 14 : 7);
  dragon.legs.forEach((l, i) => l.rotation.x = walk ? Math.sin(ph + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.5 : 0);
  dragon.wings.forEach((w, i) => w.rotation.z = Math.sin(t * 2) * 0.1 * (i ? 1 : -1) + (ai.state === 'wind' ? (i ? 0.4 : -0.4) : 0));
  dragon.tailSegs.forEach((s, i) => { if (i) s.rotation.y = Math.sin(t * 2.5 - i * 0.6) * 0.12; });
  // body collision with player
  if (dist < 3.8) player.position.addScaledVector(toP.normalize(), 3.8 - dist);
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
  const v = tmp.copy(dragon.root.position).sub(player.position);
  if (v.length() < 14) player.rotation.y = Math.atan2(v.x, v.z);
  doHit(hit.dmg, hit.label, hit.range / WEAPONS[run.weapon].range);
  snd(170 + step * 35, 0.07, 'square', 0.1);
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
  let speed = S.ps.spd * w.speedMul;
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
      snd(500, 0.08, 'triangle', 0.06); S.charge = -1; S.swing = 0; S.drinkT = 0; resetCombo();
    }
  }
  if (S.dodgeT > 0 || dir.lengthSq() <= 0.01 || S.hurtT > 0) S.moveAmt = 0;
  if (input.potion) { input.potion = false; if (S.potions > 0 && S.drinkT <= 0 && S.hp < S.ps.maxHp) { S.potions--; S.drinkT = 1.0; snd(700, 0.3, 'sine', 0.1, 300); resetCombo(); } }
  if (S.drinkT > 0) { S.drinkT -= dt; S.hp = Math.min(S.ps.maxHp, S.hp + S.ps.maxHp * 0.4 * dt); }
  const faceDragon = () => { const v = tmp.copy(dragon.root.position).sub(player.position); if (v.length() < 14) player.rotation.y = Math.atan2(v.x, v.z); };
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
  $('dhp').style.width = (S.dhp / S.dmax * 100) + '%';
  let pot = `藥水 ×${S.potions}`;
  if (S.charge >= 0) pot += ` · 蓄力`;
  else if (S.combo > 1) pot += ` · 連擊 ${S.combo}`;
  $('pot').textContent = pot;
  $('tail').textContent = S.severed ? '尾：已斷' : `尾：${Math.ceil(Math.max(0, S.tailHp) / (S.dmax * 0.22) * 100)}%`;
}
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05); time += dt;
  pollGamepad(dt);
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
  const dist = 11;
  const lookY = target.y + 2.5;
  camera.position.set(target.x - Math.sin(camYaw) * dist * Math.cos(camPitch), lookY + Math.sin(camPitch) * dist * 0.85, target.z - Math.cos(camYaw) * dist * Math.cos(camPitch));
  camera.lookAt(target.x, lookY, target.z);
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('msg').textContent = ''; }
  hud();
  // pixel-art: render scene to low-res RT, nearest-neighbor blit to screen
  if (hasWebGL && pixelRT) {
    renderer.setRenderTarget(pixelRT);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(blitScene, blitCam);
  } else {
    renderer.render(scene, camera);
  }
}
// title backdrop dragon
dragon = buildDragon(DRAGONS[0]); dragon.root.position.set(0, sampleHeight(0, 10), 10);
frame();
window.__hunt = { run, get S() { return S; }, player, startFight, severTail, pad, pollGamepad, refreshPadPresence, input, keys, PIXEL_SCALE, pStats, ATTACKS, idleCooldown, pickAttack, COMBOS, sampleHeight, OBSTACLES, HEIGHT_ZONES, pushOutObstacles, beginComboHit, resetCombo };
