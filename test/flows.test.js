const test = require('node:test');
const assert = require('node:assert');
const { makeBot, run } = require('./fake');

const FEATHER = 18734;
const STONE = 61670;

function world(entities) {
  return (text) => {
    if (text.startsWith('select find')) return { resultString: '', result: entities.map((e) => ({ Identifier: e.id, Name: `${e.name}(Clone)` })) };
    const get = text.match(/^select get (\d+)$/);
    if (get) {
      const e = entities.find((x) => x.id === Number(get[1]));
      return e ? { resultString: 'Alta.Console.Commands.EntityInfo', result: { Identifier: e.id, Name: `${e.id} - ${e.name}(Clone)`, PrefabHash: e.hash, ChunkingParent: e.parent || 0 } } : { resultString: '', result: null, error: 'no entity' };
    }
    return null;
  };
}

test('kick sends a quoted name and reason', async () => {
  const { bot, tavern } = makeBot();
  const i = await run(bot, { command: 'kick', values: { player: 'alice', reason: 'Be nice "now"' } });
  assert.match(i.last().text, /Kicked/);
  assert.deepStrictEqual(tavern.sent, ['player kick "Alice" "Be nice now"']);
});

test('an unsafe player name never reaches the console', async () => {
  const { bot, tavern, server } = makeBot();
  server.roster.set('x" ; save full-wipe ; "', { username: 'x" ; save full-wipe ; "', id: 9, since: Date.now() });
  const i = await run(bot, { command: 'kick', values: { player: 'x" ; save full-wipe ; "' } });
  assert.strictEqual(tavern.sent.length, 0);
  assert.match(i.last().text, /not a valid player name/);
});

test('admin commands are refused for members without Administrator', async () => {
  const { bot, tavern } = makeBot();
  const i = await run(bot, { command: 'kick', values: { player: 'Alice' }, admin: false });
  assert.match(i.last().text, /Not allowed/);
  assert.strictEqual(tavern.sent.length, 0);
});

test('owner only commands refuse plain admins until granted', async () => {
  const { bot } = makeBot();
  const denied = await run(bot, { command: 'spawn', values: { player: 'Alice', item: String(FEATHER) }, admin: true });
  assert.match(denied.last().text, /Not allowed/);
  bot.permissions.grant('g1', 'spawn', 'roles', 'r1');
  const ok = await run(bot, { command: 'spawn', values: { player: 'Alice', item: String(FEATHER), amount: 2 }, admin: false, roles: ['r1'] });
  assert.match(ok.last().text, /2 x \*\*Spriggull Feather Red\*\*/);
});

test('ban of an online player kicks them and a later join is kicked again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const { bot, tavern, server } = makeBot();
  bot.bans.start();
  await run(bot, { command: 'ban', sub: 'add', values: { player: 'Bob', hours: 2, reason: 'griefing' } });
  assert.ok(tavern.sent.some((c) => /^player kick "Bob" "Banned until .*griefing"$/.test(c)));
  tavern.sent.length = 0;
  server.onEvent({ type: 'PlayerJoined', data: { user: { id: 3, username: 'Bob' } } });
  t.mock.timers.tick(4100);
  await new Promise((r) => setImmediate(r));
  assert.ok(tavern.sent.some((c) => c.startsWith('player kick "Bob"')));
  bot.bans.stop();
});

test('teleport to coordinates moves the home point and puts it back', async () => {
  const { bot, tavern } = makeBot((text) => (text.startsWith('player get-home') ? { resultString: '(1.0, 2.0, 3.0)', result: [1, 2, 3] } : null));
  await run(bot, { command: 'tp', sub: 'coords', values: { player: 'Alice', x: 10, y: 20, z: 30 } });
  assert.deepStrictEqual(tavern.sent, [
    'player get-home "Alice"',
    'player set-home "Alice" 10.000,20.000,30.000',
    'player teleport "Alice" Home',
    'player set-home "Alice" 1.000,2.000,3.000',
  ]);
});

