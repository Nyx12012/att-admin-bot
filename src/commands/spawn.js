const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addItem, addInt, addMaterial, addBool } = require('../core/opts');
const items = require('../core/items');
const materials = require('../core/materials');
const { UserError } = require('../game/text');

async function give(server, name, item, count, extra = '', cap = 1) {
  const most = Math.max(1, cap);
  let made = 0;
  while (made < count) {
    const n = Math.min(most, count - made);
    const r = await server.run(`spawn "${name}" ${item.hash}${n > 1 ? ` ${n}` : ''}${extra}`, { allowError: true });
    if (r.error) {
      if (made === 0) throw new UserError(`The server refused to spawn ${item.name}: ${r.error}`);
      break;
    }
    made += n;
  }
  return made;
}

function pouchesOf(made, cap) {
  if (cap <= 1) return 0;
  return Math.floor(made / cap) + (made % cap > 1 ? 1 : 0);
}

module.exports = {
  data: addBool(addMaterial(addInt(addItem(addPlayer(new SlashCommandBuilder().setName('spawn').setDescription('Spawn items in front of a player (owner only by default)'))), 'amount', 'How many (default 1)', { required: false, min: 1, max: 50 })), 'forged', 'Spawn it finished, ready to use', { required: false }),
  access: 'owner',
  give,

  async run(ctx) {
    const s = ctx.needOnline();
    const name = ctx.player();
    const item = items.resolve(ctx.opt('item'));
    if (!item) throw new UserError(`No item matches "${ctx.opt('item')}". Pick one from the list.`);
    const count = ctx.opt('amount') || 1;
    const material = materials.fromOption(ctx.opt('material'));
    if (material && !item.unknown && !item.material) throw new UserError(`**${item.name}** has no material part, so the game would ignore ${material.name}. Spawn it without a material, or spawn one of its parts instead.`);
    const cap = count > 1 ? await ctx.bot.economy.stackOf(s, item.hash) : 1;
    const made = await give(s, name, item, count, `${material ? ` ${material.value}` : ''}${ctx.opt('forged') ? ' forged' : ''}`, cap);
    const label = item.unknown ? item.name : materials.named(item.name, material);
    const pouches = pouchesOf(made, cap);
    ctx.note(`${made} x ${label} (${item.hash}) to ${name}`);
    return ctx.ok('Spawned', `${made} x **${label}** in front of ${name}${pouches ? `, in ${pouches} ${pouches === 1 ? 'pouch' : 'pouches'}` : ''}.${material && item.unknown ? ` The bot has no record of this item, so it cannot say whether ${material.name} applied.` : ''}`);
  },
};
