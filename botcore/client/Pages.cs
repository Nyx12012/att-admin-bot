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
        internal Func<Page> Opens;
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
        internal string Area;
        internal string Act;
        internal int At;
        internal int Total;
        internal int Per;
        internal bool Loading;
        internal string Status = "";
        internal List<Row> Rows = new List<Row>();
        internal Func<JObject, Row> Make;
        int gen;

        internal void Fetch(int at)
        {
            if (Per <= 0) return;
            Loading = true;
            int mine = ++gen;
            JObject args = new JObject();
            args["at"] = Math.Max(0, at);
            args["n"] = Per;
            Net.Ask(Area, Act, args, delegate(JObject a)
            {
                if (mine != gen) return;
                Loading = false;
                Rows = new List<Row>();
                if (!BotPages.Ok(a))
                {
                    Status = BotPages.Str(a, "text");
                    Total = 0;
                    At = 0;
                }
                else
                {
                    JArray rows = a["rows"] as JArray;
                    if (rows != null)
                        foreach (JToken t in rows)
                        {
                            JObject o = t as JObject;
                            if (o != null) Rows.Add(Make(o));
                        }
                    Total = BotPages.Int(a, "total", Rows.Count);
                    At = BotPages.Int(a, "at", 0);
                    Status = BotPages.Str(a, "status");
                }
                BotTablet.Dirty();
            });
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

        static Row Nav(string id, string label, Func<Page> opens)
        {
            return new Row { Id = id, Label = Fixed(label), Opens = opens };
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

        internal static Page Menu()
        {
            Page p = new Page { Key = "menu" };
            p.Title = delegate { return Net.Current != null ? Net.Current.Title : "Bot Menu"; };
            p.Status = delegate { return Net.Current != null && !Net.Current.Bot ? "The bot is not connected right now." : ""; };
            p.Rows = delegate
            {
                List<Row> rows = new List<Row>();
                Menu m = Net.Current;
                if (m == null) return rows;
                if (m.Pages.Contains("plots")) rows.Add(Nav("plots", "Plots", Plots));
                if (m.Pages.Contains("shop")) rows.Add(Nav("shop", "Shop", Shop));
                if (m.Pages.Contains("sell")) rows.Add(Nav("sell", "Sell", Sell));
                if (m.Pages.Contains("admin")) rows.Add(Nav("admin", "Admin", Admin));
                return rows;
            };
            return p;
        }

        static Page Listing(string key, string area, string act, string title, Func<JObject, Row> make)
        {
            Page p = new Page { Key = key, Area = area, Title = Fixed(title) };
            p.Remote = new Remote { Area = area, Act = act, Make = make };
            return p;
        }

        static Page Shop()
        {
            return Listing("shop", "shop", "list", "Shop", delegate(JObject o)
            {
                string key = Str(o, "k"), name = Str(o, "t"), detail = Str(o, "d");
                int price = Int(o, "p", 0);
                return new Row { Id = key, Label = Fixed(name), Detail = Fixed(detail), Opens = delegate { return Buy(key, name, detail, price); } };
            });
        }

        static Page Buy(string key, string name, string detail, int price)
        {
            Page p = new Page { Key = "buy:" + key, Area = "shop", Title = Fixed(name), Status = Fixed(detail.Length > 0 ? detail + ". Tap twice to buy." : "Tap twice to buy.") };
            p.Rows = delegate
            {
                List<Row> rows = new List<Row>();
                foreach (int n in new int[] { 1, 5, 10 })
                {
                    int amount = n;
                    rows.Add(new Row
                    {
                        Id = "buy" + amount,
                        Label = Fixed("Buy " + amount),
                        Detail = Fixed(price > 0 ? (amount * price) + " coins, sent to your mailbox" : "sent to your mailbox"),
                        Confirm = true,
                        Run = delegate
                        {
                            JObject args = new JObject();
                            args["key"] = key;
                            args["amount"] = amount;
                            Do("shop", "buy", args);
                        },
                    });
                }
                return rows;
            };
            return p;
        }

        static Page Sell()
        {
            return Listing("sell", "sell", "list", "Sell", delegate(JObject o)
            {
                string key = Str(o, "k");
                return new Row { Id = key, Label = Fixed(Str(o, "t")), Detail = Fixed(Str(o, "d")), Run = delegate { Quote(key, null); } };
            });
        }

        static void Quote(string key, string shownQuote)
        {
            JObject args = new JObject();
            args["key"] = key;
            if (shownQuote != null)
            {
                args["phase"] = "do";
                args["quote"] = shownQuote;
            }
            Net.Ask("sell", "sell", args, delegate(JObject a)
            {
                Page next = Ok(a) && (bool?)a["quote"] == true ? Offer(key, a) : Result(a);
                if (shownQuote != null) BotTablet.Replace(next);
                else BotTablet.Push(next);
            });
            BotTablet.Dirty();
        }

        static Page Offer(string key, JObject a)
        {
            string text = Str(a, "text");
            string title = Str(a, "title");
            Page p = new Page { Key = "offer:" + key, Area = "sell", Title = Fixed(title.Length > 0 ? title : "Sell these?") };
            p.Rows = delegate
            {
                List<Row> rows = new List<Row>();
                rows.Add(new Row { Id = "sell", Label = Fixed("Sell"), Detail = Fixed("the items are gone once you tap"), Run = delegate { Quote(key, text); } });
                rows.AddRange(Lines(text, false));
                return rows;
            };
            return p;
        }

        static Page Plots()
        {
            return Listing("plots", "plots", "list", "Plots", delegate(JObject o)
            {
                string name = Str(o, "k");
                return new Row { Id = name, Label = Fixed(Str(o, "t")), Detail = Fixed(Str(o, "d")), Opens = delegate { return Plot(name); } };
            });
        }

        static Page Plot(string name)
        {
            string info = null;
            bool failed = false;
            Page p = new Page { Key = "plot:" + name, Area = "plots", Title = Fixed(name) };
            p.OnOpen = delegate
            {
                JObject args = new JObject();
                args["name"] = name;
                Net.Ask("plots", "info", args, delegate(JObject a)
                {
                    failed = !Ok(a);
                    info = Str(a, "text");
                    BotTablet.Dirty();
                });
            };
            p.Rows = delegate
            {
                List<Row> rows = new List<Row>();
                JObject args = new JObject();
                args["name"] = name;
                rows.Add(new Row { Id = "go", Label = Fixed("Go there"), Detail = Fixed("teleport to its arrival spot"), Run = delegate { Do("plots", "go", args); } });
                if (info == null) rows.Add(Text("Asking the bot", false));
                else rows.AddRange(Lines(info, failed));
                return rows;
            };
            return p;
        }

        static Page Admin()
        {
            Page p = new Page { Key = "admin", Area = "admin", Title = Fixed("Admin") };
            p.Rows = delegate
            {
                List<Row> rows = new List<Row>();
                rows.Add(Nav("kick", "Kick", delegate { return Players("kick", "Kick who?"); }));
                rows.Add(Nav("bring", "Bring", delegate { return Players("bring", "Bring who to you?"); }));
                rows.Add(Nav("goto", "TP to", delegate { return Players("goto", "Go to who?"); }));
                rows.Add(Nav("ban", "Ban", delegate { return Players("ban", "Ban who?"); }));
                return rows;
            };
            return p;
        }

        static Page Players(string act, string title)
        {
            return Listing("players:" + act, "admin", "players", title, delegate(JObject o)
            {
                string who = Str(o, "k");
                JObject args = new JObject();
                args["player"] = who;
                Row r = new Row { Id = who, Label = Fixed(Str(o, "t")) };
                if (act == "ban") r.Opens = delegate { return Ban(who); };
                else
                {
                    r.Confirm = act == "kick";
                    r.Run = delegate { Do("admin", act, args); };
                }
                return r;
            });
        }

        static Page Ban(string who)
        {
            Page p = new Page { Key = "ban:" + who, Area = "admin", Title = Fixed("Ban " + who), Status = Fixed("Tap twice. The bot keeps the ban.") };
            p.Rows = delegate
            {
                List<Row> rows = new List<Row>();
                int[] hours = new int[] { 24, 168, 0 };
                string[] names = new string[] { "1 day", "1 week", "Forever" };
                for (int i = 0; i < hours.Length; i++)
                {
                    JObject args = new JObject();
                    args["player"] = who;
                    args["hours"] = hours[i];
                    rows.Add(new Row { Id = "ban" + hours[i], Label = Fixed(names[i]), Confirm = true, Warn = hours[i] == 0, Run = delegate { Do("admin", "ban", args); } });
                }
                return rows;
            };
            return p;
        }

        static void Do(string area, string act, JObject args)
        {
            Net.Ask(area, act, args, delegate(JObject a) { BotTablet.Push(Result(a)); });
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
