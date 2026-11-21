using System;
using System.Collections.Generic;
using System.Reflection;
using Alta.Global;
using Alta.Networking;
using HarmonyLib;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using AltaStream = Alta.Serialization.Stream;

namespace BotCore.Client
{
    internal static class Wire
    {
        internal const int Type = 155;
        internal const uint Version = 1;
        internal const uint Hello = 1;
        internal const uint Ask = 2;
        internal const uint Menu = 1;
        internal const uint Answer = 2;
        internal const int MaxChars = 900;

        static ConnectionChannel _channel;
        static bool _resolved;

        static void Codec(AltaStream s, ref uint ver, ref uint kind, ref string payload)
        {
            s.SerializeBits(ref ver, 8);
            s.SerializeBits(ref kind, 8);
            s.SerializeString(ref payload, AltaStream.StringEncoding.UTF8);
        }

        internal static bool Send(Connection c, uint kind, string payload)
        {
            if (c == null || payload == null || payload.Length > MaxChars) return false;
            Channel();
            uint ver = Version, k = kind;
            string p = payload;
            try { return c.Send(_channel, (MessageType)Type, delegate(Connection x, AltaStream s) { Codec(s, ref ver, ref k, ref p); }); }
            catch (Exception e)
            {
                Mod.Warn("send", "Sending to the server failed: " + e.Message);
                return false;
            }
        }

        internal static bool Read(AltaStream s, out uint kind, out string payload)
        {
            uint ver = 0, k = 0;
            string p = null;
            kind = 0;
            payload = null;
            try { Codec(s, ref ver, ref k, ref p); }
            catch (Exception) { return false; }
            if (ver != Version || p == null || p.Length > MaxChars) return false;
            kind = k;
            payload = p;
            return true;
        }

        static void Channel()
        {
            if (_resolved) return;
            _resolved = true;
            try
            {
                ConnectionChannel best = null;
                foreach (ConnectionChannel ch in GlobalSettings<NetworkingSettings>.Instance.Channels)
                {
                    if (ch == null || !ch.IsReliable) continue;
                    if (best == null || ch.MaximumSendInterval < best.MaximumSendInterval) best = ch;
                }
                _channel = best;
            }
            catch (Exception e) { Mod.Warn("channel", "No reliable channel found, the default is used: " + e.Message); }
        }

        internal static bool Wide(out string detail)
        {
            try
            {
                Type reader = AccessTools.TypeByName("Alta.Networking.Internal.MessageProcessor");
                Type writer = AccessTools.TypeByName("Alta.Networking.Internal.OutgoingPacketManager");
                MethodBase read = reader == null ? null : AccessTools.Method(reader, "ProcessSingleMessageFromData",
                    new Type[] { typeof(Connection), typeof(ArraySegment<byte>), typeof(ConnectionChannel), typeof(MessageType).MakeByRefType() });
                MethodBase write = writer == null ? null : AccessTools.Method(writer, "StartSerialize", new Type[] { typeof(Connection), typeof(MessageType) });
                if (read == null || write == null)
                {
                    detail = "the game's message " + (read == null ? "reader" : "writer") + " was not found";
                    return false;
                }
                Patches r = HarmonyLib.Harmony.GetPatchInfo(read), w = HarmonyLib.Harmony.GetPatchInfo(write);
                if (r == null || r.Prefixes.Count == 0 || w == null || w.Prefixes.Count == 0)
                {
                    detail = "TavernLib's 8-bit message types are not patched in";
                    return false;
                }
                detail = "";
                return true;
            }
            catch (Exception e)
            {
                detail = "the check failed: " + e.Message;
                return false;
            }
        }
    }

    internal sealed class Menu
    {
        internal string Name = "";
        internal int V;
        internal bool Bot;
        internal List<string> Pages = new List<string>();

        internal string Title
        {
            get { return Name.Length > 0 ? Name + " Menu" : "Bot Menu"; }
        }
    }

    internal static class Net
    {
        const float AnswerSeconds = 40f;

        sealed class Waiter
        {
            internal Action<JObject> Done;
            internal float Until;
        }

        static readonly object Gate = new object();
        static readonly Queue<KeyValuePair<uint, string>> Inbox = new Queue<KeyValuePair<uint, string>>();
        static readonly Dictionary<int, Waiter> Waiters = new Dictionary<int, Waiter>();

        static Connection _server;
        static PlayerController _staleAtConnect;
        static float _connectedAt;
        static float _nextHello;
        static int _hellos;
        static int _nextId = 1;

        internal static Menu Current;

        internal static bool Busy
        {
            get { return Waiters.Count > 0; }
        }

