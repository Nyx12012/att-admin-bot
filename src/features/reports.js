const { embed } = require('../core/ui');

function name(x) {
  return (x && (x.username || x.Username)) || 'unknown';
}

class Reports {
  constructor(bot) {
    this.bot = bot;
  }

  post(server, title, fields) {
    const channel = this.bot.channelFor(server, 'reports') || this.bot.channelFor(server, 'logs');
    if (!channel) return;
    this.bot.post(channel, { embeds: [embed('warn', title, null, fields).setFooter({ text: server.name }).setTimestamp()] });
  }

  start() {
    for (const server of this.bot.servers.values()) {
      server.on('SocialTabletPlayerReported', (d) => this.post(server, 'Player report from the tablet', [
        ['Reported', name(d.ReportedPlayer), true],
        ['By', name(d.ReportedBy), true],
        ['Reason', String(d.Reason ?? 'none'), false],
      ]));
      server.on('SocialTabletPlayerBanned', (d) => this.post(server, 'Player banned from the tablet', [
        ['Banned', name(d.BannedPlayer || d.ReportedPlayer), true],
        ['By', name(d.BannedBy || d.ReportedBy), true],
        ['Reason', String(d.Reason ?? 'none'), false],
      ]));
    }
  }
}

module.exports = Reports;
