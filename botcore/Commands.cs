using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using Alta.Character;
using Alta.Chunks;
using Alta.Console;
using Alta.Inventory;
using Alta.Networking;
using Alta.Networking.Internal;
using Alta.Networking.Scripts.Player;
using Alta.StatSystem;
using UnityEngine;

namespace BotCore
{
    [Module("botcore", "Bridge verbs for the ATT Admin Bot on a stock server")]
    public static class BotCoreCommands
    {
        [Command("version", "BotCore version")]
        public static string Version()
        {
            return "BotCore " + Entry.Version;
        }

        [Command("user", "Resolve a player name or id: online first, then users.json")]
        public static string User(string nameOrId)
        {
            string arg = (nameOrId ?? "").Trim();
            if (arg.Length == 0) return "unknown";
            IPlayer online = Resolver.Connected(arg);
            if (online != null && online.UserInfo != null)
            {
                return "online " + online.UserInfo.Identifier.ToString(CultureInfo.InvariantCulture) + " " + online.UserInfo.Username;
            }
            int id;
            string name;
            if (Resolver.LookupUsersFile(arg, out id, out name))
            {
                return "offline " + id.ToString(CultureInfo.InvariantCulture) + " " + name;
            }
            return "unknown";
        }

        [Command("heal", "Heal players by an amount, or to full if omitted")]
        public static string Heal(PlayerList players, float amount = -1f)
        {
            List<string> lines = new List<string>();
            foreach (Player player in players)
            {
                HealthObject h = Health(player);
                if (h == null)
                {
                    lines.Add(Name(player) + ": not spawned.");
                    continue;
                }
                if (amount < 0f) h.Health = h.MaxHealth;
                else h.Health = Mathf.Min(h.MaxHealth, h.Health + amount);
                lines.Add(string.Format(CultureInfo.InvariantCulture, "{0}: health = {1}/{2}", Name(player), h.Health, h.MaxHealth));
            }
            return Join(lines);
        }

        [Command("stats", "Show a player's stats: value, base, min, max")]
        public static string Stats(Player player)
        {
            if (player == null) return "No connected players matched.";
            HealthObject h = Health(player);
            StatManager sm = h != null ? h.StatManager : null;
            if (sm == null) return Name(player) + ": no stats (not spawned).";
            List<string> lines = new List<string>();
            lines.Add("Stats for " + Name(player) + ":");
            foreach (KeyValuePair<StatDefinition, Stat> kv in sm.Stats.OrderBy(k => k.Key.Name))
            {
                Stat s = kv.Value;
                lines.Add(string.Format(CultureInfo.InvariantCulture, "  {0} = {1} (base {2}, min {3}, max {4})",
                    kv.Key.Name, s.Value, s.Base, s.Minimum, s.Maximum));
            }
            return Join(lines);
        }

        static HealthObject Health(Player player)
        {
            if (player == null) return null;
            PlayerController pc = player.PlayerController;
            return pc != null ? pc.Health : null;
        }

        static string Name(Player p)
        {
            try
            {
                string u = p.UserInfo.Username;
                return string.IsNullOrEmpty(u) ? "<player>" : u;
            }
            catch (Exception)
            {
                return "<player>";
            }
        }

        static string Join(List<string> lines)
        {
            return lines.Count == 0 ? "No connected players matched." : string.Join("\n", lines.ToArray());
        }

        [Command("ground", "Height of the ground under a point, from a height down")]
        public static string Ground(float x, float z, float top)
        {
            RaycastHit hit;
            if (Physics.Raycast(new Vector3(x, top, z), Vector3.down, out hit, 400f, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore))
            {
                return "ground " + hit.point.y.ToString("0.000", CultureInfo.InvariantCulture);
            }
            return "none";
        }

        public static string LaunchFile;

        [Command("startfile", "Where this server recorded how it was started")]
        public static string StartFile()
        {
            return LaunchFile ?? "none";
        }

