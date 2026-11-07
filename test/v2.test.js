const test = require('node:test');
const assert = require('node:assert');
const { makeBot, run } = require('./fake');
const Alchemy = require('../src/features/alchemy');

const IRON = 18734;
const STONE = 61670;

function linked(bot, server, userId, username) {
  bot.store.update(`server-${server.id}-links`, {}, (d) => {
    d[userId] = { username, id: 1, at: Date.now() };
  });
}

function eco(state) {
  return (text) => {
    if (text === 'botcore version') return 'BotCore 1.2.0';
    let m = text.match(/^botcore user "(.+)"$/);
    if (m) return `online 7 ${m[1]}`;
    m = text.match(/^trade atm get "(.+)"$/);
    if (m) return { resultString: String(state.coins), result: null };
    m = text.match(/^trade atm add "(.+)" (-?\d+)$/);
    if (m) {
      state.coins += Number(m[2]);
      return { resultString: String(state.coins), result: null };
    }
    if (/^trade post /.test(text)) {
      state.posts = (state.posts || 0) + 1;
      if (state.failAfter != null && state.posts > state.failAfter) return { error: 'mailbox full', resultString: '' };
      return 'Success';
    }
    if (/^player detailed /.test(text)) return { resultString: '', result: { Chunk: state.chunk || 'Chunk 21-34', Position: [1, 2, 3] } };
    m = text.match(/^botcore take "(.+)" (\d+) (\d+) (count|take) (\w+)$/);
    if (m) {
      const n = Math.min(state.carried || 0, Number(m[3]));
      if (m[4] === 'take') state.carried -= n;
      return `${m[4] === 'count' ? 'count' : 'taken'} ${n} ${state.refused || 0}`;
    }
    return null;
  };
}

test('the plot tree sends a plot holder to their plot and ignores everyone else', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.now() });
  const { bot, server, tavern } = makeBot((text) => {
    if (/^player detailed "Alice"/.test(text)) return { resultString: '', result: { Chunk: 'Chunk 17-34', Position: [10, 5, 10] } };
    if (/^player detailed "Bob"/.test(text)) return { resultString: '', result: { Chunk: 'Chunk 17-34', Position: [10, 5, 10] } };
    if (/^player get-home/.test(text)) return { resultString: '', result: [0, 0, 0] };
    return null;
  });
  bot.plots.start();
  bot.plots.create(server, 'base', 'Alice', '21-34', [100, 50, 100]);
  bot.plots.settings(server).tree = { chunk: '17-34', point: [10, 5, 10], radius: 8 };
  tavern.sent.length = 0;
  await bot.plots.check(server, 'Bob', 'Chunk 17-34', { moved: true });
  assert.strictEqual(bot.plots.armed.size, 0);
  await bot.plots.check(server, 'Alice', 'Chunk 17-34', { moved: true });
  assert.strictEqual(bot.plots.armed.size, 1);
  await bot.plots.treeTick();
  assert.ok(tavern.sent.includes('player set-home "Alice" 100.000,50.000,100.000'));
  assert.ok(tavern.sent.includes('player teleport "Alice" Home'));
  assert.ok(tavern.sent.some((c) => c.startsWith('player message "Alice" "Welcome to your plot')));
  const before = tavern.sent.length;
  await bot.plots.sendToPlot(server, 'Alice', bot.plots.get(server, 'base'));
  assert.strictEqual(tavern.sent.length, before, 'cooldown holds a second trip');
  bot.plots.stop();
});

test('a whole chunk tree needs no position polling', async () => {
  const { bot, server, tavern } = makeBot((text) => (/^player get-home/.test(text) ? { resultString: '', result: [1, 1, 1] } : null));
  bot.plots.create(server, 'base', 'Alice', '21-34', [100, 50, 100]);
  bot.plots.settings(server).tree = { chunk: '17-34', point: null, radius: 0 };
  await bot.plots.check(server, 'Alice', 'Chunk 17-34', { moved: true });
  assert.ok(tavern.sent.includes('player teleport "Alice" Home'));
  assert.ok(tavern.sent.includes('player set-home "Alice" 1.000,1.000,1.000'), 'home point restored');
});

