using System;
using System.Collections.Generic;
using System.Reflection;
using Alta.Meta.UI;
using Alta.QuickAccessActions;
using UnityEngine;

namespace BotCore.Client
{
    internal static class BotTablet
    {
        const int MaxRows = 6;
        const float RenderEvery = 0.25f;
        const string HousePage = "House Tablet Page";

        static readonly Color BodyInk = new Color(0.87f, 0.94f, 1f);
        static readonly Color HeadInk = new Color(1f, 0.86f, 0.6f);
        static readonly Color WarnInk = new Color(1f, 0.62f, 0.45f);

        sealed class Ui
        {
            public SocialTablet Tablet;
            public Window Win;
            public TouchScreenMenuBase Screen;
            public Transform Pages;
            public BasicTouchScreenButton HomeTouch;
            public BasicTouchScreenButton ExtTouch;
            public Panel Panel;
            public Panel Landing;
            public TextRenderer Title;
            public TextRenderer Status;
            public TextRenderer Footer;
            public int RowCount;
            public readonly Button[] Row = new Button[MaxRows];
            public readonly TextRenderer[] Label = new TextRenderer[MaxRows];
            public readonly TextRenderer[] Detail = new TextRenderer[MaxRows];
            public readonly Vector3[] LabelAt = new Vector3[MaxRows];
            public readonly Vector3[] LabelUp = new Vector3[MaxRows];
            public readonly bool[] Up = new bool[MaxRows];
            public readonly TextRenderer[] Line = new TextRenderer[MaxRows];
            public Button Back;
            public bool BackIsRow;
            public BasicTouchScreenButton Prev;
            public BasicTouchScreenButton Next;
            public float SwitchReadyAt;
            public Panel Queued;
            public readonly Dictionary<object, string> Texts = new Dictionary<object, string>();
            public readonly Dictionary<object, Color> Inks = new Dictionary<object, Color>();
        }

        static readonly List<Ui> uis = new List<Ui>();
        static readonly HashSet<int> injected = new HashSet<int>();
        static readonly List<Page> stack = new List<Page>();
        static readonly Row[] shown = new Row[MaxRows];
        static readonly Row[] pressed = new Row[MaxRows];
        static readonly List<Row> queue = new List<Row>();
        static readonly Row BackRow = new Row { Id = "back", Label = delegate { return "Back"; }, Run = delegate { backQueued = true; } };

        static Ui session;
        static SocialTablet lastLocal;
        static bool waiting;
        static float waitUntil;
        static bool homeQueued;
        static bool backQueued;
        static int pageAt;
        static int pageStep;
        static string confirmId;
        static float confirmUntil;
        static string flash;
        static float flashUntil;
        static float nextRender;
        static bool dirty;
        static FieldInfo startingField;

        internal static bool InSession
        {
            get { return session != null && session.Tablet != null; }
        }

        internal static void Dirty()
        {
            dirty = true;
        }

        internal static bool Flash(string msg)
        {
            flash = msg;
            flashUntil = Time.unscaledTime + 3f;
            dirty = true;
            for (int i = 0; i < uis.Count; i++) if (IsShowing(uis[i])) return true;
            return false;
        }

        internal static void Push(Page p)
        {
            if (p == null) return;
            stack.Add(p);
            pageAt = 0;
            confirmId = null;
            if (p.OnOpen != null) p.OnOpen();
            dirty = true;
        }

        internal static void Replace(Page p)
        {
            if (stack.Count > 1) stack.RemoveAt(stack.Count - 1);
            Push(p);
        }

        internal static void Back()
        {
            backQueued = true;
        }

        internal static void MenuChanged()
        {
            Menu m = Net.Current;
            if (session == null) return;
            if (m == null || m.Pages.Count == 0)
            {
                End(true);
                Mod.Say("The bot menu is not open to you any more.");
                return;
            }
            for (int i = 1; i < stack.Count; i++)
            {
                if (stack[i].Area != null && !m.Pages.Contains(stack[i].Area))
                {
                    ResetToMenu();
                    break;
                }
            }
            dirty = true;
        }

