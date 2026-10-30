const { SlashCommandBuilder } = require('discord.js');
const { UserError } = require('../game/text');

const FIXES = {
  chests: { command: 'wacky ow-loot', title: 'Overworld chests refilled', text: 'Every overworld loot chest got new loot.' },
  smelter: { command: 'wacky smelter', title: 'Smelter fixed', text: 'The town smelter was reset to working order.' },
  chiseldeck: { command: 'wacky chisel-deck', title: 'Chisel deck fixed', text: 'The chisel deck was reset to working order.' },
  communityboxes: { command: 'progress fillcommunityboxes', title: 'Community boxes filled', text: 'The community crafting boxes were filled.' },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('world')
    .setDescription('Fix and reset parts of the world (owner only by default)')
    .addSubcommand((s) => s.setName('chests').setDescription('Refill every overworld loot chest'))
    .addSubcommand((s) => s.setName('smelter').setDescription('Fix a stuck town smelter'))
    .addSubcommand((s) => s.setName('chiseldeck').setDescription('Fix a stuck chisel deck'))
    .addSubcommand((s) => s.setName('communityboxes').setDescription('Fill the community crafting boxes'))
    .addSubcommand((s) => s.setName('caves').setDescription('Regenerate the caves (anything left in them is lost)'))
    .addSubcommand((s) => s.setName('forests').setDescription('List the forests'))
    .addSubcommand((s) => s.addStringOption((o) => o.setName('forest').setDescription('Forest from /world forests').setRequired(true).setMaxLength(60))
      .setName('forest').setDescription('Regrow one forest')),
  access: 'owner',

  async run(ctx) {
    const s = ctx.needOnline();
    const fix = FIXES[ctx.sub];
    if (fix) {
      await s.run(fix.command, { timeout: 120000 });
      return ctx.ok(fix.title, fix.text);
    }
    if (ctx.sub === 'forests') {
      const r = await s.value('world forest list');
      const list = Array.isArray(r) ? r.map((f) => (typeof f === 'string' ? f : f.Name || JSON.stringify(f))) : String(r || '').split('\n');
      return ctx.info('Forests', list.filter(Boolean).join('\n') || 'None found.');
    }
    if (ctx.sub === 'forest') {
      const name = String(ctx.opt('forest')).trim();
      if (!/^[A-Za-z0-9 _().-]{1,60}$/.test(name)) throw new UserError('That forest name has characters the console cannot take.');
      if (!(await ctx.confirm('Regrow this forest?', `Every tree in **${name}** grows back. Cut logs on the ground are not touched.`, { label: 'Regrow' }))) return null;
      await s.run(`world forest reset "${name}"`, { timeout: 120000 });
      ctx.note(name);
      return ctx.ok('Forest reset', `${name} is growing back.`);
    }
    if (!(await ctx.confirm('Regenerate the caves?', 'The caves are rebuilt from scratch. Anything players left in the caves is gone. Players in the caves should leave first.', { label: 'Regenerate' }))) return null;
    await s.run('world caves reset', { timeout: 300000 });
    return ctx.ok('Caves regenerated', 'The caves were rebuilt.');
  },
};
