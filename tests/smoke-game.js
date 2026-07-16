const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('game.html', 'utf8');
let code = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
if (!code) throw new Error('game script not found');
if (!code.includes("if(!sprites.complete||!sprites.naturalWidth)return drawObjectVector(o)")) {
  throw new Error('object sprite fallback missing');
}
if (!code.includes("ship.x=W/2;ship.y=H*.78") || !code.includes('pointerActive=false')) {
  throw new Error('stage transition does not reset ship and input');
}

// Keep collection and navigation live, but make hazards non-lethal so the
// deterministic smoke run can exercise all three stages.
code = code.replace('danger?hit(o):collect(o)', 'danger?void 0:collect(o)');

let raf = null;
let now = 0;
let cargoDraws = 0;
let frameSprites = 0;
let maxSprites = 0;
let stagePasses = 0;
const cargoAfterGoal = [0, 0, 0];
const elements = new Map();

function element(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      textContent: '',
      style: {},
      classList: { add() {}, remove() {}, contains() { return false; } },
      onclick: null,
    });
  }
  return elements.get(id);
}

const context2d = new Proxy({
  setTransform() {}, save() {}, restore() {}, translate() {}, rotate() {},
  fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
  closePath() {}, fill() {}, stroke() {}, arc() {}, setLineDash() {}, fillText() {},
  createRadialGradient() { return { addColorStop() {} }; },
  drawImage(image, sx, sy) {
    frameSprites += 1;
    if (sy === 0 && (sx === 256 || sx === 512)) cargoDraws += 1;
  },
}, {
  get(target, key) { return key in target ? target[key] : (() => {}); },
  set(target, key, value) { target[key] = value; return true; },
});

const canvas = Object.assign(element('game'), {
  getContext: () => context2d,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
  setPointerCapture() {},
});

const sandbox = {
  document: {
    querySelector: (selector) => selector === '#game' ? canvas : element(selector.slice(1)),
    querySelectorAll: () => [],
  },
  localStorage: {
    getItem: () => JSON.stringify({ version: 4, credits: 0, owned: [] }),
    setItem() {},
  },
  Image: class Image {
    constructor() { this.complete = true; this.naturalWidth = 768; }
  },
  innerWidth: 1200,
  innerHeight: 800,
  devicePixelRatio: 1,
  location: { href: '' },
  performance: { now: () => now },
  requestAnimationFrame: (callback) => { raf = callback; },
  addEventListener() {},
  setTimeout() {},
  console,
};

sandbox.Math = Object.create(Math);
sandbox.Math.random = function deterministicRandom() {
  const stack = new Error().stack || '';
  if (stack.includes('spawnAmbientHazard')) return 0.05;
  if (stack.includes('dangerWave')) return 0.5;
  if (stack.includes('spawnCargo')) return 0.5;
  return 0.5;
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox);

for (let frame = 1; frame <= 12000; frame += 1) {
  if (!raf) {
    if (element('reportCode').textContent === 'STAGE SECURED' && stagePasses < 2) {
      stagePasses += 1;
      element('continue').onclick();
      continue;
    }
    break;
  }

  cargoDraws = 0;
  frameSprites = 0;
  now = frame * 16.6667;
  const callback = raf;
  raf = null;
  callback(now);
  maxSprites = Math.max(maxSprites, frameSprites);

  const label = element('objectiveLabel').textContent;
  if (label === '航道扫描中' || label === '撤离门已开启') {
    cargoAfterGoal[stagePasses] += cargoDraws;
  }
  if (label === '撤离门已开启' && canvas.onpointermove) {
    canvas.onpointermove({ clientX: 600, clientY: 144 });
  }
}

const sprite = fs.readFileSync('assets/salvage-sprites.png');
const pngSignature = sprite.subarray(0, 8).toString('hex');
const result = {
  report: element('reportCode').textContent,
  stagePasses,
  cargoAfterGoal,
  credits: element('runCredits').textContent,
  maxSprites,
  supplyState: element('supplyState').textContent,
  pngSignature,
};
console.log(JSON.stringify(result));

if (result.report !== 'EXTRACTION CONFIRMED') throw new Error('three-stage run did not finish');
if (stagePasses !== 2) throw new Error('stage transitions failed');
if (cargoAfterGoal.some((count) => count < 30)) throw new Error('cargo stopped after goal');
if (maxSprites > 70) throw new Error(`object rendering budget exceeded: ${maxSprites}`);
if (!result.supplyState.includes('35% 货值')) throw new Error('overflow cargo rule is not visible');
if (pngSignature !== '89504e470d0a1a0a') throw new Error('sprite atlas is not a PNG');