        internal static void OnStartup(SocialTablet t)
        {
            if (t == null || !t.IsLocalPlayer) return;
            lastLocal = t;
            int id = t.GetInstanceID();
            Ui ui = null;
            if (injected.Contains(id))
            {
                for (int i = 0; i < uis.Count; i++)
                    if ((object)uis[i].Tablet == (object)t) { ui = uis[i]; Kit.Remap(ui.Screen); }
            }
            else
            {
                injected.Add(id);
                ui = Inject(t);
                if (ui != null) uis.Add(ui);
            }
            if (waiting && Time.unscaledTime <= waitUntil)
            {
                waiting = false;
                if (ui != null) Begin(ui);
                else Mod.Say("The bot page could not be built on this tablet. See the log.");
            }
        }

        internal static void FromWheel(Controller c)
        {
            if (waiting && Time.unscaledTime <= waitUntil) return;
            Ui open = Live();
            if (open != null && (object)open == (object)session)
            {
                End(false);
                SummonActionItemQuickAccess put = Summon();
                if (put != null) put.Run(c);
                return;
            }
            if (open != null) { Begin(open); return; }
            if (lastLocal != null && lastLocal.gameObject.activeInHierarchy)
            {
                Mod.Say("The bot page could not be built on this tablet. See the log.");
                return;
            }
            SummonActionItemQuickAccess s = Summon();
            if (s == null) { Mod.Say("The tablet could not be summoned."); return; }
            waiting = true;
            waitUntil = Time.unscaledTime + 5f;
            bool spawned = false;
            try { spawned = s.IsActive; }
            catch (Exception) { }
            if (!spawned) s.Run(c);
        }

        static Ui Live()
        {
            for (int i = 0; i < uis.Count; i++)
            {
                Ui u = uis[i];
                if (u.Tablet != null && u.Tablet.IsLocalPlayer && u.Tablet.gameObject.activeInHierarchy) return u;
            }
            return null;
        }

        static SummonActionItemQuickAccess Summon()
        {
            try
            {
                ActionItemsManager m = ActionItemsManager.Instance;
                FieldInfo f = typeof(ActionItemsManager).GetField("actionItems", BindingFlags.NonPublic | BindingFlags.Instance);
                ActionItemData[] items = m != null && f != null ? f.GetValue(m) as ActionItemData[] : null;
                if (items == null) return null;
                foreach (ActionItemData d in items)
                {
                    SummonActionItemQuickAccess a = d != null ? d.Action : null;
                    if (a != null && a.DisplayName == "Social Tablet") return a;
                }
            }
            catch (Exception e) { Mod.Warn("summon", "The tablet action could not be found: " + e.Message); }
            return null;
        }

        static void Begin(Ui ui)
        {
            if (ui == null || ui.Panel == null) return;
            if (HousingHere(ui)) { Mod.Say("The Housing tablet has this tablet right now."); return; }
            session = ui;
            homeQueued = false;
            ResetToMenu();
            Render(ui);
            SwitchTo(ui, ui.Panel);
        }

        static void End(bool toNative)
        {
            Ui ui = session;
            session = null;
            if (ui == null) return;
            if (toNative && ui.Win != null && ui.Landing != null) SwitchTo(ui, ui.Landing);
        }

        static void ResetToMenu()
        {
            stack.Clear();
            stack.Add(BotPages.Menu());
            pageAt = 0;
            pageStep = 0;
            confirmId = null;
            dirty = true;
        }

        internal static bool RedirectSwitch(Window w, ref Panel panel)
        {
            Ui s = session;
            if (s == null || (object)s.Win != (object)w || s.Panel == null) return true;
            if (panel != null && panel.name == HousePage)
            {
                session = null;
                return true;
            }
            if ((object)panel == (object)s.Panel) return true;
            panel = s.Panel;
            return (object)w.CurrentPanel != (object)panel;
        }

        internal static bool RedirectFinish(Window w, ref Panel panel)
        {
            if (panel == null) return false;
            Ui s = session;
            if (s == null || (object)s.Win != (object)w || s.Panel == null) return true;
            if (panel.name == HousePage) return true;
            panel = s.Panel;
            return true;
        }

        static bool HousingHere(Ui ui)
        {
            if (ui.Pages != null && ui.Pages.Find(HousePage) != null) return true;
            Panel cur = ui.Win != null ? ui.Win.CurrentPanel : null;
            return cur != null && cur.name == HousePage;
        }

