// 看护 node.exe 跑的 Plasticine 服务（docs/install-packages.md）：崩了按 1、2、4…30 秒退避重启，稳定跑满一分钟
// 退避归零；停的时候先关 stdin（服务设了 PLASTICINE_STOP_ON_STDIN_EOF=1，自己收尾），等 5 秒还在就 taskkill /T /F。
// 托盘被强行结束时管道一断，服务也自己收尾，不会留一个孤儿进程占着端口。
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

namespace Plasticine
{
    sealed class ServerProcess
    {
        static readonly int[] Delays = { 1, 2, 4, 8, 16, 30 };
        const int StableSeconds = 60;
        const int StopGraceMilliseconds = 5000;

        readonly object gate = new object();
        Process process;
        Timer restartTimer;
        bool wanted;
        int failures;
        DateTime startedAt;

        public event Action<string> StateChanged;

        public void Start()
        {
            lock (gate)
            {
                wanted = true;
                if (process == null) Launch();
            }
        }

        public void Restart()
        {
            Stop();
            lock (gate) { failures = 0; }
            Start();
        }

        public void Stop()
        {
            Process running;
            lock (gate)
            {
                wanted = false;
                if (restartTimer != null) { restartTimer.Dispose(); restartTimer = null; }
                running = process;
                process = null;
            }
            if (running == null) return;
            try
            {
                running.StandardInput.Close();
                if (!running.WaitForExit(StopGraceMilliseconds)) Paths.KillTree(running.Id);
            }
            catch (InvalidOperationException error)
            {
                // 进程已经结束：没什么要停的。
                Paths.Log("tray.log", "停服务时进程已结束：" + error.Message);
            }
            Notify("已停止");
        }

        void Launch()
        {
            if (!File.Exists(Paths.Node) || !Directory.Exists(Paths.Server))
            {
                Notify("安装不完整：找不到 node.exe 或服务目录，请重新安装");
                return;
            }
            Directory.CreateDirectory(Paths.State);
            var info = new ProcessStartInfo(Paths.Node, @"agent\src\app\main.ts");
            info.WorkingDirectory = Paths.Server;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardInput = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.EnvironmentVariables["PLASTICINE_STATE"] = Paths.State;
            info.EnvironmentVariables["PLASTICINE_PORT"] = Paths.Port.ToString();
            info.EnvironmentVariables["PLASTICINE_CLIENT_DIR"] = Path.Combine(Paths.Server, @"client\dist");
            info.EnvironmentVariables["PLASTICINE_PLAIN_HTTP"] = "1";
            // 2026-11-05 他定：朋友的实例真跑；对外的动作仍由硬线审批把关。
            info.EnvironmentVariables["PLASTICINE_DRY_RUN"] = "0";
            info.EnvironmentVariables["PLASTICINE_STOP_ON_STDIN_EOF"] = "1";
            var started = new Process();
            started.StartInfo = info;
            started.EnableRaisingEvents = true;
            started.OutputDataReceived += (sender, e) => { if (e.Data != null) Paths.Log("server.log", e.Data); };
            started.ErrorDataReceived += (sender, e) => { if (e.Data != null) Paths.Log("server.log", e.Data); };
            started.Exited += (sender, e) => Exited(started);
            try
            {
                started.Start();
            }
            catch (System.ComponentModel.Win32Exception error)
            {
                Notify("服务没能启动：" + error.Message);
                ScheduleRestart();
                return;
            }
            started.BeginOutputReadLine();
            started.BeginErrorReadLine();
            process = started;
            startedAt = DateTime.UtcNow;
            Notify("正在启动…");
            ThreadPool.QueueUserWorkItem(_ =>
            {
                if (Paths.WaitHealthy(TimeSpan.FromSeconds(60)) && ReferenceEquals(process, started)) Notify("运行中");
            });
        }

        void Exited(Process finished)
        {
            lock (gate)
            {
                if (!ReferenceEquals(process, finished)) return;
                process = null;
                if (!wanted) return;
                Notify("服务退出了（" + finished.ExitCode + "），正在重启");
                ScheduleRestart();
            }
        }

        void ScheduleRestart()
        {
            if ((DateTime.UtcNow - startedAt).TotalSeconds >= StableSeconds) failures = 0;
            int delay = Delays[Math.Min(failures, Delays.Length - 1)];
            failures++;
            if (restartTimer != null) restartTimer.Dispose();
            restartTimer = new Timer(_ =>
            {
                lock (gate)
                {
                    if (wanted && process == null) Launch();
                }
            }, null, delay * 1000, Timeout.Infinite);
        }

        void Notify(string state)
        {
            Paths.Log("tray.log", "服务：" + state);
            var handler = StateChanged;
            if (handler != null) handler(state);
        }
    }
}
