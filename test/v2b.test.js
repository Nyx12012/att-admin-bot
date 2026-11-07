const test = require('node:test');
const assert = require('node:assert');
const { makeBot, run } = require('./fake');
const Markers = require('../src/features/markers');
const { chunkAt, chunkBounds, overworldChunk } = require('../src/game/text');

test('chunk math matches the game grid', () => {
  assert.strictEqual(chunkAt([-645.6, 128, 210.1]), '21-35');
  const b = chunkBounds('21-35');
  assert.deepStrictEqual(b, { minX: -704, minZ: 192, maxX: -640, maxZ: 256 });
  assert.strictEqual(overworldChunk('(Chunk Chunk 21-35)'), '21-35');
  assert.strictEqual(overworldChunk('Townhall Building Chunk'), null);
});

test('a marked chunk has 16 points with graves on the corners', () => {
  const pts = Markers.borderPoints('21-35');
  assert.strictEqual(pts.length, 16);
  assert.strictEqual(pts.filter((p) => p.prefab === 28202).length, 4);
  const keys = new Set(pts.map((p) => `${p.x},${p.z}`));
  assert.strictEqual(keys.size, 16);
});

function world() {
  const state = { next: 100, ents: new Map() };
  const handler = (text) => {
    let m = text.match(/^spawn "(.+)" (\d+)$/);
    if (m) {
      const id = state.next;
      state.next += 1;
      state.ents.set(id, { hash: Number(m[2]), pos: [0, 0, 0] });
      return { resultString: '', result: [{ Identifier: id }] };
    }
    m = text.match(/^select (\d+)$/);
    if (m) {
      state.sel = Number(m[1]);
      return state.ents.has(state.sel) ? `Selected: ${state.sel} - x` : { error: 'gone', resultString: '' };
    }
    m = text.match(/^select move exact (.+)$/);
    if (m) {
      const p = m[1].split(',').map(Number);
      const e = state.ents.get(state.sel);
      e.pos = e.hash === 17262 ? [p[0], 50, p[2]] : p;
      return 'Success';
    }
    if (text === 'select destroy') {
      state.ents.delete(state.sel);
      return 'Success';
    }
    if (text === 'select rotate exact 0,0,0') return 'Success';
    m = text.match(/^select get (\d+)$/);
    if (m) {
      const e = state.ents.get(Number(m[1]));
      return e ? { resultString: '', result: { Identifier: Number(m[1]), PrefabHash: e.hash, Position: e.pos } } : { error: 'gone', resultString: '' };
    }
    if (/^player detailed/.test(text)) return { resultString: '', result: { Chunk: '(Chunk Chunk 21-35)', Position: [-650, 60, 210] } };
    if (/^player list-detailed/.test(text)) return { resultString: '', result: [{ username: 'Alice', Chunk: '(Chunk Chunk 21-35)' }] };
    return null;
  };
  return { state, handler };
}

test('showing a chunk finds the ground with stakes, then places markers and removes the stakes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { state, handler } = world();
  const { bot, server } = makeBot(handler);
  const done = bot.markers.show(server, 'Alice', { minutes: 5 });
  for (let i = 0; i < 200; i += 1) {
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(100);
  }
  const set = await done;
  assert.strictEqual(set.entities.length, 16);
  const left = [...state.ents.values()];
  assert.strictEqual(left.filter((e) => e.hash === 17262).length, 0, 'no stakes left behind');
  assert.strictEqual(left.filter((e) => e.hash === 28202).length, 4);
  assert.strictEqual(left.filter((e) => e.hash === 18244).length, 12);
  assert.ok(left.every((e) => e.pos[1] === 50), 'markers stand on the found ground');
  t.mock.timers.reset();
  const r = await bot.markers.hide(server, { name: 'Alice' });
  assert.strictEqual(r.asked, 1);
  assert.strictEqual(state.ents.size, 0);
  assert.strictEqual(bot.markers.doc(server).sets.length, 0);
});

