const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { addChoice } = require('../core/opts');
const { embed } = require('../core/ui');

const PANELS = {
  world: {
    title: 'World',
    text: 'Applies to the whole server.',
    buttons: [['day', 'Day'], ['night', 'Night'], ['save', 'Save now']],
  },
  me: {
    title: 'Me',
    text: 'Acts on the in-game player you linked with /link.',
    buttons: [['heal', 'Heal'], ['godon', 'God on'], ['godoff', 'God off'], ['clarity', 'Clarity']],
  },
  teleport: {
    title: 'Teleport me',
    text: 'Sends the in-game player you linked with /link.',
    buttons: [['RespawnPoint', 'Respawn'], ['Home', 'Home'], ['OutsideTower', 'Tower'], ['OutsideCave', 'Cave'], ['OutsideForest', 'Forest']],
  },
};

const AREAS = new Set(PANELS.teleport.buttons.map((b) => b[0]));

const ACTIONS = {
  day: (s) => s.run('time set day'),
  night: (s) => s.run('time set night'),
  save: (s) => s.run('save now', { timeout: 120000 }),
};

const SELF = {
  heal: (s, name) => s.heal(name, true),
  godon: (s, name) => s.run(`player god-mode "${name}" true`),
  godoff: (s, name) => s.run(`player god-mode "${name}" false`),
  clarity: (s, name) => s.setStat(name, 'nightmare', 0),
};

module.exports = {
  data: addChoice(new SlashCommandBuilder().setName('controlpanel').setDescription('Post buttons for common admin jobs'), 'panel', 'Which panel', Object.entries(PANELS).map(([value, p]) => ({ name: p.title, value }))),
  access: 'admin',

  async run(ctx) {
    ctx.needServer();
    const panel = PANELS[ctx.opt('panel')];
    const rows = [];
    for (let i = 0; i < panel.buttons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(panel.buttons.slice(i, i + 5).map(([id, label]) => new ButtonBuilder().setCustomId(`c:controlpanel:${id}`).setLabel(label).setStyle(ButtonStyle.Secondary))));
    }
    await ctx.bot.post(ctx.i.channelId, { embeds: [embed('info', panel.title, `${panel.text} Only members allowed to use /controlpanel can press these.`)], components: rows });
    return ctx.ok('Panel posted', 'Grant a role with `/permissions grant controlpanel`. Every press is checked and written to the audit log.');
  },

  async component(ctx, action) {
    const s = ctx.needOnline();
    await ctx.i.deferReply({ flags: MessageFlags.Ephemeral });
    if (ACTIONS[action]) {
      await ACTIONS[action](s);
    } else {
      const name = ctx.self();
      if (AREAS.has(action)) await s.teleportToArea(name, action);
      else if (SELF[action]) await SELF[action](s, name);
      else return ctx.i.editReply({ content: 'That button is not part of this bot any more.' });
      ctx.note(name);
    }
    ctx.note(action);
    return ctx.i.editReply({ content: 'Done.' });
  },
};
