using System;
using System.Collections.Generic;
using System.Reflection;
using Alta.Meta.UI;
using UnityEngine;
using UnityEngine.Events;

namespace BotCore.Client
{
    internal static class Kit
    {
        const BindingFlags Fields = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;

        static FieldInfo panelWindow;
        static FieldInfo onReleased;
        static FieldInfo triggered;
        static readonly HashSet<string> missing = new HashSet<string>();

        internal static Transform Need(Transform parent, string path)
        {
            Transform t = parent != null ? parent.Find(path) : null;
            if (t == null) throw new InvalidOperationException("tablet layout is missing " + path);
            return t;
        }

        internal static Panel NewPanel(Window win, Transform pages, Transform frame, string name)
        {
            GameObject go = new GameObject(name);
            go.SetActive(false);
            go.layer = frame.gameObject.layer;
            go.transform.SetParent(pages, false);
            go.transform.localPosition = frame.localPosition;
            go.transform.localRotation = frame.localRotation;
            go.transform.localScale = frame.localScale;
            Panel panel = go.AddComponent<Panel>();
            if (panelWindow == null) panelWindow = typeof(Panel).GetField("window", Fields);
            if (panelWindow == null) throw new InvalidOperationException("Panel.window field not found");
            panelWindow.SetValue(panel, win);
            return panel;
        }

        internal static List<float> RowYs(Transform frame, Transform arrow, float titleY, float pagerY, float h, out float pitch)
        {
            List<float> ys = new List<float>();
            foreach (Transform child in frame)
            {
                if (child == arrow || child.GetComponent<Button>() == null) continue;
                float y = child.localPosition.y;
                bool dup = false;
                foreach (float have in ys) if (Mathf.Abs(have - y) < 0.005f) { dup = true; break; }
                if (!dup) ys.Add(y);
            }
            if (ys.Count == 0 || h <= 0f) throw new InvalidOperationException("native row grid or touch size is unusable");
            ys.Sort();
            ys.Reverse();
            float native = h * 1.35f;
            if (ys.Count > 1)
            {
                native = ys[0] - ys[1];
                for (int i = 2; i < ys.Count; i++) native = Mathf.Min(native, ys[i - 1] - ys[i]);
            }
            pitch = Mathf.Max(native, h * 1.05f);
            float top = Mathf.Min(ys[0], titleY - h * 1.5f);
            float bottom = pagerY + h * 1.5f;
            float avail = top - bottom;
            int n = avail < 0f ? 0 : Mathf.Min(6, 1 + Mathf.FloorToInt(avail / pitch + 0.001f));
            if (n < 3)
            {
                float tight = h * 1.05f;
                if (avail >= tight * 2f) { n = 3; pitch = avail / 2f; }
                else if (avail >= tight) { n = 2; pitch = avail; }
                else throw new InvalidOperationException("no room for 2 rows");
            }
            List<float> rows = new List<float>();
            for (int i = 0; i < n; i++) rows.Add(top - pitch * i);
            return rows;
        }

        internal static GameObject CloneVisual(Transform donor, Transform parent, string name)
        {
            GameObject go = Instance(donor, parent, name);
            foreach (MonoBehaviour mb in go.GetComponentsInChildren<MonoBehaviour>(true))
            {
                if (mb == null) continue;
                Type t = mb.GetType();
                if (t == typeof(Button) || t == typeof(TouchScreenButton) || t == typeof(ButtonWithEvents) || t == typeof(TextButton)
                    || t == typeof(TouchScreenButtonVisual) || t == typeof(TextRenderer))
                    ResetCallbacks(mb);
                else
                    UnityEngine.Object.DestroyImmediate(mb);
            }
            go.SetActive(true);
            return go;
        }

