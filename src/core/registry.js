const fs = require('fs');
const path = require('path');
const { MessageFlags } = require('discord.js');
const { Context } = require('./context');
const { embed } = require('./ui');
const { describeOptions } = require('./audit');
const { UserError } = require('../game/text');
const auto = require('./autocomplete');

function loadCommands(dir = path.join(__dirname, '..', 'commands')) {
  const map = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    const mod = require(path.join(dir, file));
    const list = Array.isArray(mod) ? mod : [mod];
    for (const cmd of list) {
      const name = cmd.data.name;
      if (map.has(name)) throw new Error(`two commands are named /${name}`);
      map.set(name, cmd);
    }
  }
  return map;
}

function keyOf(ctx) {
  return [ctx.command.data.name, ctx.group, ctx.sub].filter(Boolean).join('.');
}

function levelOf(cmd, ctx) {
  const leaf = [ctx.group, ctx.sub].filter(Boolean).join('.');
  if (cmd.access && typeof cmd.access === 'object') return cmd.access[leaf] ?? cmd.access[ctx.sub] ?? cmd.access['*'] ?? 'admin';
  return cmd.access || 'admin';
}

function baseLevel(cmd) {
  if (cmd.access && typeof cmd.access === 'object') return cmd.access['*'] ?? 'admin';
  return cmd.access || 'admin';
}

function allowed(bot, interaction, cmd, ctx) {
  const level = levelOf(cmd, ctx);
  return bot.permissions.allows(interaction, keyOf(ctx), level, { baseCovers: level !== 'owner' || baseLevel(cmd) === 'owner' });
}

function isPublic(cmd, ctx) {
  if (Array.isArray(cmd.public)) return cmd.public.includes(ctx.sub) || cmd.public.includes([ctx.group, ctx.sub].filter(Boolean).join('.'));
  return Boolean(cmd.public);
}

class Registry {
  constructor(bot, commands) {
    this.bot = bot;
    this.commands = commands || loadCommands();
  }

  json() {
    return [...this.commands.values()].map((c) => c.data.toJSON());
  }

  async handle(interaction) {
    if (interaction.isAutocomplete()) return this.autocomplete(interaction);
    if (interaction.isChatInputCommand()) return this.chat(interaction);
    if (interaction.isButton() || interaction.isStringSelectMenu()) return this.component(interaction);
    return undefined;
  }

  async chat(interaction) {
    const cmd = this.commands.get(interaction.commandName);
    if (!cmd) return interaction.reply({ content: 'That command is not part of this bot any more.', flags: MessageFlags.Ephemeral });
    const ctx = new Context(this.bot, interaction, cmd);
    const key = keyOf(ctx);
    const audit = { guildId: interaction.guildId, userId: interaction.user.id, userTag: interaction.user.tag, command: key.replace(/\./g, ' '), args: describeOptions(interaction) };
    if (!interaction.guildId) return interaction.reply({ content: 'Use this bot inside your Discord server.' });
    if (!allowed(this.bot, interaction, cmd, ctx)) {
      if (cmd.quiet !== true) this.bot.audit.write({ ...audit, outcome: 'denied' });
      return interaction.reply({ embeds: [embed('warn', 'Not allowed', `You cannot use \`/${key.replace(/\./g, ' ')}\`. A server admin can grant it with /permissions.`)], flags: MessageFlags.Ephemeral });
    }
    try {
      if (cmd.defer !== false) await interaction.deferReply(isPublic(cmd, ctx) ? {} : { flags: MessageFlags.Ephemeral });
      if (ctx.server && ctx.server.online && Date.now() - (ctx.server.rosterAt || 0) > 15000) await ctx.server.refreshRoster().catch(() => {});
      await cmd.run(ctx);
      if (cmd.audit !== false && levelOf(cmd, ctx) !== 'everyone') this.bot.audit.write({ ...audit, outcome: ctx.cancelled ? 'cancelled' : 'ok', detail: ctx.notes.join('\n') });
    } catch (e) {
      const known = e instanceof UserError;
      if (!known) console.error(`[/${key}]`, e);
      this.bot.audit.write({ ...audit, outcome: known ? 'refused' : 'error', detail: e.message });
      const payload = { embeds: [embed('fail', known ? 'Could not do that' : 'Something went wrong', known ? e.message : `${e.message}\nThe full error is in the bot window.`)], components: [] };
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  async autocomplete(interaction) {
    const cmd = this.commands.get(interaction.commandName);
    const focused = interaction.options.getFocused(true);
    let choices = [];
    try {
      const ctx = new Context(this.bot, interaction, cmd);
      if (cmd && interaction.guildId && allowed(this.bot, interaction, cmd, ctx)) {
        if (cmd.autocomplete) choices = await cmd.autocomplete(ctx, focused);
        if (!choices || choices.length === 0) choices = await auto.generic(ctx, focused);
      }
    } catch (e) {
      choices = [];
    }
    return interaction.respond((choices || []).slice(0, 25).map((c) => (typeof c === 'string' ? { name: c.slice(0, 100), value: c.slice(0, 100) } : { name: String(c.name).slice(0, 100), value: String(c.value).slice(0, 100) }))).catch(() => {});
  }

  async component(interaction) {
    const [scope, name, ...rest] = interaction.customId.split(':');
    if (scope !== 'c') return undefined;
    const cmd = this.commands.get(name);
    if (!cmd || !cmd.component) return undefined;
    const ctx = new Context(this.bot, interaction, cmd);
    const key = [name, rest[0]].join('.');
    const level = (cmd.componentAccess && cmd.componentAccess[rest[0]]) || (typeof cmd.access === 'string' ? cmd.access : 'admin');
    if (!this.bot.permissions.allows(interaction, key, level) && !this.bot.permissions.allows(interaction, name, level)) {
      return interaction.reply({ content: 'You cannot use that button.', flags: MessageFlags.Ephemeral });
    }
    try {
      await cmd.component(ctx, rest[0], rest.slice(1));
      this.bot.audit.write({ guildId: interaction.guildId, userId: interaction.user.id, userTag: interaction.user.tag, command: `${name} button`, args: rest.join(' '), outcome: 'ok', detail: ctx.notes.join('\n') });
    } catch (e) {
      const known = e instanceof UserError;
      if (!known) console.error(`[button ${interaction.customId}]`, e);
      const payload = { content: known ? e.message : `Something went wrong: ${e.message}`, flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
    return undefined;
  }
}

module.exports = { Registry, loadCommands, keyOf };
