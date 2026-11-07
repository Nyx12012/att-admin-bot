const { embed } = require('../core/ui');

const KINDS = {
  joins: { label: 'Joins and leaves', on: true },
  deaths: { label: 'Deaths', on: true },
  downed: { label: 'Downed and revived', on: true },
  settings: { label: 'Server setting changes', on: true },
  server: { label: 'Console connected and lost', on: true },
  bans: { label: 'Bans and ban kicks', on: true },
  plots: { label: 'Plot intruders and the plot tree', on: true },
  cleanup: { label: 'Cleanup runs', on: true },
  shop: { label: 'Shop, sell and withdraw', on: true },
  alchemy: { label: 'Alchemy uses', on: true },
  trials: { label: 'Trials started and finished', on: true },
  tradedeck: { label: 'Trade deck sales', on: true },
  atm: { label: 'ATM balance changes', on: false },
  objects: { label: 'Creatures and objects killed', on: false },
  population: { label: 'Creature population changes', on: false },
  chunks: { label: 'Players crossing chunks', on: false },
  inventory: { label: 'Items picked up, dropped and docked', on: false },
  commands: { label: 'Console commands run', on: false },
  mail: { label: 'Every item sent with trade post', on: false },
};

const DAMAGE = ['fall', 'impact', 'console', 'area damage', 'poison', 'hunger', 'unknown', 'fire'];
const CHANGE = ['picked up', 'dropped', 'docked', 'undocked'];
const CHANGE_NAME = { pickup: 'picked up', drop: 'dropped', dock: 'docked', undock: 'undocked' };
const QUIET = /^(select (get|find)|player (detailed|list|list-detailed|inventory|check-stat|list-stats|get-home)|websocket|botcore (version|user)|settings list|trade atm get)\b/i;

function who(x) {
  if (!x) return null;
  if (typeof x === 'string') return x;
  return x.username || x.Username || x.name || x.Name || null;
}

function damage(source) {
  if (typeof source === 'number') return DAMAGE[source] || null;
  if (typeof source !== 'string' || !source) return null;
  return source === 'Command' ? 'console' : source;
}

