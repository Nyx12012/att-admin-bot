using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using Alta.Console;
using Alta.Global;
using Alta.Networking;
using HarmonyLib;
using MelonLoader;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using AltaStream = Alta.Serialization.Stream;

namespace BotCore
{
    public sealed class TabletAsk
    {
        [JsonProperty("id")]
        public int Id { get; set; }

        [JsonProperty("player")]
        public string Player { get; set; }

        [JsonProperty("pages")]
        public string[] Pages { get; set; }

        [JsonProperty("roles")]
        public string[] Roles { get; set; }

        [JsonProperty("ask")]
        public string Ask { get; set; }
    }

    public static class TabletWire
    {
        public const int Type = 155;
        public const uint Version = 1;
        public const uint Hello = 1;
        public const uint Ask = 2;
        public const uint Menu = 1;
        public const uint Answer = 2;
        public const int MaxChars = 900;

        static ConnectionChannel _channel;
        static bool _resolved;

        public static void Codec(AltaStream s, ref uint ver, ref uint kind, ref string payload)
        {
            s.SerializeBits(ref ver, 8);
            s.SerializeBits(ref kind, 8);
            s.SerializeString(ref payload, AltaStream.StringEncoding.UTF8);
        }

        public static bool Send(Connection c, uint kind, string payload)
        {
            if (c == null || payload == null || payload.Length > MaxChars) return false;
            Channel();
            uint ver = Version, k = kind;
            string p = payload;
            return c.Send(_channel, (MessageType)Type, delegate(Connection x, AltaStream s) { Codec(s, ref ver, ref k, ref p); });
        }

        public static bool Read(AltaStream s, out uint kind, out string payload)
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
            ConnectionChannel best = null;
            foreach (ConnectionChannel ch in GlobalSettings<NetworkingSettings>.Instance.Channels)
            {
                if (ch == null || !ch.IsReliable) continue;
                if (best == null || ch.MaximumSendInterval < best.MaximumSendInterval) best = ch;
            }
            _channel = best;
        }

        public static bool Wide(out string detail)
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

    public static class TabletHost
    {
        static readonly string[] Order = new string[] { "shop", "sell", "me", "plots", "actions", "players", "spawn", "cleanup", "server", "commands" };
        const int RouteMax = 400;
        const string UpdateClient = "Update BotCore.Client to 1.6: github.com/Nyx12012/att-admin-bot/releases";
        const float TimeoutSeconds = 30f;
        const float SweepSeconds = 2f;
        const float PingSeconds = 5f;
        static readonly TabletAsk Ping = new TabletAsk { Id = -1, Player = "", Pages = new string[0], Roles = new string[0], Ask = "" };

        sealed class Client
        {
            public bool Hello;
            public bool Routes;
            public string Sent;
            public int Waiting;
            public float Tokens = 5f;
            public float TokensAt;
        }

        sealed class Pending
        {
            public Connection Conn;
            public int ClientId;
            public float Until;
        }

        sealed class Inbound
        {
            public Connection Conn;
            public uint Kind;
            public string Payload;
        }

        static readonly object Gate = new object();
        static readonly Queue<Inbound> Inbox = new Queue<Inbound>();
        static readonly Queue<KeyValuePair<int, string>> Replies = new Queue<KeyValuePair<int, string>>();
        static readonly Dictionary<Connection, Client> Clients = new Dictionary<Connection, Client>();
        static readonly Dictionary<int, Pending> Waiting = new Dictionary<int, Pending>();
        static readonly List<Connection> Joined = new List<Connection>();
        static readonly List<Connection> Left = new List<Connection>();
        static bool _socketGone;

        static MelonLogger.Instance _log;
        static ConsoleEvent<TabletAsk> _event;
        static bool _on;
        static ISocket _socket;
        static float _nextAttach;
        static float _nextSweep;
        static float _nextPing;
        static int _nextId = 1;
        static string _botName;
        static string _config;
        static DateTime _configStamp;
        static Dictionary<string, List<string>> _rules = Defaults();
        static MethodInfo _getRoles;

        public static bool On
        {
            get { return _on; }
        }

