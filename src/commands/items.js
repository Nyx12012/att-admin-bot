const { SlashCommandBuilder } = require('discord.js');
const { addName } = require('../core/opts');
const items = require('../core/items');
const { list } = require('../core/ui');

module.exports = {
  data: addName(new SlashCommandBuilder().setName('items').setDescription('Look up item codes'), 'search', 'Part of a name, or a code', { max: 60 }),
  access: 'admin',

  async run(ctx) {
    const rows = items.search(ctx.opt('search'), { limit: 40 });
    return ctx.info(`Items: ${ctx.opt('search')}`, list(rows.map((i) => `\`${i.hash}\` ${i.name}${i.pickup ? '' : ' (cannot be picked up)'}`), 'Nothing matches.'));
  },
};
