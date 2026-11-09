const { SlashCommandBuilder } = require('discord.js');
const { addItem, addInt, addName, addBool, addMaterial } = require('../core/opts');
const items = require('../core/items');
const materials = require('../core/materials');
const { UserError, own } = require('../game/text');

function goods(s, description = 'What to sell') {
  return addName(s, 'goods', description, { auto: true, max: 60 });
}

function find(doc, text) {
  const key = String(text).toLowerCase();
  const hit = own(doc.items, key);
  if (hit) return hit;
  return Object.values(doc.items).find((x) => x.name.toLowerCase() === key) || null;
}

function priced(x) {
  return `**${x.name}**: ${x.price} coins each${x.daily ? `, up to ${x.daily} a day` : ''}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('Sell items you carry to the bot for ATM coins (needs BotCore)')
    .addSubcommand((s) => s.setName('list').setDescription('What the bot buys and for how much'))
    .addSubcommand((s) => addInt(goods(s.setName('item').setDescription('Sell what you hold or carry, you confirm first')), 'amount', 'Most to sell (default all you carry)', { required: false, min: 1, max: 100 }))
    .addSubcommand((s) => addMaterial(addInt(addInt(addItem(s.setName('add').setDescription('Set what the bot pays for an item, or for one wood or metal of it')), 'price', 'Coins paid per item', { min: 1, max: 10000000 }), 'daily', 'Most one player can sell a day', { required: false, min: 1, max: 10000 })))
    .addSubcommand((s) => goods(s.setName('remove').setDescription('Stop buying an item'), 'Item to stop buying'))
    .addSubcommand((s) => addBool(s.setName('pause').setDescription('Pause or resume all buying'), 'on', 'True pauses, false resumes')),
  access: { list: 'everyone', item: 'everyone', '*': 'admin' },
  public: ['list'],

  async autocomplete(ctx, focused) {
    if (!ctx.server || focused.name !== 'goods') return [];
    const q = String(focused.value).toLowerCase();
    const all = ctx.bot.economy.buyback(ctx.server).items;
    const rows = Object.entries(all)
      .filter(([, x]) => x.name.toLowerCase().includes(q))
      .map(([key, x]) => ({ name: `${x.name}: ${x.price} coins`, value: key }));
    if (ctx.sub !== 'item') return rows;
    const kinds = new Map(Object.values(all).filter((x) => x.material && !own(all, String(x.hash))).map((x) => [x.hash, x.base]));
    const groups = [...kinds].filter(([, base]) => base.toLowerCase().includes(q)).map(([hash, base]) => ({ name: `${base}: any kind, priced by what you carry`, value: `all:${hash}` }));
    return groups.concat(rows);
  },

  async run(ctx) {
    const s = ctx.needServer();
    const eco = ctx.bot.economy;
    const doc = eco.buyback(s);
    if (ctx.sub === 'list') {
      const list = Object.values(doc.items);
      const head = doc.paused ? 'Buying is paused right now.\n\n' : '';
      return ctx.info('The bot buys', head + (list.map(priced).join('\n') || 'Nothing yet.'));
    }
    if (ctx.sub === 'add') {
      const item = items.resolve(ctx.opt('item'));
      if (!item || item.unknown) throw new UserError(`No item matches "${ctx.opt('item')}". Pick one from the list.`);
      if (!item.pickup) throw new UserError(`${item.name} cannot be picked up, so nobody could sell it.`);
      const price = ctx.opt('price');
      const material = materials.fromOption(ctx.opt('material'));
      eco.assertNoLoop(s, item.hash, { sell: price, material: material && material.value });
      const key = material ? `${item.hash}:${material.value}` : String(item.hash);
      doc.items[key] = { hash: item.hash, name: materials.named(item.name, material), base: item.name, material: material ? material.value : null, price, daily: ctx.opt('daily') || null };
      eco.saveBuyback(s);
      ctx.note(`${doc.items[key].name} ${price}`);
      return ctx.ok('Price set', priced(doc.items[key]));
    }
    if (ctx.sub === 'remove') {
      const x = find(doc, ctx.opt('goods'));
      if (!x) throw new UserError(`The bot does not buy "${ctx.opt('goods')}".`);
      delete doc.items[x.material ? `${x.hash}:${x.material}` : String(x.hash)];
      eco.saveBuyback(s);
      ctx.note(x.name);
      return ctx.ok('Removed', x.name);
    }
    if (ctx.sub === 'pause') {
      doc.paused = ctx.opt('on');
      eco.saveBuyback(s);
      return ctx.ok('Buying', doc.paused ? 'Paused.' : 'Back on.');
    }
    if (!ctx.bot.links.of(s, ctx.user.id)) throw new UserError('Link your account with /link first, the bot pays your in-game name.');
    const entries = eco.saleEntries(doc, ctx.opt('goods'));
    if (!entries.length) throw new UserError(`The bot does not buy "${ctx.opt('goods')}". See /sell list.`);
    const r = await eco.sell(ctx, entries, ctx.opt('amount'));
    if (!r) return null;
    return ctx.ok('Sold', `You sold **${r.what}** for **${r.paid} coins**. Your ATM holds ${r.balance}.`);
  },
};