        public static void Start(string userData, MelonLogger.Instance log)
        {
            _log = log;
            try
            {
                string detail;
                if (!TabletWire.Wide(out detail))
                {
                    log.Warning("The in-game bot tablet is off: " + detail + ". Update TavernLib.");
                    return;
                }
                _event = new ConsoleEvent<TabletAsk>("BotCoreTablet");
                string dir = Path.Combine(userData, "BotCore");
                Directory.CreateDirectory(dir);
                _config = Path.Combine(dir, "tablet.txt");
                if (!File.Exists(_config)) File.WriteAllText(_config, DefaultText());
                LoadRules(true);
                _getRoles = FindRoles();
                if (_getRoles == null) log.Warning("TavernLib's roles API was not found, so only tablet pages set to everyone show. Update TavernLib to 1.5.3 or newer.");
                _on = true;
                log.Msg("The in-game bot tablet is on (message " + TabletWire.Type + "). Who sees which page: " + _config);
            }
            catch (Exception e)
            {
                log.Error("The in-game bot tablet could not start: " + e.Message);
            }
        }

        static string DefaultText()
        {
            return "# Who sees each page of the in-game bot tablet. Use everyone, nobody, or role names from the\r\n"
                + "# Server launcher's Edit Roles, split by commas. Saved changes apply within a few seconds.\r\n"
                + "# Players, spawn, cleanup and server: what is on them works for anyone who sees them.\r\n"
                + "# Commands: every bot command, with the same rules as on Discord.\r\n"
                + "shop = everyone\r\nsell = everyone\r\nme = everyone\r\nplots = everyone\r\nactions = everyone\r\n"
                + "players = owner, admin, moderator\r\nspawn = owner\r\ncleanup = owner, admin, moderator\r\n"
                + "server = owner, admin\r\ncommands = owner, admin\r\n";
        }

        static Dictionary<string, List<string>> Defaults()
        {
            Dictionary<string, List<string>> d = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
            d["shop"] = new List<string> { "everyone" };
            d["sell"] = new List<string> { "everyone" };
            d["me"] = new List<string> { "everyone" };
            d["plots"] = new List<string> { "everyone" };
            d["actions"] = new List<string> { "everyone" };
            d["players"] = new List<string> { "owner", "admin", "moderator" };
            d["spawn"] = new List<string> { "owner" };
            d["cleanup"] = new List<string> { "owner", "admin", "moderator" };
            d["server"] = new List<string> { "owner", "admin" };
            d["commands"] = new List<string> { "owner", "admin" };
            return d;
        }

        public static Dictionary<string, List<string>> ParseRules(string text)
        {
            Dictionary<string, List<string>> d = Defaults();
            foreach (string raw in (text ?? "").Split('\n'))
            {
                string line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                int eq = line.IndexOf('=');
                if (eq <= 0) continue;
                string page = line.Substring(0, eq).Trim().ToLowerInvariant();
                if (page == "admin") page = "players";
                if (Array.IndexOf(Order, page) < 0) continue;
                List<string> roles = new List<string>();
                foreach (string part in line.Substring(eq + 1).Split(','))
                {
                    string r = part.Trim().ToLowerInvariant();
                    if (r.Length > 0 && !roles.Contains(r)) roles.Add(r);
                }
                d[page] = roles;
            }
            return d;
        }

        static void LoadRules(bool first)
        {
            try
            {
                DateTime stamp = File.GetLastWriteTimeUtc(_config);
                if (!first && stamp == _configStamp) return;
                _configStamp = stamp;
                _rules = ParseRules(File.ReadAllText(_config));
                if (!first) _log.Msg("Tablet pages reloaded from " + _config);
            }
            catch (Exception e)
            {
                if (first) _log.Warning("Could not read " + _config + ", the default tablet pages apply: " + e.Message);
            }
        }

        static MethodInfo FindRoles()
        {
            foreach (Assembly a in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type t;
                try { t = a.GetType("TavernLib.ModdingApi.Roles", false); }
                catch (Exception) { continue; }
                if (t == null) continue;
                MethodInfo m = t.GetMethod("GetRoles", BindingFlags.Public | BindingFlags.Static, null, new Type[] { typeof(Connection) }, null);
                if (m != null) return m;
            }
            return null;
        }

