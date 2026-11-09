# ATT Admin Bot

A Discord bot for running your own A Township Tale server. It talks to the server's console, so
you can moderate, help players, change settings and keep the world tidy from Discord instead of
typing console commands.

It works with any server that runs TavernLib (the normal TavernLauncher setup, on Windows or the
Linux docker kit). Nothing extra has to be installed on the server. One optional server mod,
BotCore, adds coins, mail, the shop and selling.

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

**Plots.** Claim chunks for a player, by standing there or from a list. Anyone who is not the owner
or trusted gets a warning, or is sent out to a spot you choose. Plot owners manage their own trusted
list. Linked Discord admins can always enter. `/plot why` shows exactly why a player is or is not
allowed.

**Plot tree.** On by default at chunk 17-34: anyone with a plot who walks into that chunk is sent to
their plot, everyone else is left alone. `/plot tree` changes the chunk or turns it off. Each plot has
an arrival spot, which fills in the first time its owner walks in, or you set it with `/plot spawn`.

**Chunks.** `/chunk show` marks the border of your chunk for a few minutes: graves with a beam of
light at the corners, lamp posts along the sides. Nobody can pick them up. `/chunk watch` shows the
chunk and plot name on screen when you cross a border.

**Shop and selling (needs BotCore).** List items with prices and categories, and players buy with
their ATM coins from Discord. Items arrive in the mailbox. You can also sell Discord roles. Set what
the bot pays for items, and players sell what they carry with `/sell item`. They see the offer and
confirm first. Prices can depend on the wood or metal: `/sell add` with a `material` sets one price
for Redwood and another for Oak, and `/sell item` pays each piece by what it really is. `/shop add`
sells one wood or metal the same way. Daily limits are optional, and a sell price at or above the
shop price is refused so nobody can print coins. Nothing is bought, sold or withdrawn within 15 m of an ATM. Change that with `/shop atmdistance`.

**Alchemy.** Build your own recipes for your server. Put items in the front pockets, in order or not,
and either bring your hands together or just wait. A recipe can run up to 5 console commands, give
items or a buff, use up the items, have a cooldown, work only for named players, and hit everyone in
the chunk. In commands, `{player}` is who it runs on and `{caster}` is who fired it. `/alchemy hold`
gives a buff for as long as someone carries an item, or one exact item from a save string.
`/alchemy edit` changes a saved one without making it again.

**Fun.** Smite, fling, featherweight, no hunger, clarity, forge all, hearts, spriggull drops,
meetings and surprises. Kill and death leaderboards and time online with `/stats` and `/playtime`.

**Admin tools.** Button panels, console kits, spawning from save strings, looking into chunks and
resetting them, removing one item from the ground, and posts as the bot.

**Raw console.** `/cmd` sends any console command. It is owner only unless you grant it.

## Permissions

- The Discord server owner and anyone in `BOT_OWNER_IDS` can use everything.
- Members with the Administrator permission can use the admin commands.
- `/boot`, `/shutdown` and `/restart` are for admins. Grant `/boot` to a role if your members should
  be able to start the server.
- Owner only by default: `/bot`, `/cmd`, `/cc`, `/string`, `/spawn`, `/kit give`, `/mail`, `/atm add|set`,
  `/alchemy create|hold|edit|delete|toggle|test`, `/report action|clear`, `/chunks wipe`,
  `/settings set`, `/world`, `/permissions`. These can run anything on your server, so grant them
  with care.
- `/permissions grant` lets any role or member use a command, or one subcommand like
  `cleanup.run`. A grant for a whole command leaves out its owner only subcommands: grant
  those by name, like `kit.give`.
- Everyone can use `/players`, `/status`, `/help`, `/link`, `/shop list|menu|buy`,
  `/sell list|item`, `/balance`, `/withdraw`, `/stats`, `/playtime`, `/chunk` and their own plot's
  trust list and arrival spot.

Every admin action is written to `data/audit/` and, if you pick a channel, posted to Discord.

## BotCore (optional)

The game's coin and mailbox commands look players up on Alta's old servers, which are gone.
BotCore is a small server mod that answers those lookups, which turns on `/atm`, `/mail`, `/shop`,
`/sell`, `/balance` and `/withdraw`. It also removes sold items safely from a player's hands, belt
and bag, reads what wood or metal they are made of, tells the bot where the ground is for
`/chunk show`, and records how the server was started so `/boot` can start it again.
On Windows it also starts the bot together with the game server: drop the bot into `UserData`
under any folder name, fill in `.env`, and the first server start installs what it needs (Node.js
too, when the PC has none) and starts it. See [botcore/README.md](botcore/README.md). Without
BotCore everything else works.

## Commands

| Command | What it does |
|---|---|
| `/setup` | Channels for logs, the online list, cleanup reports, tablet reports and the audit log. `/setup auto` makes them all, `/setup logchannel` gives one kind of log its own channel |
| `/permissions` | Let roles or members use commands |
| `/status`, `/players` | Server health and who is online |
| `/l` | Numbers the players online (admins). Every player option takes that number, the name, or an @mention of a member who used `/link` |
| `/cleanup` | Ground cleanup rules, preview, run, warning, threshold, decay |
| `/kick`, `/ban` | Kick, timed or permanent bans |
| `/message`, `/announce` | On screen messages, repeating announcements |
| `/player` | Info, inventory and stats of an online player |
| `/tp`, `/location`, `/home` | Teleports, saved spots, respawn points |
| `/kill`, `/heal`, `/godmode`, `/stat`, `/buff` | Health and stats |
| `/spawn`, `/kit`, `/mail`, `/atm`, `/string` | Items and coins |
| `/shop`, `/sell`, `/balance`, `/withdraw` | The shop, selling to the bot, coins |
| `/alchemy` | Your own item recipes and carried item buffs |
| `/time`, `/settings`, `/save`, `/festival`, `/world` | The world and the server |
| `/boot`, `/shutdown`, `/restart` | Start, close or restart the game server from Discord |
| `/bot` | Stop or restart the Discord bot itself |
| `/plot`, `/chunk` | Land claims, the plot tree, chunk markers |
| `/despawn`, `/despawnmenu`, `/wipe`, `/chunks` | Remove one item from the ground, look into or reset a chunk |
| `/report` | What happens on a tablet report |
| `/stats`, `/playtime`, `/autobuff` | Leaderboards, time online, a buff on every join |
| `/controlpanel`, `/cc`, `/items`, `/say`, `/embed`, `/poll` | Buttons, console kits, item codes, posts |
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
- Reports made on the tablet only reach the bot on servers running TavernEssentials. The game itself
  never sends them.
- Selling a stack takes the whole amount you confirm. A bag with something inside cannot be sold.
- A carried item buff can last up to 15 seconds after letting go.
- If a purchase or sale stops halfway, `/shop pending` lists it. Nothing is paid twice on its own.

## Licence

MIT
