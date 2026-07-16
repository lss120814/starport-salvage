const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('game.html', 'utf8');
const match = source.match(/const stages=(\[[\s\S]*?\]);let stage=/);
if (!match) throw new Error('stage configuration not found');
const stages = vm.runInNewContext(match[1]);

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function simulateStage(stageIndex, options, seed) {
  const cfg = stages[stageIndex];
  const random = seeded(seed);
  const yieldMult = options.yieldMult || 1;
  const rareBoost = options.rarecore ? 0.06 : 0;
  const hazardBoost = options.rarecore ? 0.04 : 0;
  let elapsed = 0;
  let cargoClock = 0.35;
  let hazardClock = 0;
  let progress = 0;
  let credits = 0;
  let hazards = 0;
  let gateAt = null;

  while (elapsed < cfg.time) {
    const dt = 1 / 60;
    elapsed += dt;
    cargoClock += dt;
    hazardClock += dt;
    const gate = gateAt !== null;
    const cargoInterval = cfg.cargo * (gate ? 1.24 : 1);
    const ramp = 1 - Math.min(0.3, elapsed / cfg.time * 0.3);
    const hazardInterval = cfg.hazard * ramp * (1 - hazardBoost);

    if (cargoClock >= cargoInterval) {
      cargoClock = 0;
      const cacheChance = stageIndex > 0 && elapsed > cfg.min * 0.42
        ? 0.025 + stageIndex * 0.018
        : 0;
      const rareChance = 0.13 + rareBoost + stageIndex * 0.025;
      const roll = random();
      const raw = roll < cacheChance ? 70 : roll < cacheChance + rareChance ? 30 : 10;
      const base = Math.floor(raw * cfg.mult);
      const quotaPart = Math.min(base, Math.max(0, cfg.target - progress));
      const overflowPart = base - quotaPart;
      progress += base;
      credits += (quotaPart + overflowPart * 0.35) * yieldMult;
    }
    if (hazardClock >= hazardInterval) {
      hazardClock = 0;
      hazards += 1;
    }
    if (gateAt === null && progress >= cfg.target && elapsed >= cfg.min) gateAt = elapsed;
    if (gateAt !== null && elapsed - gateAt >= 1.2) break;
  }
  return { credits, hazards, elapsed, progress };
}

function average(options) {
  const totals = stages.map(() => ({ credits: 0, hazards: 0 }));
  for (let seed = 1; seed <= 2000; seed += 1) {
    stages.forEach((_, stage) => {
      const result = simulateStage(stage, options, seed * 17 + stage * 997);
      totals[stage].credits += result.credits;
      totals[stage].hazards += result.hazards;
    });
  }
  return totals.map((total) => ({
    credits: Math.round(total.credits / 2000),
    hazards: Math.round(total.hazards / 2000),
  }));
}

const baseline = average({ yieldMult: 1, rarecore: false });
const upgraded = average({ yieldMult: 1.18, rarecore: false });
const rarecore = average({ yieldMult: 1.18, rarecore: true });
console.log(JSON.stringify({ baseline, upgraded, rarecore }));

if (!(baseline[0].credits < baseline[1].credits && baseline[1].credits < baseline[2].credits)) {
  throw new Error('later maps are not consistently richer');
}
if (!upgraded.every((value, index) => value.credits > baseline[index].credits * 1.15)) {
  throw new Error('yield upgrades do not provide their intended value');
}
if (!rarecore.every((value, index) => value.credits > upgraded[index].credits)) {
  throw new Error('rarecore does not increase expected income');
}
if (!rarecore.every((value, index) => value.hazards > upgraded[index].hazards)) {
  throw new Error('rarecore does not increase ambient danger');
}