        static List<string> RolesOf(Connection c)
        {
            List<string> list = new List<string>();
            if (_getRoles == null) return list;
            try
            {
                IEnumerable roles = _getRoles.Invoke(null, new object[] { c }) as IEnumerable;
                if (roles != null)
                    foreach (object r in roles)
                        if (r != null) list.Add(r.ToString().Trim().ToLowerInvariant());
            }
            catch (Exception) { }
            return list;
        }

        public static List<string> PagesFor(List<string> roles, Dictionary<string, List<string>> rules)
        {
            List<string> pages = new List<string>();
            foreach (string page in Order)
            {
                List<string> allowed;
                if (!rules.TryGetValue(page, out allowed)) continue;
                bool ok = allowed.Contains("everyone");
                for (int i = 0; !ok && i < allowed.Count; i++) ok = roles.Contains(allowed[i]);
                if (ok) pages.Add(page);
            }
            return pages;
        }

        static string NameOf(Connection c)
        {
            try { return c != null && c.UserInfo != null ? c.UserInfo.Username : null; }
            catch (Exception) { return null; }
        }

        public static void Tick()
        {
            if (!_on) return;
            float now = Time.realtimeSinceStartup;
            Attach(now);
            List<Inbound> inbound = new List<Inbound>();
            List<KeyValuePair<int, string>> replies = new List<KeyValuePair<int, string>>();
            List<Connection> joined, left;
            bool gone;
            lock (Gate)
            {
                while (Inbox.Count > 0) inbound.Add(Inbox.Dequeue());
                while (Replies.Count > 0) replies.Add(Replies.Dequeue());
                joined = new List<Connection>(Joined);
                left = new List<Connection>(Left);
                Joined.Clear();
                Left.Clear();
                gone = _socketGone;
                _socketGone = false;
            }
            if (gone)
            {
                Clients.Clear();
                Waiting.Clear();
                _socket = null;
            }
            foreach (Connection c in joined)
            {
                if (c == null || Clients.ContainsKey(c)) continue;
                Clients[c] = new Client();
                c.SetHandler((MessageType)TabletWire.Type, Receive);
                c.Disconnected += Forget;
            }
            foreach (Connection c in left) Clients.Remove(c);
            foreach (Inbound m in inbound) Handle(m, now);
            foreach (KeyValuePair<int, string> r in replies) Deliver(r.Key, r.Value);
            Expire(now);
            if (now >= _nextPing)
            {
                _nextPing = now + PingSeconds;
                if (_event.HasListeners) _event.Invoke(delegate { return Ping; });
            }
            if (now >= _nextSweep)
            {
                _nextSweep = now + SweepSeconds;
                LoadRules(false);
                foreach (Connection c in new List<Connection>(Clients.Keys))
                {
                    Client cl = Clients[c];
                    if (cl.Hello) SendMenu(c, cl, false);
                }
            }
        }

        static void Attach(float now)
        {
            if (_socket != null || now < _nextAttach) return;
            _nextAttach = now + 5f;
            ISocket s = Alta.Networking.Socket.Current;
            if (s == null || !s.IsServer || s.TransportSocket == null) return;
            _socket = s;
            s.ConnectionCreated += Register;
            s.SocketDestroyed += Detach;
            foreach (Connection c in s.Connections) Register(c);
        }

        static void Detach(ISocket s)
        {
            try
            {
                s.ConnectionCreated -= Register;
                s.SocketDestroyed -= Detach;
            }
            catch (Exception) { }
            lock (Gate) _socketGone = true;
        }

        static void Register(Connection c)
        {
            if (c == null) return;
            lock (Gate) Joined.Add(c);
        }

        static void Forget(Connection c)
        {
            lock (Gate) Left.Add(c);
        }

        static void Receive(Connection c, AltaStream s)
        {
            uint kind;
            string payload;
            if (!TabletWire.Read(s, out kind, out payload)) return;
            lock (Gate)
            {
                if (Inbox.Count < 256) Inbox.Enqueue(new Inbound { Conn = c, Kind = kind, Payload = payload });
            }
        }

