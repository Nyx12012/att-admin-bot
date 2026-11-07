const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const { addItem, addName } = require('../core/opts');
const { embed } = require('../core/ui');
const items = require('../core/items');
const { UserError, chunkName, isSafeName, quoteName } = require('../game/text');

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{1,60}$/;
const NOBODY = 'Nobody is online, and items only exist near players, so there is nothing to remove.';

async function removeOne(ctx, item) {
  const s = ctx.needOnline();
  const preview = await ctx.bot.cleanup.sweepItems(s, [item.hash], { preview: true });
  if (preview.scan.nobody) return ctx.info(item.name, NOBODY);
  const found = preview.scan.total;
  if (found === 0) return ctx.info(item.name, 'None on the ground near any player. Held and stored ones are never touched.');
  if (!(await ctx.confirm(`Remove ${item.name}?`, `**${found}** on the ground near players will be removed. Held items, bags and storage slots are safe. Items on shelves or in open crates count as on the ground.`, { label: `Remove ${found}` }))) return null;
  const r = await ctx.bot.cleanup.sweepItems(s, [item.hash]);
  ctx.note(`${r.removed} x ${item.name}`);
  return ctx.ok('Removed', `${r.removed} x **${item.name}**.`);
}

async function loose(ctx, s) {
  const anchor = s.players().map((p) => p.username).find(isSafeName);
  if (!anchor) throw new UserError(NOBODY);
  const all = await s.value(`select find ${quoteName(anchor)} 100000`, { timeout: 60000 });
  if (!Array.isArray(all)) throw new UserError('Could not list the loaded items.');
  const counts = new Map();
  for (const e of all) {
    const item = items.resolve(String(e.Name || '').replace(/^\d+\s*-\s*/, '').replace(/\(Clone\)$/, '').trim());
    if (item && item.pickup) counts.set(item.hash, (counts.get(item.hash) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([hash, n]) => ({ item: items.byHash(hash), n }));
}

const despawn = {
  data: addItem(new SlashCommandBuilder().setName('despawn').setDescription('Remove every loose copy of one item near players')),
  access: 'admin',

  async run(ctx) {
    const item = items.resolve(ctx.opt('item'));
    if (!item) throw new UserError(`No item matches "${ctx.opt('item')}". Pick one from the list.`);
    return removeOne(ctx, item);
  },
};

const despawnmenu = {
  data: new SlashCommandBuilder().setName('despawnmenu').setDescription('Pick from what is loaded near players and remove it'),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needOnline();
    const list = await loose(ctx, s);
    if (list.length === 0) return ctx.info('Nothing found', 'No items that can be picked up are loaded near players.');
    const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('despawn-pick').setPlaceholder('Item to remove')
      .addOptions(list.map((x) => ({ label: `${x.n} x ${x.item.name}`.slice(0, 100), value: String(x.item.hash) }))));
    const msg = await ctx.reply({ embeds: [embed('info', 'Remove what?', 'The most common items loaded near players, counting held and stored ones. The next step shows how many are really loose.')], components: [row] });
    let choice;
    try {
      choice = await msg.awaitMessageComponent({ componentType: ComponentType.StringSelect, time: 60000, filter: (x) => x.user.id === ctx.user.id });
    } catch {
      ctx.cancelled = true;
      return ctx.reply({ embeds: [embed('muted', 'Remove what?', 'No answer, nothing was done.')], components: [] });
    }
    await choice.deferUpdate().catch(() => {});
    return removeOne(ctx, items.byHash(choice.values[0]));
  },
};

const wipe = {
  data: addName(addName(new SlashCommandBuilder().setName('wipe').setDescription('Remove loose copies of an item by code or identifier'), 'item_code', 'Item code, name or identifier', { max: 60 }), 'chunk', 'Only this chunk, like 21-34', { required: false, max: 12 }),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needOnline();
    const text = String(ctx.opt('item_code')).trim();
    const known = items.resolve(text);
    const chunk = ctx.opt('chunk') ? chunkName(ctx.opt('chunk')) : null;
    if (chunk && !/^\d+-\d+$/.test(chunk)) throw new UserError('Write the chunk like 21-34.');
    if (known && !chunk && !known.unknown) return removeOne(ctx, known);
    const code = known ? known.hash : text;
    if (!known && !IDENTIFIER.test(text)) throw new UserError('Use an item code, an item name or an identifier like Prefab_Babu.');
    const label = known ? known.name : text;
    if (!(await ctx.confirm(`Remove ${label}?`, `Every loose copy${chunk ? ` in chunk ${chunk}` : ' near players'} is removed. The bot cannot count this one first. Held items, bags and storage slots are safe.`, { label: 'Remove' }))) return null;
    const r = await s.run(`wacky destroy-free ${code}${chunk ? ` ${chunk}` : ''}`, { allowError: true });
    if (r.error) throw new UserError(`The server refused: ${String(r.error).slice(0, 200)}`);
    ctx.note(`${label}${chunk ? ` in ${chunk}` : ''}`);
    return ctx.ok('Removed', `Loose copies of **${label}**${chunk ? ` in chunk ${chunk}` : ''} were removed.`);
  },
};

module.exports = [despawn, despawnmenu, wipe];
