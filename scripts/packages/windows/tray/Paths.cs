// Windows 安装包的位置和小工具（docs/install-packages.md）。.NET Framework 4.x 自带的 csc 只认 C# 5：
// 不用 $"" 插值、?.、=> 成员。
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;

namespace Plasticine
{
    static class Paths
    {
        // 和服务的默认端口一致（agent/src/app/config.ts），Linux / Mac 安装包也用这个。
        public const int Port = 8790;
        public const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        public const string RunValue = "Plasticine";

        public static string AppDirectory
        {
            get { return Path.GetDirectoryName(System.Windows.Forms.Application.ExecutablePath); }
        }

        public static string Node { get { return Path.Combine(AppDirectory, "node", "node.exe"); } }
        public static string Server { get { return Path.Combine(AppDirectory, "server"); } }

        /// <summary>%LOCALAPPDATA%\Plasticine：数据、日志、更新下载、留作回退的安装程序。卸载时问了才删。</summary>
        public static string Data
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Plasticine");
            }
        }

        public static string State { get { return Path.Combine(Data, "state"); } }
        public static string Logs { get { return Path.Combine(Data, "logs"); } }
        public static string Updates { get { return Path.Combine(Data, "updates"); } }
        public static string Installers { get { return Path.Combine(Data, "installers"); } }

        public static string LocalUrl { get { return "http://127.0.0.1:" + Port + "/"; } }

        // 2026-11-05 网页是正式端，不再拦普通浏览器，打开的就是本机地址本身。
        public static string BrowserUrl { get { return LocalUrl; } }

        public static void Log(string file, string line)
        {
            try
            {
                Directory.CreateDirectory(Logs);
                string path = Path.Combine(Logs, file);
                // 超过 10 MB 换一份，只留上一份。
                if (File.Exists(path) && new FileInfo(path).Length > 10 * 1024 * 1024)
                {
                    File.Copy(path, path + ".1", true);
                    File.Delete(path);
                }
                File.AppendAllText(path, DateTime.Now.ToString("s") + " " + line + Environment.NewLine, Encoding.UTF8);
            }
            catch (IOException error)
            {
                // 日志写不进去不影响服务；只能打到调试输出。
                Debug.WriteLine(error.Message);
            }
        }

        /// <summary>本机服务答上 /v2/health 就是 true；不走系统代理。</summary>
        public static bool Healthy()
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(LocalUrl + "v2/health");
                request.Proxy = null;
                request.Timeout = 2000;
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    return response.StatusCode == HttpStatusCode.OK;
                }
            }
            catch (WebException)
            {
                return false;
            }
        }

        public static bool WaitHealthy(TimeSpan timeout)
        {
            DateTime deadline = DateTime.UtcNow + timeout;
            while (DateTime.UtcNow < deadline)
            {
                if (Healthy()) return true;
                System.Threading.Thread.Sleep(500);
            }
            return false;
        }

        /// <summary>点分数字逐段比较（和 scripts/packages/release-manifest.ts 的 isNewerVersion 同一规则）。</summary>
        public static bool IsNewer(string candidate, string current)
        {
            string[] left = candidate.Split('.');
            string[] right = current.Split('.');
            for (int i = 0; i < Math.Max(left.Length, right.Length); i++)
            {
                long a = i < left.Length ? ParsePart(left[i]) : 0;
                long b = i < right.Length ? ParsePart(right[i]) : 0;
                if (a != b) return a > b;
            }
            return false;
        }

        static long ParsePart(string part)
        {
            long value;
            return long.TryParse(part, out value) ? value : 0;
        }

        /// <summary>结束进程和它开的子进程（PowerShell 命令等）。</summary>
        public static void KillTree(int pid)
        {
            var info = new ProcessStartInfo("taskkill", "/PID " + pid + " /T /F");
            info.CreateNoWindow = true;
            info.UseShellExecute = false;
            using (var process = Process.Start(info))
            {
                process.WaitForExit(10000);
            }
        }
    }
}
