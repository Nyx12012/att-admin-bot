const { embed, ago } = require('../core/ui');

class PlayerList {
  constructor(bot) {
    this.bot = bot;
    this.timers = new Map();
    this.busy = new Set();
    this.interval = null;
  }

  view(server) {
    const players = server.players();
    if (!server.online) {
      return embed('muted', `${server.name}: offline`, `The bot cannot reach the game console right now.${server.lastError ? `\n${server.lastError}` : ''}`).setTimestamp();
    }
    const lines = players.map((p) => `**${p.username}**  ${ago(p.since)}`);
    return embed('info', `${server.name}: ${players.length} online`, lines.length ? lines.join('\n') : 'Nobody is online.')
      .setFooter({ text: 'Updates on its own' })
      .setTimestamp();
  }

  schedule(server, delay = 5000) {
    if (this.timers.has(server.id)) return;
    this.timers.set(server.id, setTimeout(() => {
      this.timers.delete(server.id);
      this.update(server).catch((e) => console.warn(`[playerlist] ${e.message}`));
    }, delay));
  }

  async update(server) {
    if (!server.guildId || this.busy.has(server.id)) return;
    const channelId = this.bot.channelFor(server, 'playerlist');
    if (!channelId || !this.bot.client.isReady()) return;
    this.busy.add(server.id);
    try {
      const state = this.bot.guildSetting(server.guildId, 'playerlistMessage');
      const payload = { embeds: [this.view(server)] };
      let msg = null;
      if (state.messageId && state.channelId === channelId) {
        try {
          const ch = await this.bot.client.channels.fetch(channelId);
          msg = await ch.messages.fetch(state.messageId);
          await msg.edit(payload);
          return;
        } catch {
          msg = null;
        }
      }
      msg = await this.bot.post(channelId, payload);
      if (msg) {
        this.bot.setGuild(server.guildId, 'playerlistMessage', 'channelId', channelId);
        this.bot.setGuild(server.guildId, 'playerlistMessage', 'messageId', msg.id);
      }
    } finally {
      this.busy.delete(server.id);
    }
  }

  start() {
    for (const server of this.bot.servers.values()) {
      for (const e of ['rosterJoin', 'rosterLeave', 'PlayerJoined', 'PlayerLeft', 'ready', 'down']) server.on(e, () => this.schedule(server));
    }
    this.interval = setInterval(() => {
      for (const server of this.bot.servers.values()) this.schedule(server, 0);
    }, 120000);
    this.interval.unref?.();
  }

  discordReady() {
    for (const server of this.bot.servers.values()) this.schedule(server, 2000);
  }

  stop() {
    clearInterval(this.interval);
    for (const t of this.timers.values()) clearTimeout(t);
  }
}

module.exports = PlayerList;
