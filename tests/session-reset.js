const fs = require('fs');
const vm = require('vm');

const home = fs.readFileSync('index.html', 'utf8');
const match = home.match(/const KEY=.*?const has=/s);
if (!match) throw new Error('session bootstrap not found');
const bootstrap = match[0].replace(/const has=$/, '');
const KEY = 'void-salvage-tree-v4';
const storage = map => ({
  getItem: key => map.has(key) ? map.get(key) : null,
  setItem: (key, value) => map.set(key, String(value)),
});
const run = session => vm.runInNewContext(bootstrap, { sessionStorage: storage(session), JSON });

const tabA = new Map();
run(tabA);
const freshA = JSON.parse(tabA.get(KEY));
if (freshA.credits !== 0 || freshA.owned.length || freshA.runs !== 0 || freshA.victories !== 0) {
  throw new Error('new tab did not start with fresh progression');
}

tabA.set(KEY, JSON.stringify({ version: 4, credits: 123, owned: ['engine1'], runs: 1, victories: 0 }));
run(tabA);
const sameTab = JSON.parse(tabA.get(KEY));
if (sameTab.credits !== 123 || sameTab.owned[0] !== 'engine1') {
  throw new Error('navigation inside one tab reset progression');
}

const tabB = new Map();
run(tabB);
const freshB = JSON.parse(tabB.get(KEY));
if (freshB.credits !== 0 || freshB.owned.length) throw new Error('new tab did not receive an independent fresh tree');
if (JSON.parse(tabA.get(KEY)).credits !== 123) throw new Error('opening another tab erased the first tab');

console.log(JSON.stringify({ newTabFresh: true, sameTabPreserved: true, tabsIsolated: true }));
