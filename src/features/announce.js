const { UserError, cleanText } = require('../game/text');

class Announce {
  constructor(bot) {
    this.bot = bot;
    this.timer = null;
  }

  doc(server) {
    return this.bot.store.get(`server-${server.id}-announcements`, {});
  }

  add(server, text, every, seconds = 8) {
    const clean = cleanText(text, 180);
    if (!clean) throw new UserError('That announcement is empty.');
    const d = this.doc(server);
    let n = 1;
    while (d[`a${n}`]) n += 1;
    const id = `a${n}`;
    d[id] = { id, text: clean, every: Math.max(5, Math.min(1440, Math.round(every))), seconds: Math.max(3, Math.min(30, seconds)), last: Date.now(), on: true };
    this.bot.store.save(`server-${server.id}-announcements`);
    return d[id];
  }

  remove(server, id) {
    const d = this.doc(server);
    if (!d[id]) return false;
    delete d[id];
    this.bot.store.save(`server-${server.id}-announcements`);
    return true;
  }

  async tick() {
    for (const server of this.bot.servers.values()) {
      if (!server.online || server.roster.size === 0) continue;
      for (const a of Object.values(this.doc(server))) {
        if (!a.on || Date.now() - a.last < a.every * 60000) continue;
        a.last = Date.now();
        this.bot.store.save(`server-${server.id}-announcements`);
        await server.broadcast(a.text, a.seconds).catch((e) => console.warn(`[announce] ${e.message}`));
      }
    }
  }

  start() {
    this.timer = setInterval(() => this.tick().catch(() => {}), 30000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }
}

module.exports = Announce;
