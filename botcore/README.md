# BotCore

A small, optional server mod for the bot. It is only needed for `/atm` and `/mail`.

The game's coin and mailbox commands (`trade atm`, `trade post`) look players up on Alta's old
servers, which are gone, so on a normal server they fail with "Failed sending request". BotCore
answers those lookups from the players online right now and from `users.json` in
`%APPDATA%\TheModdingTavern`, the file TavernLib already keeps. Nothing else in the game changes.

## Install

1. Stop the game server.
2. Put `BotCore.dll` in the server's `Mods` folder.
3. Start the server. Its log shows `BotCore 1.0.0: 6 commands ready`.

The bot notices it on its next connect and logs `BotCore 1.0.0 found`.

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
