const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addItem, addInt, addMaterial, addBool } = require('../core/opts');
const items = require('../core/items');
const materials = require('../core/materials');
const { UserError } = require('../game/text');

async function give(server, name, item, count, extra = '') {
  let made = 0;
  for (let i = 0; i < count; i += 1) {
    const r = await server.run(`spawn "${name}" ${item.hash}${extra}`, { allowError: true });
    if (r.error) {
      if (made === 0) throw new UserError(`The server refused to spawn ${item.name}: ${r.error}`);
      break;
    }
    made += 1;
  }
  return made;
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
    const made = await give(s, name, item, count, `${material ? ` ${material.value}` : ''}${ctx.opt('forged') ? ' forged' : ''}`);
    const label = item.unknown ? item.name : materials.named(item.name, material);
    ctx.note(`${made} x ${label} (${item.hash}) to ${name}`);
    return ctx.ok('Spawned', `${made} x **${label}** in front of ${name}.${material && item.unknown ? ` The bot has no record of this item, so it cannot say whether ${material.name} applied.` : ''}`);
  },
};
