const { SlashCommandBuilder } = require('discord.js');
const { addText } = require('../core/opts');
const { code } = require('../core/ui');

function show(value) {
  if (value == null) return 'No output.';
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > 3800 ? `${text.slice(0, 3800)}\n...` : text;
}

module.exports = {
  data: addText(new SlashCommandBuilder().setName('cmd').setDescription('Send a raw command to the game console (owner only)'), 'command', 'The console command', { max: 500 }),
  access: 'owner',

  async run(ctx) {
    const s = ctx.needOnline();
    const command = String(ctx.opt('command')).replace(/[\r\n]+/g, ' ').trim();
    ctx.note(command);
    const r = await s.run(command, { allowError: true, timeout: 60000 });
    if (r.error) return ctx.fail('Console error', `${code(command)}\n\`\`\`\n${show(r.error)}\n\`\`\``);
    const body = r.result != null ? r.result : r.resultString;
    return ctx.info('Console', `${code(command)}\n\`\`\`json\n${show(body)}\n\`\`\``);
  },
};
