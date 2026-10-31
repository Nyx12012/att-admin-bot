using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using MelonLoader;

namespace BotCore
{
    public static class Autostart
    {
        public const string FolderName = "ATT-Admin-Bot";

        public static void Run(string userData, MelonLogger.Instance log)
        {
            try
            {
                string folder = Path.Combine(userData, FolderName);
                string entry = Path.Combine(Path.Combine(folder, "src"), "index.js");
                if (!File.Exists(entry)) return;
                string off = Path.Combine(Path.Combine(userData, "BotCore"), "autostart-off.txt");
                if (File.Exists(off))
                {
                    log.Msg("Bot autostart is off because " + off + " exists");
                    return;
                }
                if (AlreadyRunning(Path.Combine(Path.Combine(folder, "data"), "bot.pid")))
                {
                    log.Msg("The Discord bot is already running, not starting a second copy");
                    return;
                }
                string node = FindNode(folder);
                if (node == null)
                {
                    log.Error("Bot autostart: Node.js was not found. Install it from https://nodejs.org or put node.exe in " + Path.Combine(folder, "node"));
                    return;
                }
                if (!Directory.Exists(Path.Combine(Path.Combine(folder, "node_modules"), "discord.js")))
                {
                    log.Error("Bot autostart: the bot's packages are missing. Run start.bat in " + folder + " once, then restart the server");
                    return;
                }
                int pid = Process.GetCurrentProcess().Id;
                ProcessStartInfo psi = new ProcessStartInfo(node, "src\\index.js --server-pid " + pid.ToString(CultureInfo.InvariantCulture));
                psi.WorkingDirectory = folder;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                Process started = Process.Start(psi);
                log.Msg("Started the Discord bot (pid " + started.Id.ToString(CultureInfo.InvariantCulture) + "), log: " + Path.Combine(Path.Combine(folder, "logs"), "bot.log"));
            }
            catch (Exception e)
            {
                log.Error("Bot autostart failed: " + e.Message);
            }
        }

        static bool AlreadyRunning(string pidFile)
        {
            try
            {
                if (!File.Exists(pidFile)) return false;
                if ((DateTime.UtcNow - File.GetLastWriteTimeUtc(pidFile)).TotalSeconds > 90) return false;
                string text = File.ReadAllText(pidFile).Trim();
                int pid;
                if (!int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out pid)) return false;
                Process p = Process.GetProcessById(pid);
                return !p.HasExited;
            }
            catch (Exception)
            {
                return false;
            }
        }

        static string FindNode(string folder)
        {
            string local = Path.Combine(Path.Combine(folder, "node"), "node.exe");
            if (File.Exists(local)) return local;
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in path.Split(Path.PathSeparator))
            {
                string d = dir.Trim().Trim('"');
                if (d.Length == 0) continue;
                try
                {
                    string candidate = Path.Combine(d, "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch (Exception)
                {
                }
            }
            string programFiles = Environment.GetEnvironmentVariable("ProgramFiles");
            if (!string.IsNullOrEmpty(programFiles))
            {
                string standard = Path.Combine(Path.Combine(programFiles, "nodejs"), "node.exe");
                if (File.Exists(standard)) return standard;
            }
            return null;
        }
    }
}
