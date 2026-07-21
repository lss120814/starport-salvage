const fs = require('fs');

const home = fs.readFileSync('index.html', 'utf8');
const game = fs.readFileSync('game.html', 'utf8');
const tree = fs.readFileSync('tree.html', 'utf8');

const checks = {
  separatePages: /href="game\.html\?v=10/.test(home) && /href="tree\.html\?v=10/.test(home),
  threatContracts: (home.match(/data-threat="[123]"/g) || []).length === 3,
  threatAccessibility: (home.match(/aria-pressed="(?:true|false)"/g) || []).length === 3,
  keyboardRoutes: home.includes("e.code==='Space'") && home.includes("e.key==='Enter'"),
  keyboardFocusSafe: home.includes("e.target.closest?.('input,textarea,select')"),
  singleLife: game.includes('<strong class="hull">I</strong>'),
  pulseControls: game.includes('id="pulseBtn"') && game.includes("e.code==='Space'"),
  reliablePulse: game.includes('pulseCooldown=8') && game.includes('invuln=Math.max(invuln,.75)') && game.includes("o.kind==='hunter'"),
  pauseControl: game.includes("k==='escape'") && game.includes('SYSTEM PAUSED'),
  constantSpeedPointer: game.includes('if(!dx&&!dy&&pointerActive)') && game.includes('dx/=len;dy/=len'),
  keyboardOverridesPointer: game.includes('if(move)pointerActive=false'),
  distinctMissions: game.includes('10 秒扫描') && game.includes('3 枚冷却核心'),
  safeReturnIsNotVictory: game.includes("finish(true,false)") && game.includes("if(complete)save.victories"),
  persistentTree: tree.includes('save.owned.push(id)') && tree.includes('sessionStorage.setItem(KEY'),
  freshSessionTree: [home, game, tree].every(page => page.includes('sessionStorage.getItem(KEY)') && page.includes('sessionStorage.setItem(KEY')),
  isolatedTabs: [home, game, tree].every(page => !page.includes('localStorage.setItem(KEY')),
  dprIndependentWorld: game.includes('W=innerWidth;H=innerHeight') && game.includes('ctx.setTransform(d,0,0,d,0,0)'),
  stableTouchControls: game.includes('setPointerCapture?.(e.pointerId)') && game.includes('onlostpointercapture=release') && !game.includes('b.onpointerleave='),
  clearsStuckInput: game.includes("addEventListener('blur',clearInput)") && game.includes("document.addEventListener('visibilitychange'") && game.includes('clearInput();state=\'paused\''),
  responsiveMobileTree: tree.includes('.tree{width:100%;height:auto;transform:none;display:flex;flex-direction:column}') && tree.includes('.fork{grid-template-columns:1fr'),
  noHighScore: !home.includes('最高纪录') && !game.includes('最高纪录') && !tree.includes('最高纪录'),
};

console.log(JSON.stringify(checks));
for (const [name, passed] of Object.entries(checks)) {
  if (!passed) throw new Error(`UI contract failed: ${name}`);
}
