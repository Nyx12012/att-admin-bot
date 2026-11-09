using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using Alta.Console;
using MelonLoader;

[assembly: MelonInfo(typeof(BotCore.Entry), "BotCore", BotCore.Entry.Version, "ATT Admin Bot")]
[assembly: MelonGame(null, null)]
[assembly: RuntimeCompatibility(WrapNonExceptionThrows = true)]

namespace BotCore
{
    public class Entry : MelonMod
    {
        public const string Version = "1.4.0";

        bool _registered;

        public override void OnInitializeMelon()
        {
            MelonEvents.OnApplicationLateStart.Subscribe(Boot, 0, false);
        }

        void Boot()
        {
            MelonLogger.Instance log = LoggerInstance;
            try
            {
                string modsDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                string userData = Path.Combine(Directory.GetParent(modsDir).FullName, "UserData");
                BotCoreCommands.Sweep.ProtectFilePath = Path.Combine(Path.Combine(userData, "BotCore"), "sweep-protect.txt");

                RecordLaunch(userData, log);
                Resolver.Apply(log);
                Autostart.Run(userData, log);

                int count = RegisterCommands();
                _registered = count > 0;
                if (count == 0)
                {
                    log.Error("BotCore " + Version + ": the console did not accept the botcore module, no commands ready");
                    return;
                }
                log.Msg("BotCore " + Version + ": " + count + " commands ready");
            }
            catch (Exception e)
            {
                log.Error("BotCore " + Version + " failed to start: " + e);
            }
        }

        static void RecordLaunch(string userData, MelonLogger.Instance log)
        {
            try
            {
                string[] args = Environment.GetCommandLineArgs();
                if (Array.IndexOf(args, "/start_server") < 0) return;
                string dir = Path.Combine(userData, "BotCore");
                Directory.CreateDirectory(dir);
                string file = Path.Combine(dir, "server-start.txt");
                List<string> lines = new List<string>();
                Process self = Process.GetCurrentProcess();
                lines.Add(self.Id.ToString());
                lines.Add(self.MainModule.FileName);
                lines.Add(Environment.CurrentDirectory);
                for (int i = 1; i < args.Length; i++) lines.Add(args[i]);
                File.WriteAllLines(file, lines.ToArray());
                BotCoreCommands.LaunchFile = file;
            }
            catch (Exception e)
            {
                log.Warning("BotCore could not record how this server was started, so /boot needs SERVER_START: " + e.Message);
            }
        }

        static int RegisterCommands()
        {
            Assembly asm = typeof(Entry).Assembly;
            CommandService.CommandCollection.Collect(asm);
            foreach (Alta.Console.Module m in CommandService.CommandCollection.Modules)
            {
                if (m.Assembly == asm && m.Name == "botcore") return CountCommands(m);
            }
            return 0;
        }

        static int CountCommands(Alta.Console.Module m)
        {
            int n = m.Commands.Count;
            foreach (Alta.Console.Module sub in m.Submodules) n += CountCommands(sub);
            return n;
        }

        public override void OnApplicationQuit()
        {
            if (!_registered) return;
            try { CommandService.CommandCollection.Unload(typeof(Entry).Assembly); }
            catch (Exception) { }
        }
    }
}
