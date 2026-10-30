const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addText } = require('../core/opts');
const { cleanText } = require('../game/text');

module.exports = {
  data: addText(addPlayer(new SlashCommandBuilder().setName('kick').setDescription('Kick a player from the server')), 'reason', 'Shown to the player', { required: false, max: 150 }),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needOnline();
    const name = ctx.player();
    const reason = cleanText(ctx.opt('reason') || 'Kicked by an admin', 150) || 'Kicked by an admin';
    await s.run(`player kick "${name}" "${reason}"`);
    ctx.note(`${name}: ${reason}`);
    return ctx.ok('Kicked', `**${name}** was kicked. Reason: ${reason}`);
  },
};
