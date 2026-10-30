const { SlashCommandBuilder } = require('discord.js');
const { addPlayer } = require('../core/opts');
const { vec, vecText } = require('../game/text');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('home')
    .setDescription("A player's respawn point")
    .addSubcommand((s) => addPlayer(s.setName('show').setDescription('Where it is')))
    .addSubcommand((s) => addPlayer(s.setName('here').setDescription('Set it to where the player stands')))
    .addSubcommand((s) => addPlayer(s.setName('reset').setDescription('Back to the default respawn'))),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needOnline();
    const name = ctx.player();
    if (ctx.sub === 'show') {
      const home = vec(await s.value(`player get-home "${name}"`));
      const unset = !home || home.every((n) => n === 0);
      return ctx.info(`${name}: home`, unset ? 'No home set, they respawn at the default spot.' : home.map((n) => n.toFixed(1)).join(', '));
    }
    if (ctx.sub === 'reset') {
      await s.run(`player set-home "${name}" 0,0,0`);
      ctx.note(name);
      return ctx.ok('Home reset', `${name} respawns at the default spot again.`);
    }
    const { pos } = await s.position(name);
    if (!pos) return ctx.warn('No position', `Could not read where ${name} is.`);
    await s.run(`player set-home "${name}" ${vecText(pos)}`);
    ctx.note(`${name} ${vecText(pos)}`);
    return ctx.ok('Home set', `${name} now respawns at ${pos.map((n) => n.toFixed(1)).join(', ')}.`);
  },
};