test('markers clear on the timer, and a second set in the same chunk is refused', async () => {
  const { state, handler } = world();
  const { bot, server } = makeBot(handler);
  const d = bot.markers.doc(server);
  state.ents.set(1, { hash: 28202, pos: [1, 1, 1] });
  d.sets.push({ id: 'x', chunk: '21-35', by: 'Alice', until: Date.now() + 60000, at: Date.now(), entities: [{ id: 1, hash: 28202, pos: [1, 1, 1] }] });
  await assert.rejects(bot.markers.show(server, 'Alice'), /already marked/);
  d.sets[0].until = 0;
  await bot.markers.tickServer(server);
  assert.strictEqual(state.ents.size, 0);
  assert.strictEqual(d.sets.length === 0 || bot.markers.doc(server).sets.length === 0, true);
});

test('a marker whose id changed after a restart is found by prefab and place, and a wrong id is left alone', async () => {
  const { state, handler } = world();
  const base = handler;
  const { bot, server } = makeBot((text) => {
    if (text.startsWith('select find')) return { resultString: '', result: [{ Identifier: 7, Name: '7 - Player Grave(Clone)' }, { Identifier: 8, Name: '8 - Stone(Clone)' }] };
    return base(text);
  });
  state.ents.set(1, { hash: 61670, pos: [1, 1, 1] });
  state.ents.set(7, { hash: 28202, pos: [5, 5, 5] });
  state.ents.set(8, { hash: 61670, pos: [5, 5, 5] });
  const d = bot.markers.doc(server);
  d.sets.push({ id: 'x', chunk: '21-35', by: 'Alice', until: 0, at: Date.now(), entities: [{ id: 1, hash: 28202, pos: [5, 5, 5] }] });
  await bot.markers.tickServer(server);
  assert.ok(state.ents.has(1), 'an id now used by something else is not touched');
  assert.ok(!state.ents.has(7), 'the real marker went');
  assert.ok(state.ents.has(8));
});

test('a marker that cannot be found stops being searched for after three tries', async () => {
  const { handler } = world();
  const scans = [];
  const { bot, server } = makeBot((text) => {
    if (text.startsWith('select find')) {
      scans.push(text);
      return { resultString: '', result: [] };
    }
    return handler(text);
  });
  bot.markers.doc(server).sets.push({ id: 'x', chunk: '21-35', by: 'Alice', until: 0, at: Date.now(), entities: [{ id: 9, hash: 28202, pos: [5, 5, 5] }] });
  for (let i = 0; i < 5; i += 1) await bot.markers.tickServer(server);
  assert.strictEqual(scans.length, 3);
  assert.strictEqual(bot.markers.doc(server).sets.length, 0);
});

test('report rules match a reason with spaces', async () => {
  const { bot, server, tavern } = makeBot();
  bot.reports.start();
  await run(bot, { command: 'report', sub: 'action', values: { reason: 'Bad Name', command: 'player kick {reported}' }, owner: true });
  server.onEvent({ type: 'SocialTabletPlayerReported', data: { ReportedPlayer: { username: 'Bob' }, ReportedBy: { username: 'Alice' }, Reason: 'bad name' } });
  await new Promise((r) => setImmediate(r));
  assert.ok(tavern.sent.includes('player kick "Bob"'));
});

test('a console drop during delivery keeps the row and refunds nothing it cannot prove', async () => {
  const state = { coins: 100 };
  const { bot, server } = makeBot((text) => {
    if (/^trade post /.test(text)) throw new Error('console gone');
    if (text === 'botcore version') return 'BotCore 1.2.0';
    let m = text.match(/^botcore user "(.+)"$/);
    if (m) return `online 7 ${m[1]}`;
    if (/^trade atm get/.test(text)) return { resultString: String(state.coins), result: null };
    m = text.match(/^trade atm add "(.+)" (-?\d+)$/);
    if (m) {
      state.coins += Number(m[2]);
      return { resultString: String(state.coins), result: null };
    }
    return null;
  });
  bot.store.update(`server-${server.id}-links`, {}, (d) => { d.u1 = { username: 'Alice', id: 1, at: Date.now() }; });
  await run(bot, { command: 'shop', sub: 'add', values: { item: '18734', category: 'Stuff', price: 10 } });
  const key = Object.keys(bot.economy.shop(server).items)[0];
  const i = await run(bot, { command: 'shop', sub: 'buy', values: { product: key }, admin: false });
  assert.match(i.last().text, /something went wrong|console dropped/i);
  assert.strictEqual(bot.economy.ledger(server).pending.length, 1);
  assert.match(bot.economy.ledger(server).pending[0].state, /check the mailbox/);
});

