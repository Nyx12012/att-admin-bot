# BotCore

A small, optional server mod for the bot. It does two things:

- **Coins and mail.** The game's coin and mailbox commands (`trade atm`, `trade post`) look
  players up on Alta's old servers, which are gone, so on a normal server they fail with "Failed
  sending request". BotCore answers those lookups from the players online right now and from
  `users.json` in `%APPDATA%\TheModdingTavern`, the file TavernLib already keeps. That turns on
  `/atm` and `/mail`.
- **Starts the bot with the server.** If the bot is in the server's `UserData\ATT-Admin-Bot`
  folder, BotCore starts it when the server starts, and the bot stops when the server stops. See
  "Start the bot with the game server" in SETUP.md.

Nothing else in the game changes.

## Install

1. Stop the game server.
2. Put `BotCore.dll` in the server's `Mods` folder.
3. Start the server. Its log shows `BotCore 1.1.0: 6 commands ready`, and `Started the Discord
   bot` when the bot is in `UserData\ATT-Admin-Bot`.

To turn the autostart off, create an empty file `UserData\BotCore\autostart-off.txt`.

## Console commands it adds

- `botcore version`
- `botcore user <name or id>`: `online <id> <name>`, `offline <id> <name>` or `unknown`
- `botcore heal`, `botcore stats`, `botcore sweep count|run`: older helpers. The bot does not use
  them; it uses TavernLib's stat commands and the game's own `wacky destroy-free` instead.

## Build it yourself

You need Windows, the game with TavernLauncher's server files (MelonLoader), and the .NET
Framework 4 compiler that ships with Windows.

```
.\build.ps1 -Game "C:\path\to\A Township Tale"
```

The DLL lands in `botcore\bin\BotCore.dll`.
