# BotCore

A small, optional server mod for the bot. It does these things:

- **Coins and mail.** The game's coin and mailbox commands (`trade atm`, `trade post`) look
  players up on Alta's old servers, which are gone, so on a normal server they fail with "Failed
  sending request". BotCore answers those lookups from the players online right now and from
  `users.json` in `%APPDATA%\TheModdingTavern`, the file TavernLib already keeps. That turns on
  `/atm`, `/mail`, `/shop`, `/sell`, `/balance` and `/withdraw`.
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

Nothing else in the game changes.

## Install

1. Stop the game server.
2. Put `BotCore.dll` in the server's `Mods` folder.
3. Start the server. Its log shows `BotCore 1.4.0: 10 commands ready`, and `Started the Discord
   bot` when a copy of the bot is in `UserData`.

## Console commands it adds

- `botcore version`
- `botcore user <name or id>`: `online <id> <name>`, `offline <id> <name>` or `unknown`
- `botcore take <player> <item> <max> [count|take] [all|hands|belt] [any|none|material]`: count or
  remove carried items, answers `count <n> <refused>` or `taken <n> <refused>`
- `botcore carried <player> <item> [all|hands|belt]`: carried items split by material, answers
  `carried <refused> Oak=2|Redwood=1`, or `-` for none
- `botcore startfile`: the file where this server recorded how it was started, for `/boot`. It holds
  the launch tokens, so keep it private like `startServer.bat`
- `botcore ground <x> <z> <from height>`: the height of the ground under a point, answers
  `ground <y>` or `none`
- `botcore heal`, `botcore stats`, `botcore sweep count|run`: older helpers. The bot does not use
  them; it uses TavernLib's stat commands and the game's own `wacky destroy-free` instead.

## Build it yourself

You need Windows, the game with TavernLauncher's server files (MelonLoader), and the .NET
Framework 4 compiler that ships with Windows.

```
.\build.ps1 -Game "C:\path\to\A Township Tale"
```

The DLL lands in `botcore\bin\BotCore.dll`.
