# Setup

About ten minutes. You need:

- Your A Township Tale server running with TavernLauncher (the Server launcher on Windows, or the
  Linux docker kit). TavernLib is part of that setup.
- Node.js 20 or newer, free from https://nodejs.org (pick the LTS version).
- A Discord server where you are the owner or an admin.

The bot connects to the game server's console on port 1760. The easy way is to run the bot on
the same computer as the game server.

## 1. Get the bot

Download this repository (Code, Download ZIP on GitHub) and unzip it somewhere simple, like
`C:\ATT-Admin-Bot`. Avoid OneDrive folders.

## 2. Make the Discord bot

1. Open https://discord.com/developers/applications and click **New Application**. Name it.
2. Open the **Bot** tab and click **Reset Token**. Copy the token. Anyone with it controls the
   bot, so keep it secret.
3. The bot needs no privileged intents. Leave all three intent switches off.
4. Open **OAuth2**, then **URL Generator**. Tick `bot` and `applications.commands`. Under Bot
   Permissions tick: View Channels, Send Messages, Embed Links, Read Message History and Manage
   Messages (only used by `/purge`).
5. Open the link at the bottom and add the bot to your Discord server.

## 3. Get your Discord server id

In Discord open User Settings, Advanced, and turn on **Developer Mode**. Right click your server
icon and click **Copy Server ID**.

Optional: right click your own name and **Copy User ID** too. Put it in `BOT_OWNER_IDS` if you
want full access without being the Discord server owner. Several ids are fine, separated by
commas.

## 4. Fill in the settings

Copy `.env.example` and name the copy `.env`. Open it with Notepad:

| Line | What goes there |
|---|---|
| `DISCORD_TOKEN` | The bot token from step 2 |
| `DISCORD_GUILD_ID` | The server id from step 3 |
| `BOT_OWNER_IDS` | Optional, your user id |
| `SERVER_NAME` | Any name, shown in Discord |
| `ATT_CONSOLE_HOST`, `ATT_CONSOLE_PORT` | Leave `127.0.0.1` and `1760` when the bot runs on the game server's computer |
| `ATT_CONSOLE_TOKEN_FILE` | Leave empty on Windows (see below) |
| `ATT_CONSOLE_TOKEN` | Leave empty on Windows (see below) |

**The console token.** TavernLib writes it to `%APPDATA%\TheModdingTavern\console_token.txt`
when the server starts. When the bot runs on the same Windows account as the server, it finds
that file on its own. Otherwise:

- Windows, other account: click **Copy Console Token** in the Server launcher and paste it after
  `ATT_CONSOLE_TOKEN=`.
- Linux docker kit: run this in the `att-server-docker` folder and paste the output after
  `ATT_CONSOLE_TOKEN=`:

  ```
  docker compose exec att-server cat /wine/drive_c/users/root/AppData/Roaming/TheModdingTavern/console_token.txt
  ```

The token never expires and gives full control of the server. Never share `.env`, and never open
port 1760 on your router.

## 5. Start it

Start your game server first. Then:

- Windows: double click `start.bat`.
- Linux: `sh start.sh`

The first start installs what the bot needs, which takes a minute. You are done when you see:

```
[discord] logged in as YourBot#1234
[discord] 33 commands ready in Discord server ...
[main] connected to the game console
```

The commands show up in Discord right away. If the game server is not running yet, the bot waits
and connects on its own when it comes up.

## 6. First things in Discord

1. `/setup channel` picks channels. Make at least an event log and a live online list:
   `kind: Event log` and `kind: Live online list`.
2. `/cleanup preset preset:spriggull` adds the Spriggull cleanup (feathers, raw drumsticks,
   bones). It starts in preview mode and posts what it would remove.
3. When the numbers look right, `/cleanup mode rule:spriggull mode:live`.
4. `/permissions grant` lets your moderators use the commands they need, for example
   `command: kick` with `role: Moderator`.
5. Tell your players about `/link start`, so their Discord account shows next to their name.

`/help` lists everything.

## Keep it running

Closing the `start.bat` window stops the bot. To keep it running in the background and restart it
when it crashes, use pm2:

```
npm install -g pm2
pm2 start src/index.js --name att-bot
pm2 save
```

On Windows, `pm2-installer` or a Task Scheduler task "at log on" running `start.bat` keeps it
up after a reboot.

## More than one game server

Copy `servers.example.json` to `servers.json` and list each game server with its own Discord
server id, console port and token. When `servers.json` exists, the server lines in `.env` are
ignored. Each Discord server controls one game server.

## Running the bot on another computer

The console is plain WebSocket with no encryption. If the bot cannot run on the game server's
computer, connect the two over a VPN (Tailscale, WireGuard) or an SSH tunnel, then set
`ATT_CONSOLE_HOST` to the game server's VPN address. Still never open port 1760 to the internet.

## Optional: BotCore

For `/atm` and `/mail`, put `BotCore.dll` in the game server's `Mods` folder and restart the
server. See [botcore/README.md](botcore/README.md).

## Troubleshooting

| You see | Fix |
|---|---|
| `DISCORD_TOKEN is empty` | Fill `.env` (step 4). |
| `Discord login failed` | The token is wrong or was reset. Copy a new one (step 2). |
| `no console token yet` | Start the game server once, or paste the token into `ATT_CONSOLE_TOKEN`. |
| `the console refused the token` | The token is old. The Server launcher writes a new one each time it starts the server: copy the current one, or leave `ATT_CONSOLE_TOKEN` empty so the bot reads the file. |
| `cannot reach the console yet` | The game server is not running, or the host or port is wrong. |
| No slash commands in Discord | `DISCORD_GUILD_ID` is wrong, or the bot was added without `applications.commands`. Add it again with the link from step 2. |
| Commands answer "is not connected right now" | The bot lost the console. It reconnects by itself; check the game server. |
| Right after a server restart, commands are slow or time out | A restarting server holds commands for one to four minutes while the world loads. Wait. |