        [Command("carried", "Count carried items of one prefab, split by material")]
        public static string Carried(Player player, int hash, string where = "all")
        {
            if (player == null) return "error no player";
            PlayerCharacter character = player.PlayerCharacter;
            PlayerController pc = player.PlayerController;
            if (character == null || pc == null) return "error not spawned";
            Taking t = new Taking();
            t.Hash = (uint)hash;
            t.Max = int.MaxValue;
            t.Dry = true;
            t.ByMaterial = new SortedDictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            Walk(character, pc, where, t);
            List<string> parts = new List<string>();
            foreach (KeyValuePair<string, int> kv in t.ByMaterial) parts.Add(kv.Key + "=" + kv.Value.ToString(CultureInfo.InvariantCulture));
            return "carried " + t.Refused.ToString(CultureInfo.InvariantCulture) + " " + (parts.Count == 0 ? "-" : string.Join("|", parts.ToArray()));
        }

        [Command("take", "Remove carried items of one prefab. Mode count only counts. Where is all, hands or belt. Material is any, none or a material name")]
        public static string Take(Player player, int hash, int max, string mode = "take", string where = "all", string material = "any")
        {
            if (player == null) return "error no player";
            PlayerCharacter character = player.PlayerCharacter;
            PlayerController pc = player.PlayerController;
            if (character == null || pc == null) return "error not spawned";
            Taking t = new Taking();
            t.Hash = (uint)hash;
            t.Max = max <= 0 ? int.MaxValue : max;
            t.Dry = mode == "count";
            t.Material = material == "any" ? null : material;
            Walk(character, pc, where, t);
            return (t.Dry ? "count " : "taken ") + t.Count.ToString(CultureInfo.InvariantCulture) + " " + t.Refused.ToString(CultureInfo.InvariantCulture);
        }

        static void Walk(PlayerCharacter character, PlayerController pc, string where, Taking t)
        {
            bool all = where == "all";
            if (all || where == "hands")
            {
                TakeHeld(pc.RightController, t);
                TakeHeld(pc.LeftController, t);
            }
            if (all || where == "belt") WalkDocks(character.BeltDocks.Components, t);
            if (all) WalkDocks(character.BackDocks.Components, t);
        }

        sealed class Taking
        {
            public uint Hash;
            public int Max;
            public bool Dry;
            public int Count;
            public int Refused;
            public string Material;
            public SortedDictionary<string, int> ByMaterial;
        }

        static string MaterialOf(Pickup p)
        {
            PhysicalMaterialPart part = p.Entity.GetComponentInChildren<PhysicalMaterialPart>();
            PhysicalMaterial m = part != null ? part.PhysicalMaterial : null;
            return m != null ? m.name : "none";
        }

        static string Squash(string s)
        {
            return s.Replace(" ", "").ToLowerInvariant();
        }

        static bool Matches(Pickup p, Taking t)
        {
            NetworkEntity e = p != null ? p.Entity : null;
            if (e == null || e.IsBeingDestroyed || e.Prefab == null || e.Prefab.Hash != t.Hash) return false;
            return t.Material == null || Squash(MaterialOf(p)) == Squash(t.Material);
        }

        static void Tally(Pickup p, int n, Taking t)
        {
            if (t.ByMaterial != null)
            {
                string key = MaterialOf(p);
                int had;
                t.ByMaterial.TryGetValue(key, out had);
                t.ByMaterial[key] = had + n;
            }
            t.Count += n;
        }

        static bool HasContents(Pickup p)
        {
            if (p.SubDocks == null) return false;
            IEnumerable<PickupDock> docks = p.SubDocks.TotalDocks;
            if (docks == null) return false;
            foreach (PickupDock d in docks)
            {
                if (d != null && d.HasDockedPickup) return true;
            }
            return false;
        }

