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
code = code.replace("if(danger){hit(o);if(o.kind!=='boss')objects.splice(i,1)}", "if(danger){if(o.kind!=='boss')objects.splice(i,1)}");
code = code.replace('time:78', 'time:180').replace('time:98', 'time:220').replace('time:118', 'time:260');
code = code.replace('hit(s);enemyShots.splice(i,1)', 'enemyShots.splice(i,1)');

let raf = null;
let now = 0;
let cargoDraws = 0;
let frameSprites = 0;
let maxSprites = 0;
let stagePasses = 0;
let moduleSelections = 0;
let moduleButtons = [];
let buildSelections = 0;
let buildButtons = [];
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
    if (sx === 515 || sx === 810) cargoDraws += 1;
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
      if (selector === '[data-build]') {
        const ids = [...element('moduleGrid').innerHTML.matchAll(/data-build="([^"]+)"/g)].map(m => m[1]);
        buildButtons = ids.map(id => ({
          dataset: { build: id }, onclick: null,
          classList: { add() {}, remove() {}, toggle() {} },
        }));
        return buildButtons;
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
    constructor() { this.complete = true; this.naturalWidth = 1536; this.naturalHeight = 1024; }
  },
  innerWidth: 1200,
  innerHeight: 800,
  devicePixelRatio: 1.5,
  location: { href: '', search: '?threat=2', reload() {} },
  URLSearchParams,
  navigator: {},
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

for (let frame = 1; frame <= 50000; frame += 1) {
  if (!raf) {
    if (element('reportCode').textContent === 'FIELD BUILD AVAILABLE') {
      if (buildButtons.length !== 3 || !buildButtons[0].onclick) throw new Error('build choice cards were not wired');
      buildButtons[0].onclick();
      buildSelections += 1;
      continue;
    }
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
  if (stagePasses === 0 && missionValue.includes('✓')) missionCompleted[0] = true;
  if (stagePasses === 1 && missionValue.includes('✓') && missionValue.includes('10.0')) missionCompleted[1] = true;
  if (stagePasses === 2 && missionValue.includes('✓') && missionValue.includes('3/3')) missionCompleted[2] = true;
  if (label === '航道扫描中' || label === '撤离门已开启') {
    cargoAfterGoal[stagePasses] += cargoDraws;
  }
  const held = Number.parseInt(element('holdState').textContent, 10) || 0;
  const relays = [[192,160],[1008,160],[192,576]];
  if (held >= 3 && canvas.onpointermove) canvas.onpointermove({ clientX: relays[stagePasses][0], clientY: relays[stagePasses][1] });
  else if (stagePasses === 1 && canvas.onpointermove && label !== '深层航段门') canvas.onpointermove({ clientX: 600, clientY: 336 });
  else if (canvas.onpointermove && label !== '深层航段门') canvas.onpointermove({ clientX: 600, clientY: 620 });
  if (label === '深层航段门' && canvas.onpointermove) {
    canvas.onpointermove({ clientX: 600, clientY: 144 });
  }
}

const sprite = fs.readFileSync('assets/salvage-sprites-v12.png');
const pngSignature = sprite.subarray(0, 8).toString('hex');
const result = {
  report: element('reportCode').textContent,
  stagePasses,
  moduleSelections,
  buildSelections,
  missionCompleted,
  pulseActivated,
  pulseReadyAgain,
  cargoAfterGoal,
  credits: element('runCredits').textContent,
  maxSprites,
  supplyState: element('supplyState').textContent,
  pngSignature,
};
console.log(JSON.stringify(result));

if (result.report !== 'EXTRACTION CONFIRMED') throw new Error('three-stage run did not finish');
if (stagePasses !== 2) throw new Error('stage transitions failed');
if (moduleSelections !== 2) throw new Error('run module choices failed');
if (buildSelections < 3) throw new Error('field build choices did not trigger');
if (missionCompleted.some(value => !value)) throw new Error('distinct stage missions did not complete');
if (!pulseActivated) throw new Error('spacebar pulse did not activate');
if (!pulseReadyAgain) throw new Error('pulse did not return to ready state');
if (cargoAfterGoal.reduce((sum, count) => sum + count, 0) < 100) throw new Error('cargo stopped after goal');
if (maxSprites > 70) throw new Error(`object rendering budget exceeded: ${maxSprites}`);
if (pngSignature !== '89504e470d0a1a0a') throw new Error('sprite atlas is not a PNG');
