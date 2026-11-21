# BotCore

Two small, optional mods for the bot:

- `BotCore.Server.dll` goes on the game server.
- `BotCore.Client.dll` goes on each player's PC. It adds the bot tablet in game.

## BotCore.Server

It does these things:

- **Coins and mail.** The game's coin and mailbox commands (`trade atm`, `trade post`) look
  players up on Alta's old servers, which are gone, so on a normal server they fail with "Failed
  sending request". BotCore answers those lookups from the players online right now and from
  `users.json` in `%APPDATA%\TheModdingTavern`, the file TavernLib already keeps. That turns on
  `/atm`, `/mail`, `/shop`, `/sell`, `/balance` and `/withdraw`.
- **The bot tablet.** Players with BotCore.Client get a bubble on their quick access wheel that
  opens the bot's menu on their tablet. BotCore.Server checks each player's roles and passes what
  they press to the bot. See "The bot tablet" below.
- **Starts the bot with the server.** If a copy of the bot is in the server's `UserData` folder,
  under any folder name, BotCore starts it when the server starts. The bot then stays up until
  someone stops it. See "Start the bot with the game server" in SETUP.md.
- **Sets the bot up the first time.** In the background, while the server loads, BotCore runs
  `npm install` in the bot's folder.
- **Downloads and runs Node.js when none is found.** If the PC has no Node.js, BotCore downloads
  the official Windows x64 zip of Node.js 24 from nodejs.org into the bot's `node` folder, checks
  it against a SHA-256 built into BotCore, and runs the bot with it.

An empty file `UserData\BotCore\autostart-off.txt` turns all of the bot starting, installing and
downloading off.

### Install

1. Stop the game server.
2. Put `BotCore.Server.dll` in the server's `Mods` folder. If an older `BotCore.dll` is there,
   delete it: BotCore.Server replaces it, and stays off while the old one is still there.
3. Start the server. Its log shows `BotCore 1.6.0: 16 commands ready`, `The in-game bot tablet is
   on`, and `Started the Discord bot` when a copy of the bot is in `UserData`.

## BotCore.Client

Players put `BotCore.Client.dll` in their game's `Mods` folder (PC, MelonLoader, the same place as
other client mods). On a server with BotCore.Server, a **Bot Menu** bubble shows on the quick access
wheel. It opens the tablet on the bot's menu. The bot builds every page, so a newer bot brings new
buttons without a new client.

- **Shop**: what the bot sells, your price and your ATM coins. Pick an item, then Buy 1, 5 or 10.
  It arrives in your mailbox, stacks in pouches.
- **Sell**: what the bot buys. Pick one to see the offer for what you carry, then Sell.
- **Me**: your coins, Withdraw, a code to link Discord, your stats, where you are.
- **Plots**: your plots for players; list, create, edit and delete for staff.
- **Actions**: buttons the server owner made for your role.
- **Players**, **Cleanup**, **Server**, **Spawn**: staff tools.
- **Commands**: every bot command as a form. Options are picked from lists: online players,
  items (in your hands, recent, shop, sell list, A to Z), numbers, choices.

Buttons that do something you cannot undo need two taps. Home goes back to the bot menu. Tap the
bubble again to put the tablet away.

The bubble does not show on servers without BotCore.Server, or when your roles open no page there.
It turns grey while the bot is not connected. The client needs no Discord link: the server already
knows who you are.

## The bot tablet

`UserData\BotCore\tablet.txt` on the server says who sees each page. BotCore writes it on the
first start:

```
shop = everyone
sell = everyone
me = everyone
plots = everyone
actions = everyone
players = owner, admin, moderator
spawn = owner
cleanup = owner, admin, moderator
server = owner, admin
commands = owner, admin
```

What is on Players, Spawn, Cleanup and Server works for anyone who sees the page. Commands uses the
same rules as Discord: the role `owner` counts as the bot owner, `admin` as a Discord admin, and a
player who used `/link` also brings what their Discord roles were granted. An old `admin = ...` line
from 2.2 is read as `players`.

Use `everyone`, `nobody`, or role names from the Server launcher's Edit Roles (TavernLib's
`users.json`), split by commas. Saved changes and role changes reach players within a few seconds,
no restart needed. Roles need a TavernLib with the roles API (1.5.3 or newer). Without it only pages
set to `everyone` show.

The tablet needs the bot (2.3.0 or newer) connected to the server. Purchases, sales, kicks, bans and
teleports go through the same code as the Discord commands, with the same rules and limits. Admin
actions are written to the bot's audit log as `<name> (in game)`.

## Console commands it adds

- `botcore version`
- `botcore user <name or id>`: `online <id> <name>`, `offline <id> <name>` or `unknown`
- `botcore take <player> <item> <max> [count|take] [all|hands|belt] [any|none|material]`: count or
  remove carried items, answers `count <n> <refused>` or `taken <n> <refused>`. A max of 0 means no
  limit
- `botcore carried <player> <item> [all|hands|belt]`: carried items split by material, answers
  `carried <refused> Oak=2|Redwood=1`, or `-` for none
- `botcore startfile`: the file where this server recorded how it was started, for `/boot`. It holds
  the launch tokens, so keep it private like `startServer.bat`
- `botcore ground <x> <z> <from height>`: the height of the ground under a point, answers
  `ground <y>` or `none`
- `botcore stack <item>`: how many of an item the game puts in one pouch, answers `stack <n>`, or
  `single` when it does not stack
- `botcore sweep near <player> <meters> [count|run]`: loose ground items around a player, counted
  or removed. Held, docked, mounted and protected items never count, nor a tablet someone summoned
- `botcore tablet status`: players with the tablet, their roles and the pages they may open
- `botcore tablet roles <player>`: the TavernLib roles of an online player, for job role prices
- `botcore tablet hello` and `botcore tablet answer`: the bot's side of the tablet
- `botcore heal`, `botcore stats`, `botcore sweep count|run`: older helpers. The bot does not use
  them; it uses TavernLib's stat commands and the game's own `wacky destroy-free` instead.

The tablet uses network message 155 and the console event `BotCoreTablet`.

## Build it yourself

You need Windows, the game with TavernLauncher's server files (MelonLoader), and the .NET
Framework 4 compiler that ships with Windows.

```
.\build.ps1 -Game "C:\path\to\A Township Tale"
```

Both DLLs land in `botcore\bin`.
