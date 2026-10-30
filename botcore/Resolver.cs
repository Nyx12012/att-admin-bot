using System;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using Alta.Networking.Scripts.Player;
using HarmonyLib;
using MelonLoader;
using Newtonsoft.Json.Linq;

namespace BotCore
{
    public static class Resolver
    {
        static MelonLogger.Instance _log;
        static FieldInfo _fiIsByUsername;
        static FieldInfo _fiUserIdentifier;
        static FieldInfo _fiUsername;
        static FieldInfo _fiHasSearched;
        static FieldInfo _fiUserInfo;
        static Type _userInfoType;

        public static bool Active;

        public static string UsersFile
        {
            get
            {
                string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                return Path.Combine(Path.Combine(appData, "TheModdingTavern"), "users.json");
            }
        }

        public static void Apply(MelonLogger.Instance log)
        {
            _log = log;
            try
            {
                Type uia = typeof(UserInfoAccess);
                const BindingFlags priv = BindingFlags.NonPublic | BindingFlags.Instance;
                _fiIsByUsername = uia.GetField("isByUsername", priv);
                _fiUserIdentifier = uia.GetField("userIdentifier", priv);
                _fiUsername = uia.GetField("username", priv);
                _fiHasSearched = uia.GetField("hasSearched", priv);
                _fiUserInfo = uia.GetField("userInfo", priv);
                if (_fiIsByUsername == null || _fiUserIdentifier == null || _fiUsername == null
                    || _fiHasSearched == null || _fiUserInfo == null)
                {
                    log.Error("UserInfoAccess fields not found, the game layout changed. Economy verbs stay as they are.");
                    return;
                }
                _userInfoType = _fiUserInfo.FieldType;

                MethodInfo target = uia.GetMethod("SearchForUserAsync", priv);
                if (target == null)
                {
                    log.Error("UserInfoAccess.SearchForUserAsync not found. Economy verbs stay as they are.");
                    return;
                }
                MethodInfo prefix = typeof(Resolver).GetMethod("SearchPrefix", BindingFlags.NonPublic | BindingFlags.Static);
                new HarmonyLib.Harmony("botcore.resolver").Patch(target, new HarmonyMethod(prefix));
                Active = true;
                log.Msg("Player lookups now answer from the online list and users.json");
            }
            catch (Exception e)
            {
                log.Error("Resolver failed to apply: " + e);
            }
        }

        static bool SearchPrefix(object __instance, ref Task __result)
        {
            try
            {
                bool byName = (bool)_fiIsByUsername.GetValue(__instance);
                string uname = (string)_fiUsername.GetValue(__instance);
                int uid = (int)_fiUserIdentifier.GetValue(__instance);
                string arg = byName ? uname : uid.ToString(CultureInfo.InvariantCulture);
                object resolved = ResolveConnected(arg);
                if (resolved == null) resolved = FromUsersFile(byName, uname, uid);
                _fiUserInfo.SetValue(__instance, resolved);
                _fiHasSearched.SetValue(__instance, true);
            }
            catch (Exception e)
            {
                if (_log != null) _log.Warning("Player lookup failed: " + e.Message);
            }
            __result = Task.FromResult(true);
            return false;
        }

        public static IPlayer Connected(string arg)
        {
            if (string.IsNullOrEmpty(arg)) return null;
            try
            {
                PlayerConverter conv = new PlayerConverter();
                return conv.ConvertFrom(null, CultureInfo.InvariantCulture, arg) as IPlayer;
            }
            catch (Exception)
            {
                return null;
            }
        }

        static object ResolveConnected(string arg)
        {
            IPlayer player = Connected(arg);
            if (player == null || player.UserInfo == null) return null;
            return player.UserInfo.UserInfo;
        }

        public static bool LookupUsersFile(string arg, out int id, out string name)
        {
            id = -1;
            name = null;
            int parsed;
            bool byId = int.TryParse(arg, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed);
            string key = byId ? null : arg.ToLowerInvariant();
            try
            {
                string path = UsersFile;
                if (!File.Exists(path)) return false;
                JObject root = JObject.Parse(File.ReadAllText(path));
                JObject users = root["users"] as JObject;
                if (users == null) return false;
                if (!byId)
                {
                    JObject user = users[key] as JObject;
                    if (user == null) return false;
                    long found = ReadId(user);
                    if (found < 0 || found > int.MaxValue) return false;
                    id = (int)found;
                    name = key;
                    return true;
                }
                foreach (JProperty p in users.Properties())
                {
                    JObject user = p.Value as JObject;
                    if (user == null) continue;
                    if (ReadId(user) != parsed) continue;
                    id = parsed;
                    name = p.Name;
                    return true;
                }
                return false;
            }
            catch (Exception e)
            {
                if (_log != null) _log.Warning("Could not read users.json: " + e.Message);
                return false;
            }
        }

        static long ReadId(JObject user)
        {
            JToken token = user["user_id"];
            if (token == null) return -1;
            try { return token.Value<long>(); }
            catch (Exception) { return -1; }
        }

        static object FromUsersFile(bool byName, string uname, int uid)
        {
            int id;
            string name;
            string arg = byName ? uname : uid.ToString(CultureInfo.InvariantCulture);
            if (!LookupUsersFile(arg, out id, out name)) return null;
            return MakeUserInfo(id, name);
        }

        static object MakeUserInfo(int id, string name)
        {
            ConstructorInfo ctor = _userInfoType.GetConstructor(new Type[] { typeof(int), typeof(string) });
            if (ctor != null) return ctor.Invoke(new object[] { id, name });
            object o = Activator.CreateInstance(_userInfoType);
            PropertyInfo pid = _userInfoType.GetProperty("Identifier");
            PropertyInfo pname = _userInfoType.GetProperty("Username");
            if (pid != null && pid.CanWrite) pid.SetValue(o, id, null);
            if (pname != null && pname.CanWrite) pname.SetValue(o, name, null);
            return o;
        }
    }
}
