const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const { addItem, addInt, addName, addMaterial, addBool } = require('../core/opts');
const materials = require('../core/materials');
const { embed } = require('../core/ui');
const items = require('../core/items');
const { UserError, safeKey, own } = require('../game/text');

const QUANTITIES = [1, 2, 3, 4, 5, 10, 15, 20, 25];
const NO_LINK = 'Link your account with /link first, the bot pays and delivers to your in-game name.';

function product(s, description = 'Shop item') {
  return addName(s, 'product', description, { auto: true, max: 60 });
}

function find(doc, text) {
  const key = String(text).toLowerCase();
  const hit = own(doc.items, key);
  if (hit) return hit;
  return Object.values(doc.items).find((x) => x.name.toLowerCase() === key) || null;
}

function grouped(doc) {
  const out = new Map();
  for (const x of Object.values(doc.items)) {
    if (!out.has(x.category)) out.set(x.category, []);
    out.get(x.category).push(x);
  }
  return out;
}

function priced(x) {
  return `**${x.name}**: ${x.price} coins${x.role ? ' (Discord role)' : ''}${x.daily ? `, ${x.daily} a day` : ''}`;
}

function done(ctx, r) {
  const lines = [`You bought **${r.delivered} x ${r.name}** for **${r.spent} coins**. You have ${r.left} left.`];
  lines.push(r.role ? 'The role is yours now.' : 'It is waiting in your mailbox.');
  if (r.delivered < r.amount) lines.push(`Only ${r.delivered} of ${r.amount} could be sent, the rest was refunded. ${r.problem || ''}`);
  return ctx.ok('Bought', lines.join('\n'));
}

async function pick(ctx, msg) {
  try {
    const choice = await msg.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      time: 60000,
      filter: (x) => x.user.id === ctx.user.id,
    });
    await choice.deferUpdate().catch(() => {});
    return choice.values[0];
  } catch {
    await ctx.reply({ embeds: [embed('muted', 'Shop', 'No answer, nothing was bought.')], components: [] });
    return null;
  }
}

