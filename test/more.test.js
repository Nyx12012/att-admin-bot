const test = require('node:test');
const assert = require('node:assert');
const { makeBot, run } = require('./fake');

test('announcements show only when their time comes', async () => {
  const { bot, tavern, server } = makeBot();
  const a = bot.announce.add(server, 'Vote for us', 10);
  await bot.announce.tick();
  assert.ok(!tavern.sent.some((c) => c.startsWith('player message *')));
  a.last = Date.now() - 11 * 60000;
  await bot.announce.tick();
  assert.ok(tavern.sent.includes('player message * "Vote for us" 8'));
});

test('a paused rule does not run on the timer', async () => {
  const { bot, tavern, server } = makeBot((text) => (text.startsWith('select find') ? { resultString: '', result: [] } : null));
  await run(bot, { command: 'cleanup', sub: 'preset', values: { preset: 'rocks' } });
  await run(bot, { command: 'cleanup', sub: 'pause', values: { rule: 'rocks', paused: true } });
  await bot.cleanup.tickServer(server);
  assert.ok(!tavern.sent.some((c) => c.startsWith('select find')));
  await run(bot, { command: 'cleanup', sub: 'pause', values: { rule: 'rocks', paused: false } });
  await bot.cleanup.tickServer(server);
  assert.ok(tavern.sent.some((c) => c.startsWith('select find')));
});

test('the cleanup timer skips a server with nobody online', async () => {
  const { bot, tavern, server } = makeBot(null, { players: [] });
  await run(bot, { command: 'cleanup', sub: 'preset', values: { preset: 'rocks' } });
  await bot.cleanup.tickServer(server);
  assert.strictEqual(tavern.sent.length, 0);
});

test('a grant for one subcommand allows only that subcommand', async () => {
  const { bot } = makeBot((text) => (text.startsWith('select find') ? { resultString: '', result: [] } : null));
  await run(bot, { command: 'cleanup', sub: 'preset', values: { preset: 'rocks' } });
  bot.permissions.grant('g1', 'cleanup.preview', 'roles', 'mods');
  const ok = await run(bot, { command: 'cleanup', sub: 'preview', values: { rule: 'rocks' }, admin: false, roles: ['mods'] });
  assert.match(ok.last().text, /Preview|Nothing/);
  const no = await run(bot, { command: 'cleanup', sub: 'mode', values: { rule: 'rocks', mode: 'live' }, admin: false, roles: ['mods'] });
  assert.match(no.last().text, /Not allowed/);
});

test('one chunk cannot belong to two plots', async () => {
  const { bot } = makeBot((text) => (text.startsWith('player detailed') ? { resultString: '', result: { Position: [0, 0, 0], Chunk: '(Chunk Chunk 3-4)' } } : null));
  await run(bot, { command: 'plot', sub: 'create', values: { name: 'one', player: 'Alice' } });
  const two = await run(bot, { command: 'plot', sub: 'create', values: { name: 'two', player: 'Bob' } });
  assert.match(two.last().text, /already belongs to the plot "one"/);
});

test('an expired ban lets the player in again', async () => {
  const { bot, server } = makeBot();
  const b = bot.bans.add(server, 'Bob', { hours: 1, reason: 'x' });
  assert.ok(bot.bans.get(server, 'bob'));
  b.until = Date.now() - 1000;
  assert.strictEqual(bot.bans.get(server, 'Bob'), null);
  assert.strictEqual(bot.bans.expire(server).length, 1);
});

test('the console being down gives a clear answer', async () => {
  const { bot, tavern } = makeBot();
  tavern.connected = false;
  const i = await run(bot, { command: 'kick', values: { player: 'Alice' } });
  assert.match(i.last().text, /not connected/);
});
