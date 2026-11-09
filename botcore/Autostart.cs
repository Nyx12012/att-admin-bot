using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using MelonLoader;

namespace BotCore
{
    public static class Autostart
    {
        const string NodeVersion = "v24.22.2";
        const string NodeSha256 = "ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2";
        const string NodeUrl = "https://nodejs.org/dist/" + NodeVersion + "/node-" + NodeVersion + "-win-x64.zip";
        const int StepMs = 15 * 60 * 1000;
        static readonly string[] SettingsNames = { ".env", ".env.txt", "env", "env.txt" };

        public static void Run(string userData, MelonLogger.Instance log)
        {
            int serverPid = Process.GetCurrentProcess().Id;
            Thread worker = new Thread(delegate() { Work(userData, serverPid, log); });
            worker.IsBackground = true;
            worker.Name = "BotCore autostart";
            worker.SetApartmentState(ApartmentState.STA);
            worker.Start();
        }

        static void Work(string userData, int serverPid, MelonLogger.Instance log)
        {
            try
            {
                List<string> found = FindBots(userData);
                if (found.Count == 0) return;
                string off = Sub(Sub(userData, "BotCore"), "autostart-off.txt");
                if (File.Exists(off))
                {
                    log.Msg("Bot autostart is off because " + off + " exists");
                    return;
                }
                if (AnyRunning(found, log)) return;
                string folder = Pick(found, log);
                WaitForEarlierSetup(folder, log);
                string node = FindNode(folder);
                if (node == null) node = DownloadNode(folder, log);
                if (node == null) return;
                if (!Installed(folder) && !Install(folder, node, log)) return;
                if (AnyRunning(found, log)) return;
                Start(folder, node, serverPid, log);
            }
            catch (Exception e)
            {
                log.Error("Bot autostart failed: " + e.Message + ". It is tried again at the next server start");
            }
        }

        static string Sub(string a, string b)
        {
            return Path.Combine(a, b);
        }

        static bool IsBot(string dir)
        {
            try
            {
                if (!File.Exists(Sub(Sub(dir, "src"), "index.js"))) return false;
                string package = Sub(dir, "package.json");
                return File.Exists(package) && Regex.IsMatch(File.ReadAllText(package), "\"name\"\\s*:\\s*\"att-admin-bot\"");
            }
            catch (Exception)
            {
                return false;
            }
        }

        static string[] Folders(string dir)
        {
            try
            {
                return Directory.GetDirectories(dir);
            }
            catch (Exception)
            {
                return new string[0];
            }
        }

        static List<string> FindBots(string userData)
        {
            List<string> found = new List<string>();
            foreach (string dir in Folders(userData))
            {
                if (IsBot(dir))
                {
                    found.Add(dir);
                    continue;
                }
                foreach (string inner in Folders(dir))
                {
                    if (IsBot(inner)) found.Add(inner);
                }
            }
            return found;
        }

        static bool HasSettings(string folder)
        {
            foreach (string name in SettingsNames)
            {
                if (File.Exists(Sub(folder, name))) return true;
            }
            return false;
        }

        static DateTime LastUsed(string folder)
        {
            string data = Sub(folder, "data");
            return Directory.Exists(data) ? Directory.GetLastWriteTimeUtc(data) : DateTime.MinValue;
        }

        static int Better(string a, string b)
        {
            int settings = HasSettings(b).CompareTo(HasSettings(a));
            if (settings != 0) return settings;
            int used = LastUsed(b).CompareTo(LastUsed(a));
            return used != 0 ? used : string.CompareOrdinal(a, b);
        }

        static string Pick(List<string> found, MelonLogger.Instance log)
        {
            if (found.Count == 1) return found[0];
            found.Sort(Better);
            string why = HasSettings(found[0]) ? "it has the settings file and was used last" : "none has a settings file yet and it was used last";
            log.Msg("Found " + found.Count.ToString(CultureInfo.InvariantCulture) + " copies of the Discord bot: " + string.Join(", ", found.ToArray()) + ". Using " + found[0] + " because " + why + ". Balances live in each copy's data folder");
            return found[0];
        }