        static void TakeHeld(Controller c, Taking t)
        {
            if (c == null || c.Interactor == null || t.Count >= t.Max) return;
            Pickup p = c.Interactor.InteractingWith as Pickup;
            if (p == null) return;
            if (!Matches(p, t))
            {
                if (p.SubDocks != null) WalkDocks(p.SubDocks.Docks, t);
                return;
            }
            if (HasContents(p))
            {
                t.Refused++;
                return;
            }
            if (!t.Dry) p.Entity.SceneDestroy();
            Tally(p, 1, t);
        }

        static void WalkDocks(IEnumerable<PickupDock> docks, Taking t)
        {
            if (docks == null) return;
            foreach (PickupDock dock in docks)
            {
                if (t.Count >= t.Max) return;
                if (dock == null || !dock.HasDockedPickup || dock.DockedPickup == null) continue;
                Pickup p = dock.DockedPickup;
                if (!Matches(p, t))
                {
                    if (p.SubDocks != null) WalkDocks(p.SubDocks.Docks, t);
                    continue;
                }
                int stored = Math.Max(1, dock.QuantityStored);
                if (HasContents(p))
                {
                    t.Refused += stored;
                    continue;
                }
                int n = Math.Min(stored, t.Max - t.Count);
                if (!t.Dry) dock.DestroyAmount(n);
                Tally(p, n, t);
            }
        }

        [Module("sweep", "Loose ground items: count (dry run) then run (despawn)")]
        public static class Sweep
        {
            public static string ProtectFilePath;

            static FieldInfo _entityManagerField;

            [Command("count", "Dry run: count loose ground items, optional item name or prefab hash filter")]
            public static string Count(string filter = null)
            {
                List<Hit> hits = FindLoose(filter);
                return Report("LOOSE", hits, filter, null);
            }

            [Command("run", "Despawn loose ground items, optional filter and max count")]
            public static string Run(string filter = null, int max = 0)
            {
                List<Hit> hits = FindLoose(filter);
                if (max > 0 && hits.Count > max) hits = hits.Take(max).ToList();

                int destroyed = 0;
                List<string> errors = new List<string>();
                foreach (Hit hit in hits)
                {
                    try
                    {
                        NetworkEntity e = hit.Entity;
                        if (e == null || e.IsBeingDestroyed) continue;
                        if (e.Spawner != null) e.Spawner.Destroy(e);
                        else e.SceneDestroy();
                        destroyed++;
                    }
                    catch (Exception ex)
                    {
                        if (errors.Count < 3) errors.Add(hit.PrefabName + ": " + ex.Message);
                    }
                }
                string tail = null;
                if (errors.Count > 0) tail = "errors (" + errors.Count + " shown max 3): " + string.Join("; ", errors.ToArray());
                return Report("SWEPT " + destroyed + " /", hits, filter, tail);
            }

            sealed class Hit
            {
                public NetworkEntity Entity;
                public string PrefabName;
            }

            static List<Hit> FindLoose(string filter)
            {
                string needle = Normalize(filter);
                if (needle == "all" || needle == "*") needle = "";
                uint hash = 0;
                bool byHash = needle.Length > 0 && uint.TryParse(needle, out hash);
                List<string> protect = LoadProtectList();

                List<Hit> hits = new List<Hit>();
                foreach (NetworkEntity e in AllEntities())
                {
                    if (!IsLoose(e)) continue;
                    if (byHash)
                    {
                        if (e.Prefab == null || e.Prefab.Hash != hash) continue;
                    }
                    string name = e.Prefab != null ? e.Prefab.name : e.name;
                    string norm = Normalize(name);
                    if (!byHash && needle.Length > 0 && norm.IndexOf(needle, StringComparison.Ordinal) < 0) continue;
                    if (IsProtected(norm, protect)) continue;
                    Hit hit = new Hit();
                    hit.Entity = e;
                    hit.PrefabName = name;
                    hits.Add(hit);
                }
                return hits;
            }

            static bool IsLoose(NetworkEntity e)
            {
                if (e == null || e.Parent != null || e.IsBeingDestroyed) return false;
                Pickup p = e.CommonPickup;
                if (p == null) return false;
                if (p.IsDocked || p.IsInteractedWith) return false;
                if (p.IsEnvironmental || p.IsChunkingParentStatic) return false;
                if (IsMounted(e)) return false;
                return true;
            }

