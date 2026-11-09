# Setup

About ten minutes. You need:

- Your A Township Tale server running with TavernLauncher (the Server launcher on Windows, or the
  Linux docker kit). TavernLib is part of that setup.
- Node.js 20 or newer, free from https://nodejs.org (pick the LTS version). With BotCore on Windows
  you can skip this: BotCore downloads Node.js when none is found.
- A Discord server where you are the owner or an admin.

The bot connects to the game server's console on port 1760. The easy way is to run the bot on
the same computer as the game server.

## 1. Get the bot

Download this repository (Code, Download ZIP on GitHub) and unzip it somewhere simple, like
`C:\ATT-Admin-Bot`. Avoid OneDrive folders. On Windows with BotCore, unzip it into the server's
`UserData` folder instead and skip step 5 (see "Start the bot with the game server").

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

Copy `.env.example` and name the copy `.env`. It must sit in the same folder as
`package.json` and the `src` folder. Windows hides file endings by default, so first turn them on
in File Explorer (View, Show, File name extensions): Notepad likes to save `.env.txt`, which looks
like `.env` while endings are hidden. The bot reads `.env.txt` too and tells you to rename it.

Open `.env` with Notepad:

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
[discord] 54 commands ready in Discord server ...
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
   The shop, selling and the plot tree on Discord all need it.

`/setup auto` makes a category with all the channels in one go. Only the online list can be seen by
everyone, so open the others to your staff role in Discord.

The plot tree is on from the start at chunk 17-34. Anyone with a plot who walks into that chunk is
sent to their plot. Use `/plot tree action:set chunk:21-35` to move it, or `action:off` to turn it off.

To open a shop, install BotCore (below), then `/shop add` and `/sell add` for each item.

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

## Start the bot with the game server (Windows, BotCore)

With BotCore the game server starts the bot itself. Put the files in place, fill in `.env` and
start the server. There is no folder to rename and no `start.bat` to run.

1. Put `BotCore.dll` in the server's `Mods` folder.
2. Unzip the bot into the server's `UserData` folder (next to `Mods`). Any folder name works,
   including the `att-admin-bot-2.1.0` a GitHub download unpacks as, and the extra folder inside it
   that some unzip tools add.
3. Fill in `.env` there (step 4).
4. Start the server. On the first start BotCore installs what the bot needs in the background. That
   takes about a minute and the server does not wait for it. Then the server log shows `Started the
   Discord bot`. The bot writes its own log to `logs\bot.log` in its folder, and the install writes
   to `logs\install.log`. If the install fails the server carries on, the log says why, and the
   next server start tries again.

If Node.js is not on the PC, BotCore downloads the official Windows zip of Node.js 24 from
nodejs.org into the bot's `node` folder, checks its SHA-256 and uses it. To use your own, install
Node.js or put `node.exe` in that `node` folder first.

The bot stays up until someone stops it, through server restarts and after the server closes.
`/bot restart` restarts it. `/bot stop` stops it, and then only the next server start or a manual
`start.bat` brings it back.

Only one copy of a Discord bot runs at a time on a PC, even from another folder, so starting
`start.bat` while the server's copy runs just says it is already running. To turn all of this off,
create an empty file `UserData\BotCore\autostart-off.txt`.

If `UserData` holds several copies of the bot, the one with a `.env` is started and the server log
says which. Coin balances and settings live in each copy's `data` folder, so when you unpack a new
version beside the old one, copy `.env` and `data` across before you remove the old one.

While the server restarts, the bot stays online and commands that need the game say it is not
connected.
The Linux docker kit runs the game under Wine: keep running the bot with pm2 there.

## Starting and closing the server from Discord

`/boot` starts the server, `/shutdown` saves and closes it, `/restart` does both. They are for admins,
and `/permissions grant` opens any of them to a role.

With BotCore 1.3.0 and the bot on the same PC as the server, there is nothing to set up: BotCore
records how the server was started, and `/boot` starts it the same way. Start the server by hand
once after installing BotCore so it has something to record. If you host from TavernLauncher, keep
the launcher open for logins, and do not press its Start button while the bot's server runs.

Docker and other setups: set `SERVER_START` in `.env` to a script or command that starts your server
(or `"start"` on a server in `servers.json`). The bot must be able to run it, and it wins over the
recorded start.

## More than one game server

Copy `servers.example.json` to `servers.json` and list each game server with its own Discord
server id, console port and token. When `servers.json` exists, the server lines in `.env` are
ignored. Each Discord server controls one game server.

## Running the bot on another computer

The console is plain WebSocket with no encryption. If the bot cannot run on the game server's
computer, connect the two over a VPN (Tailscale, WireGuard) or an SSH tunnel, then set
`ATT_CONSOLE_HOST` to the game server's VPN address. Still never open port 1760 to the internet.

## Optional: BotCore

For `/atm`, `/mail`, `/shop`, `/sell`, `/balance` and `/withdraw`, put `BotCore.dll` (1.4.0 or newer) in
the game server's `Mods` folder and restart the server. See [botcore/README.md](botcore/README.md).

## Troubleshooting

| You see | Fix |
|---|---|
| `DISCORD_TOKEN is empty` | Fill `.env` (step 4). |
| `Discord login failed` | The token is wrong or was reset. Copy a new one (step 2). |
| `no console token yet` | Start the game server once, or paste the token into `ATT_CONSOLE_TOKEN`. |
| `the console refused the token` | The token is old. The Server launcher writes a new one each time it starts the server: copy the current one, or leave `ATT_CONSOLE_TOKEN` empty so the bot reads the file. |
| `cannot reach the console yet` | The game server is not running, or the host or port is wrong. |
| No slash commands in Discord | `DISCORD_GUILD_ID` is wrong, or the bot was added without `applications.commands`. Add it again with the link from step 2. |
| `/shop` or `/sell` say the server answered in a way the bot does not understand | Update BotCore to 1.4.0 or newer. |
| `Bot autostart: npm install failed` in the server log | Open `logs\install.log` in the bot's folder. Usually no internet. The next server start tries again. |
| Commands answer "is not connected right now" | The bot lost the console. It reconnects by itself; check the game server. |
| Right after a server restart, commands are slow or time out | A restarting server holds commands for one to four minutes while the world loads. Wait. |
