const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addItem, addInt } = require('../core/opts');
const items = require('../core/items');
const { UserError } = require('../game/text');

async function give(server, name, item, count) {
  let made = 0;
  for (let i = 0; i < count; i += 1) {
    const r = await server.run(`spawn "${name}" ${item.hash}`, { allowError: true });
    if (r.error) {
      if (made === 0) throw new UserError(`The server refused to spawn ${item.name}: ${r.error}`);
      break;
    }
    made += 1;
  }
  return made;
}

module.exports = {
  data: addInt(addItem(addPlayer(new SlashCommandBuilder().setName('spawn').setDescription('Spawn items in front of a player (owner only by default)'))), 'amount', 'How many (default 1)', { required: false, min: 1, max: 50 }),
  access: 'owner',
  give,

  async run(ctx) {
    const s = ctx.needOnline();
    const name = ctx.player();
    const item = items.resolve(ctx.opt('item'));
    if (!item) throw new UserError(`No item matches "${ctx.opt('item')}". Pick one from the list.`);
    const count = ctx.opt('amount') || 1;
    const made = await give(s, name, item, count);
    ctx.note(`${made} x ${item.name} (${item.hash}) to ${name}`);
    return ctx.ok('Spawned', `${made} x **${item.name}** in front of ${name}.`);
  },
};
