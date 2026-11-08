// 命令：cmd.exe /d /s /c 跑（先换成 UTF-8 代码页），工作目录要在授权目录里；stdout、stderr 各留 maxOutputBytes
// （默认 100 KiB），多的照样读完丢掉；超时（默认 120 秒）或壳取消就连子进程一起结束（taskkill /T /F，和托盘
// Paths.KillTree 同一个做法）。回执形状是设备动作 run_command 的回执。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

namespace Plasticine.Helper
{
    static class Commands
    {
        sealed class Capture
        {
            readonly int limit;
            readonly MemoryStream kept = new MemoryStream();
            public bool Truncated;
            public Capture(int limit) { this.limit = limit; }

            public void Drain(Stream stream)
            {
                var buffer = new byte[8192];
                int read;
                while ((read = stream.Read(buffer, 0, buffer.Length)) > 0)
                {
                    int room = limit - (int)kept.Length;
                    if (room > 0) kept.Write(buffer, 0, Math.Min(room, read));
                    if (read > room) Truncated = true;
                }
            }

            public string Text()
            {
                return new UTF8Encoding(false, false).GetString(kept.ToArray());
            }
        }

        static void KillTree(int pid)
        {
            var info = new ProcessStartInfo("taskkill", "/PID " + pid + " /T /F");
            info.CreateNoWindow = true;
            info.UseShellExecute = false;
            using (var process = Process.Start(info)) process.WaitForExit(10000);
        }

        public static Dictionary<string, object> Run(string command, string cwd, int timeoutSeconds, int maxOutputBytes,
            CancellationToken token)
        {
            string directory = PathPolicy.Allowed(cwd);
            if (!Directory.Exists(directory)) throw new HelperError("not_found", "没有这个工作目录：" + cwd);
            var info = new ProcessStartInfo("cmd.exe", "/d /s /c \"chcp 65001>nul & " + command + "\"");
            info.WorkingDirectory = directory;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.RedirectStandardInput = true;
            using (var process = Process.Start(info))
            {
                process.StandardInput.Close();
                var stdout = new Capture(maxOutputBytes);
                var stderr = new Capture(maxOutputBytes);
                var readOut = new Thread(delegate () { stdout.Drain(process.StandardOutput.BaseStream); });
                var readErr = new Thread(delegate () { stderr.Drain(process.StandardError.BaseStream); });
                readOut.Start();
                readErr.Start();
                DateTime deadline = DateTime.UtcNow.AddSeconds(timeoutSeconds);
                bool timedOut = false;
                while (!process.WaitForExit(200))
                {
                    if (token.IsCancellationRequested || DateTime.UtcNow > deadline)
                    {
                        timedOut = !token.IsCancellationRequested;
                        KillTree(process.Id);
                        break;
                    }
                }
                process.WaitForExit(5000);
                readOut.Join(5000);
                readErr.Join(5000);
                token.ThrowIfCancellationRequested();
                string errors = stderr.Text();
                if (timedOut) errors += "\n（" + timeoutSeconds + " 秒没跑完，已结束这条命令和它开的进程。）";
                return Program.Result("exitCode", process.HasExited ? process.ExitCode : -1,
                    "stdout", stdout.Text(), "stderr", errors, "truncated", stdout.Truncated || stderr.Truncated);
            }
        }
    }
}
