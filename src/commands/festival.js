const { SlashCommandBuilder } = require('discord.js');
const { UserError } = require('../game/text');

async function festivals(server, timeout = 30000) {
  const list = await server.value('festivities list', { timeout });
  return (Array.isArray(list) ? list : []).filter((f) => !/test/i.test(f.Name));
}

function pick(s) {
  return s.addStringOption((o) => o.setName('festival').setDescription('Which one').setRequired(true).setAutocomplete(true));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('festival')
    .setDescription('Holiday events like Halloween or Christmas')
    .addSubcommand((s) => s.setName('list').setDescription('Every festival'))
    .addSubcommand((s) => pick(s.setName('start').setDescription('Start one now')))
    .addSubcommand((s) => pick(s.setName('stop').setDescription('Stop one'))),
  access: 'admin',

  async autocomplete(ctx, focused) {
    if (!ctx.server || !ctx.server.online) return [];
    const q = String(focused.value).toLowerCase();
    return (await festivals(ctx.server, 2500)).filter((f) => f.Name.toLowerCase().includes(q)).map((f) => ({ name: f.Name, value: String(f.Hash) }));
  },

  async run(ctx) {
    const s = ctx.needOnline();
    const list = await festivals(s);
    if (ctx.sub === 'list') return ctx.info('Festivals', list.map((f) => f.Name).join('\n') || 'None.');
    const f = list.find((x) => String(x.Hash) === String(ctx.opt('festival')) || x.Name.toLowerCase().startsWith(String(ctx.opt('festival')).toLowerCase()));
    if (!f) throw new UserError(`No festival matches "${ctx.opt('festival')}".`);
    await s.run(`festivities ${ctx.sub} ${f.Hash}`);
    ctx.note(f.Name);
    return ctx.ok(ctx.sub === 'start' ? 'Festival started' : 'Festival stopped', f.Name);
  },
};