            static bool IsMounted(NetworkEntity e)
            {
                try
                {
                    Joint[] joints = e.GetComponentsInChildren<Joint>(true);
                    return joints != null && joints.Length > 0;
                }
                catch (Exception)
                {
                    return true;
                }
            }

            static IEnumerable<NetworkEntity> AllEntities()
            {
                NetworkScene scene = NetworkSceneManager.Current as NetworkScene;
                if (scene != null)
                {
                    if (_entityManagerField == null)
                    {
                        _entityManagerField = typeof(NetworkScene).GetField("entityManager", BindingFlags.Instance | BindingFlags.NonPublic);
                    }
                    if (_entityManagerField != null)
                    {
                        EntityManager em = _entityManagerField.GetValue(scene) as EntityManager;
                        if (em != null) return em.IterateEntities();
                    }
                }
                return ChunkWalk();
            }

            static IEnumerable<NetworkEntity> ChunkWalk()
            {
                List<NetworkEntity> result = new List<NetworkEntity>();
                foreach (Chunk chunk in Chunk.ChunksByIndex.Values.ToList())
                {
                    if (chunk == null || chunk.Entities == null) continue;
                    foreach (NetworkEntity e in chunk.Entities.Entities) result.Add(e);
                }
                return result;
            }

            static List<string> LoadProtectList()
            {
                List<string> list = new List<string>();
                try
                {
                    if (ProtectFilePath != null && File.Exists(ProtectFilePath))
                    {
                        foreach (string raw in File.ReadAllLines(ProtectFilePath))
                        {
                            string line = raw.Trim();
                            if (line.Length == 0 || line.StartsWith("#", StringComparison.Ordinal)) continue;
                            string norm = Normalize(line);
                            if (norm.Length > 0) list.Add(norm);
                        }
                    }
                }
                catch (Exception) { }
                return list;
            }

            static bool IsProtected(string normName, List<string> protect)
            {
                for (int i = 0; i < protect.Count; i++)
                {
                    if (normName.IndexOf(protect[i], StringComparison.Ordinal) >= 0) return true;
                }
                return false;
            }

            static string Normalize(string s)
            {
                if (s == null) return "";
                char[] buffer = new char[s.Length];
                int n = 0;
                for (int i = 0; i < s.Length; i++)
                {
                    char c = s[i];
                    if (c == ' ' || c == '-' || c == '_' || c == '\'') continue;
                    buffer[n++] = char.ToLowerInvariant(c);
                }
                return new string(buffer, 0, n);
            }

            static string Report(string verb, List<Hit> hits, string filter, string tail)
            {
                Dictionary<string, int> byPrefab = new Dictionary<string, int>();
                foreach (Hit hit in hits)
                {
                    int count;
                    byPrefab.TryGetValue(hit.PrefabName, out count);
                    byPrefab[hit.PrefabName] = count + 1;
                }

                List<string> lines = new List<string>();
                string f = string.IsNullOrEmpty(filter) ? "none" : filter;
                lines.Add(verb + " " + hits.Count + " loose item(s), " + byPrefab.Count
                    + " prefab(s), filter: " + f + " (docked/held/mounted/static items never match)");

                List<KeyValuePair<string, int>> sorted = byPrefab
                    .OrderByDescending(kv => kv.Value)
                    .ThenBy(kv => kv.Key)
                    .ToList();
                int shown = Math.Min(sorted.Count, 30);
                for (int i = 0; i < shown; i++)
                {
                    lines.Add("  " + sorted[i].Value.ToString(CultureInfo.InvariantCulture).PadLeft(4) + "  " + sorted[i].Key);
                }
                if (sorted.Count > shown) lines.Add("  ... and " + (sorted.Count - shown) + " more prefab(s)");
                if (tail != null) lines.Add(tail);
                return string.Join("\n", lines.ToArray());
            }
        }
    }
}
