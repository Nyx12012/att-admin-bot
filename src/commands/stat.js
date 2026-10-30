const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addName, addNumber, addInt, addBool } = require('../core/opts');

function stat(s) {
  return addName(s, 'stat', 'Stat name, like speed or damage', { auto: true, max: 40 });
}

function fmt(n) {
  return Number(n).toFixed(2).replace(/\.?0+$/, '');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stat')
    .setDescription("Change a player's stats")
    .addSubcommand((s) => addNumber(stat(addPlayer(s.setName('set').setDescription('Set the base value of a stat (kept inside its min and max)'))), 'value', 'New base value'))
    .addSubcommand((s) => addBool(addInt(addNumber(stat(addPlayer(s.setName('boost').setDescription('Add to a stat for a while'))), 'amount', 'How much to add (negative takes away)'), 'seconds', 'How long', { min: 1, max: 86400 }), 'multiply', 'Multiply instead of add', { required: false }))
    .addSubcommand((s) => stat(addPlayer(s.setName('check').setDescription('Read one stat')))),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needOnline();
    const name = ctx.player();
    const st = await s.stat(name, ctx.opt('stat'));
    if (ctx.sub === 'check') {
      return ctx.info(`${name}: ${st.name}`, `Now ${fmt(st.value)}, base ${fmt(st.base)} (min ${fmt(st.min)}, max ${fmt(st.max)}). Items, food and effects change the value on top of the base.`);
    }
    if (ctx.sub === 'set') {
      const value = Math.max(st.min, Math.min(st.max, ctx.opt('value')));
      await s.setStat(name, st.name, value);
      ctx.note(`${name} ${st.name} base ${st.base} to ${value}`);
      return ctx.ok('Stat set', `${name}: ${st.name} base ${fmt(st.base)} to ${fmt(value)}${value !== ctx.opt('value') ? ' (kept inside its limits)' : ''}.`);
    }
    const amount = ctx.opt('amount');
    const seconds = ctx.opt('seconds');
    const mult = Boolean(ctx.opt('multiply'));
    await s.run(`player modify-stat "${name}" ${st.name} ${Number(amount)} ${Number(seconds)} ${mult ? 'true' : 'false'}`);
    ctx.note(`${name} ${st.name} ${mult ? 'x' : '+'}${amount} for ${seconds}s`);
    return ctx.ok('Stat boosted', `${name}: ${st.name} ${mult ? 'times' : 'plus'} ${amount} for ${seconds} s.`);
  },
};