test('a pockets recipe with no way to stop refiring is refused', async () => {
  const { bot } = makeBot();
  const i = await run(bot, { command: 'alchemy', sub: 'create', values: { name: 'x', items: '18734', delete_items: false, command: 'time set day', trigger: 'pockets' }, owner: true });
  assert.match(i.last().text, /every inventory change/);
});

test('a deleted recipe stops firing for a player who was already armed', async () => {
  const state = { detailed: { LeftHandPosition: [0, 0, 0], RightHandPosition: [0.01, 0, 0] } };
  const { bot, server, tavern } = makeBot((text) => {
    if (/^player inventory/.test(text)) return { resultString: '', result: [{ Belt: [{ Identifier: 5, PrefabHash: 18734 }, null, null, null] }] };
    if (/^player detailed/.test(text)) return { resultString: '', result: state.detailed };
    return null;
  });
  await run(bot, { command: 'alchemy', sub: 'create', values: { name: 'clap', items: '18734', delete_items: false, command: 'time set night' }, owner: true });
  await bot.alchemy.inspect(server, 'Alice');
  await run(bot, { command: 'alchemy', sub: 'delete', values: { name: 'clap' }, owner: true });
  await bot.alchemy.pollHands();
  assert.ok(!tavern.sent.includes('time set night'));
  bot.alchemy.stop();
});

test('players need a link to mark a chunk, and only admins can name someone else', async () => {
  const { bot } = makeBot();
  const a = await run(bot, { command: 'chunk', sub: 'show', admin: false });
  assert.match(a.last().text, /not linked/);
  const b = await run(bot, { command: 'chunk', sub: 'where', values: { player: 'Bob' }, admin: false });
  assert.match(b.last().text, /Only admins/);
});

test('report actions run with the names filled in, and an unsafe name is skipped', async () => {
  const { bot, server, tavern } = makeBot();
  bot.reports.start();
  await run(bot, { command: 'report', sub: 'action', values: { reason: 'any', command: 'player message {reported} "Reported for {reason}" 5' }, owner: true });
  server.onEvent({ type: 'SocialTabletPlayerReported', data: { ReportedPlayer: { username: 'Bob' }, ReportedBy: { username: 'Alice' }, Reason: 'griefing "x"' } });
  await new Promise((r) => setImmediate(r));
  assert.ok(tavern.sent.some((c) => c.startsWith('player message "Bob" "Reported for griefing x"')));
  tavern.sent.length = 0;
  server.onEvent({ type: 'SocialTabletPlayerReported', data: { ReportedPlayer: { username: 'x" ; quit ; "' }, ReportedBy: { username: 'Alice' }, Reason: 'y' } });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(tavern.sent.length, 0);
});

test('console kits run in order and fill in the player', async () => {
  const { bot, tavern } = makeBot();
  await run(bot, { command: 'cc', sub: 'create', values: { name: 'night', command: 'time set night' }, owner: true });
  await run(bot, { command: 'cc', sub: 'add', values: { kit: 'night', command: 'player kill {player}' }, owner: true });
  const needs = await run(bot, { command: 'cc', sub: 'run', values: { kit: 'night' }, owner: true });
  assert.match(needs.last().text, /pick a player/);
  tavern.sent.length = 0;
  await run(bot, { command: 'cc', sub: 'run', values: { kit: 'night', player: 'Bob' }, owner: true });
  assert.deepStrictEqual(tavern.sent, ['time set night', 'player kill "Bob"']);
  const denied = await run(bot, { command: 'cc', sub: 'list', admin: true });
  assert.match(denied.last().text, /Not allowed/);
});