test('a plot with no arrival spot tells the player and does not move them', async () => {
  const { bot, server, tavern } = makeBot();
  bot.plots.claim(server, 'base', 'Alice', '21-34');
  bot.plots.settings(server).tree = { chunk: '17-34', point: null, radius: 0 };
  await bot.plots.check(server, 'Alice', 'Chunk 17-34', { moved: true });
  assert.ok(tavern.sent.some((c) => /no arrival spot/.test(c)));
  assert.ok(!tavern.sent.some((c) => c.includes('teleport')));
});

test('the owner fills in a missing arrival spot by walking in', async () => {
  const { bot, server } = makeBot((text) => (/^player detailed "Alice"/.test(text) ? { resultString: '', result: { Chunk: 'Chunk 21-34', Position: [7, 8, 9] } } : null));
  const p = bot.plots.claim(server, 'base', 'Alice', '21-34');
  await bot.plots.check(server, 'Alice', 'Chunk 21-34', { moved: true });
  assert.deepStrictEqual(p.spawn, [7, 8, 9]);
});

test('cave and building chunks never count as plot chunks', () => {
  const { bot, server } = makeBot();
  bot.plots.claim(server, 'base', 'Alice', '3-4');
  assert.strictEqual(bot.plots.at(server, 'Cave Layer 3-4'), null);
  assert.strictEqual(bot.plots.at(server, 'Townhall Building Chunk'), null);
  assert.ok(bot.plots.at(server, '(Chunk 3-4)'));
  assert.ok(bot.plots.at(server, 'Chunk Chunk 3-4'));
});

test('owner, trusted and staff pass; a linked Discord admin passes; others are sent out', async () => {
  const { bot, server, tavern } = makeBot();
  const p = bot.plots.create(server, 'base', 'Alice', '21-34', [1, 1, 1]);
  await bot.plots.check(server, 'Alice', 'Chunk 21-34', { moved: true });
  p.trusted.push('Carl');
  await bot.plots.check(server, 'Carl', 'Chunk 21-34', { moved: true });
  bot.plots.settings(server).staff.push('Dana');
  await bot.plots.check(server, 'Dana', 'Chunk 21-34', { moved: true });
  assert.ok(!tavern.sent.some((c) => c.includes('You do not have access')));
  linked(bot, server, 'admin1', 'Erin');
  bot.client.guilds = { cache: new Map([['g1', { id: 'g1', ownerId: 'x', members: { fetch: async () => ({ permissions: { has: () => true } }) } }]]) };
  await bot.plots.check(server, 'Erin', 'Chunk 21-34', { moved: true });
  assert.ok(!tavern.sent.some((c) => c.includes('You do not have access')));
  await bot.plots.check(server, 'Bob', 'Chunk 21-34', { moved: true });
  assert.ok(tavern.sent.some((c) => c.includes('You do not have access. You show as Bob')));
  assert.ok(tavern.sent.includes('player teleport "Bob" RespawnPoint'));
});

test('the leave rule is off by default and moves plot members out when on', async () => {
  const { bot, server, tavern } = makeBot();
  bot.plots.create(server, 'base', 'Alice', '21-34', [1, 1, 1]);
  await bot.plots.check(server, 'Alice', 'Chunk 22-34', { old: 'Chunk 21-34', moved: true });
  assert.ok(!tavern.sent.some((c) => c.includes('teleport')));
  bot.plots.settings(server).leave = true;
  await bot.plots.check(server, 'Alice', 'Chunk 22-34', { old: 'Chunk 21-34', moved: true });
  assert.ok(tavern.sent.includes('player teleport "Alice" RespawnPoint'));
});

test('/plot why names exactly what was compared', async () => {
  const { bot, server } = makeBot((text) => (/^player detailed/.test(text) ? { resultString: '', result: { Chunk: 'Chunk 21-34', Position: [1, 1, 1] } } : null));
  bot.plots.create(server, 'base', 'Alice', '21-34', [1, 1, 1]);
  const no = await run(bot, { command: 'plot', sub: 'why', values: { player: 'Bob' } });
  assert.match(no.last().text, /not allowed/);
  assert.match(no.last().text, /owner \*\*Alice\*\*/);
  const yes = await run(bot, { command: 'plot', sub: 'why', values: { player: 'Alice' } });
  assert.match(yes.last().text, /allowed\*\* \(owner\)/);
});