function menu(id, placeholder, options) {
  return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).addOptions(options.slice(0, 25)))];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Buy items with ATM coins (needs the BotCore server mod)')
    .addSubcommand((s) => s.setName('list').setDescription('Everything for sale'))
    .addSubcommand((s) => s.setName('menu').setDescription('Pick something to buy from a menu'))
    .addSubcommand((s) => addInt(product(s.setName('buy').setDescription('Buy an item, it arrives in your mailbox')), 'amount', 'How many (default 1)', { required: false, min: 1, max: 25 }))
    .addSubcommand((s) => addBool(addMaterial(addInt(addInt(addName(addItem(s.setName('add').setDescription('Add or change an item for sale')), 'category', 'Category, like Weapons', { max: 40 }), 'price', 'Price in coins', { min: 1, max: 10000000 }), 'daily', 'Most one player can buy a day', { required: false, min: 1, max: 10000 })), 'forged', 'Sell it finished, ready to use', { required: false }))
    .addSubcommand((s) => addInt(addName(addName(s.setName('addrole').setDescription('Sell a Discord role'), 'category', 'Category, like Perks', { max: 40 }), 'name', 'Name shown in the shop', { max: 60 }), 'price', 'Price in coins', { min: 1, max: 10000000 })
      .addRoleOption((o) => o.setName('role').setDescription('The role to grant').setRequired(true)))
    .addSubcommand((s) => product(s.setName('remove').setDescription('Take an item off sale')))
    .addSubcommand((s) => addInt(s.setName('atmdistance').setDescription('Block buying, selling and withdrawing near an ATM (default 15, 0 turns it off)'), 'meters', 'Meters around an ATM', { min: 0, max: 200 }))
    .addSubcommand((s) => s.setName('pending').setDescription('Purchases and sales that did not finish'))
    .addSubcommand((s) => addInt(s.setName('settle').setDescription('Clear a row of /shop pending once you fixed it by hand'), 'row', 'Row number', { min: 1 })),
  access: { list: 'everyone', menu: 'everyone', buy: 'everyone', '*': 'admin' },
  public: ['list'],

  async autocomplete(ctx, focused) {
    if (!ctx.server || focused.name !== 'product') return [];
    const q = String(focused.value).toLowerCase();
    return Object.values(ctx.bot.economy.shop(ctx.server).items)
      .filter((x) => x.name.toLowerCase().includes(q) || x.category.toLowerCase().includes(q))
      .map((x) => ({ name: `${x.name}: ${x.price} coins (${x.category})`, value: x.key }));
  },

  async run(ctx) {
    const s = ctx.needServer();
    const eco = ctx.bot.economy;
    const doc = eco.shop(s);
    if (ctx.sub === 'list') {
      const groups = grouped(doc);
      if (groups.size === 0) return ctx.info('Shop', 'Nothing for sale yet.');
      return ctx.info('Shop', 'Buy with `/shop buy` or `/shop menu`. Use `/link` first.', [...groups].map(([cat, list]) => [cat, list.map(priced).join('\n'), false]));
    }
    if (ctx.sub === 'add') {
      const item = items.resolve(ctx.opt('item'));
      if (!item || item.unknown) throw new UserError(`No item matches "${ctx.opt('item')}". Pick one from the list.`);
      const price = ctx.opt('price');
      const material = materials.fromOption(ctx.opt('material'));
      eco.assertNoLoop(s, item.hash, { buy: price, material: material && material.value });
      const key = material ? safeKey(`${item.hash}-${material.value}`) : safeKey(item.name.replace(/\s+/g, '-'));
      const name = materials.named(item.name, material);
      doc.items[key] = { key, hash: item.hash, name, category: String(ctx.opt('category')).trim(), price, daily: ctx.opt('daily') || null, material: material ? material.value : null, forged: Boolean(ctx.opt('forged')) };
      eco.saveShop(s);
      ctx.note(`${name} ${price}`);
      return ctx.ok('Item added', priced(doc.items[key]));
    }
    if (ctx.sub === 'addrole') {
      const role = ctx.role('role');
      const name = String(ctx.opt('name')).trim();
      const key = safeKey(`role-${name.replace(/\s+/g, '-')}`);
      doc.items[key] = { key, role: role.id, name, category: String(ctx.opt('category')).trim(), price: ctx.opt('price'), daily: null };
      eco.saveShop(s);
      ctx.note(`${name} ${ctx.opt('price')}`);
      return ctx.ok('Role added', `${priced(doc.items[key])}\nThe bot needs Manage Roles, and its own role must sit above <@&${role.id}>.`);
    }
    if (ctx.sub === 'remove') {
      const x = find(doc, ctx.opt('product'));
      if (!x) throw new UserError(`"${ctx.opt('product')}" is not for sale.`);
      delete doc.items[x.key];
      eco.saveShop(s);
      ctx.note(x.name);
      return ctx.ok('Removed', x.name);
    }
    if (ctx.sub === 'atmdistance') {
      doc.atmDistance = ctx.opt('meters');
      eco.saveShop(s);
      ctx.note(`${doc.atmDistance} m`);
      return ctx.ok('ATM rule', doc.atmDistance ? `Coins and items cannot move while the player is within ${doc.atmDistance} m of an ATM.` : 'Off.');
    }
    if (ctx.sub === 'pending') {
      const rows = eco.ledger(s).pending;
      return ctx.info('Unfinished rows', rows.map((r) => `**${r.id}**: ${r.kind}, ${r.player}, ${r.amount} x ${r.item}, ${r.coins} coins, ${r.state}`).join('\n') || 'Nothing is waiting.');
    }
    if (ctx.sub === 'settle') {
      const row = eco.settle(s, ctx.opt('row'));
      if (!row) throw new UserError(`There is no row ${ctx.opt('row')}.`);
      ctx.note(JSON.stringify(row));
      return ctx.ok('Row cleared', `${row.kind} of ${row.player}, ${row.coins} coins. Clearing it moves no coins, use /atm if they are owed any.`);
    }
    if (!ctx.bot.links.of(s, ctx.user.id)) throw new UserError(NO_LINK);
    if (ctx.sub === 'buy') {
      const x = find(doc, ctx.opt('product'));
      if (!x) throw new UserError(`"${ctx.opt('product')}" is not for sale. See /shop list.`);
      const r = await eco.buy(ctx, x, ctx.opt('amount') || 1);
      return done(ctx, { ...r, name: x.name, role: x.role });
    }
    const groups = grouped(doc);
    if (groups.size === 0) return ctx.info('Shop', 'Nothing for sale yet.');
    let msg = await ctx.reply({
      embeds: [embed('info', 'Shop', 'Pick a category.')],
      components: menu('shop-cat', 'Category', [...groups.keys()].map((c) => ({ label: c.slice(0, 100), value: c.slice(0, 100) }))),
    });
    const category = await pick(ctx, msg);
    if (!category) return null;
    const list = (groups.get(category) || []).slice(0, 25);
    msg = await ctx.reply({
      embeds: [embed('info', category, 'Pick an item.')],
      components: menu('shop-item', 'Item', list.map((x) => ({ label: `${x.name}: ${x.price} coins`.slice(0, 100), value: x.key }))),
    });
    const key = await pick(ctx, msg);
    if (!key) return null;
    const x = own(doc.items, key);
    if (!x) throw new UserError('That item just went off sale.');
    let amount = 1;
    if (!x.role) {
      msg = await ctx.reply({
        embeds: [embed('info', x.name, `${x.price} coins each. How many?`)],
        components: menu('shop-qty', 'How many', QUANTITIES.map((n) => ({ label: `${n} for ${n * x.price} coins`.slice(0, 100), value: String(n) }))),
      });
      const chosen = await pick(ctx, msg);
      if (!chosen) return null;
      amount = Number(chosen);
    }
    const now = own(doc.items, key);
    if (!now || now.price !== x.price) throw new UserError(`${x.name} changed while you were choosing. Open /shop menu again.`);
    const r = await eco.buy(ctx, now, amount);
    return done(ctx, { ...r, name: now.name, role: now.role });
  },
};
