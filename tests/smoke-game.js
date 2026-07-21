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
let sawOverflowRule = false;
let moduleSelections = 0;
let moduleButtons = [];
const missionCompleted = [false, false, false];
const cargoAfterGoal = [0, 0, 0];
const elements = new Map();
const eventHandlers = {};

function element(id) {
  if (!elements.has(id)) {
    const classes = new Set(id === 'modal' ? ['hidden'] : []);
    elements.set(id, {
      id,
      textContent: '',
      style: {},
      classList: {
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        toggle(name, force) { const on = force === undefined ? !classes.has(name) : force; on ? classes.add(name) : classes.delete(name); return on; },
        contains(name) { return classes.has(name); },
      },
      onclick: null,
      disabled: false,
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
    addEventListener() {},
    hidden: false,
    querySelectorAll: (selector) => {
      if (selector === '[data-module]') {
        const ids = [...element('moduleGrid').innerHTML.matchAll(/data-module="([^"]+)"/g)].map(m => m[1]);
        moduleButtons = ids.map(id => ({
          dataset: { module: id }, onclick: null,
          classList: { add() {}, remove() {}, toggle() {} },
        }));
        return moduleButtons;
      }
      if (selector === '.module-card') return moduleButtons;
      return [];
    },
  },
  localStorage: {
    getItem: () => JSON.stringify({ version: 4, credits: 0, owned: [] }),
    setItem() {},
  },
  sessionStorage: {
    getItem: () => JSON.stringify({ version: 4, credits: 0, owned: [] }),
    setItem() {},
  },
  Image: class Image {
    constructor() { this.complete = true; this.naturalWidth = 768; }
  },
  innerWidth: 1200,
  innerHeight: 800,
  devicePixelRatio: 1.5,
  location: { href: '', search: '?threat=2', reload() {} },
  URLSearchParams,
  performance: { now: () => now },
  requestAnimationFrame: (callback) => { raf = callback; },
  addEventListener(type, handler) { eventHandlers[type] = handler; },
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

eventHandlers.keydown({ key: 'Escape', code: 'Escape', repeat: false, preventDefault() {} });
if (element('reportCode').textContent !== 'SYSTEM PAUSED' || element('modal').classList.contains('hidden')) {
  throw new Error('escape did not pause the game');
}
eventHandlers.keydown({ key: 'Escape', code: 'Escape', repeat: false, preventDefault() {} });
if (!element('modal').classList.contains('hidden')) throw new Error('escape did not resume the game');
eventHandlers.keydown({ key: ' ', code: 'Space', repeat: false, preventDefault() {} });
let pulseActivated = false;
let pulseReadyAgain = false;

for (let frame = 1; frame <= 12000; frame += 1) {
  if (!raf) {
    if (element('reportCode').textContent === 'SECTOR MODULE RECOVERED' && stagePasses < 2) {
      if (moduleButtons.length !== 3 || !moduleButtons[0].onclick) throw new Error('module choice cards were not wired');
      moduleButtons[0].onclick();
      if (element('continue').disabled) throw new Error('module selection did not enable continuation');
      moduleSelections += 1;
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
  const missionValue = element('missionValue').textContent;
  if (element('systemStatus').textContent.includes('充能')) pulseActivated = true;
  if (pulseActivated && element('systemStatus').textContent.includes('READY')) pulseReadyAgain = true;
  if (stagePasses === 0 && missionValue === '回收链路在线') missionCompleted[0] = true;
  if (stagePasses === 1 && missionValue.startsWith('10.0')) missionCompleted[1] = true;
  if (stagePasses === 2 && missionValue.startsWith('3 / 3')) missionCompleted[2] = true;
  if (element('supplyState').textContent.includes('35%')) sawOverflowRule = true;
  if (label === '航道扫描中' || label === '撤离门已开启') {
    cargoAfterGoal[stagePasses] += cargoDraws;
  }
  if (stagePasses === 1 && canvas.onpointermove && label !== '撤离门已开启') {
    canvas.onpointermove({ clientX: 600, clientY: 336 });
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
  moduleSelections,
  missionCompleted,
  pulseActivated,
  pulseReadyAgain,
  cargoAfterGoal,
  credits: element('runCredits').textContent,
  maxSprites,
  supplyState: element('supplyState').textContent,
  sawOverflowRule,
  pngSignature,
};
console.log(JSON.stringify(result));

if (result.report !== 'EXTRACTION CONFIRMED') throw new Error('three-stage run did not finish');
if (stagePasses !== 2) throw new Error('stage transitions failed');
if (moduleSelections !== 2) throw new Error('run module choices failed');
if (missionCompleted.some(value => !value)) throw new Error('distinct stage missions did not complete');
if (!pulseActivated) throw new Error('spacebar pulse did not activate');
if (!pulseReadyAgain) throw new Error('pulse did not return to ready state');
if (cargoAfterGoal.some((count) => count < 30)) throw new Error('cargo stopped after goal');
if (maxSprites > 70) throw new Error(`object rendering budget exceeded: ${maxSprites}`);
if (!result.sawOverflowRule) throw new Error('overflow cargo rule is not visible');
if (pngSignature !== '89504e470d0a1a0a') throw new Error('sprite atlas is not a PNG');
