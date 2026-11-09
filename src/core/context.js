const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { embed } = require('./ui');
const { UserError, isSafeName } = require('../game/text');
const targets = require('./targets');

class Context {
  constructor(bot, interaction, command) {
    this.bot = bot;
    this.i = interaction;
    this.command = command;
    this.guildId = interaction.guildId;
    this.server = bot.serverFor(interaction.guildId);
    this.notes = [];
    const o = interaction.options;
    this.group = o && typeof o.getSubcommandGroup === 'function' ? o.getSubcommandGroup(false) : null;
    this.sub = o && typeof o.getSubcommand === 'function' ? o.getSubcommand(false) : null;
  }

  get user() {
    return this.i.user;
  }

  opt(name, fallback = null) {
    const o = this.i.options.get(name);
    return o == null || o.value == null ? fallback : o.value;
  }

  role(name) {
    const o = this.i.options.get(name);
    return o ? o.role : null;
  }

  channel(name) {
    const o = this.i.options.get(name);
    return o ? o.channel : null;
  }

  member(name) {
    const o = this.i.options.get(name);
    return o ? o.user : null;
  }

  needServer() {
    if (!this.server) throw new UserError('No game server is linked to this Discord server. Set DISCORD_GUILD_ID in .env, or add this server in servers.json.');
    return this.server;
  }

  needOnline() {
    const s = this.needServer();
    if (!s.online) throw new UserError(`${s.name} is not connected right now. ${s.lastError ? `Last error: ${s.lastError}` : 'Is the game server running?'}`);
    return s;
  }

  player(name = 'player', { required = true } = {}) {
    const s = this.needOnline();
    const value = this.opt(name);
    if (!value) {
      if (!required) return null;
      throw new UserError('Pick a player.');
    }
    const t = targets.resolve(this.bot, s, value);
    const p = t.via === 'name' ? s.find(t.username) : s.roster.get(t.username.toLowerCase());
    if (!p) {
      if (t.via === 'number') throw new UserError(`Number ${t.n} was ${t.username}, who is not online now. Use /l again.`);
      if (t.via === 'mention') throw new UserError(`<@${t.discordId}> is ${t.username}, who is not online.`);
      throw new UserError(`${t.username} is not online.`);
    }
    if (!isSafeName(p.username)) throw new UserError(`"${String(p.username).slice(0, 40)}" is not a valid player name, so the bot will not send it to the console.`);
    return p.username;
  }

  name(name = 'player', { required = true } = {}) {
    const value = this.opt(name);
    if (value == null || String(value).trim() === '') {
      if (!required) return null;
      throw new UserError('Pick a player.');
    }
    const t = targets.resolve(this.bot, this.needServer(), value);
    if (t.via === 'name') {
      const online = this.server.roster && this.server.roster.get(t.username.toLowerCase());
      if (online) return online.username;
    }
    return t.username;
  }

  self() {
    const link = this.bot.links.of(this.server, this.user.id);
    if (!link) throw new UserError('Your Discord account is not linked to a player yet. Use /link start first.');
    if (!isSafeName(link.username)) throw new UserError('Your linked name cannot be sent to the console.');
    return link.username;
  }

  data(name, fallback) {
    return this.bot.store.get(`server-${this.needServer().id}-${name}`, fallback);
  }

  save(name) {
    this.bot.store.save(`server-${this.needServer().id}-${name}`);
  }

  note(text) {
    this.notes.push(text);
  }

  async reply(payload) {
    if (typeof payload === 'string') payload = { content: payload, embeds: [], components: [] };
    if (this.i.deferred || this.i.replied) return this.i.editReply(payload);
    return this.i.reply(payload);
  }

  ok(title, description, fields) {
    return this.reply({ embeds: [embed('ok', title, description, fields)], components: [] });
  }

  info(title, description, fields) {
    return this.reply({ embeds: [embed('info', title, description, fields)], components: [] });
  }

  warn(title, description, fields) {
    return this.reply({ embeds: [embed('warn', title, description, fields)], components: [] });
  }

  fail(title, description, fields) {
    return this.reply({ embeds: [embed('fail', title, description, fields)], components: [] });
  }

  async confirm(title, description, { label = 'Confirm', danger = true, seconds = 30 } = {}) {
    const id = `confirm:${this.i.id}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${id}:yes`).setLabel(label).setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${id}:no`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    const msg = await this.reply({ embeds: [embed('warn', title, description)], components: [row] });
    try {
      const press = await msg.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: seconds * 1000,
        filter: (b) => b.user.id === this.user.id && b.customId.startsWith(id),
      });
      await press.deferUpdate().catch(() => {});
      if (press.customId.endsWith(':yes')) return true;
      this.cancelled = true;
      await this.reply({ embeds: [embed('muted', title, 'Cancelled, nothing was done.')], components: [] });
      return false;
    } catch {
      this.cancelled = true;
      await this.reply({ embeds: [embed('muted', title, 'No answer, nothing was done.')], components: [] });
      return false;
    }
  }
}

module.exports = { Context };
