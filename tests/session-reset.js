const fs = require('fs');
const vm = require('vm');

const home = fs.readFileSync('index.html', 'utf8');
const match = home.match(/const KEY=.*?let s=/s);
if (!match) throw new Error('session bootstrap not found');
const bootstrap = match[0].replace(/let s=$/, '');

const local = new Map([['void-salvage-tree-v4', JSON.stringify({ credits: 999, owned: ['shield1'], runs: 8, victories: 3 })]]);
const session = new Map();
const storage = map => ({
  getItem: key => map.has(key) ? map.get(key) : null,
  setItem: (key, value) => map.set(key, String(value)),
});
const run = () => vm.runInNewContext(bootstrap, {
  localStorage: storage(local),
  sessionStorage: storage(session),
  JSON,
});

run();
const fresh = JSON.parse(local.get('void-salvage-tree-v4'));
if (fresh.credits !== 0 || fresh.owned.length || fresh.runs !== 0 || fresh.victories !== 0) {
  throw new Error('new browser session did not reset progression');
}

local.set('void-salvage-tree-v4', JSON.stringify({ credits: 123, owned: ['engine1'], runs: 1, victories: 0 }));
run();
const sameSession = JSON.parse(local.get('void-salvage-tree-v4'));
if (sameSession.credits !== 123 || sameSession.owned[0] !== 'engine1') {
  throw new Error('navigation inside one session reset progression again');
}

console.log(JSON.stringify({ freshSessionReset: true, sameSessionPreserved: true }));