        static GameObject Instance(Transform donor, Transform parent, string name)
        {
            if (parent.gameObject.activeInHierarchy) throw new InvalidOperationException("clone parent must be inactive");
            GameObject go = UnityEngine.Object.Instantiate(donor.gameObject, parent, false);
            go.name = name;
            go.SetActive(false);
            go.transform.localRotation = Quaternion.Inverse(parent.rotation) * donor.rotation;
            Vector3 d = donor.lossyScale;
            Vector3 p = parent.lossyScale;
            if (Mathf.Abs(p.x) < 1e-5f || Mathf.Abs(p.y) < 1e-5f || Mathf.Abs(p.z) < 1e-5f)
                throw new InvalidOperationException("clone parent scale is unusable");
            go.transform.localScale = new Vector3(d.x / p.x, d.y / p.y, d.z / p.z);
            return go;
        }

        static void ResetCallbacks(Component c)
        {
            Type type = c.GetType();
            while (type != null && type != typeof(MonoBehaviour))
            {
                foreach (FieldInfo f in type.GetFields(Fields | BindingFlags.DeclaredOnly))
                {
                    if (f.IsInitOnly) continue;
                    if (typeof(Delegate).IsAssignableFrom(f.FieldType)) f.SetValue(c, null);
                    else if (typeof(UnityEventBase).IsAssignableFrom(f.FieldType) || f.FieldType == typeof(AltaEvent))
                        f.SetValue(c, Activator.CreateInstance(f.FieldType));
                    else if (f.Name == "<State>k__BackingField") f.SetValue(c, false);
                }
                type = type.BaseType;
            }
        }

        internal static Button CloneButton(Transform donor, Transform parent, string name, Vector3 localPos)
        {
            GameObject go = CloneVisual(donor, parent, name);
            go.transform.localPosition = localPos;
            Button b = go.GetComponent<Button>();
            if (b == null || !(b is ITouchScreenButton)) throw new InvalidOperationException("donor is not a touch button: " + donor.name);
            b.IsEnabled = true;
            return b;
        }

        internal static BasicTouchScreenButton CloneOld(Transform donor, Transform parent, string name)
        {
            GameObject go = Instance(donor, parent, name);
            go.transform.position = donor.position;
            StripNav(go);
            BasicTouchScreenButton b = go.GetComponent<BasicTouchScreenButton>();
            if (b == null) throw new InvalidOperationException("donor is not a rail button: " + donor.name);
            SilenceNativeRelease(b);
            ButtonWithEvents bwe = go.GetComponent<ButtonWithEvents>();
            if (bwe != null)
            {
                SilencePersistent(bwe, "onPress");
                SilencePersistent(bwe, "onRelease");
            }
            b.IsEnabled = true;
            go.SetActive(true);
            return b;
        }

        internal static TextRenderer CloneText(Transform donor, Transform parent, string name, Color ink, float scale)
        {
            GameObject go = CloneVisual(donor, parent, name);
            TextRenderer tr = go.GetComponent<TextRenderer>();
            if (tr == null) throw new InvalidOperationException("text donor has no text: " + donor.name);
            go.transform.localScale = go.transform.localScale * scale;
            Ink(tr, ink);
            return tr;
        }

        internal static void ConfigureText(TextRenderer tr, float worldWidth, int lines, float minFrac)
        {
            Set(tr, "supportsHTMLTags", false);
            Set(tr, "isMultiLine", lines > 1);
            if (worldWidth <= 0f) return;
            float ls = Mathf.Abs(tr.transform.lossyScale.x);
            if (ls <= 0f) throw new InvalidOperationException("text scale is unusable: " + tr.name);
            float max = worldWidth / ls;
            FieldInfo sf = typeof(TextRenderer).GetField("scale", Fields);
            float scale = sf != null ? (float)sf.GetValue(tr) : 0f;
            Set(tr, "maxWidth", max);
            Set(tr, "bestFitToWidth", lines == 1);
            Set(tr, "hasLineLimit", true);
            Set(tr, "maxLines", lines);
            if (scale > 0f)
            {
                Set(tr, "lineWidth", max / scale);
                Set(tr, "maxScale", scale);
                Set(tr, "minScale", scale * minFrac);
            }
        }

        static void Set(object target, string name, object value)
        {
            FieldInfo f = target.GetType().GetField(name, Fields);
            if (f != null && f.FieldType.IsInstanceOfType(value)) { f.SetValue(target, value); return; }
            if (missing.Add(name)) Mod.Log.Warning("Text field '" + name + "' not found, that fit setting is skipped.");
        }