        static void Handle(Inbound m, float now)
        {
            Client cl;
            if (m.Conn == null || !Clients.TryGetValue(m.Conn, out cl)) return;
            if (m.Kind == TabletWire.Hello)
            {
                cl.Hello = true;
                cl.Routes = Newer(m.Payload, 1, 6);
                SendMenu(m.Conn, cl, true);
                return;
            }
            if (m.Kind != TabletWire.Ask || !cl.Hello) return;
            int clientId = -1;
            string route = null;
            try
            {
                JObject o = JObject.Parse(m.Payload);
                clientId = (int)o["id"];
                route = (string)o["go"];
            }
            catch (Exception) { }
            if (clientId < 0) return;
            if (!cl.Routes) { Refuse(m.Conn, clientId, UpdateClient); return; }
            if (route == null || route.Length > RouteMax) { Refuse(m.Conn, clientId, "That button is too long for the tablet."); return; }
            int cut = route.IndexOfAny(new char[] { '/', '?' });
            string page = (cut < 0 ? route : route.Substring(0, cut)).ToLowerInvariant();
            cl.Tokens = Math.Min(5f, cl.Tokens + (now - cl.TokensAt) * 2f);
            cl.TokensAt = now;
            if (cl.Tokens < 1f) { Refuse(m.Conn, clientId, "Slow down a little."); return; }
            cl.Tokens -= 1f;
            if (cl.Waiting > 0 && Waiting.ContainsKey(cl.Waiting)) { Refuse(m.Conn, clientId, "Wait for the last answer first."); return; }
            string name = NameOf(m.Conn);
            List<string> roles = RolesOf(m.Conn);
            List<string> pages = PagesFor(roles, _rules);
            bool open = page == "home" ? pages.Count > 0 : pages.Contains(page);
            if (string.IsNullOrEmpty(name) || !open) { Refuse(m.Conn, clientId, "Your role cannot use that page on this server."); return; }
            if (_event == null || !_event.HasListeners) { Refuse(m.Conn, clientId, "The bot is not connected right now."); return; }
            int id = _nextId++;
            Waiting[id] = new Pending { Conn = m.Conn, ClientId = clientId, Until = now + TimeoutSeconds };
            cl.Waiting = id;
            TabletAsk ask = new TabletAsk { Id = id, Player = name, Pages = pages.ToArray(), Roles = roles.ToArray(), Ask = m.Payload };
            _event.Invoke(delegate { return ask; });
        }

        static void Refuse(Connection c, int clientId, string text)
        {
            JObject o = new JObject();
            o["id"] = clientId;
            o["ok"] = false;
            o["text"] = text;
            TabletWire.Send(c, TabletWire.Answer, o.ToString(Formatting.None));
        }

        static void Deliver(int id, string json)
        {
            Pending p;
            if (!Waiting.TryGetValue(id, out p)) return;
            Waiting.Remove(id);
            Client cl;
            if (p.Conn == null || !Clients.TryGetValue(p.Conn, out cl)) return;
            if (cl.Waiting == id) cl.Waiting = 0;
            string text;
            try
            {
                JObject o = JObject.Parse(json);
                o["id"] = p.ClientId;
                text = o.ToString(Formatting.None);
            }
            catch (Exception)
            {
                Refuse(p.Conn, p.ClientId, "The bot answered in a way the tablet does not understand. Update the bot.");
                return;
            }
            if (text.Length > TabletWire.MaxChars) { Refuse(p.Conn, p.ClientId, "The answer was too long for the tablet."); return; }
            TabletWire.Send(p.Conn, TabletWire.Answer, text);
        }

        static void Expire(float now)
        {
            List<int> late = null;
            foreach (KeyValuePair<int, Pending> kv in Waiting)
                if (now > kv.Value.Until) (late ?? (late = new List<int>())).Add(kv.Key);
            if (late == null) return;
            foreach (int id in late)
            {
                Pending p = Waiting[id];
                Waiting.Remove(id);
                Client cl;
                if (p.Conn != null && Clients.TryGetValue(p.Conn, out cl) && cl.Waiting == id) cl.Waiting = 0;
                Refuse(p.Conn, p.ClientId, "The bot did not answer in time.");
            }
        }