test('/plot claim takes a chunk list and refuses a clash', async () => {
  const { bot, server } = makeBot();
  const a = await run(bot, { command: 'plot', sub: 'claim', values: { name: 'one', owner: 'Alice', chunks: '15-28, 16-28' } });
  assert.match(a.last().text, /15-28, 16-28/);
  const b = await run(bot, { command: 'plot', sub: 'claim', values: { name: 'two', owner: 'Bob', chunks: '16-28' } });
  assert.match(b.last().text, /already belongs/);
  assert.match(bot.plots.map(server), /A = one \(Alice\)/);
});

test('each log kind can have its own channel and falls back to the event log', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const { bot, server, posts } = makeBot();
  bot.logs.start();
  bot.setGuild('g1', 'channels', 'logs', 'c-logs');
  bot.setGuild('g1', 'channels', 'log-deaths', 'c-deaths');
  server.onEvent({ type: 'PlayerKilled', data: { killedPlayer: { username: 'Alice' }, source: 5 } });
  server.onEvent({ type: 'PlayerJoined', data: { user: { id: 1, username: 'Bob' } } });
  server.onEvent({ type: 'PlayerStateChanged', data: { user: { username: 'Carl' }, state: 'Downed', isEnter: true } });
  t.mock.timers.tick(4100);
  await new Promise((r) => setImmediate(r));
  const text = (id) => posts.filter((p) => p.id === id).map((p) => p.p.embeds[0].toJSON().description).join('\n');
  assert.match(text('c-deaths'), /\*\*Alice\*\* died \(hunger\)/);
  assert.match(text('c-logs'), /\*\*Bob\*\* joined/);
  assert.match(text('c-logs'), /\*\*Carl\*\* is downed/);
});

test('a purchase takes coins, posts one at a time and logs it', async () => {
  const state = { coins: 100 };
  const { bot, server, tavern } = makeBot(eco(state));
  linked(bot, server, 'u1', 'Alice');
  await run(bot, { command: 'shop', sub: 'add', values: { item: String(IRON), category: 'Stuff', price: 10 } });
  const key = Object.keys(bot.economy.shop(server).items)[0];
  const i = await run(bot, { command: 'shop', sub: 'buy', values: { product: key, amount: 3 }, admin: false });
  assert.match(i.last().text, /3 x .* for \*\*30 coins/);
  assert.strictEqual(state.coins, 70);
  assert.strictEqual(tavern.sent.filter((c) => c.startsWith('trade post "Alice"')).length, 3);
  assert.strictEqual(bot.economy.ledger(server).pending.length, 0);
});

test('a failed delivery refunds what did not arrive', async () => {
  const state = { coins: 100, failAfter: 1 };
  const { bot, server } = makeBot(eco(state));
  linked(bot, server, 'u1', 'Alice');
  await run(bot, { command: 'shop', sub: 'add', values: { item: String(IRON), category: 'Stuff', price: 10 } });
  const key = Object.keys(bot.economy.shop(server).items)[0];
  const i = await run(bot, { command: 'shop', sub: 'buy', values: { product: key, amount: 3 }, admin: false });
  assert.match(i.last().text, /Only 1 of 3/);
  assert.strictEqual(state.coins, 90);
});

test('not enough coins and no link are refused before anything moves', async () => {
  const state = { coins: 5 };
  const { bot, server, tavern } = makeBot(eco(state));
  await run(bot, { command: 'shop', sub: 'add', values: { item: String(IRON), category: 'Stuff', price: 10 } });
  const key = Object.keys(bot.economy.shop(server).items)[0];
  const unlinked = await run(bot, { command: 'shop', sub: 'buy', values: { product: key }, admin: false });
  assert.match(unlinked.last().text, /Link your account/);
  linked(bot, server, 'u1', 'Alice');
  const poor = await run(bot, { command: 'shop', sub: 'buy', values: { product: key }, admin: false });
  assert.match(poor.last().text, /costs 10 coins and you have 5/);
  assert.ok(!tavern.sent.some((c) => c.startsWith('trade post') || c.startsWith('trade atm add')));
  assert.strictEqual(state.coins, 5);
});