        static bool AnyRunning(List<string> found, MelonLogger.Instance log)
        {
            foreach (string folder in found)
            {
                if (AlreadyRunning(Sub(Sub(folder, "data"), "bot.pid")))
                {
                    log.Msg("The Discord bot is already running from " + folder + ", not starting a second copy");
                    return true;
                }
            }
            return false;
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

        static string LogsDir(string folder)
        {
            string logs = Sub(folder, "logs");
            Directory.CreateDirectory(logs);
            return logs;
        }

        static string JobFile(string folder)
        {
            return Sub(LogsDir(folder), "setup.pid");
        }

        static void WaitForEarlierSetup(string folder, MelonLogger.Instance log)
        {
            try
            {
                string file = JobFile(folder);
                if (!File.Exists(file)) return;
                int pid = int.Parse(File.ReadAllText(file).Trim(), CultureInfo.InvariantCulture);
                Process p = Process.GetProcessById(pid);
                if (!string.Equals(p.ProcessName, "cmd", StringComparison.OrdinalIgnoreCase)) return;
                log.Msg("The bot's setup from the last server start is still running, waiting for it");
                p.WaitForExit(StepMs);
            }
            catch (Exception)
            {
            }
        }

        static string Comspec()
        {
            string comspec = Environment.GetEnvironmentVariable("ComSpec");
            return string.IsNullOrEmpty(comspec) ? "cmd.exe" : comspec;
        }

        static void EndTree(int pid)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("taskkill.exe", "/T /F /PID " + pid.ToString(CultureInfo.InvariantCulture));
                psi.UseShellExecute = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                using (Process p = Process.Start(psi)) p.WaitForExit(30000);
            }
            catch (Exception)
            {
            }
        }

        static int Step(string folder, string commandLine)
        {
            string output = Sub(LogsDir(folder), "install.log");
            string arguments = "/d /s /c \"" + commandLine + " >> \"" + output + "\" 2>&1\"";
            ProcessStartInfo psi = new ProcessStartInfo(Comspec(), arguments);
            psi.WorkingDirectory = folder;
            psi.UseShellExecute = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            string job = JobFile(folder);
            using (Process p = Process.Start(psi))
            {
                File.WriteAllText(job, p.Id.ToString(CultureInfo.InvariantCulture));
                if (!p.WaitForExit(StepMs))
                {
                    EndTree(p.Id);
                    File.Delete(job);
                    return -1;
                }
                int code = p.ExitCode;
                File.Delete(job);
                return code;
            }
        }

        static string LastLine(string folder)
        {
            try
            {
                string[] lines = File.ReadAllLines(Sub(LogsDir(folder), "install.log"));
                for (int i = lines.Length - 1; i >= 0; i--)
                {
                    if (lines[i].Trim().Length > 0) return " Last line: " + lines[i].Trim();
                }
            }
            catch (Exception)
            {
            }
            return "";
        }

        static bool Failed(string folder, string what, int code, MelonLogger.Instance log)
        {
            string how = code == -1 ? "it ran out of time" : "exit code " + code.ToString(CultureInfo.InvariantCulture);
            log.Error("Bot autostart: " + what + " failed (" + how + "), see " + Sub(LogsDir(folder), "install.log") + "." + LastLine(folder) + " It is tried again at the next server start");
            return false;
        }

        static string HashOf(string file)
        {
            using (SHA256 sha = SHA256.Create())
            using (FileStream stream = File.OpenRead(file))
            {
                StringBuilder text = new StringBuilder();
                foreach (byte b in sha.ComputeHash(stream)) text.Append(b.ToString("x2", CultureInfo.InvariantCulture));
                return text.ToString();
            }
        }

