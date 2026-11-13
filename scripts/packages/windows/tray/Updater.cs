// Windows 安装包的自更新（docs/install-packages.md）：启动后一分钟和每天查一次发布点的 manifest.json
// （格式见 scripts/packages/release-manifest.ts），有更新的版本就下载 assets.windows 的安装程序、核对 SHA-256 和
// 大小，记下「正在从 A 换到 B」，然后静默运行它（它会先让托盘退出、换掉程序文件、再把新托盘起来）。
// 新托盘起来后看这条记录：一分半内服务答上健康检查就算成了；答不上就静默运行上一版的安装程序退回去，
// 这一版记进「跳过」不再自动装。每次安装都把安装程序本身留一份在 %LOCALAPPDATA%\Plasticine\installers，
// 「回到上一版」就是运行上一份。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace Plasticine
{
    sealed class Updater
    {
        static readonly TimeSpan HealthAfterUpdate = TimeSpan.FromSeconds(90);
        static readonly TimeSpan KeepInstallers = TimeSpan.FromDays(7);
        static string PendingFile { get { return Path.Combine(Paths.Data, "update-pending.json"); } }
        static string StateFile { get { return Path.Combine(Paths.Data, "update-state.json"); } }

        readonly JavaScriptSerializer json = new JavaScriptSerializer();

        /// <summary>装着的版本和发布点（服务包的 manifest.json）。</summary>
        public string CurrentVersion { get { return Text(LocalManifest(), "version"); } }

        Dictionary<string, object> LocalManifest()
        {
            string text = File.ReadAllText(Path.Combine(Paths.Server, "manifest.json"), Encoding.UTF8);
            return (Dictionary<string, object>)json.DeserializeObject(text);
        }

        static string Text(Dictionary<string, object> map, string key)
        {
            object value;
            return map != null && map.TryGetValue(key, out value) && value != null ? value.ToString() : null;
        }

        static Dictionary<string, object> Child(Dictionary<string, object> map, string key)
        {
            object value;
            return map != null && map.TryGetValue(key, out value) ? value as Dictionary<string, object> : null;
        }

        /// <summary>查一次；有新版且下载核对通过就返回安装程序路径（调用方停服务、运行它、退出托盘），否则 null。</summary>
        public string CheckAndDownload()
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            try { PruneInstallers(); }
            catch (Exception error) { Paths.Log("tray.log", "清旧安装程序没成：" + error.Message); }
            var local = LocalManifest();
            string releaseUrl = Text(local, "releaseUrl");
            string current = Text(local, "version");
            var manifestUri = new Uri(releaseUrl.TrimEnd('/') + "/manifest.json");
            RequireHttps(manifestUri);
            var release = (Dictionary<string, object>)json.DeserializeObject(DownloadText(manifestUri));
            string version = Text(release, "version");
            var asset = Child(Child(release, "assets"), "windows");
            if (version == null || asset == null || !Paths.IsNewer(version, current)) return null;
            if (Skipped().Contains(version))
            {
                Paths.Log("tray.log", "更新：跳过 " + version + "（上次装上后没起来，已退回）");
                return null;
            }
            var assetUri = new Uri(manifestUri, Text(asset, "url"));
            RequireHttps(assetUri);
            string name = Path.GetFileName(Text(asset, "name"));
            Directory.CreateDirectory(Paths.Updates);
            string target = Path.Combine(Paths.Updates, name);
            string partial = target + ".part";
            using (var client = new WebClient())
            {
                client.DownloadFile(assetUri, partial);
            }
            long size = Convert.ToInt64(asset["size"]);
            if (new FileInfo(partial).Length != size || Sha256(partial) != Text(asset, "sha256"))
            {
                File.Delete(partial);
                throw new InvalidDataException(name + " 的大小或 SHA-256 和发布清单对不上，没有安装。");
            }
            if (File.Exists(target)) File.Delete(target);
            File.Move(partial, target);
            WritePending(current, version);
            Paths.Log("tray.log", "更新：" + current + " → " + version + "，安装程序已核对");
            return target;
        }

        /// <summary>新托盘起来时调：上次是更新换上来的，就看服务健不健康；不健康返回上一版安装程序的路径。</summary>
        public string CheckAfterUpdate()
        {
            if (!File.Exists(PendingFile)) return null;
            var pending = (Dictionary<string, object>)json.DeserializeObject(File.ReadAllText(PendingFile, Encoding.UTF8));
            string from = Text(pending, "from");
            string to = Text(pending, "to");
            File.Delete(PendingFile);
            if (Paths.WaitHealthy(HealthAfterUpdate))
            {
                Paths.Log("tray.log", "更新：" + to + " 已起来");
                PruneInstallers();
                return null;
            }
            Paths.Log("tray.log", "更新：" + to + " 没起来，退回 " + from);
            Skip(to);
            return Installer(from);
        }

        /// <summary>「回到上一版」：比装着的旧的那份安装程序里最新的一份；当前版本记进跳过，免得第二天又装回来。</summary>
        public string PreviousInstaller()
        {
            string current = CurrentVersion;
            return InstallerVersions()
                .Where(version => Paths.IsNewer(current, version))
                .OrderByDescending(version => version, Comparer<string>.Create(Compare))
                .Select(version => Installer(version))
                .FirstOrDefault(path => path != null);
        }

        public void SkipCurrent() { Skip(CurrentVersion); }

        /// <summary>静默运行安装程序；它会先让这个托盘退出。</summary>
        public static void RunInstaller(string path)
        {
            Directory.CreateDirectory(Paths.Logs);
            string log = Path.Combine(Paths.Logs, "install.log");
            var info = new ProcessStartInfo(path, "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG=\"" + log + "\"");
            info.UseShellExecute = false;
            Process.Start(info);
        }

        static int Compare(string left, string right)
        {
            if (Paths.IsNewer(left, right)) return 1;
            return Paths.IsNewer(right, left) ? -1 : 0;
        }

        static IEnumerable<string> InstallerVersions()
        {
            if (!Directory.Exists(Paths.Installers)) return new string[0];
            return Directory.GetFiles(Paths.Installers, "Plasticine-Setup-*.exe")
                .Select(path => Path.GetFileNameWithoutExtension(path).Substring("Plasticine-Setup-".Length));
        }

        static string Installer(string version)
        {
            if (version == null) return null;
            string path = Path.Combine(Paths.Installers, "Plasticine-Setup-" + version + ".exe");
            return File.Exists(path) ? path : null;
        }

        /// <summary>
        /// 只留最新 2 份安装程序，每份从下载那一刻起满 7 天就删（2026-11-13 定）。按文件的创建时间算，打开、复制都不会让它重新计时。
        /// 更新成功后跑一次，每次查更新也跑一次，所以没有新版本也会到期清。
        /// </summary>
        public void PruneInstallers()
        {
            DateTime cutoff = DateTime.UtcNow - KeepInstallers;
            var keep = InstallerVersions()
                .Where(v => File.GetCreationTimeUtc(Installer(v)) > cutoff)
                .OrderByDescending(v => v, Comparer<string>.Create(Compare)).Take(2).ToList();
            foreach (string version in InstallerVersions().ToList())
            {
                if (!keep.Contains(version)) File.Delete(Installer(version));
            }
            if (Directory.Exists(Paths.Updates)) Directory.Delete(Paths.Updates, true);
        }

        List<string> Skipped()
        {
            if (!File.Exists(StateFile)) return new List<string>();
            var state = (Dictionary<string, object>)json.DeserializeObject(File.ReadAllText(StateFile, Encoding.UTF8));
            object list;
            if (state == null || !state.TryGetValue("skipped", out list) || !(list is object[])) return new List<string>();
            return ((object[])list).Select(item => item.ToString()).ToList();
        }

        void Skip(string version)
        {
            var skipped = Skipped();
            if (version != null && !skipped.Contains(version)) skipped.Add(version);
            var state = new Dictionary<string, object>();
            state["skipped"] = skipped;
            File.WriteAllText(StateFile, json.Serialize(state), Encoding.UTF8);
        }

        void WritePending(string from, string to)
        {
            var pending = new Dictionary<string, object>();
            pending["from"] = from;
            pending["to"] = to;
            File.WriteAllText(PendingFile, json.Serialize(pending), Encoding.UTF8);
        }

        static void RequireHttps(Uri uri)
        {
            if (uri.Scheme != Uri.UriSchemeHttps) throw new InvalidDataException("发布点只能是 https：" + uri);
        }

        static string DownloadText(Uri uri)
        {
            using (var client = new WebClient())
            {
                client.Encoding = Encoding.UTF8;
                return client.DownloadString(uri);
            }
        }

        static string Sha256(string path)
        {
            using (var sha = SHA256.Create())
            using (var stream = File.OpenRead(path))
            {
                return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            }
        }
    }
}