test('the Town Hall blocks a purchase', async () => {
  const state = { coins: 100, chunk: 'Townhall Building Chunk' };
  const { bot, server } = makeBot(eco(state));
  linked(bot, server, 'u1', 'Alice');
  await run(bot, { command: 'shop', sub: 'add', values: { item: String(IRON), category: 'Stuff', price: 10 } });
  const key = Object.keys(bot.economy.shop(server).items)[0];
  const i = await run(bot, { command: 'shop', sub: 'buy', values: { product: key }, admin: false });
  assert.match(i.last().text, /Town Hall/);
  assert.strictEqual(state.coins, 100);
});

test('the shop menu walks through category, item and quantity', async () => {
  const state = { coins: 100 };
  const { bot, server } = makeBot(eco(state));
  linked(bot, server, 'u1', 'Alice');
  await run(bot, { command: 'shop', sub: 'add', values: { item: String(IRON), category: 'Stuff', price: 10 } });
  const key = Object.keys(bot.economy.shop(server).items)[0];
  const i = await run(bot, { command: 'shop', sub: 'menu', admin: false, picks: ['Stuff', key, '2'] });
  assert.match(i.last().text, /2 x/);
  assert.strictEqual(state.coins, 80);
});

test('selling asks first, removes through BotCore and pays the ATM', async () => {
  const state = { coins: 10, carried: 4 };
  const { bot, server, tavern } = makeBot(eco(state));
  linked(bot, server, 'u1', 'Alice');
  await run(bot, { command: 'sell', sub: 'add', values: { item: String(IRON), price: 5 } });
  const no = await run(bot, { command: 'sell', sub: 'item', values: { goods: String(IRON) }, admin: false, confirm: false });
  assert.match(no.last().text, /nothing was done/i);
  assert.strictEqual(state.carried, 4);
  const yes = await run(bot, { command: 'sell', sub: 'item', values: { goods: String(IRON), amount: 3 }, admin: false });
  assert.match(yes.last().text, /3 x .* for \*\*15 coins/);
  assert.strictEqual(state.carried, 1);
  assert.strictEqual(state.coins, 25);
  assert.ok(tavern.sent.some((c) => /botcore take "Alice" \d+ 3 count all/.test(c)));
});

