const { RESERVED } = require('../game/text');

const TICK_MS = 60000;

function who(x) {
  return (x && typeof x === 'object' && (x.username || x.Username)) || null;
}

class Stats {
  constructor(bot) {
    this.bot = bot;
    this.timer = null;
  }

  doc(server) {
    const d = this.bot.store.get(`server-${server.id}-stats`, () => ({}));
    if (!d.players) d.players = {};
    return d;
  }

  row(server, name) {
    const d = this.doc(server);
    const key = String(name).toLowerCase();
    if (RESERVED.has(key)) return { name, kills: 0, deaths: 0, creatures: 0, seconds: 0 };
    if (!Object.prototype.hasOwnProperty.call(d.players, key)) d.players[key] = { name, kills: 0, deaths: 0, creatures: 0, seconds: 0 };
    d.players[key].name = name;
    return d.players[key];
  }

  save(server) {
    this.bot.store.save(`server-${server.id}-stats`);
  }

  tick() {
    for (const server of this.bot.servers.values()) {
      if (!server.online || server.roster.size === 0) continue;
      for (const p of server.players()) this.row(server, p.username).seconds += TICK_MS / 1000;
      this.save(server);
    }
  }

  start() {
    for (const server of this.bot.servers.values()) {
      server.on('PlayerKilled', (d) => {
        const victim = who(d.killedPlayer);
        const killer = who(d.killerPlayer);
        if (victim) this.row(server, victim).deaths += 1;
        if (killer && killer !== victim) this.row(server, killer).kills += 1;
        this.save(server);
      });
      server.on('ObjectKilled', (d) => {
        const killer = who(d.killerPlayer);
        if (!killer || !d.name || /combat_dummy/i.test(d.name)) return;
        this.row(server, killer).creatures += 1;
        this.save(server);
      });
    }
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }
}

module.exports = Stats;
