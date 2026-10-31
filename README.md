# ATT Admin Bot

A Discord bot for running your own A Township Tale server. It talks to the server's console, so
you can moderate, help players, change settings and keep the world tidy from Discord instead of
typing console commands.

It works with any server that runs TavernLib (the normal TavernLauncher setup, on Windows or the
Linux docker kit). Nothing extra has to be installed on the server. One optional server mod,
BotCore, adds coins and mail.

Setup takes about ten minutes: see [SETUP.md](SETUP.md).

## What it does

**Ground cleanup.** Items like Spriggull feathers, raw drumsticks, bones, rocks and sticks pile up
and slow a server down. Cleanup rules remove them on a timer.

- Ready made rules (`/cleanup preset`): spriggull, rocks, cave, trees, mushrooms, rusty, scraps.
  Or make your own from any items.
- Only loose items go. Anything held, in a bag, on a belt or in a storage slot (storage chests,
  racks, docks) stays, because the bot uses the game's own clean up of free items. Items set
  down on a shelf, a table or inside an open crate have no slot, so they count as loose: keep
  them out of your rules or store them in slots.
- Every new rule starts in preview mode: it counts and reports, and deletes nothing until you
  switch it to live.
- Optional: only clean when more than a number of items are lying around, and an in game
  warning before each cleanup (off by default).
- `/cleanup decay` changes the game's own rot speed for every loose item.

**Moderation.** Kick, ban for a time or forever (banned players are kicked when they join),
on screen messages to one player or everyone, repeating announcements, and a log channel for
joins, leaves, deaths, bans and setting changes. A live "who is online" message keeps itself up
to date. Reports made on the in game tablet are posted to Discord.

**Players.** Player info, inventory and stats, teleports (to a player, a named spot, saved
locations or coordinates), summon, homes, kill, heal, god mode, stats, spawning items, item kits
and saved buffs. Players can link their Discord account to their in game name.

**World and server.** Time of day, every server setting (PVP, drop on death, respawn time, player
limit, decay and more), save and backup, festivals, refilling overworld chests, fixing a stuck
smelter or chisel deck, filling community boxes, regrowing forests and regenerating caves.

**Plots.** Claim chunks for a player. Anyone who is not the owner or trusted gets a warning, or
is sent out to a spot you choose. Plot owners manage their own trusted list.

**Fun.** Smite, fling, featherweight, no hunger, clarity and forge all.

**Raw console.** `/cmd` sends any console command. It is owner only unless you grant it.

## Permissions

- The Discord server owner and anyone in `BOT_OWNER_IDS` can use everything.
- Members with the Administrator permission can use the admin commands.
- Owner only by default: `/cmd`, `/spawn`, `/kit give`, `/mail`, `/atm add|set`,
  `/settings set`, `/world`, `/permissions`.
- `/permissions grant` lets any role or member use a command, or one subcommand like
  `cleanup.run`. A grant for a whole command leaves out its owner only subcommands: grant
  those by name, like `kit.give`.
- Everyone can use `/players`, `/status`, `/help`, `/link` and their own plot's trust list.

Every admin action is written to `data/audit/` and, if you pick a channel, posted to Discord.

## BotCore (optional)

The game's coin and mailbox commands look players up on Alta's old servers, which are gone.
BotCore is a small server mod that answers those lookups, which turns on `/atm` and `/mail`.
On Windows it can also start the bot together with the game server, so nobody has to run
`start.bat`. See [botcore/README.md](botcore/README.md). Without it everything else works.

## Commands

| Command | What it does |
|---|---|
| `/setup` | Channels for logs, the online list, cleanup reports, tablet reports and the audit log |
| `/permissions` | Let roles or members use commands |
| `/status`, `/players` | Server health and who is online |
| `/cleanup` | Ground cleanup rules, preview, run, warning, threshold, decay |
| `/kick`, `/ban` | Kick, timed or permanent bans |
| `/message`, `/announce` | On screen messages, repeating announcements |
| `/player` | Info, inventory and stats of an online player |
| `/tp`, `/location`, `/home` | Teleports, saved spots, respawn points |
| `/kill`, `/heal`, `/godmode`, `/stat`, `/buff` | Health and stats |
| `/spawn`, `/kit`, `/mail`, `/atm` | Items and coins |
| `/time`, `/settings`, `/save`, `/festival`, `/world` | The world and the server |
| `/plot` | Land claims |
| `/fun` | Smite, fling and friends |
| `/link` | Link Discord accounts to in game names |
| `/purge` | Delete recent messages in a channel |
| `/cmd` | Raw console command |
| `/help` | Everything above, inside Discord |

## Good to know

- The bot must reach the server's console on port 1760. Run it on the same machine, or over a
  VPN or SSH tunnel. Never open port 1760 on your router: the console token gives full control.
- Items only exist near players, so a cleanup only sees what is loaded around someone online.
- Bans are kept by the bot. Keep the bot running, or also add the player to the blacklist in the
  Server launcher.
- Coordinate teleports briefly move the player's home point and then put it back.

## Tests

```
npm install
npm test
```

## Licence

MIT