test('cleanup preview counts only loose items and deletes nothing', async () => {
  const ents = [
    { id: 1, name: 'Spriggull Feather Red', hash: FEATHER },
    { id: 2, name: 'Spriggull Feather Red', hash: FEATHER, parent: 77 },
    { id: 3, name: 'Stone', hash: STONE },
    { id: 4, name: 'Spriggull Feather Red', hash: FEATHER },
  ];
  const { bot, tavern } = makeBot(world(ents));
  await run(bot, { command: 'cleanup', sub: 'preset', values: { preset: 'spriggull' } });
  const i = await run(bot, { command: 'cleanup', sub: 'preview', values: { rule: 'spriggull' } });
  assert.match(i.last().text, /2 {2}Spriggull Feather Red/);
  assert.ok(!tavern.sent.some((c) => c.startsWith('wacky')));
});

test('a live cleanup asks, then uses destroy-free once per prefab found', async () => {
  const ents = [
    { id: 1, name: 'Spriggull Feather Red', hash: FEATHER },
    { id: 5, name: 'SpriggullDrumstick Full Ripe', hash: 43430 },
    { id: 6, name: 'SpriggullDrumstick Full Ripe', hash: 43430, parent: 9 },
  ];
  const { bot, tavern } = makeBot(world(ents));
  await run(bot, { command: 'cleanup', sub: 'preset', values: { preset: 'spriggull' } });
  await run(bot, { command: 'cleanup', sub: 'mode', values: { rule: 'spriggull', mode: 'live' } });
  const i = await run(bot, { command: 'cleanup', sub: 'run', values: { rule: 'spriggull' } });
  assert.match(i.last().text, /Cleaned/);
  const wacky = tavern.sent.filter((c) => c.startsWith('wacky'));
  assert.deepStrictEqual(wacky.sort(), ['wacky destroy-free 18734', 'wacky destroy-free 43430']);
});

test('cancelling a live cleanup deletes nothing', async () => {
  const ents = [{ id: 1, name: 'Stone', hash: STONE }];
  const { bot, tavern } = makeBot(world(ents));
  await run(bot, { command: 'cleanup', sub: 'sweep', values: { item: 'Stone' }, confirm: false });
  assert.ok(!tavern.sent.some((c) => c.startsWith('wacky')));
});

test('without destroy-free the cleanup removes loose items one by one', async () => {
  const ents = [{ id: 1, name: 'Stone', hash: STONE }, { id: 2, name: 'Stone', hash: STONE, parent: 4 }, { id: 3, name: 'Stone', hash: STONE }];
  const base = world(ents);
  const { bot, tavern } = makeBot((text) => (text.startsWith('wacky destroy-free') ? { resultString: '', result: null, error: '[CommandService.Handle] Command not found' } : base(text)));
  const i = await run(bot, { command: 'cleanup', sub: 'sweep', values: { item: 'Stone' } });
  assert.match(i.last().text, /2 \*\*Stone\*\* removed/);
  assert.deepStrictEqual(tavern.sent.filter((c) => /^wacky destroy \d/.test(c)), ['wacky destroy 1', 'wacky destroy 3']);
});

