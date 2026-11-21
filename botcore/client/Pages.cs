using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace BotCore.Client
{
    internal sealed class Row
    {
        internal string Id;
        internal Func<string> Label;
        internal Func<string> Detail;
        internal Action Run;
        internal bool Confirm;
        internal bool IsText;
        internal bool Warn;
    }

    internal sealed class Page
    {
        internal string Key;
        internal string Area;
        internal Func<string> Title;
        internal Func<List<Row>> Rows;
        internal Func<string> Status;
        internal Action OnOpen;
        internal Remote Remote;
    }

    internal sealed class Remote
    {
        internal string Route;
        internal int At;
        internal int Total;
        internal int Per;
        internal bool Loading;
        internal string Title = "";
        internal string Status = "";
        internal List<Row> Rows = new List<Row>();
        int gen;

        internal void Fetch(int at)
        {
            if (Per <= 0) return;
            Loading = true;
            int mine = ++gen;
            Net.Ask(Route, Math.Max(0, at), Per, delegate(JObject a)
            {
                if (mine != gen) return;
                Loading = false;
                if (!BotPages.Ok(a))
                {
                    Rows = new List<Row>();
                    Status = BotPages.Str(a, "text");
                    Total = 0;
                    At = 0;
                }
                else Fill(a);
                BotTablet.Dirty();
            });
        }

        internal void Fill(JObject a)
        {
            Rows = BotPages.RowsOf(a);
            Total = BotPages.Int(a, "total", Rows.Count);
            At = BotPages.Int(a, "at", 0);
            Status = BotPages.Str(a, "status");
            string t = BotPages.Str(a, "title");
            if (t.Length > 0) Title = t;
        }
    }

    internal static class BotPages
    {
        internal static bool Ok(JObject a)
        {
            try { return a != null && (bool?)a["ok"] == true; }
            catch (Exception) { return false; }
        }

        internal static string Str(JObject a, string key)
        {
            try { return a == null ? "" : ((string)a[key] ?? ""); }
            catch (Exception) { return ""; }
        }

        internal static int Int(JObject a, string key, int fallback)
        {
            try { return a == null || a[key] == null ? fallback : (int)a[key]; }
            catch (Exception) { return fallback; }
        }

        static Func<string> Fixed(string s)
        {
            return delegate { return s; };
        }

        static Row Text(string s, bool warn)
        {
            return new Row { Id = "text", Label = Fixed(s), IsText = true, Warn = warn };
        }

        static List<Row> Lines(string text, bool warn)
        {
            List<Row> rows = new List<Row>();
            foreach (string line in Mod.Wrap(text, 44)) rows.Add(Text(line, warn));
            return rows;
        }

        static string AreaOf(string route)
        {
            if (string.IsNullOrEmpty(route)) return null;
            int cut = route.IndexOfAny(new char[] { '/', '?' });
            return cut < 0 ? route : route.Substring(0, cut);
        }

        internal static Page Menu()
        {
            Menu m = Net.Current;
            if (m != null && m.V < 2)
            {
                Page old = new Page { Key = "old", Title = Fixed(m.Title) };
                old.Rows = delegate { return Lines("This server runs an older BotCore.Server. Ask the server owner to update it to 1.6 or newer so this tablet works again.", true); };
                return old;
            }
            Page p = Screen("home", BotTablet.PerFor(1));
            p.Area = null;
            p.Status = delegate { return Net.Current != null && !Net.Current.Bot ? "The bot is not connected right now." : (p.Remote.Loading ? "Asking the bot" : p.Remote.Status); };
            return p;
        }

        static Page Screen(string route, int per)
        {
            Remote rm = new Remote { Route = route, Per = per };
            Page p = new Page { Key = route, Area = AreaOf(route), Remote = rm };
            p.Title = delegate { return rm.Title.Length > 0 ? rm.Title : (Net.Current != null ? Net.Current.Title : "Bot Menu"); };
            p.OnOpen = delegate { if (rm.Rows.Count == 0 && !rm.Loading) rm.Fetch(rm.At); };
            return p;
        }

        internal static Page FromAnswer(JObject a, int per)
        {
            if (!Ok(a)) return Result(a);
            string route = Str(a, "r");
            if (route.Length > 0)
            {
                Page p = Screen(route, per);
                p.Remote.Fill(a);
                p.OnOpen = null;
                return p;
            }
            string title = Str(a, "title");
            List<Row> rows = RowsOf(a);
            string text = Str(a, "text");
            if (text.Length > 0) rows.AddRange(Lines(text, false));
            if (rows.Count == 0) rows.AddRange(Lines("Done.", false));
            string status = Str(a, "status");
            Page s = new Page { Key = "page:" + title, Title = Fixed(title.Length > 0 ? title : "Done") };
            s.Rows = delegate { return rows; };
            if (status.Length > 0) s.Status = Fixed(status);
            return s;
        }

        internal static List<Row> RowsOf(JObject a)
        {
            List<Row> rows = new List<Row>();
            JArray list = a == null ? null : a["rows"] as JArray;
            if (list == null) return rows;
            foreach (JToken t in list)
            {
                JObject o = t as JObject;
                if (o != null) rows.Add(Make(o));
            }
            return rows;
        }

        static Row Make(JObject o)
        {
            string key = Str(o, "k");
            string mode = Str(o, "m");
            string detail = Str(o, "d");
            Row r = new Row
            {
                Id = key.Length > 0 ? key : Str(o, "t"),
                Label = Fixed(Str(o, "t")),
                Detail = detail.Length > 0 ? Fixed(detail) : null,
                Confirm = Int(o, "c", 0) == 1,
                Warn = Int(o, "w", 0) == 1,
                IsText = mode == "x" || key.Length == 0,
            };
            if (!r.IsText) r.Run = delegate { Tap(key, mode); };
            return r;
        }

        static void Tap(string route, string mode)
        {
            int depth = BotTablet.Depth + (mode == "s" ? 0 : mode == "u" ? -1 : 1);
            int per = BotTablet.PerFor(depth);
            Net.Ask(route, 0, per, delegate(JObject a)
            {
                Page next = FromAnswer(a, per);
                if (!Ok(a)) BotTablet.Push(next);
                else if (mode == "s") BotTablet.Replace(next);
                else if (mode == "u") BotTablet.Up(next);
                else BotTablet.Push(next);
            });
            BotTablet.Dirty();
        }

        internal static Page Result(JObject a)
        {
            bool ok = Ok(a);
            string title = Str(a, "title");
            if (title.Length == 0) title = ok ? "Done" : "Could not do that";
            string text = Str(a, "text");
            Page p = new Page { Key = "result", Title = Fixed(title) };
            p.Rows = delegate { return Lines(text.Length > 0 ? text : (ok ? "Done." : "Nothing was done."), !ok); };
            return p;
        }
    }
}
