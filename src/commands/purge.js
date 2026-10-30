const { SlashCommandBuilder } = require('discord.js');
const { addInt } = require('../core/opts');
const { UserError } = require('../game/text');

module.exports = {
  data: addInt(new SlashCommandBuilder().setName('purge').setDescription('Delete recent messages in this channel'), 'count', 'How many (up to 100)', { min: 1, max: 100 }),
  access: 'admin',

  async run(ctx) {
    const ch = ctx.i.channel;
    if (!ch || typeof ch.bulkDelete !== 'function') throw new UserError('This channel does not allow bulk delete.');
    const gone = await ch.bulkDelete(ctx.opt('count'), true);
    ctx.note(`${gone.size} in #${ch.name}`);
    return ctx.ok('Deleted', `${gone.size} message(s) removed. Messages older than 14 days are skipped by Discord.`);
  },
};
