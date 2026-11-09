const { SlashCommandBuilder } = require('discord.js');
const { addInt } = require('../core/opts');
const { UserError } = require('../game/text');

const busy = new Set();

function who(s) {
  return s.addStringOption((o) => o.setName('player').setDescription('In-game name, online or not').setRequired(true).setAutocomplete(true).setMaxLength(32));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('atm')
    .setDescription("A player's ATM coins (needs the BotCore server mod)")
    .addSubcommand((s) => who(s.setName('balance').setDescription('How many coins they have')))
    .addSubcommand((s) => addInt(who(s.setName('add').setDescription('Give coins (negative takes away)')), 'amount', 'Coins', { min: -1000000, max: 1000000 }))
    .addSubcommand((s) => addInt(who(s.setName('set').setDescription('Set the balance')), 'amount', 'Coins', { min: 0, max: 10000000 })),
  access: { balance: 'admin', '*': 'owner' },

  async run(ctx) {
    const s = ctx.needOnline();
    const user = await s.lookup(ctx.name('player'));
    const q = `"${user.username}"`;
    if (ctx.sub === 'balance') {
      const v = await s.value(`trade atm get ${q}`);
      return ctx.info(`${user.username}: ATM`, `${Number(v)} coins.`);
    }
    const key = `${s.id}:${user.id}`;
    if (busy.has(key)) throw new UserError(`Another ATM change for ${user.username} is still running.`);
    busy.add(key);
    try {
      const before = Number(await s.value(`trade atm get ${q}`));
      const amount = ctx.opt('amount');
      if (ctx.sub === 'add' && before + amount < 0) throw new UserError(`${user.username} only has ${before} coins.`);
      const after = ctx.sub === 'add' ? Number(await s.value(`trade atm add ${q} ${amount}`)) : (await s.run(`trade atm set ${q} ${amount}`), Number(await s.value(`trade atm get ${q}`)));
      ctx.note(`${user.username} ${before} to ${after}`);
      return ctx.ok(`${user.username}: ATM`, `${before} to **${after}** coins.`);
    } finally {
      busy.delete(key);
    }
  },
};
