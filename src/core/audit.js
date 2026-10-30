const fs = require('fs');
const path = require('path');
const { embed, code } = require('./ui');

class Audit {
  constructor(dir, bot) {
    this.dir = path.join(dir, 'audit');
    this.bot = bot;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  write(entry) {
    const line = { ts: new Date().toISOString(), ...entry };
    const day = line.ts.slice(0, 10);
    fs.appendFile(path.join(this.dir, `${day}.jsonl`), `${JSON.stringify(line)}\n`, () => {});
    const channelId = entry.guildId && this.bot.guildSetting(entry.guildId, 'channels').audit;
    if (channelId && entry.outcome !== 'denied-quiet') {
      const color = entry.outcome === 'ok' || entry.outcome === 'cancelled' ? 'muted' : entry.outcome === 'denied' ? 'warn' : 'fail';
      const desc = [`${entry.userTag ? entry.userTag : entry.userId} ran ${code(`/${entry.command}${entry.args ? ` ${entry.args}` : ''}`)}`];
      if (entry.detail) desc.push(String(entry.detail).slice(0, 900));
      this.bot.post(channelId, { embeds: [embed(color, null, desc.join('\n')).setFooter({ text: entry.outcome })] });
    }
  }
}

function describeOptions(interaction) {
  const parts = [];
  const walk = (opts) => {
    for (const o of opts || []) {
      if (o.options) {
        parts.push(o.name);
        walk(o.options);
      } else {
        parts.push(`${o.name}:${String(o.value).slice(0, 80)}`);
      }
    }
  };
  walk(interaction.options && interaction.options.data);
  return parts.join(' ');
}

module.exports = { Audit, describeOptions };