        static Ui Inject(SocialTablet t)
        {
            Window win = t.GetComponent<Window>();
            TouchScreenMenuBase screen = t.GetComponentInChildren<TouchScreenMenuBase>(true);
            if (win == null || screen == null) { Mod.Log.Warning("This tablet has no window or touch screen, so it gets no bot page."); return null; }
            Ui ui = new Ui();
            ui.Tablet = t;
            ui.Win = win;
            ui.Screen = screen;
            try
            {
                Build(ui);
            }
            catch (Exception e)
            {
                Mod.Log.Error("The bot page was not built on this tablet: " + e.Message);
                if (ui.Panel != null) UnityEngine.Object.DestroyImmediate(ui.Panel.gameObject);
                return null;
            }
            Kit.Remap(screen);
            return ui;
        }

        static void Build(Ui ui)
        {
            Transform scr = ui.Screen.transform;
            ui.Pages = Kit.Need(scr, "Components/Pages");
            Transform buttons = Kit.Need(scr, "Components/Buttons");
            Transform actions = Kit.Need(ui.Pages, "Player Actions Page");
            Transform recent = Kit.Need(ui.Pages, "Recent Players Page");
            Transform rowDonor = Kit.Need(actions, "Add Friend Button");
            Transform arrowDonor = Kit.Need(actions, "Back Page Button");
            Transform titleDonor = Kit.Need(recent, "Title");
            Transform prevDonor = Kit.Need(recent, "Back Button");
            Transform nextDonor = Kit.Need(recent, "Forward Button");
            Transform home = Kit.Need(buttons, "Home Button");
            Transform ext = buttons.Find("Extended Home Button");
            ui.HomeTouch = home.GetComponent<BasicTouchScreenButton>();
            ui.ExtTouch = ext != null ? ext.GetComponent<BasicTouchScreenButton>() : null;
            if (ui.HomeTouch == null) throw new InvalidOperationException("Home has no touch button");
            ui.Landing = StartingPanel(ui.Win);
            if (ui.Landing == null) ui.Landing = recent.GetComponent<Panel>();

            TextRenderer nameDonor = rowDonor.GetComponentInChildren<TextRenderer>(true);
            if (nameDonor == null || titleDonor.GetComponent<TextRenderer>() == null) throw new InvalidOperationException("row or title text donor is missing");
            ITouchScreenButton rowTouch = rowDonor.GetComponent<Button>() as ITouchScreenButton;
            if (rowTouch == null) throw new InvalidOperationException("row donor has no touch button");
            float pageScale = Mathf.Abs(actions.lossyScale.y);
            if (pageScale <= 0f) throw new InvalidOperationException("page scale is unusable");

            float h = rowTouch.ButtonSize.y * Mathf.Abs(scr.lossyScale.y) / pageScale;
            float titleY = actions.InverseTransformPoint(titleDonor.position).y;
            Vector3 prevAt = actions.InverseTransformPoint(prevDonor.position);
            Vector3 nextAt = actions.InverseTransformPoint(nextDonor.position);
            float pagerY = Mathf.Max(prevAt.y, nextAt.y);
            float pitch;
            List<float> ys = Kit.RowYs(actions, arrowDonor, titleY, pagerY, h, out pitch);
            float textW = rowTouch.ButtonSize.x * Mathf.Abs(scr.lossyScale.x) * 0.95f;

            ui.Panel = Kit.NewPanel(ui.Win, ui.Pages, actions, "Bot Menu Page");
            Transform root = ui.Panel.transform;
            Vector3 nameAt = actions.InverseTransformPoint(nameDonor.transform.position);

            ui.Title = Kit.CloneText(titleDonor, root, "Bot Title", HeadInk, 1f);
            ui.Title.transform.localPosition = actions.InverseTransformPoint(titleDonor.position);
            Kit.ConfigureText(ui.Title, textW, 1, 0.6f);

            ui.Prev = Kit.CloneOld(prevDonor, root, "Bot Prev");
            ui.Next = Kit.CloneOld(nextDonor, root, "Bot Next");
            List<Rect> fixedRects = new List<Rect>();
            fixedRects.Add(Kit.TouchRect(scr, ui.HomeTouch));
            if (ui.ExtTouch != null) fixedRects.Add(Kit.TouchRect(scr, ui.ExtTouch));
            fixedRects.Add(Kit.TouchRect(scr, ui.Prev));
            fixedRects.Add(Kit.TouchRect(scr, ui.Next));
            Vector2 rowSize = rowTouch.ButtonSize;
            for (int i = ys.Count - 1; i >= 0; i--)
            {
                Rect rr = RectAt(scr, root, new Vector3(rowDonor.localPosition.x, ys[i], rowDonor.localPosition.z), rowSize);
                if (HitsAny(rr, fixedRects)) ys.RemoveAt(i);
            }
            if (ys.Count < 2) throw new InvalidOperationException("fewer than 2 rows clear of Home and the pager arrows");
            ui.RowCount = ys.Count;

            for (int i = 0; i < ui.RowCount; i++)
            {
                Button b = Kit.CloneButton(rowDonor, root, "Bot Row " + i, new Vector3(rowDonor.localPosition.x, ys[i], rowDonor.localPosition.z));
                TextRenderer label = b.GetComponentInChildren<TextRenderer>(true);
                if (label == null) throw new InvalidOperationException("row clone has no text");
                Vector3 la = b.transform.InverseTransformPoint(label.transform.position);
                Vector3 up = b.transform.InverseTransformVector(root.TransformVector(new Vector3(0f, pitch, 0f)));
                ui.LabelAt[i] = la;
                ui.LabelUp[i] = la + up * 0.13f;
                Kit.Ink(label, BodyInk);
                Kit.ConfigureText(label, textW, 1, 0.6f);
                TextRenderer det = Kit.CloneText(nameDonor.transform, b.transform, "Bot Detail " + i, BodyInk, 0.65f);
                det.transform.localPosition = la - up * 0.18f;
                Kit.ConfigureText(det, textW, 1, 0.6f);
                det.gameObject.SetActive(false);
                ui.Row[i] = b;
                ui.Label[i] = label;
                ui.Detail[i] = det;

                TextRenderer line = Kit.CloneText(nameDonor.transform, root, "Bot Line " + i, BodyInk, 0.8f);
                line.transform.position = b.transform.TransformPoint(la);
                Kit.ConfigureText(line, textW, 1, 0.5f);
                line.gameObject.SetActive(false);
                ui.Line[i] = line;

                int at = i;
                b.Pressed += delegate(Button x) { pressed[at] = shown[at]; };
                b.Released += delegate(Button x) { RowReleased(at); };
                b.gameObject.SetActive(false);
            }

            float rowEdgeTop = ys[0] + h * 0.5f;
            float rowEdgeLow = ys[ys.Count - 1] - h * 0.5f;
            float arrowHalf = ((ITouchScreenButton)ui.Prev).ButtonSize.y * Mathf.Abs(scr.lossyScale.y) / pageScale * 0.5f;
            if (titleY - rowEdgeTop >= h * 0.6f)
            {
                ui.Status = Kit.CloneText(nameDonor.transform, root, "Bot Status", BodyInk, 0.65f);
                ui.Status.transform.localPosition = new Vector3(nameAt.x, (titleY + rowEdgeTop) * 0.5f, nameAt.z);
                Kit.ConfigureText(ui.Status, textW, 1, 0.5f);
            }
            if (rowEdgeLow - (pagerY + arrowHalf) >= h * 0.5f)
            {
                ui.Footer = Kit.CloneText(nameDonor.transform, root, "Bot Footer", BodyInk, 0.65f);
                ui.Footer.transform.localPosition = new Vector3(nameAt.x, (rowEdgeLow + pagerY + arrowHalf) * 0.5f, nameAt.z);
                Kit.ConfigureText(ui.Footer, textW, 1, 0.65f);
            }

            ui.Prev.gameObject.SetActive(false);
            ui.Next.gameObject.SetActive(false);
            ui.Prev.Released += delegate { pageStep = -1; dirty = true; };
            ui.Next.Released += delegate { pageStep = 1; dirty = true; };

            PlaceBack(ui, root, arrowDonor, prevAt, nextAt, fixedRects, rowSize, ys, rowDonor);

            ui.HomeTouch.Released += delegate { if ((object)session == (object)ui) homeQueued = true; };
            if (ui.ExtTouch != null) ui.ExtTouch.Released += delegate { if ((object)session == (object)ui) homeQueued = true; };
            Mod.Log.Msg("Bot page built on the tablet: " + ui.RowCount + " rows" + (ui.BackIsRow ? ", Back as the last row" : "") + ".");
        }

