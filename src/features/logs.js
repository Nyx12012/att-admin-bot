const { embed } = require('../core/ui');

const KINDS = {
  joins: { label: 'Joins and leaves', on: true },
  deaths: { label: 'Deaths', on: true },
  downed: { label: 'Downed and revived', on: false },
  settings: { label: 'Server setting changes', on: true },
  server: { label: 'Console connected and lost', on: true },
  bans: { label: 'Bans and ban kicks', on: true },
  plots: { label: 'Plot intruders', on: true },
  cleanup: { label: 'Cleanup runs', on: true },
};

function who(x) {
  if (!x) return null;
  if (typeof x === 'string') return x;
  return x.username || x.Username || x.name || x.Name || null;
}

class Logs {
  constructor(bot) {
    this.bot = bot;
    this.buffers = new Map();
    this.died = new Map();
  }

  enabled(server, kind) {
    if (!server.guildId) return false;
    const t = this.bot.guildSetting(server.guildId, 'logToggles');
    return t[kind] ?? KINDS[kind].on;
  }

  line(server, kind, text) {
    if (!this.enabled(server, kind)) return;
    const channel = this.bot.channelFor(server, 'logs');
    if (!channel) return;
    const time = `<t:${Math.floor(Date.now() / 1000)}:T>`;
    let buf = this.buffers.get(server.id);
    if (!buf) {
      buf = { lines: [], timer: null };
      this.buffers.set(server.id, buf);
    }
    buf.lines.push(`${time} ${text}`);
    if (!buf.timer) buf.timer = setTimeout(() => this.flush(server), 4000);
  }

  async flush(server) {
    const buf = this.buffers.get(server.id);
    if (!buf) return;
    buf.timer = null;
    const lines = buf.lines.splice(0);
    const channel = this.bot.channelFor(server, 'logs');
    while (lines.length) {
      const chunk = [];
      let size = 0;
      while (lines.length && size + lines[0].length < 3800) {
        size += lines[0].length + 1;
        chunk.push(lines.shift());
      }
      if (chunk.length === 0) chunk.push(lines.shift().slice(0, 3800));
      await this.bot.post(channel, { embeds: [embed('muted', null, chunk.join('\n')).setFooter({ text: server.name })] });
    }
  }

  start() {
    for (const server of this.bot.servers.values()) {
      server.on('PlayerJoined', (d) => this.line(server, 'joins', `**${who(d.user) || 'Someone'}** joined.`));
      server.on('PlayerLeft', (d) => this.line(server, 'joins', `**${who(d.user) || 'Someone'}** left.`));
      server.on('PlayerKilled', (d) => {
        const victim = who(d.killedPlayer) || who(d.player) || who(d.user) || 'Someone';
        const killer = who(d.killerPlayer);
        const source = d.source || d.usedTool || null;
        this.died.set(`${server.id}:${victim.toLowerCase()}`, Date.now());
        let text = killer && killer !== victim ? `**${killer}** killed **${victim}**` : `**${victim}** died`;
        if (source && typeof source === 'string') text += ` (${source === 'Command' ? 'console' : source})`;
        this.line(server, 'deaths', `${text}.`);
      });
      server.on('PlayerStateChanged', (d) => {
        const name = who(d.user) || 'Someone';
        if (d.state !== 'Downed') return;
        if (d.isEnter) {
          this.line(server, 'downed', `**${name}** is downed.`);
          return;
        }
        const key = `${server.id}:${name.toLowerCase()}`;
        const t = setTimeout(() => {
          if (Date.now() - (this.died.get(key) || 0) > 3000) this.line(server, 'downed', `**${name}** is back up.`);
        }, 2000);
        t.unref?.();
      });
      server.on('ServerSettingsChanged', (d) => {
        const text = typeof d === 'string' ? d : JSON.stringify(d).slice(0, 300);
        this.line(server, 'settings', `Server settings changed: ${text}`);
      });
      server.on('ready', () => this.line(server, 'server', `Console connected to **${server.name}**.`));
      server.on('down', (why) => this.line(server, 'server', `Lost the console of **${server.name}** (${why}). Reconnecting.`));
    }
  }

  stop() {
    for (const buf of this.buffers.values()) clearTimeout(buf.timer);
  }
}

Logs.KINDS = KINDS;
module.exports = Logs;
