const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addName } = require('../core/opts');
const { UserError } = require('../game/text');

const SAVE_STRING = /^[0-9,|]{5,6000}$/;

function data(s) {
  return s.addStringOption((o) => o.setName('data').setDescription('The save string').setRequired(true).setMaxLength(6000));
}

function read(ctx) {
  const text = String(ctx.opt('data')).trim();
  if (!SAVE_STRING.test(text)) throw new UserError('A save string only has digits, commas and pipes.');
  return text;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('string')
    .setDescription('Make an item from a save string')
    .addSubcommand((s) => data(addPlayer(s.setName('spawn').setDescription('Spawn it in front of an online player'))))
    .addSubcommand((s) => data(addName(s.setName('mail').setDescription("Send it to a player's mailbox (needs BotCore)"), 'name', 'In-game name, online or not'))),
  access: 'owner',

  async run(ctx) {
    const s = ctx.needOnline();
    const text = read(ctx);
    if (ctx.sub === 'spawn') {
      const name = ctx.player();
      await s.run(`spawn string "${name}" ${text}`);
      ctx.note(`${name}: ${text.length} characters`);
      return ctx.ok('Spawned', `The item appeared in front of ${name}.`);
    }
    const user = await s.lookup(ctx.name('name'));
    await s.run(`trade post-string "${user.username}" ${text}`);
    ctx.note(`${user.username}: ${text.length} characters`);
    return ctx.ok('Mailed', `The item is waiting in ${user.username}'s mailbox.`);
  },
};