        static void PlaceBack(Ui ui, Transform root, Transform arrowDonor, Vector3 prevAt, Vector3 nextAt, List<Rect> fixedRects,
            Vector2 rowSize, List<float> ys, Transform rowDonor)
        {
            Transform scr = ui.Screen.transform;
            List<Rect> busy = new List<Rect>(fixedRects);
            for (int i = 0; i < ys.Count; i++)
                busy.Add(RectAt(scr, root, new Vector3(rowDonor.localPosition.x, ys[i], rowDonor.localPosition.z), rowSize));
            ITouchScreenButton donorTouch = arrowDonor.GetComponent<Button>() as ITouchScreenButton;
            if (donorTouch == null) throw new InvalidOperationException("back arrow donor has no touch button");
            Vector2 size = donorTouch.ButtonSize;
            Vector3 at = arrowDonor.localPosition;
            float width = size.x;
            Rect native = RectAt(scr, root, at, size);
            if (HitsAny(native, busy))
            {
                Rect pr = Kit.TouchRect(scr, ui.Prev);
                Rect nr = Kit.TouchRect(scr, ui.Next);
                float gap = Mathf.Abs(nr.center.x - pr.center.x) - (pr.width + nr.width) * 0.5f - 0.004f;
                float w = Mathf.Min(size.x, gap);
                Vector3 mid = (prevAt + nextAt) * 0.5f;
                Rect between = RectAt(scr, root, mid, new Vector2(Mathf.Max(w, 0f), size.y));
                if (w >= size.x * 0.4f && !HitsAny(between, busy))
                {
                    at = mid;
                    width = w;
                }
                else
                {
                    ui.BackIsRow = true;
                    return;
                }
            }
            ui.Back = Kit.CloneButton(arrowDonor, root, "Bot Back", at);
            if (width < size.x) Kit.FitWidth(ui.Back, width);
            ui.Back.gameObject.SetActive(false);
            ui.Back.Released += delegate(Button x) { backQueued = true; };
        }