test('the timer respects the threshold and the warning setting', async (t) => {
  const ents = [{ id: 1, name: 'Stone', hash: STONE }, { id: 2, name: 'Stone', hash: STONE }];
  const { bot, tavern, server } = makeBot(world(ents));
  await run(bot, { command: 'cleanup', sub: 'add', values: { name: 'rocks', items: 'Stone', above: 5 } });
  await run(bot, { command: 'cleanup', sub: 'mode', values: { rule: 'rocks', mode: 'live' } });
  await bot.cleanup.tickServer(server);
  assert.ok(!tavern.sent.some((c) => c.startsWith('wacky')), 'below the threshold nothing goes');
  const rule = bot.cleanup.rule(server, 'rocks');
  rule.min = 0;
  rule.last = 0;
  const d = bot.cleanup.doc(server);
  d.warning = { on: true, seconds: 10 };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = bot.cleanup.tickServer(server);
  for (let n = 0; n < 50 && !tavern.sent.some((c) => c.startsWith('player message *')); n += 1) await new Promise((r) => setImmediate(r));
  assert.ok(tavern.sent.some((c) => /^player message \* "Ground cleanup in 10 seconds: Stone/.test(c)));
  t.mock.timers.tick(10000);
  await p;
  assert.ok(tavern.sent.includes('wacky destroy-free 61670'));
});

test('a new rule starts in preview mode', async () => {
  const { bot, server } = makeBot();
  await run(bot, { command: 'cleanup', sub: 'preset', values: { preset: 'rocks', every: 15 } });
  const r = bot.cleanup.rule(server, 'rocks');
  assert.strictEqual(r.mode, 'preview');
  assert.strictEqual(r.every, 15);
});

test('plots send intruders out and leave trusted players alone', async () => {
  const { bot, tavern, server } = makeBot((text) => (text.startsWith('player detailed') ? { resultString: '', result: { Position: [1, 2, 3], Chunk: '(Chunk Chunk 21-34)' } } : null));
  bot.plots.start();
  await run(bot, { command: 'plot', sub: 'create', values: { name: 'base', player: 'Alice' } });
  await run(bot, { command: 'plot', sub: 'trust', values: { plot: 'base', name: 'Carol' } });
  tavern.sent.length = 0;
  await bot.plots.check(server, 'Carol', 'Chunk 21-34');
  assert.strictEqual(tavern.sent.length, 0);
  await bot.plots.check(server, 'Bob', 'Chunk 21-34');
  assert.ok(tavern.sent.some((c) => c.startsWith('player message "Bob"')));
  assert.ok(tavern.sent.includes('player teleport "Bob" RespawnPoint'));
  bot.plots.stop();
});

test('only the plot owner or an admin can trust players', async () => {
  const { bot } = makeBot((text) => (text.startsWith('player detailed') ? { resultString: '', result: { Position: [1, 2, 3], Chunk: '(Chunk Chunk 1-1)' } } : null));
  await run(bot, { command: 'plot', sub: 'create', values: { name: 'home', player: 'Alice' } });
  const denied = await run(bot, { command: 'plot', sub: 'trust', values: { plot: 'home', name: 'Bob' }, admin: false, userId: 'stranger' });
  assert.match(denied.last().text, /Only Alice/);
  bot.store.update('server-main-links', {}, (d) => { d.alice = { username: 'Alice', id: 5 }; });
  const ok = await run(bot, { command: 'plot', sub: 'trust', values: { plot: 'home', name: 'Bob' }, admin: false, userId: 'alice' });
  assert.match(ok.last().text, /Bob can enter/);
});

test('linking needs the code shown in game', async () => {
  const { bot, tavern } = makeBot();
  await run(bot, { command: 'link', sub: 'start', values: { player: 'Alice' }, admin: false, userId: 'd1' });
  const msg = tavern.sent.find((c) => c.startsWith('player message "Alice"'));
  const code = msg.match(/code: (\d{4})/)[1];
  const wrong = await run(bot, { command: 'link', sub: 'confirm', values: { code: '0000' === code ? '1111' : '0000' }, admin: false, userId: 'd1' });
  assert.match(wrong.last().text, /wrong/);
  const ok = await run(bot, { command: 'link', sub: 'confirm', values: { code }, admin: false, userId: 'd1' });
  assert.match(ok.last().text, /linked to \*\*Alice\*\*/);
});

test('settings set checks the type of the current value', async () => {
  const settings = { DropAllOnDeath: false, DecayMultiplier: 1 };
  const { bot, tavern } = makeBot((text) => {
    if (text === 'settings list server') return { resultString: 'Alta.Utilities.ServerSettings', result: { ...settings } };
    const m = text.match(/^settings changesetting server (\w+) (\S+)$/);
    if (m) settings[m[1]] = m[2] === 'true' ? true : m[2] === 'false' ? false : Number(m[2]);
    return null;
  });
  const bad = await run(bot, { command: 'settings', sub: 'set', values: { setting: 'dropallondeath', value: 'maybe' }, owner: true });
  assert.match(bad.last().text, /true or false/);
  const ok = await run(bot, { command: 'settings', sub: 'set', values: { setting: 'dropallondeath', value: 'on' }, owner: true });
  assert.match(ok.last().text, /\*\*true\*\*/);
  assert.ok(tavern.sent.includes('settings changesetting server DropAllOnDeath true'));
});

test('heal only touches stats that are not full', async () => {
  const stats = [
    { Name: 'health', Min: 0, Max: 2, Value: 0.5 },
    { Name: 'poison', Min: 0, Max: 31, Value: 0 },
    { Name: 'nightmare', Min: 0, Max: 1, Value: 1 },
    { Name: 'hunger', Min: 0, Max: 2, Value: 1 },
  ];
  const { bot, tavern } = makeBot((text) => (text.startsWith('player list-stats') ? { resultString: '', result: stats } : null));
  await run(bot, { command: 'heal', values: { player: 'Alice' } });
  assert.deepStrictEqual(tavern.sent.filter((c) => c.startsWith('player set-stat')), ['player set-stat "Alice" health 2', 'player set-stat "Alice" nightmare 0']);
});

test('every admin action is written to the audit log', async () => {
  const fs = require('fs');
  const path = require('path');
  const { bot, dir } = makeBot();
  await run(bot, { command: 'message', sub: 'all', values: { text: 'hello' } });
  await new Promise((r) => setTimeout(r, 50));
  const files = fs.readdirSync(path.join(dir, 'audit'));
  const line = JSON.parse(fs.readFileSync(path.join(dir, 'audit', files[0]), 'utf8').trim().split('\n').pop());
  assert.strictEqual(line.command, 'message all');
  assert.strictEqual(line.outcome, 'ok');
});

test('autocomplete offers online players and items', async () => {
  const { bot } = makeBot();
  const p = await run(bot, { command: 'kick', values: { player: { focused: true, value: 'al' } }, autocomplete: true });
  assert.deepStrictEqual(p.responded.map((c) => c.value), ['Alice']);
  const it = await run(bot, { command: 'spawn', values: { player: 'Alice', item: { focused: true, value: 'feather red' } }, autocomplete: true, owner: true });
  assert.ok(it.responded.some((c) => c.value === String(FEATHER)));
  const hidden = await run(bot, { command: 'spawn', values: { player: 'Alice', item: { focused: true, value: 'feather red' } }, autocomplete: true });
  assert.deepStrictEqual(hidden.responded, []);
});

test('autocomplete shows nothing to members who cannot use the command', async () => {
  const { bot, server } = makeBot();
  bot.bans.add(server, 'Secret', { reason: 'x' });
  const i = await run(bot, { command: 'ban', sub: 'remove', values: { player: { focused: true, value: '' } }, autocomplete: true, admin: false });
  assert.deepStrictEqual(i.responded, []);
});

test('ban add matches the exact name, never a prefix', async () => {
  const { bot, server, tavern } = makeBot(null, { players: ['Bobby'] });
  await run(bot, { command: 'ban', sub: 'add', values: { player: 'Bob' } });
  assert.ok(bot.bans.get(server, 'Bob'));
  assert.strictEqual(bot.bans.get(server, 'Bobby'), null);
  assert.ok(!tavern.sent.some((c) => c.includes('Bobby')));
});

test('a grant for a command does not open its owner only subcommands', async () => {
  const { bot } = makeBot();
  bot.permissions.grant('g1', 'kit', 'roles', 'mods');
  const list = await run(bot, { command: 'kit', sub: 'list', admin: false, roles: ['mods'] });
  assert.match(list.last().text, /Kits/);
  const give = await run(bot, { command: 'kit', sub: 'give', values: { player: 'Alice', kit: 'x' }, admin: false, roles: ['mods'] });
  assert.match(give.last().text, /Not allowed/);
  bot.permissions.grant('g1', 'kit.give', 'roles', 'mods');
  const now = await run(bot, { command: 'kit', sub: 'give', values: { player: 'Alice', kit: 'x' }, admin: false, roles: ['mods'] });
  assert.match(now.last().text, /no kit called/);
  bot.permissions.grant('g1', 'world', 'roles', 'mods');
  const world = await run(bot, { command: 'world', sub: 'smelter', admin: false, roles: ['mods'] });
  assert.match(world.last().text, /Smelter fixed/);
});

test('reserved words cannot become names', async () => {
  const { bot } = makeBot();
  const i = await run(bot, { command: 'kit', sub: 'create', values: { name: '__proto__', items: 'Stick' } });
  assert.match(i.last().text, /cannot be used/);
  const b = await run(bot, { command: 'ban', sub: 'info', values: { player: 'constructor' } });
  assert.match(b.last().text, /not banned/);
});

test('a cancelled confirm is audited as cancelled', async () => {
  const fs = require('fs');
  const path = require('path');
  const { bot, dir } = makeBot(world([{ id: 1, name: 'Stone', hash: STONE }]));
  await run(bot, { command: 'cleanup', sub: 'sweep', values: { item: 'Stone' }, confirm: false });
  await new Promise((r) => setTimeout(r, 50));
  const file = fs.readdirSync(path.join(dir, 'audit'))[0];
  const last = JSON.parse(fs.readFileSync(path.join(dir, 'audit', file), 'utf8').trim().split('\n').pop());
  assert.strictEqual(last.outcome, 'cancelled');
});
