using System;
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
        public const string Version = "1.1.0";

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
