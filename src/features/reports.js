const { embed } = require('../core/ui');
const { quoteName, cleanText, isSafeName, own } = require('../game/text');

function name(x) {
  return (x && (x.username || x.Username)) || 'unknown';
}

class Reports {
  constructor(bot) {
    this.bot = bot;
  }

  doc(server) {
    const d = this.bot.store.get(`server-${server.id}-reportrules`, () => ({}));
    if (!d.actions) d.actions = {};
    if (d.role === undefined) d.role = null;
    return d;
  }

  save(server) {
    this.bot.store.save(`server-${server.id}-reportrules`);
  }

  post(server, title, fields, content) {
    const channel = this.bot.channelFor(server, 'reports') || this.bot.channelFor(server, 'logs');
    if (!channel) return;
    const payload = { embeds: [embed('warn', title, null, fields).setFooter({ text: server.name }).setTimestamp()] };
    if (content) {
      payload.content = content;
      payload.allowedMentions = { roles: [content.replace(/[<@&>]/g, '')] };
    }
    this.bot.post(channel, payload);
  }

  expand(template, d) {
    const reported = name(d.ReportedPlayer);
    const reporter = name(d.ReportedBy);
    if (/\{reported\}/.test(template) && !isSafeName(reported)) return null;
    if (/\{reporter\}/.test(template) && !isSafeName(reporter)) return null;
    return template
      .replace(/"?\{reported\}"?/g, () => quoteName(reported))
      .replace(/"?\{reporter\}"?/g, () => quoteName(reporter))
      .replace(/\{reason\}/g, () => cleanText(d.Reason ?? 'none', 120));
  }

  async act(server, d) {
    const rules = this.doc(server).actions;
    const reason = String(d.Reason ?? '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 32);
    const list = [...(own(rules, reason) || []), ...(own(rules, 'any') || [])];
    for (const template of list) {
      const text = this.expand(template, d);
      if (!text) continue;
      const r = await server.run(text, { allowError: true }).catch((e) => ({ error: e.message }));
      this.bot.audit.write({ guildId: server.guildId, userId: 'bot', userTag: 'report action', command: 'report action', args: text, outcome: r.error ? 'error' : 'ok', detail: r.error || '' });
    }
  }

  start() {
    for (const server of this.bot.servers.values()) {
      server.on('SocialTabletPlayerReported', (d) => {
        const role = this.doc(server).role;
        this.post(server, 'Player report from the tablet', [
          ['Reported', name(d.ReportedPlayer), true],
          ['By', name(d.ReportedBy), true],
          ['Reason', String(d.Reason ?? 'none'), false],
        ], role ? `<@&${role}>` : null);
        this.act(server, d).catch((e) => console.warn(`[reports] ${e.message}`));
      });
      server.on('SocialTabletPlayerBanned', (d) => this.post(server, 'Player banned from the tablet', [
        ['Banned', name(d.BannedPlayer || d.ReportedPlayer), true],
        ['By', name(d.BannedBy || d.ReportedBy), true],
        ['Reason', String(d.Reason ?? 'none'), false],
      ]));
    }
  }
}

module.exports = Reports;