        internal static void OnConnection(Connection c)
        {
            if (c == null) return;
            _server = c;
            Current = null;
            _hellos = 0;
            _nextHello = 0f;
            _staleAtConnect = PlayerController.Current;
            _connectedAt = Time.realtimeSinceStartup;
            lock (Gate) Inbox.Clear();
            Fail("The connection to the server changed.");
            c.SetHandler((MessageType)Wire.Type, Receive);
            c.Disconnected += OnDisconnected;
        }

        static void OnDisconnected(Connection c)
        {
            if (c != _server) return;
            _server = null;
            Current = null;
        }

        static void Receive(Connection c, AltaStream s)
        {
            uint kind;
            string payload;
            if (c != _server || !Wire.Read(s, out kind, out payload)) return;
            lock (Gate)
            {
                if (Inbox.Count < 128) Inbox.Enqueue(new KeyValuePair<uint, string>(kind, payload));
            }
        }

        static bool Spawned(float now)
        {
            PlayerController pc = PlayerController.Current;
            if (pc == null || _server == null || !pc.IsLocalPlayer) return false;
            return !ReferenceEquals(pc, _staleAtConnect) || now - _connectedAt > 45f;
        }

        internal static void Tick()
        {
            float now = Time.realtimeSinceStartup;
            List<KeyValuePair<uint, string>> got = new List<KeyValuePair<uint, string>>();
            lock (Gate)
            {
                while (Inbox.Count > 0) got.Add(Inbox.Dequeue());
            }
            foreach (KeyValuePair<uint, string> m in got)
            {
                if (m.Key == Wire.Menu) OnMenu(m.Value);
                else if (m.Key == Wire.Answer) OnAnswer(m.Value);
            }
            if (Current == null && _server != null && _hellos < 3 && now >= _nextHello && Spawned(now))
            {
                _hellos++;
                _nextHello = now + 6f;
                Wire.Send(_server, Wire.Hello, Mod.Version);
            }
            if (Waiters.Count == 0) return;
            List<int> late = null;
            foreach (KeyValuePair<int, Waiter> kv in Waiters)
                if (now > kv.Value.Until) (late ?? (late = new List<int>())).Add(kv.Key);
            if (late == null) return;
            foreach (int id in late) Finish(id, Failure("No answer came from the server."));
        }

        static void OnMenu(string json)
        {
            try
            {
                JObject o = JObject.Parse(json);
                Menu m = new Menu();
                m.Name = Mod.Clean((string)o["name"] ?? "", 32);
                m.Bot = (bool?)o["bot"] ?? false;
                m.V = (int?)o["v"] ?? 1;
                JArray pages = o["pages"] as JArray;
                if (pages != null)
                    foreach (JToken p in pages)
                    {
                        string page = Mod.Clean((string)p ?? "", 16);
                        if (page.Length > 0 && m.Pages.Count < 16 && !m.Pages.Contains(page)) m.Pages.Add(page);
                    }
                bool first = Current == null;
                Current = m;
                if (first) Mod.Log.Msg("This server has BotCore.Server: " + (m.Pages.Count > 0 ? "pages " + string.Join(", ", m.Pages.ToArray()) : "no pages for you") + (m.Bot ? "" : ", the bot is not connected") + ".");
                BotTablet.MenuChanged();
            }
            catch (Exception e) { Mod.Warn("menu", "The server's menu could not be read: " + e.Message); }
        }

        static void OnAnswer(string json)
        {
            JObject o;
            try { o = JObject.Parse(json); }
            catch (Exception) { return; }
            int id;
            try { id = (int)o["id"]; }
            catch (Exception) { return; }
            Finish(id, o);
        }

        static void Finish(int id, JObject o)
        {
            Waiter w;
            if (!Waiters.TryGetValue(id, out w)) return;
            Waiters.Remove(id);
            try { w.Done(o); }
            catch (Exception e) { Mod.Log.Error("A tablet answer could not be shown: " + e); }
        }

        static void Fail(string text)
        {
            foreach (int id in new List<int>(Waiters.Keys)) Finish(id, Failure(text));
        }

        internal static JObject Failure(string text)
        {
            JObject o = new JObject();
            o["ok"] = false;
            o["text"] = text;
            return o;
        }

        internal static void Ask(string route, int at, int n, Action<JObject> done)
        {
            if (_server == null || Current == null)
            {
                done(Failure("This server has no bot tablet."));
                return;
            }
            int id = _nextId++;
            JObject o = new JObject();
            o["id"] = id;
            o["go"] = route ?? "";
            o["at"] = at;
            o["n"] = n;
            string json = o.ToString(Formatting.None);
            if (json.Length > Wire.MaxChars || !Wire.Send(_server, Wire.Ask, json))
            {
                done(Failure("The request could not be sent."));
                return;
            }
            Waiters[id] = new Waiter { Done = done, Until = Time.realtimeSinceStartup + AnswerSeconds };
        }
    }
}