        static Rect RectAt(Transform scr, Transform root, Vector3 local, Vector2 size)
        {
            Vector3 p = scr.worldToLocalMatrix.MultiplyPoint(root.TransformPoint(local));
            return new Rect(new Vector2(p.x, p.y) - size * 0.5f, size);
        }

        static bool HitsAny(Rect r, List<Rect> others)
        {
            Rect g = Kit.Grow(r, 0.001f);
            for (int i = 0; i < others.Count; i++) if (g.Overlaps(others[i])) return true;
            return false;
        }

        static Panel StartingPanel(Window w)
        {
            try
            {
                if (startingField == null) startingField = typeof(Window).GetField("startingPanel", BindingFlags.NonPublic | BindingFlags.Instance);
                return startingField != null ? startingField.GetValue(w) as Panel : null;
            }
            catch (Exception) { return null; }
        }

        internal static void Tick()
        {
            float now = Time.unscaledTime;
            for (int i = uis.Count - 1; i >= 0; i--)
            {
                Ui u = uis[i];
                if (u.Win == null || u.Panel == null || u.Tablet == null)
                {
                    if ((object)u == (object)session) session = null;
                    uis.RemoveAt(i);
                }
            }
            if (session != null && !session.Tablet.gameObject.activeInHierarchy) session = null;
            if (waiting && now > waitUntil) waiting = false;
            if (uis.Count == 0) return;
            if (session != null && HousingHere(session)) session = null;

            if (homeQueued)
            {
                homeQueued = false;
                if (session != null)
                {
                    ResetToMenu();
                    if (!IsShowing(session)) SwitchTo(session, session.Panel);
                }
            }
            if (backQueued)
            {
                backQueued = false;
                if (stack.Count > 1)
                {
                    stack.RemoveAt(stack.Count - 1);
                    pageAt = 0;
                    confirmId = null;
                    Page top = stack[stack.Count - 1];
                    if (top.Remote != null) top.Remote.Fetch(top.Remote.At);
                }
                dirty = true;
            }
            if (queue.Count > 0)
            {
                Row[] rows = queue.ToArray();
                queue.Clear();
                foreach (Row r in rows) Activate(r);
            }

            bool rendered = false;
            for (int i = 0; i < uis.Count; i++)
            {
                Ui ui = uis[i];
                if (ui.Queued != null && now >= ui.SwitchReadyAt)
                {
                    Panel p = ui.Queued;
                    ui.Queued = null;
                    SwitchTo(ui, p);
                }
                if (IsShowing(ui) && stack.Count > 0 && (dirty || now >= nextRender))
                {
                    Render(ui);
                    rendered = true;
                }
            }
            if (rendered)
            {
                nextRender = now + RenderEvery;
                dirty = false;
            }
        }

