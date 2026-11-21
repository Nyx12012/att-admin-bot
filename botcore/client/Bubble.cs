using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Alta.QuickAccessActions;
using UnityEngine;

namespace BotCore.Client
{
    public class BotBubble : QuickAccessMenuAction
    {
        public override bool IsValid
        {
            get
            {
                Menu m = Net.Current;
                if (m == null || !m.Bot) return false;
                try { return !Player.Current.PlayerController.IsDowned; }
                catch (Exception) { return true; }
            }
        }

        public override bool IsIgnored
        {
            get
            {
                Menu m = Net.Current;
                return m == null || m.Pages.Count == 0;
            }
        }

        public override bool IsActive
        {
            get { return BotTablet.InSession; }
        }

        public override bool HasEffectOnRun
        {
            get { return true; }
        }

        public override void Run(Controller controller)
        {
            try { BotTablet.FromWheel(controller); }
            catch (Exception e) { Mod.Log.Error("The bot bubble failed: " + e); }
        }
    }

    internal static class Bubble
    {
        internal const string Name = "Bot Menu";

        static readonly Dictionary<QuickAccessMenuController, BotBubble> Wheels = new Dictionary<QuickAccessMenuController, BotBubble>();

        internal static void Inject(QuickAccessMenuController wheel)
        {
            Prune();
            if (wheel == null || Wheels.ContainsKey(wheel)) return;
            Controller hand = wheel.Controller;
            PlayerController pc = hand == null ? null : hand.PlayerController;
            if (pc == null || !pc.IsLocalPlayer) return;
            FieldInfo menus = Field(typeof(QuickAccessMenuController), "quickAccessMenus");
            FieldInfo display = Field(typeof(QuickAccessMenuAction), "displayName");
            FieldInfo prefab = Field(typeof(QuickAccessMenuAction), "prefab");
            if (menus == null || display == null) throw new MissingFieldException("the wheel's bubble list was not found");
            BotBubble b = ScriptableObject.CreateInstance<BotBubble>();
            b.name = "BotCore.Client";
            b.hideFlags = HideFlags.DontUnloadUnusedAsset;
            display.SetValue(b, Name);
            if (prefab != null) prefab.SetValue(b, Icon.Get());
            QuickAccessMenuAction[] arr = (QuickAccessMenuAction[])menus.GetValue(wheel);
            List<QuickAccessMenuAction> list = new List<QuickAccessMenuAction>();
            if (arr != null) list.AddRange(arr);
            list.Add(b);
            menus.SetValue(wheel, list.ToArray());
            b.InitializeForPlayer(pc.NetworkPlayer, false);
            Wheels[wheel] = b;
        }

        static void Prune()
        {
            List<QuickAccessMenuController> dead = new List<QuickAccessMenuController>();
            foreach (QuickAccessMenuController w in Wheels.Keys) if (w == null) dead.Add(w);
            foreach (QuickAccessMenuController w in dead)
            {
                BotBubble b = Wheels[w];
                Wheels.Remove(w);
                if (b != null) UnityEngine.Object.Destroy(b);
            }
        }

        internal static FieldInfo Field(Type t, string name)
        {
            for (; t != null; t = t.BaseType)
            {
                FieldInfo f = t.GetField(name, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                if (f != null) return f;
            }
            return null;
        }
    }

    internal static class Icon
    {
        static GameObject _template;
        static bool _tried;

        internal static GameObject Get()
        {
            if (_tried) return _template;
            _tried = true;
            try
            {
                Texture2D tex = Load();
                Shader sh = Shader.Find("Sprites/Default");
                if (tex == null || sh == null) return null;
                Material mat = new Material(sh);
                mat.mainTexture = tex;
                _template = new GameObject("BotCoreClientIcon");
                _template.transform.position = new Vector3(0f, -9999f, 0f);
                Quad(_template, mat, Quaternion.identity);
                Quad(_template, mat, Quaternion.Euler(0f, 180f, 0f));
                UnityEngine.Object.DontDestroyOnLoad(_template);
            }
            catch (Exception e)
            {
                Mod.Log.Warning("The bubble icon could not be drawn, the bubble shows its name only: " + e.Message);
                _template = null;
            }
            return _template;
        }

        static Texture2D Load()
        {
            using (Stream s = typeof(Icon).Assembly.GetManifestResourceStream("BotCore.Client.icon.png"))
            {
                if (s == null) return null;
                byte[] bytes = new byte[s.Length];
                int at = 0;
                while (at < bytes.Length)
                {
                    int n = s.Read(bytes, at, bytes.Length - at);
                    if (n <= 0) break;
                    at += n;
                }
                Texture2D tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                if (!ImageConversion.LoadImage(tex, bytes)) return null;
                tex.wrapMode = TextureWrapMode.Clamp;
                return tex;
            }
        }

        static void Quad(GameObject parent, Material mat, Quaternion rot)
        {
            GameObject q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            q.name = "face";
            Collider col = q.GetComponent<Collider>();
            if (col != null) UnityEngine.Object.Destroy(col);
            q.transform.SetParent(parent.transform, false);
            q.transform.localRotation = rot;
            q.transform.localScale = new Vector3(0.21f, 0.21f, 0.21f);
            q.GetComponent<MeshRenderer>().sharedMaterial = mat;
        }
    }
}