        static void SendMenu(Connection c, Client cl, bool force)
        {
            JObject o = new JObject();
            List<string> pages = PagesFor(RolesOf(c), _rules);
            if (cl.Routes) o["v"] = 2;
            o["name"] = _botName ?? "";
            o["bot"] = _event != null && _event.HasListeners;
            o["pages"] = cl.Routes ? new JArray(pages.ToArray()) : new JArray(pages.Count > 0 ? new string[] { "shop" } : new string[0]);
            string text = o.ToString(Formatting.None);
            if (!force && text == cl.Sent) return;
            if (TabletWire.Send(c, TabletWire.Menu, text)) cl.Sent = text;
        }

        public static bool Newer(string version, int major, int minor)
        {
            if (string.IsNullOrEmpty(version)) return false;
            string[] parts = version.Trim().Split('.');
            int a, b;
            if (parts.Length < 2 || !int.TryParse(parts[0], out a) || !int.TryParse(parts[1], out b)) return false;
            return a > major || (a == major && b >= minor);
        }

        public static string RolesText(Player p)
        {
            Connection c = null;
            try { c = p != null ? p.ConnectionToRemotePlayer : null; }
            catch (Exception) { }
            if (c == null) return "error not online";
            if (_getRoles == null) return "error no roles api";
            List<string> roles = RolesOf(c);
            return "roles " + (roles.Count > 0 ? string.Join(",", roles.ToArray()) : "-");
        }

        public static string BotHello(string data)
        {
            string name;
            try { name = Encoding.UTF8.GetString(Convert.FromBase64String(data ?? "")); }
            catch (Exception) { return "error bad name"; }
            StringBuilder sb = new StringBuilder();
            foreach (char ch in name) if (!char.IsControl(ch) && ch != '<' && ch != '>' && ch != '\\') sb.Append(ch);
            string clean = sb.ToString().Trim();
            _botName = clean.Length > 32 ? clean.Substring(0, 32) : clean;
            return _on ? "ok " + _botName : "off";
        }

        public static string BotAnswer(int id, string data)
        {
            string json;
            try { json = Encoding.UTF8.GetString(Convert.FromBase64String(data ?? "")); }
            catch (Exception) { return "error bad answer"; }
            lock (Gate)
            {
                if (Replies.Count < 256) Replies.Enqueue(new KeyValuePair<int, string>(id, json));
            }
            return "ok";
        }

        public static string Status()
        {
            if (!_on) return "off";
            List<string> lines = new List<string>();
            lines.Add("bot " + (_event != null && _event.HasListeners ? "connected" : "not connected") + ", name " + (_botName ?? "-") + ", roles API " + (_getRoles != null ? "found" : "missing"));
            foreach (KeyValuePair<Connection, Client> kv in Clients)
            {
                if (!kv.Value.Hello) continue;
                List<string> roles = RolesOf(kv.Key);
                lines.Add((NameOf(kv.Key) ?? "?") + ": roles " + (roles.Count > 0 ? string.Join(",", roles.ToArray()) : "-")
                    + ", pages " + string.Join(",", PagesFor(roles, _rules).ToArray()));
            }
            return string.Join("\n", lines.ToArray());
        }
    }

    public static partial class BotCoreCommands
    {
        [Module("tablet", "The in-game bot tablet, the bot's side")]
        public static class Tablet
        {
            [Command("hello", "The bot names itself for the tablet title")]
            public static string Hello(string name)
            {
                return TabletHost.BotHello(name);
            }

            [Command("answer", "The bot answers one tablet request")]
            public static string Answer(int id, string data)
            {
                return TabletHost.BotAnswer(id, data);
            }

            [Command("status", "Players with the tablet and the pages they may open")]
            public static string Status()
            {
                return TabletHost.Status();
            }

            [Command("roles", "The TavernLib roles of an online player")]
            public static string Roles(Player player)
            {
                return TabletHost.RolesText(player);
            }
        }
    }
}