        static bool IsShowing(Ui ui)
        {
            return ui.Win != null && ui.Panel != null && (object)ui.Win.CurrentPanel == (object)ui.Panel && ui.Panel.IsActive;
        }

        static void RowReleased(int at)
        {
            Row r = pressed[at] ?? shown[at];
            pressed[at] = null;
            if (r != null && !r.IsText) queue.Add(r);
        }

        static void Activate(Row r)
        {
            if (stack.Count == 0) return;
            if (r != BackRow && Net.Busy)
            {
                Flash("Waiting for the bot");
                return;
            }
            float now = Time.unscaledTime;
            string id = stack[stack.Count - 1].Key + ":" + r.Id;
            if (r.Confirm && !(confirmId == id && now < confirmUntil))
            {
                confirmId = id;
                confirmUntil = now + 3f;
                dirty = true;
                return;
            }
            confirmId = null;
            try
            {
                if (r.Opens != null) Push(r.Opens());
                if (r.Run != null) r.Run();
            }
            catch (Exception e)
            {
                Mod.Log.Error("The tablet button '" + r.Id + "' failed: " + e);
                Flash("That failed, see the log");
            }
            dirty = true;
        }

        static void SwitchTo(Ui ui, Panel target)
        {
            Window w = ui.Win;
            if (w == null || target == null) return;
            float now = Time.unscaledTime;
            if (now < ui.SwitchReadyAt) { ui.Queued = target; return; }
            ui.SwitchReadyAt = now + 0.15f;
            if ((object)w.CurrentPanel == (object)target)
            {
                if (target.IsActive) return;
                Panel showing = ActivePanel(ui, target);
                if (showing != null) showing.SetActive(false, delegate { if (target != null && !target.IsActive) target.SetActive(true); });
                else target.SetActive(true);
                return;
            }
            w.SwitchToPanel(target);
        }

        static Panel ActivePanel(Ui ui, Panel except)
        {
            foreach (Transform child in ui.Pages)
            {
                Panel p = child.GetComponent<Panel>();
                if (p != null && (object)p != (object)except && p.IsActive) return p;
            }
            return null;
        }