test('selling respects the daily limit, carrying nothing and bags with contents', async () => {
  const state = { coins: 0, carried: 5 };
  const { bot, server } = makeBot(eco(state));
  linked(bot, server, 'u1', 'Alice');
  await run(bot, { command: 'sell', sub: 'add', values: { item: String(IRON), price: 1, daily: 2 } });
  await run(bot, { command: 'sell', sub: 'item', values: { goods: String(IRON) }, admin: false });
  assert.strictEqual(state.carried, 3);
  const limit = await run(bot, { command: 'sell', sub: 'item', values: { goods: String(IRON) }, admin: false });
  assert.match(limit.last().text, /today's limit/);
  await run(bot, { command: 'sell', sub: 'remove', values: { goods: String(IRON) } });
  await run(bot, { command: 'sell', sub: 'add', values: { item: String(IRON), price: 1 } });
  state.carried = 0;
  state.refused = 1;
  const bag = await run(bot, { command: 'sell', sub: 'item', values: { goods: String(IRON) }, admin: false });
  assert.match(bag.last().text, /Empty it first/);
});

test('a sell price at or above the shop price is refused both ways', async () => {
  const { bot } = makeBot(eco({ coins: 0 }));
  await run(bot, { command: 'shop', sub: 'add', values: { item: String(IRON), category: 'Stuff', price: 10 } });
  const a = await run(bot, { command: 'sell', sub: 'add', values: { item: String(IRON), price: 10 } });
  assert.match(a.last().text, /print coins/);
  await run(bot, { command: 'sell', sub: 'add', values: { item: String(IRON), price: 5 } });
  const b = await run(bot, { command: 'shop', sub: 'add', values: { item: String(IRON), category: 'Stuff', price: 4 } });
  assert.match(b.last().text, /print coins/);
});

test('an unconfirmed ATM leaves a pending row an admin can see and settle', async () => {
  const state = { coins: 100 };
  const base = eco(state);
  const { bot, server } = makeBot((text) => (/^trade atm add/.test(text) ? { resultString: '0', result: null } : base(text)));
  linked(bot, server, 'u1', 'Alice');
  await run(bot, { command: 'shop', sub: 'add', values: { item: String(IRON), category: 'Stuff', price: 10 } });
  const key = Object.keys(bot.economy.shop(server).items)[0];
  const i = await run(bot, { command: 'shop', sub: 'buy', values: { product: key }, admin: false });
  assert.match(i.last().text, /did not confirm/);
  const list = await run(bot, { command: 'shop', sub: 'pending' });
  assert.match(list.last().text, /coins unconfirmed/);
  const done = await run(bot, { command: 'shop', sub: 'settle', values: { row: 1 } });
  assert.match(done.last().text, /Clearing it moves no coins/);
  assert.strictEqual(bot.economy.ledger(server).pending.length, 0);
});

test('withdraw takes coins and mails a pouch, refunding if the mail fails', async () => {
  const state = { coins: 100 };
  const { bot, server, tavern } = makeBot(eco(state));
  linked(bot, server, 'u1', 'Alice');
  const ok = await run(bot, { command: 'withdraw', values: { amount: 40 }, admin: false });
  assert.match(ok.last().text, /40 coins/);
  assert.strictEqual(state.coins, 60);
  assert.ok(tavern.sent.includes('trade post "Alice" 61648 40'));
  state.failAfter = 0;
  state.posts = 0;
  const bad = await run(bot, { command: 'withdraw', values: { amount: 10 }, admin: false });
  assert.match(bad.last().text, /coins were returned/);
  assert.strictEqual(state.coins, 60);
});

test('shop commands say BotCore is needed without it', async () => {
  const { bot, server } = makeBot();
  linked(bot, server, 'u1', 'Alice');
  await run(bot, { command: 'shop', sub: 'add', values: { item: String(IRON), category: 'Stuff', price: 10 } });
  const key = Object.keys(bot.economy.shop(server).items)[0];
  const i = await run(bot, { command: 'shop', sub: 'buy', values: { product: key }, admin: false });
  assert.match(i.last().text, /BotCore/);
});

test('despawn counts first and removes only after the confirm', async () => {
  const entities = [{ id: 1, hash: IRON, name: 'Spriggull Feather Red', parent: 0 }, { id: 2, hash: IRON, name: 'Spriggull Feather Red', parent: 9 }];
  const handler = (text) => {
    if (text.startsWith('select find')) return { resultString: '', result: entities.map((e) => ({ Identifier: e.id, Name: `${e.name}(Clone)` })) };
    const m = text.match(/^select get (\d+)$/);
    if (m) {
      const e = entities.find((x) => x.id === Number(m[1]));
      return { resultString: '', result: { Identifier: e.id, PrefabHash: e.hash, ChunkingParent: e.parent } };
    }
    return null;
  };
  const { bot, tavern } = makeBot(handler);
  const no = await run(bot, { command: 'despawn', values: { item: String(IRON) }, confirm: false });
  assert.match(no.last().text, /nothing was done/i);
  assert.ok(!tavern.sent.some((c) => c.startsWith('wacky destroy-free')));
  const yes = await run(bot, { command: 'despawn', values: { item: String(IRON) } });
  assert.match(yes.last().text, /1 x/);
  assert.ok(tavern.sent.includes(`wacky destroy-free ${IRON}`));
  const none = await run(bot, { command: 'despawn', values: { item: String(STONE) } });
  assert.match(none.last().text, /None on the ground/);
});

test('wipe takes a chunk and refuses text that could not be a name', async () => {
  const { bot, tavern } = makeBot();
  const bad = await run(bot, { command: 'wipe', values: { item_code: 'x" ; quit ; "' } });
  assert.match(bad.last().text, /item code/);
  await run(bot, { command: 'wipe', values: { item_code: String(IRON), chunk: '21-34' } });
  assert.ok(tavern.sent.includes(`wacky destroy-free ${IRON} 21-34`));
});

test('alchemy matches the pockets in order, as any order and for one item anywhere', () => {
  const belt = [{ id: 1, hash: 10 }, null, { id: 3, hash: 20 }, { id: 4, hash: 30 }];
  assert.deepStrictEqual(Alchemy.match({ slots: [20], ordered: true }, belt).map((b) => b.id), [3]);
  assert.deepStrictEqual(Alchemy.match({ slots: [10, 30], ordered: true }, belt).map((b) => b.id), [1, 4]);
  assert.strictEqual(Alchemy.match({ slots: [30, 10], ordered: true }, belt), null);
  assert.deepStrictEqual(Alchemy.match({ slots: [30, 10], ordered: false }, belt).map((b) => b.id), [4, 1]);
  assert.strictEqual(Alchemy.match({ slots: [10, 20, 30, 40], ordered: true }, belt), null);
  assert.deepStrictEqual(Alchemy.match({ slots: [10, 20], ordered: true }, belt).map((b) => b.id), [1, 3]);
  const full = [{ id: 1, hash: 10 }, { id: 2, hash: 20 }, { id: 3, hash: 20 }, { id: 4, hash: 30 }];
  assert.strictEqual(Alchemy.match({ slots: [20, 10, 20, 30], ordered: true }, full), null);
  assert.strictEqual(Alchemy.match({ slots: [10, 10], ordered: false }, full), null);
});

function pockets(belt, extra = {}) {
  return (text) => {
    if (/^player inventory/.test(text)) return { resultString: '', result: [{ Belt: belt, LeftHand: extra.left || null, RightHand: extra.right || null, All: extra.all || [] }] };
    if (/^select \d+$/.test(text)) return { resultString: `Selected: ${text.split(' ')[1]} - x`, result: null };
    if (/^player list-detailed/.test(text)) return { resultString: '', result: extra.players || [] };
    if (/^player detailed/.test(text)) return { resultString: '', result: extra.detailed || {} };
    return null;
  };
}

const COIN = { id: 5, hash: IRON };

function beltItem(b) {
  return { Identifier: b.id, PrefabHash: b.hash, Name: 'x' };
}

test('a pockets recipe uses the item, runs its commands and respects the cooldown', async () => {
  const { bot, server, tavern } = makeBot(pockets([beltItem(COIN), null, null, null]));
  await run(bot, { command: 'alchemy', sub: 'create', values: { name: 'zap', items: String(IRON), delete_items: true, command: 'player kill {player}', trigger: 'pockets', cooldown: 60, message: 'Zap' }, owner: true });
  await bot.alchemy.inspect(server, 'Alice');
  assert.ok(tavern.sent.includes('select 5'));
  assert.ok(tavern.sent.includes('select destroy'));
  assert.ok(tavern.sent.includes('player kill "Alice"'));
  tavern.sent.length = 0;
  await bot.alchemy.inspect(server, 'Alice');
  assert.ok(!tavern.sent.includes('player kill "Alice"'));
  assert.ok(tavern.sent.some((c) => /ready in/.test(c)));
});

test('a hands recipe waits for the hands to come together, and fires once per clap', async () => {
  const state = { detailed: { LeftHandPosition: [0, 0, 0], RightHandPosition: [1, 0, 0] } };
  const { bot, server, tavern } = makeBot(pockets([beltItem(COIN), null, null, null], state));
  await run(bot, { command: 'alchemy', sub: 'create', values: { name: 'clap', items: String(IRON), delete_items: false, command: 'time set Noon' }, owner: true });
  await bot.alchemy.inspect(server, 'Alice');
  await bot.alchemy.pollHands();
  assert.ok(!tavern.sent.includes('time set Noon'));
  state.detailed.RightHandPosition = [0.1, 0, 0];
  await bot.alchemy.pollHands();
  assert.ok(tavern.sent.includes('time set Noon'));
  tavern.sent.length = 0;
  await bot.alchemy.pollHands();
  assert.ok(!tavern.sent.includes('time set Noon'), 'hands must part first');
  bot.alchemy.stop();
});

test('the whitelist and the area option pick who it runs on', async () => {
  const players = [{ username: 'Alice', Chunk: 'Chunk 1-1', Position: [0, 0, 0] }, { username: 'Bob', Chunk: 'Chunk 1-1', Position: [0, 0, 0] }, { username: 'Carl', Chunk: 'Chunk 2-2', Position: [0, 0, 0] }];
  const { bot, server, tavern } = makeBot(pockets([beltItem(COIN), null, null, null], { players }));
  await run(bot, { command: 'alchemy', sub: 'create', values: { name: 'aura', items: String(IRON), delete_items: false, command: 'player kill {player}', trigger: 'pockets', aoe: true, aoe_caster: false, whitelist: 'Alice', cooldown: 60 }, owner: true });
  await bot.alchemy.inspect(server, 'Bob');
  assert.ok(!tavern.sent.some((c) => c.startsWith('player kill')), 'not on the whitelist');
  await bot.alchemy.inspect(server, 'Alice');
  assert.ok(tavern.sent.includes('player kill "Bob"'));
  assert.ok(!tavern.sent.includes('player kill "Alice"'));
  assert.ok(!tavern.sent.includes('player kill "Carl"'));
});

test('recipes can only be made by the owner, and give and buff work without a command', async () => {
  const { bot, server, tavern } = makeBot(pockets([beltItem(COIN), null, null, null]));
  const denied = await run(bot, { command: 'alchemy', sub: 'create', values: { name: 'x', items: String(IRON), delete_items: false, command: 'quit' } });
  assert.match(denied.last().text, /Not allowed/);
  await run(bot, { command: 'alchemy', sub: 'create', values: { name: 'gift', items: String(IRON), delete_items: false, trigger: 'pockets', cooldown: 60, gives: String(STONE), gives_amount: 2, buff_stat: 'speed', buff_value: 1, buff_seconds: 30 }, owner: true });
  await bot.alchemy.inspect(server, 'Alice');
  assert.strictEqual(tavern.sent.filter((c) => c === `spawn "Alice" ${STONE}`).length, 2);
  assert.ok(tavern.sent.includes('player modify-stat "Alice" speed 1 30 false'));
});

test('a carried item buff applies while carried and stops refreshing when dropped', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  const state = { right: beltItem(COIN) };
  const { bot, server, tavern } = makeBot((text) => {
    if (/^player inventory/.test(text)) return { resultString: '', result: [{ Belt: [], LeftHand: null, RightHand: state.right, All: [] }] };
    return null;
  });
  await run(bot, { command: 'alchemy', sub: 'hold', values: { name: 'swift', item: String(IRON), stat: 'speed', value: 2, where: 'hand' }, owner: true });
  await bot.alchemy.inspect(server, 'Alice');
  assert.strictEqual(tavern.sent.filter((c) => c === 'player modify-stat "Alice" speed 2 15 false').length, 1);
  t.mock.timers.tick(15000);
  assert.strictEqual(tavern.sent.filter((c) => c === 'player modify-stat "Alice" speed 2 15 false').length, 2);
  state.right = null;
  await bot.alchemy.inspect(server, 'Alice');
  t.mock.timers.tick(30000);
  assert.strictEqual(tavern.sent.filter((c) => c === 'player modify-stat "Alice" speed 2 15 false').length, 2);
  bot.alchemy.stop();
});

