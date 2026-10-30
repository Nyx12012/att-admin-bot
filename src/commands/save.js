const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('save')
    .setDescription('Save the world')
    .addSubcommand((s) => s.setName('now').setDescription('Save the world right away'))
    .addSubcommand((s) => s.setName('backup').setDescription('Make a backup of the save')),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needOnline();
    if (ctx.sub === 'backup') {
      await s.run('save backup true', { timeout: 120000 });
      return ctx.ok('Backup made', 'The server wrote a backup of its save.');
    }
    await s.run('save now', { timeout: 120000 });
    return ctx.ok('Saved', 'The world is saved.');
  },
};