test('string only takes digits, commas and pipes', async () => {
  const { bot, tavern } = makeBot();
  const bad = await run(bot, { command: 'string', sub: 'spawn', values: { player: 'Bob', data: '123 ; quit' }, owner: true });
  assert.match(bad.last().text, /digits/);
  await run(bot, { command: 'string', sub: 'spawn', values: { player: 'Bob', data: '12345,1,2|3' }, owner: true });
  assert.ok(tavern.sent.includes('spawn string "Bob" 12345,1,2|3'));
});

test('stats count kills and deaths, and a leaderboard reads them', async () => {
  const { bot, server } = makeBot();
  bot.stats.start();
  server.onEvent({ type: 'PlayerKilled', data: { killedPlayer: { username: 'Bob' }, killerPlayer: { username: 'Alice' } } });
  server.onEvent({ type: 'PlayerKilled', data: { killedPlayer: { username: 'Bob' } } });
  server.onEvent({ type: 'ObjectKilled', data: { killerPlayer: { username: 'Alice' }, name: 'Wyrm' } });
  bot.stats.tick();
  const top = await run(bot, { command: 'stats', sub: 'top', values: { kind: 'deaths' } });
  assert.match(top.last().text, /1\. \*\*Bob\*\*: 2/);
  const one = await run(bot, { command: 'stats', sub: 'player', values: { player: 'Alice' } });
  assert.match(one.last().text, /Player kills: 1/);
  assert.match(one.last().text, /Creatures killed: 1/);
  bot.stats.stop();
});

test('autobuff gives a saved buff a while after joining', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { bot, server, tavern } = makeBot((text) => {
    if (/^player list-stats/.test(text)) return { resultString: '', result: [{ Name: 'speed', Min: 0, Max: 10, Value: 1 }] };
    return null;
  });
  bot.autobuff.start();
  await run(bot, { command: 'buff', sub: 'create', values: { name: 'fast', stats: 'speed 3' } });
  await run(bot, { command: 'autobuff', sub: 'set', values: { name: 'Bob', buff: 'fast' } });
  server.onEvent({ type: 'PlayerJoined', data: { user: { id: 1, username: 'Bob' } } });
  t.mock.timers.tick(30000);
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
  assert.ok(tavern.sent.includes('player set-stat "Bob" speed 3'));
  bot.autobuff.stop();
});

test('fun hearts set both the most health and the health now', async () => {
  const { bot, tavern } = makeBot();
  await run(bot, { command: 'fun', sub: 'hearts', values: { player: 'Bob', hearts: 16 } });
  assert.ok(tavern.sent.includes('player set-stat "Bob" maxhealth 4'));
  assert.ok(tavern.sent.includes('player set-stat "Bob" health 4'));
});

test('setup auto makes the channels and uses them', async () => {
  const { bot } = makeBot();
  const made = [];
  bot.client.user.id = 'botid';
  bot.playerlist.schedule = () => {};
  const { FakeInteraction } = require('./fake');
  const i = new FakeInteraction({ command: 'setup', sub: 'auto' });
  i.guild.channels = { create: async (o) => {
    made.push(o.name);
    return { id: `c${made.length}`, name: o.name };
  } };
  await bot.registry.handle(i);
  assert.strictEqual(made.length, 7);
  assert.strictEqual(bot.guildSetting('g1', 'channels').logs, 'c2');
  assert.match(i.last().text, /Channels made/);
});

test('say sends no pings', async () => {
  const { bot, posts } = makeBot();
  const { FakeInteraction } = require('./fake');
  const i = new FakeInteraction({ command: 'say', values: { text: 'hello @everyone' } });
  i.channelId = 'here';
  await bot.registry.handle(i);
  assert.strictEqual(posts[0].id, 'here');
  assert.deepStrictEqual(posts[0].p.allowedMentions, { parse: [] });
});

test('a poll checks its answers', async () => {
  const { bot } = makeBot();
  const a = await run(bot, { command: 'poll', values: { question: 'Q', answers: 'one' } });
  assert.match(a.last().text, /2 to 10/);
});
