using System;
using System.Collections.Generic;
using System.Reflection;
using Alta.Networking;
using Alta.Networking.Servers;
using Alta.QuickAccessActions;
using HarmonyLib;
using MelonLoader;
using UnityEngine;

[assembly: MelonInfo(typeof(BotCore.Client.Mod), "BotCore.Client", BotCore.Client.Mod.Version, "ATT Admin Bot")]
[assembly: MelonGame("Alta", "A Township Tale")]

namespace BotCore.Client
{
    public class Mod : MelonMod
    {
        public const string Version = "1.6.0";
        internal static MelonLogger.Instance Log;

        static readonly Dictionary<string, float> quietUntil = new Dictionary<string, float>();
        bool _on;

        public override void OnInitializeMelon()
        {
            Log = LoggerInstance;
            try
            {
                if (ApplicationManager.IsHeadless || CommandLineArguments.Contains(CommandLineArguments.StartServerArgument))
                {
                    Log.Msg("This is a server, so the client half does nothing here. Servers need BotCore.Server.dll.");
                    return;
                }
                string detail;
                if (!Wire.Wide(out detail))
                {
                    Log.Warning("The bot tablet is off: " + detail + ". Update TavernLib.");
                    return;
                }
                _on = Hooks.Apply(HarmonyInstance);
                if (_on) Log.Msg("BotCore.Client " + Version + " ready: the bot bubble shows on servers with BotCore.Server 1.6.0 or newer.");
            }
            catch (Exception e)
            {
                Log.Error("BotCore.Client could not start: " + e);
            }
        }

        public override void OnUpdate()
        {
            if (!_on) return;
            Step("network", Net.Tick);
            Step("tablet", BotTablet.Tick);
        }

        static void Step(string name, Action a)
        {
            try { a(); }
            catch (Exception e) { Warn(name, "The " + name + " step failed: " + e); }
        }

        internal static void Warn(string key, string msg)
        {
            float now = Time.unscaledTime;
            float until;
            if (quietUntil.TryGetValue(key, out until) && now < until) return;
            quietUntil[key] = now + 10f;
            Log.Warning(msg);
        }

        internal static void Say(string msg)
        {
            if (string.IsNullOrEmpty(msg)) return;
            if (BotTablet.Flash(msg)) return;
            try
            {
                PlayerController pc = PlayerController.Current;
                if (pc != null && pc.MessageDisplay != null) pc.MessageDisplay.Display(msg, 3f);
            }
            catch (Exception) { }
        }

        internal static string Clean(string s, int max)
        {
            if (string.IsNullOrEmpty(s)) return "";
            s = s.Replace('\\', '/').Replace('\n', ' ').Replace('\r', ' ').Replace('\t', ' ')
                .Replace('[', '(').Replace(']', ')').Replace('<', '(').Replace('>', ')').Replace('{', '(').Replace('}', ')').Trim();
            if (s.Length > max) s = s.Substring(0, max - 1) + ".";
            return s;
        }

        internal static List<string> Wrap(string text, int width)
        {
            List<string> lines = new List<string>();
            foreach (string para in (text ?? "").Replace("\r", "").Split('\n'))
            {
                string line = "";
                foreach (string word in para.Split(' '))
                {
                    if (word.Length == 0) continue;
                    string w = word.Length > width ? word.Substring(0, width) : word;
                    if (line.Length == 0) line = w;
                    else if (line.Length + 1 + w.Length <= width) line += " " + w;
                    else { lines.Add(line); line = w; }
                }
                if (line.Length > 0) lines.Add(line);
            }
            return lines;
        }
    }

    internal static class Hooks
    {
        internal static bool Apply(HarmonyLib.Harmony h)
        {
            bool ok = Patch(h, AccessTools.Method(typeof(ConnectToServerUtility), "SetupConnectionToServer", new Type[] { typeof(Connection) }), null, "Connected", "the game connection")
                & Patch(h, AccessTools.Method(typeof(QuickAccessMenuController), "InitializeControllerExtension"), null, "WheelUp", "the wheel");
            bool tablet = Patch(h, AccessTools.Method(typeof(SocialTablet), "StartupForLocalPlayer"), null, "TabletUp", "the tablet start")
                & Patch(h, AccessTools.Method(typeof(Alta.Meta.UI.Window), "SwitchToPanel", new Type[] { typeof(Alta.Meta.UI.Panel) }), "TabletSwitch", null, "the tablet page switch")
                & Patch(h, AccessTools.Method(typeof(Alta.Meta.UI.Window), "FinishSwitch"), "TabletFinish", null, "the tablet page landing");
            if (!tablet) Mod.Log.Warning("The tablet pages could not hook in, so the bot bubble stays off.");
            return ok && tablet;
        }

        static bool Patch(HarmonyLib.Harmony h, MethodInfo target, string prefix, string postfix, string label)
        {
            try
            {
                if (target == null) throw new MissingMethodException(label + " was not found");
                HarmonyMethod pre = prefix == null ? null : new HarmonyMethod(typeof(Hooks).GetMethod(prefix, BindingFlags.NonPublic | BindingFlags.Static));
                HarmonyMethod post = postfix == null ? null : new HarmonyMethod(typeof(Hooks).GetMethod(postfix, BindingFlags.NonPublic | BindingFlags.Static));
                h.Patch(target, pre, post);
                return true;
            }
            catch (Exception e)
            {
                Mod.Log.Error("Could not hook " + label + ": " + e.Message);
                return false;
            }
        }

        static void Connected(Connection connection)
        {
            try { Net.OnConnection(connection); }
            catch (Exception e) { Mod.Log.Error("Connection set-up failed: " + e.Message); }
        }

        static void WheelUp(QuickAccessMenuController __instance)
        {
            try { Bubble.Inject(__instance); }
            catch (Exception e) { Mod.Log.Error("The bot bubble could not join the wheel: " + e.Message); }
        }

        static void TabletUp(SocialTablet __instance)
        {
            try { BotTablet.OnStartup(__instance); }
            catch (Exception e) { Mod.Log.Error("The bot page could not join the tablet: " + e); }
        }

        static bool TabletSwitch(Alta.Meta.UI.Window __instance, ref Alta.Meta.UI.Panel panel)
        {
            try { return BotTablet.RedirectSwitch(__instance, ref panel); }
            catch (Exception e) { Mod.Warn("switch", "Tablet page switch failed: " + e.Message); return true; }
        }

        static bool TabletFinish(Alta.Meta.UI.Window __instance, ref Alta.Meta.UI.Panel panel)
        {
            try { return BotTablet.RedirectFinish(__instance, ref panel); }
            catch (Exception e) { Mod.Warn("finish", "Tablet page landing failed: " + e.Message); return true; }
        }
    }
}
