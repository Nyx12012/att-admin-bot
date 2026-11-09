const { SlashCommandBuilder } = require('discord.js');
const { addName } = require('../core/opts');
const { UserError, isSafeName, own } = require('../game/text');

function who(s) {
  return addName(s, 'name', 'In-game name', { max: 32 });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autobuff')
    .setDescription('Give a player a saved buff every time they join')
    .addSubcommand((s) => addName(who(s.setName('set').setDescription('Pick the buff for a player')), 'buff', 'A buff from /buff', { auto: true }))
    .addSubcommand((s) => who(s.setName('clear').setDescription('Stop giving it')))
    .addSubcommand((s) => s.setName('list').setDescription('Who gets what')),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needServer();
    const auto = ctx.bot.autobuff;
    const doc = auto.doc(s);
    if (ctx.sub === 'list') {
      return ctx.info('Autobuff', Object.entries(doc).map(([n, b]) => `**${n}**: ${b}`).join('\n') || 'Nobody yet.');
    }
    const name = ctx.name('name');
    if (!isSafeName(name)) throw new UserError('That is not a valid in-game name.');
    if (ctx.sub === 'clear') {
      delete doc[name.toLowerCase()];
      auto.save(s);
      return ctx.ok('Autobuff', `${name} gets nothing on join now.`);
    }
    const key = String(ctx.opt('buff')).toLowerCase();
    if (!own(ctx.data('buffs', {}), key)) throw new UserError(`No buff called "${key}". See /buff list.`);
    doc[name.toLowerCase()] = key;
    auto.save(s);
    ctx.note(`${name}: ${key}`);
    return ctx.ok('Autobuff', `${name} gets **${key}** 30 seconds after every join.`);
  },
};