test('a hold rule with a whitelist only buffs those players', async () => {
  const { bot, server, tavern } = makeBot((text) => (/^player inventory/.test(text) ? { resultString: '', result: [{ Belt: [beltItem(COIN)], LeftHand: null, RightHand: null, All: [] }] } : null));
  await run(bot, { command: 'alchemy', sub: 'hold', values: { name: 'mine', item: String(IRON), stat: 'damage', value: 1, where: 'pocket', whitelist: 'Bob' }, owner: true });
  await bot.alchemy.inspect(server, 'Alice');
  assert.ok(!tavern.sent.some((c) => c.startsWith('player modify-stat')));
  await bot.alchemy.inspect(server, 'Bob');
  assert.ok(tavern.sent.some((c) => c.startsWith('player modify-stat "Bob" damage')));
  bot.alchemy.stop();
});

test('alchemy only asks for the inventory event while something uses it', async () => {
  const { bot, server } = makeBot();
  assert.ok(!server.wantedBy.get('InventoryChanged'));
  await run(bot, { command: 'alchemy', sub: 'create', values: { name: 'a', items: String(IRON), delete_items: false, command: 'time set Noon' }, owner: true });
  assert.ok(server.wantedBy.get('InventoryChanged').has('alchemy'));
  await run(bot, { command: 'alchemy', sub: 'delete', values: { name: 'a' }, owner: true });
  assert.ok(!server.wantedBy.get('InventoryChanged').has('alchemy'));
});