        internal static void FitWidth(Button b, float width)
        {
            ITouchScreenButton t = (ITouchScreenButton)b;
            if (width >= t.ButtonSize.x) return;
            FieldInfo f = typeof(TouchScreenButton).GetField("touchSize", Fields);
            if (f == null) throw new InvalidOperationException("TouchScreenButton.touchSize not found");
            float k = width / t.ButtonSize.x;
            Vector2 size = (Vector2)f.GetValue(b);
            size.x = width;
            f.SetValue(b, size);
            Vector3 s = b.transform.localScale;
            b.transform.localScale = new Vector3(s.x * k, s.y, s.z);
        }

        internal static Rect TouchRect(Transform screen, ITouchScreenButton b)
        {
            Vector3 p = screen.worldToLocalMatrix.MultiplyPoint(b.transform.position);
            Vector2 size = b.ButtonSize;
            return new Rect(new Vector2(p.x, p.y) - size * 0.5f, size);
        }

        internal static Rect Grow(Rect r, float m)
        {
            return new Rect(r.x - m, r.y - m, r.width + m * 2f, r.height + m * 2f);
        }

        internal static void StripNav(GameObject go)
        {
            Component[] all = go.GetComponentsInChildren<Component>(true);
            foreach (Component c in all)
                if (c != null && c.GetType().Name == "NavigateTo") UnityEngine.Object.DestroyImmediate(c);
        }

        internal static void Ink(TextRenderer tr, Color c)
        {
            if (tr == null) return;
            try { tr.SetColor(c); }
            catch (Exception e) { Mod.Warn("ink", "Tablet ink failed, the native colours stand: " + e.Message); }
        }

        internal static void SetText(TextRenderer tr, string text)
        {
            if (tr == null) return;
            try { tr.Text = (text ?? "").Replace("\\", "\\\\"); }
            catch (Exception e) { Mod.Warn("text", "Tablet text failed: " + e.Message); }
        }

        internal static void SetLabel(Button btn, TextRenderer label, string text)
        {
            if (btn == null) return;
            try { btn.Label = (text ?? "").Replace("\\", "\\\\"); }
            catch (Exception) { }
            SetText(label, text);
        }

        internal static int SilenceNativeRelease(BasicTouchScreenButton basic)
        {
            if (onReleased == null) onReleased = typeof(BasicTouchScreenButton).GetField("onReleased", BindingFlags.NonPublic | BindingFlags.Instance);
            if (triggered == null) triggered = typeof(AltaEvent).GetField("triggered", BindingFlags.NonPublic | BindingFlags.Instance);
            if (onReleased == null || triggered == null) throw new InvalidOperationException("onReleased or triggered field not found");
            object alta = onReleased.GetValue(basic);
            UnityEventBase ev = alta != null ? triggered.GetValue(alta) as UnityEventBase : null;
            if (ev == null) throw new InvalidOperationException("onReleased is unreadable");
            int count = ev.GetPersistentEventCount();
            for (int i = 0; i < count; i++) ev.SetPersistentListenerState(i, UnityEventCallState.Off);
            return count;
        }

        internal static void SilencePersistent(ButtonWithEvents bwe, string field)
        {
            FieldInfo fi = typeof(ButtonWithEvents).GetField(field, BindingFlags.NonPublic | BindingFlags.Instance);
            if (fi == null) return;
            UnityEventBase ev = fi.GetValue(bwe) as UnityEventBase;
            if (ev == null) return;
            int count = ev.GetPersistentEventCount();
            for (int i = 0; i < count; i++) ev.SetPersistentListenerState(i, UnityEventCallState.Off);
        }

        internal static void Remap(TouchScreenMenuBase screen)
        {
            try
            {
                screen.InstantiatedButtons.Clear();
                screen.MapButtons();
            }
            catch (Exception e)
            {
                Mod.Log.Error("The tablet touch map could not be rebuilt, the bot page buttons are dead on this tablet: " + e.Message);
            }
        }
    }
}