        static string DownloadNode(string folder, MelonLogger.Instance log)
        {
            string system = Sub(Environment.GetEnvironmentVariable("WINDIR") ?? "C:\\Windows", "System32");
            string curl = Sub(system, "curl.exe");
            string tar = Sub(system, "tar.exe");
            string target = Sub(folder, "node");
            if (!File.Exists(curl) || !File.Exists(tar))
            {
                log.Error("Bot autostart: Node.js was not found and this Windows has no curl.exe or tar.exe to fetch it. Install Node.js from https://nodejs.org or put node.exe in " + target);
                return null;
            }
            if (Directory.Exists(target) && (Directory.GetFiles(target).Length > 0 || Directory.GetDirectories(target).Length > 0))
            {
                log.Error("Bot autostart: " + target + " has files in it but no node.exe. Empty that folder so Node.js can be downloaded into it");
                return null;
            }
            string part = Sub(folder, "node.part");
            if (Directory.Exists(part)) Directory.Delete(part, true);
            Directory.CreateDirectory(part);
            string zip = Sub(part, "node.zip");
            string unpacked = Sub(part, "node");
            Directory.CreateDirectory(unpacked);
            log.Msg("Node.js was not found, downloading " + NodeVersion + " from nodejs.org into " + target);
            int code = Step(folder, "\"" + curl + "\" -fsSL --retry 3 --connect-timeout 30 -o \"" + zip + "\" " + NodeUrl);
            if (code != 0)
            {
                Failed(folder, "downloading Node.js", code, log);
                return null;
            }
            string hash = HashOf(zip);
            if (hash != NodeSha256)
            {
                File.Delete(zip);
                log.Error("Bot autostart: the Node.js download does not match its known SHA-256 (got " + hash + "), so it was thrown away and not run. It is tried again at the next server start");
                return null;
            }
            code = Step(folder, "\"" + tar + "\" -xf \"" + zip + "\" -C \"" + unpacked + "\" --strip-components=1");
            if (code != 0)
            {
                Failed(folder, "unpacking Node.js", code, log);
                return null;
            }
            if (!File.Exists(Sub(unpacked, "node.exe")))
            {
                log.Error("Bot autostart: the Node.js zip held no node.exe. It is tried again at the next server start");
                return null;
            }
            if (Directory.Exists(target)) Directory.Delete(target);
            Directory.Move(unpacked, target);
            Directory.Delete(part, true);
            log.Msg("Node.js " + NodeVersion + " is ready in " + target + ", SHA-256 checked");
            return Sub(target, "node.exe");
        }

        static string FinishedMark(string folder)
        {
            return Sub(Sub(folder, "node_modules"), ".package-lock.json");
        }

        static bool Installed(string folder)
        {
            return File.Exists(FinishedMark(folder));
        }

        static bool Install(string folder, string node, MelonLogger.Instance log)
        {
            string dir = Path.GetDirectoryName(node);
            string npm = Sub(dir, "npm.cmd");
            if (!File.Exists(npm))
            {
                log.Error("Bot autostart: npm.cmd was not found beside " + node + ". Install Node.js from https://nodejs.org, or run start.bat in " + folder);
                return false;
            }
            string modules = Sub(folder, "node_modules");
            if (Directory.Exists(modules))
            {
                log.Msg("Removing the bot's unfinished package install");
                Directory.Delete(modules, true);
            }
            log.Msg("Installing the Discord bot's packages in " + folder + ". This takes about a minute and the server does not wait for it");
            int code = Step(folder, "set \"PATH=" + dir + ";%PATH%\" && \"" + npm + "\" install --omit=dev --no-fund --no-audit");
            if (code != 0) return Failed(folder, "npm install", code, log);
            if (!Installed(folder)) return Failed(folder, "npm install finished without its lock file, so the install", code, log);
            log.Msg("The Discord bot's packages are installed");
            return true;
        }

        static void Start(string folder, string node, int serverPid, MelonLogger.Instance log)
        {
            ProcessStartInfo psi = new ProcessStartInfo(node, "src\\index.js --server-pid " + serverPid.ToString(CultureInfo.InvariantCulture));
            psi.WorkingDirectory = folder;
            psi.UseShellExecute = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            Process started = Process.Start(psi);
            log.Msg("Started the Discord bot (pid " + started.Id.ToString(CultureInfo.InvariantCulture) + ") from " + folder + ", log: " + Sub(Sub(folder, "logs"), "bot.log"));
        }

        static string FindNode(string folder)
        {
            string local = Sub(Sub(folder, "node"), "node.exe");
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
                string standard = Sub(Sub(programFiles, "nodejs"), "node.exe");
                if (File.Exists(standard)) return standard;
            }
            return null;
        }
    }
}