        static void Render(Ui ui)
        {
            if (stack.Count == 0) return;
            float now = Time.unscaledTime;
            Page page = stack[stack.Count - 1];
            bool sub = stack.Count > 1;
            bool backRow = ui.BackIsRow && stack.Count > 2;
            int per = Math.Max(1, ui.RowCount - (backRow ? 1 : 0));
            List<Row> rows;
            int pages;
            int offset;
            string status = "";
            if (page.Remote != null)
            {
                Remote rm = page.Remote;
                if (rm.Per != per)
                {
                    rm.Per = per;
                    rm.Fetch(0);
                }
                else if (pageStep != 0 && !rm.Loading)
                {
                    int to = rm.At + pageStep * per;
                    if (to >= 0 && to < rm.Total) rm.Fetch(to);
                }
                pageStep = 0;
                rows = rm.Rows;
                pages = Math.Max(1, (rm.Total + per - 1) / per);
                pageAt = Math.Min(pages - 1, rm.At / per);
                offset = 0;
                status = rm.Loading ? "Asking the bot" : rm.Status;
            }
            else
            {
                try { rows = page.Rows != null ? page.Rows() : new List<Row>(); }
                catch (Exception e)
                {
                    Mod.Warn("render", "The tablet page '" + page.Key + "' failed: " + e);
                    rows = new List<Row>();
                }
                pages = Math.Max(1, (rows.Count + per - 1) / per);
                pageAt += pageStep;
                pageStep = 0;
                if (pageAt < 0) pageAt = 0;
                if (pageAt >= pages) pageAt = pages - 1;
                offset = pageAt * per;
                if (page.Status != null)
                {
                    try { status = page.Status(); }
                    catch (Exception) { status = ""; }
                }
            }

            string title;
            try { title = page.Title(); }
            catch (Exception) { title = "Bot Menu"; }
            bool flashing = flash != null && now < flashUntil;
            if (flashing && ui.Status != null) status = flash;
            else if (flashing) title = flash;
            Text(ui, ui.Title, Mod.Clean(title, 28));
            if (ui.Status != null) Text(ui, ui.Status, Mod.Clean(status, 60));
            if (ui.Footer != null) Text(ui, ui.Footer, pages > 1 ? "page " + (pageAt + 1) + " of " + pages : "");

            for (int i = 0; i < ui.RowCount; i++)
            {
                Row r;
                if (backRow && i == ui.RowCount - 1) r = BackRow;
                else
                {
                    int at = offset + i;
                    r = (i < per && at < rows.Count) ? rows[at] : null;
                }
                shown[i] = r;
                Button b = ui.Row[i];
                TextRenderer line = ui.Line[i];
                if (r == null)
                {
                    Active(b.gameObject, false);
                    Active(line.gameObject, false);
                    continue;
                }
                string label;
                try { label = r.Label(); }
                catch (Exception) { label = r.Id; }
                if (r.IsText)
                {
                    Active(b.gameObject, false);
                    Active(line.gameObject, true);
                    Text(ui, line, Mod.Clean(label, 48));
                    Color lineInk = r.Warn ? WarnInk : BodyInk;
                    Color had;
                    if (!ui.Inks.TryGetValue(line, out had) || had != lineInk)
                    {
                        ui.Inks[line] = lineInk;
                        Kit.Ink(line, lineInk);
                    }
                    continue;
                }
                string detail = null;
                if (r.Detail != null)
                {
                    try { detail = r.Detail(); }
                    catch (Exception) { detail = null; }
                }
                if (confirmId == page.Key + ":" + r.Id && now < confirmUntil) detail = "tap again to confirm";
                Active(line.gameObject, false);
                Active(b.gameObject, true);
                RowText(ui, i, Mod.Clean(label, 30), string.IsNullOrEmpty(detail) ? null : Mod.Clean(detail, 40), r.Warn ? WarnInk : BodyInk);
            }
            if (ui.Back != null) Active(ui.Back.gameObject, sub);
            Active(ui.Prev.gameObject, pages > 1 && pageAt > 0);
            Active(ui.Next.gameObject, pages > 1 && pageAt < pages - 1);
        }

        static void Active(GameObject go, bool on)
        {
            if (go != null && go.activeSelf != on) go.SetActive(on);
        }

        static void Text(Ui ui, TextRenderer tr, string s)
        {
            if (tr == null) return;
            string had;
            if (ui.Texts.TryGetValue(tr, out had) && had == s) return;
            ui.Texts[tr] = s;
            Kit.SetText(tr, s);
        }

        static void RowText(Ui ui, int i, string label, string detail, Color ink)
        {
            Button b = ui.Row[i];
            TextRenderer lt = ui.Label[i];
            TextRenderer dt = ui.Detail[i];
            bool up = detail != null;
            if (ui.Up[i] != up || !ui.Texts.ContainsKey(lt))
            {
                ui.Up[i] = up;
                lt.transform.position = b.transform.TransformPoint(up ? ui.LabelUp[i] : ui.LabelAt[i]);
            }
            string had;
            if (!ui.Texts.TryGetValue(lt, out had) || had != label)
            {
                ui.Texts[lt] = label;
                Kit.SetLabel(b, lt, label);
            }
            Active(dt.gameObject, up);
            if (up) Text(ui, dt, detail);
            Color was;
            if (!ui.Inks.TryGetValue(lt, out was) || was != ink)
            {
                ui.Inks[lt] = ink;
                Kit.Ink(lt, ink);
                Kit.Ink(dt, ink);
            }
        }
    }
}
