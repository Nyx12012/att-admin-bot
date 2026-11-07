const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { addChoice, addBool } = require('../core/opts');
const Logs = require('../features/logs');

const CHANNELS = [
  { name: 'Event log (joins, deaths, bans, ...)', value: 'logs' },
  { name: 'Live online list', value: 'playerlist' },
  { name: 'Cleanup reports', value: 'cleanup' },
  { name: 'Tablet reports', value: 'reports' },
  { name: 'Audit (every admin command)', value: 'audit' },
];

const AUTO = [
  ['logs', 'event-log', false],
  ['playerlist', 'online-now', true],
  ['cleanup', 'cleanup-reports', false],
  ['reports', 'tablet-reports', false],
  ['audit', 'audit-log', false],
  ['log-shop', 'shop-log', false],
];

const LOGS = Object.entries(Logs.KINDS).map(([value, k]) => ({ name: k.label, value }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Pick the channels the bot posts in and what it logs')
    .addSubcommand((s) => addChoice(s.setName('channel').setDescription('Set a channel for one kind of post'), 'kind', 'What to post there', CHANNELS)
      .addChannelOption((o) => o.setName('channel').setDescription('The channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => addChoice(s.setName('clear').setDescription('Stop posting one kind of post'), 'kind', 'What to stop', CHANNELS))
    .addSubcommand((s) => addBool(addChoice(s.setName('log').setDescription('Turn one kind of event log on or off'), 'kind', 'Which events', LOGS), 'on', 'On or off'))
    .addSubcommand((s) => addChoice(s.setName('logchannel').setDescription('Send one kind of event log to its own channel'), 'kind', 'Which events', LOGS)
      .addChannelOption((o) => o.setName('channel').setDescription('The channel, empty means the event log channel').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('auto').setDescription('Make a category with all the bot channels and use them'))
    .addSubcommand((s) => s.setName('show').setDescription('Show the current setup')),
  access: 'admin',

  async run(ctx) {
    const gid = ctx.guildId;
    if (ctx.sub === 'auto') {
      const guild = ctx.i.guild;
      const hidden = [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: ctx.bot.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] }];
      const parent = await guild.channels.create({ name: 'ATT server', type: ChannelType.GuildCategory });
      const made = [];
      for (const [kind, name, open] of AUTO) {
        const ch = await guild.channels.create({ name, type: ChannelType.GuildText, parent: parent.id, permissionOverwrites: open ? [] : hidden });
        ctx.bot.setGuild(gid, 'channels', kind, ch.id);
        made.push(`<#${ch.id}>`);
      }
      if (ctx.server) ctx.bot.playerlist.schedule(ctx.server, 500);
      ctx.note(made.join(' '));
      return ctx.ok('Channels made', `${made.join('\n')}\n\nOnly the online list can be seen by everyone. Open the others to your staff role in Discord.`);
    }
    if (ctx.sub === 'channel') {
      const kind = ctx.opt('kind');
      const ch = ctx.channel('channel');
      ctx.bot.setGuild(gid, 'channels', kind, ch.id);
      ctx.note(`${kind} -> #${ch.name}`);
      if (kind === 'playerlist' && ctx.server) ctx.bot.playerlist.schedule(ctx.server, 500);
      return ctx.ok('Channel set', `${CHANNELS.find((c) => c.value === kind).name} now goes to <#${ch.id}>.`);
    }
    if (ctx.sub === 'clear') {
      const kind = ctx.opt('kind');
      ctx.bot.setGuild(gid, 'channels', kind, null);
      return ctx.ok('Channel cleared', `${CHANNELS.find((c) => c.value === kind).name} is no longer posted.`);
    }
    if (ctx.sub === 'log') {
      const kind = ctx.opt('kind');
      const on = ctx.opt('on');
      ctx.bot.setGuild(gid, 'logToggles', kind, on);
      if (ctx.server) ctx.bot.logs.sync(ctx.server);
      return ctx.ok('Event log updated', `${Logs.KINDS[kind].label}: **${on ? 'on' : 'off'}**.`);
    }
    if (ctx.sub === 'logchannel') {
      const kind = ctx.opt('kind');
      const ch = ctx.channel('channel');
      ctx.bot.setGuild(gid, 'channels', `log-${kind}`, ch ? ch.id : null);
      ctx.note(`${kind} -> ${ch ? `#${ch.name}` : 'event log'}`);
      return ctx.ok('Log channel set', ch ? `${Logs.KINDS[kind].label} now goes to <#${ch.id}>.` : `${Logs.KINDS[kind].label} goes to the event log channel again.`);
    }
    const channels = ctx.bot.guildSetting(gid, 'channels');
    const toggles = ctx.bot.guildSetting(gid, 'logToggles');
    const s = ctx.server;
    return ctx.info('Setup', s ? `Game server: **${s.name}** (${s.online ? 'connected' : 'not connected'})` : 'No game server is linked to this Discord server.', [
      ['Channels', CHANNELS.map((c) => `${c.name}: ${channels[c.value] ? `<#${channels[c.value]}>` : 'not set'}`).join('\n'), false],
      ['Event log', Object.entries(Logs.KINDS).map(([k, v]) => `${v.label}: ${(toggles[k] ?? v.on) ? 'on' : 'off'}${channels[`log-${k}`] ? ` in <#${channels[`log-${k}`]}>` : ''}`).join('\n'), false],
      ['Good to know', 'Tablet reports only reach the bot on servers running TavernEssentials. The game itself never sends them.', false],
    ]);
  },
};
