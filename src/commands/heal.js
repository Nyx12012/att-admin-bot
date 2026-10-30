const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addBool } = require('../core/opts');

const RESET = { health: 'Max', poison: 'Min', nightmare: 'Min', cripplehealth: 'Max', hunger: 'Max' };

module.exports = {
  data: addBool(addPlayer(new SlashCommandBuilder().setName('heal').setDescription('Fill health and clear poison and nightmare (does not revive a downed player)')), 'food', 'Also fill hunger', { required: false }),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needOnline();
    const name = ctx.player();
    const stats = await s.stats(name);
    const done = [];
    for (const st of stats) {
      const key = String(st.Name).toLowerCase();
      if (!RESET[key] || (key === 'hunger' && !ctx.opt('food'))) continue;
      const value = RESET[key] === 'Max' ? st.Max : st.Min;
      if (Number(st.Value) === Number(value)) continue;
      await s.setStat(name, st.Name, value);
      done.push(`${st.Name} ${Number(st.Value).toFixed(2)} to ${value}`);
    }
    ctx.note(`${name}: ${done.join(', ') || 'already fine'}`);
    return ctx.ok(`${name} healed`, done.length ? done.join('\n') : 'They were already at full health.');
  },
};