function short(d) {
  return (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300);
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

  channel(server, kind) {
    return this.bot.channelFor(server, `log-${kind}`) || this.bot.channelFor(server, 'logs');
  }

  line(server, kind, text) {
    if (!this.enabled(server, kind)) return;
    const channel = this.channel(server, kind);
    if (!channel) return;
    const time = `<t:${Math.floor(Date.now() / 1000)}:T>`;
    const key = `${server.id}:${channel}`;
    let buf = this.buffers.get(key);
    if (!buf) {
      buf = { lines: [], timer: null, server, channel };
      this.buffers.set(key, buf);
    }
    buf.lines.push(`${time} ${text}`);
    if (!buf.timer) buf.timer = setTimeout(() => this.flush(key), 4000);
  }

  async flush(key) {
    const buf = this.buffers.get(key);
    if (!buf) return;
    buf.timer = null;
    const lines = buf.lines.splice(0);
    while (lines.length) {
      const chunk = [];
      let size = 0;
      while (lines.length && size + lines[0].length < 3800) {
        size += lines[0].length + 1;
        chunk.push(lines.shift());
      }
      if (chunk.length === 0) chunk.push(lines.shift().slice(0, 3800));
      await this.bot.post(buf.channel, { embeds: [embed('muted', null, chunk.join('\n')).setFooter({ text: buf.server.name })] });
    }
  }

  sync(server) {
    server.want('InventoryChanged', 'logs', this.enabled(server, 'inventory'));
    server.want('CommandExecuted', 'logs', this.enabled(server, 'commands') || this.enabled(server, 'mail'));
  }

  start() {
    for (const server of this.bot.servers.values()) {
      this.sync(server);
      server.on('PlayerJoined', (d) => this.line(server, 'joins', `**${who(d.user) || 'Someone'}** joined.`));
      server.on('PlayerLeft', (d) => this.line(server, 'joins', `**${who(d.user) || 'Someone'}** left.`));
      server.on('PlayerKilled', (d) => {
        const victim = who(d.killedPlayer) || who(d.player) || who(d.user) || 'Someone';
        const killer = who(d.killerPlayer);
        const source = damage(d.source);
        const tool = typeof d.usedTool === 'string' && d.usedTool ? d.usedTool : null;
        this.died.set(`${server.id}:${victim.toLowerCase()}`, Date.now());
        let text = killer && killer !== victim ? `**${killer}** killed **${victim}**` : `**${victim}** died`;
        const how = [source, tool].filter(Boolean).join(', ');
        if (how) text += ` (${how})`;
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
      server.on('ServerSettingsChanged', (d) => this.line(server, 'settings', `Server settings changed: ${short(d)}`));
      server.on('AtmBalanceChanged', (d) => this.line(server, 'atm', `**${who(d.User) || who(d.user) || 'Someone'}**: ATM ${d.Change >= 0 ? '+' : ''}${d.Change}, now ${d.CurrentBalance}.`));
      server.on('TradeDeckUsed', (d) => this.line(server, 'tradedeck', `**${who(d.buyer) || 'Someone'}** bought ${d.quantity ?? 1} x ${d.itemName || 'an item'} for ${d.price ?? '?'} coins${who(d.seller) ? ` from **${who(d.seller)}**` : ''}.`));
      server.on('ObjectKilled', (d) => {
        const killer = who(d.killerPlayer);
        if (!killer || !d.name || /combat_dummy/i.test(d.name)) return;
        this.line(server, 'objects', `**${killer}** killed ${d.name}.`);
      });
      server.on('PopulationModified', (d) => this.line(server, 'population', `Population changed: ${short(d)}`));
      server.on('TrialStarted', (d) => this.line(server, 'trials', `Trial started: ${short(d)}`));
      server.on('TrialFinished', (d) => this.line(server, 'trials', `Trial finished: ${short(d)}`));
      server.on('PlayerMovedChunk', (d) => this.line(server, 'chunks', `**${who(d.player) || 'Someone'}** went from ${d.oldChunk} to ${d.newChunk}.`));
      server.on('InventoryChanged', (d) => {
        const change = typeof d.ChangeType === 'number' ? CHANGE[d.ChangeType] : CHANGE_NAME[String(d.ChangeType).toLowerCase()] || 'moved';
        this.line(server, 'inventory', `**${who(d.User) || who(d.user) || 'Someone'}** ${change} ${d.Quantity > 1 ? `${d.Quantity} x ` : ''}${d.ItemName || 'an item'}.`);
      });
      server.on('CommandExecuted', (d) => {
        const text = String(d.Command || '');
        const post = text.match(/^trade post "?([^"]+?)"? (\d+)(.*)$/);
        if (post) this.line(server, 'mail', `**${post[1]}** was sent item ${post[2]}${post[3]}${d.WasSuccessful === false ? ' (failed)' : ''}.`);
        if (!text || QUIET.test(text)) return;
        this.line(server, 'commands', `\`${text.replace(/`/g, "'").slice(0, 200)}\`${d.WasSuccessful === false ? ' failed' : ''}`);
      });
      server.on('ready', () => {
        this.sync(server);
        const online = server.players().map((p) => p.username);
        this.line(server, 'server', `Console connected to **${server.name}**.${online.length ? ` Online now: ${online.join(', ')}.` : ''}`);
      });
      server.on('down', (why) => this.line(server, 'server', `Lost the console of **${server.name}** (${why}). Reconnecting.`));
    }
  }

  stop() {
    for (const buf of this.buffers.values()) clearTimeout(buf.timer);
  }
}

Logs.KINDS = KINDS;
module.exports = Logs;
