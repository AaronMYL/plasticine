// Plasticine 的 Windows 托盘（docs/install-packages.md）：看护后台的服务，托盘菜单只有几项——打开（默认浏览器打开
// 本机地址）、重新启动、开机时启动、回到上一版（有上一版时才有）、退出。没有应用内浏览器。
//   PlasticineTray.exe --open        起托盘和服务，再打开浏览器（开始菜单、安装完成时）
//   PlasticineTray.exe --background  只起托盘和服务（开机启动、更新后）
//   PlasticineTray.exe --quit        让正在跑的托盘停服务、退出（安装程序、卸载程序用）
// 选 C# WinForms 的理由：.NET Framework 4.x 和它的编译器 csc 每台 Windows 10/11 都自带，NotifyIcon 是系统托盘
// 最成熟的封装；不加任何依赖，CI 上一条命令编出来。用 Node 的托盘包要么带一个额外的原生二进制，要么不再维护。
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Plasticine
{
    static class Program
    {
        const string MutexName = @"Local\PlasticineTray";
        public const string QuitEvent = @"Local\PlasticineTrayQuit";
        public const string OpenEvent = @"Local\PlasticineTrayOpen";

        [STAThread]
        static int Main(string[] args)
        {
            string mode = args.Length > 0 ? args[0] : "--open";
            if (mode == "--quit") return RequestQuit();
            bool created;
            using (var mutex = new Mutex(true, MutexName, out created))
            {
                if (!created)
                {
                    if (mode == "--open") Signal(OpenEvent);
                    return 0;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new Tray(mode == "--open"));
                GC.KeepAlive(mutex);
            }
            return 0;
        }

        static void Signal(string name)
        {
            EventWaitHandle handle;
            if (EventWaitHandle.TryOpenExisting(name, out handle))
            {
                using (handle) handle.Set();
            }
        }

        /// <summary>让正在跑的托盘退出，最多等 20 秒（停服务最多 5 秒）。没有在跑的托盘就直接返回。</summary>
        static int RequestQuit()
        {
            Signal(QuitEvent);
            bool created;
            for (int i = 0; i < 40; i++)
            {
                using (var probe = new Mutex(false, MutexName, out created))
                {
                    if (created) return 0;
                }
                Thread.Sleep(500);
            }
            return 1;
        }
    }

    sealed class Tray : ApplicationContext
    {
        readonly NotifyIcon icon = new NotifyIcon();
        readonly ServerProcess server = new ServerProcess();
        readonly Updater updater = new Updater();
        readonly ToolStripMenuItem status = new ToolStripMenuItem("正在启动…");
        readonly ToolStripMenuItem startAtLogin = new ToolStripMenuItem("开机时启动");
        readonly ToolStripMenuItem rollBack = new ToolStripMenuItem("回到上一版");
        readonly SynchronizationContext ui;
        readonly System.Windows.Forms.Timer daily = new System.Windows.Forms.Timer();
        readonly EventWaitHandle quitSignal = new EventWaitHandle(false, EventResetMode.AutoReset, Program.QuitEvent);
        readonly EventWaitHandle openSignal = new EventWaitHandle(false, EventResetMode.AutoReset, Program.OpenEvent);
        bool quitting;

        public Tray(bool open)
        {
            // 建菜单（第一个控件）时 WinForms 才装上它的同步上下文；之后后台线程的回调都 Post 回这条界面线程。
            BuildMenu();
            ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            server.StateChanged += state => ui.Post(_ => ShowState(state), null);
            FirstRunDefaults();
            server.Start();
            ListenForSignals();
            if (open) OpenBrowser();
            // 启动后一分钟查一次更新（先让服务起来、上次的更新先验收），之后每天一次。
            ThreadPool.QueueUserWorkItem(_ => AfterStart());
            daily.Interval = 24 * 60 * 60 * 1000;
            daily.Tick += (sender, e) => ThreadPool.QueueUserWorkItem(_ => CheckForUpdate());
            daily.Start();
        }

        void BuildMenu()
        {
            var menu = new ContextMenuStrip();
            var open = new ToolStripMenuItem("打开 Plasticine", null, (sender, e) => OpenBrowser());
            open.Font = new Font(open.Font, FontStyle.Bold);
            status.Enabled = false;
            startAtLogin.Checked = StartsAtLogin();
            startAtLogin.Click += (sender, e) => ToggleStartAtLogin();
            rollBack.Click += (sender, e) => RollBack();
            menu.Items.Add(open);
            menu.Items.Add(status);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("重新启动", null, (sender, e) =>
                ThreadPool.QueueUserWorkItem(_ => server.Restart())));
            menu.Items.Add(startAtLogin);
            menu.Items.Add(rollBack);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("退出", null, (sender, e) => Quit()));
            menu.Opening += (sender, e) => rollBack.Visible = updater.PreviousInstaller() != null;
            icon.ContextMenuStrip = menu;
            icon.Icon = DrawIcon();
            icon.Text = "Plasticine";
            icon.DoubleClick += (sender, e) => OpenBrowser();
            icon.Visible = true;
        }

        void ShowState(string state)
        {
            status.Text = "服务：" + state;
            icon.Text = ("Plasticine · " + state).Length > 63 ? "Plasticine" : "Plasticine · " + state;
        }

        void ListenForSignals()
        {
            var thread = new Thread(() =>
            {
                var handles = new WaitHandle[] { quitSignal, openSignal };
                while (true)
                {
                    int which = WaitHandle.WaitAny(handles);
                    if (which == 0)
                    {
                        ui.Post(_ => Quit(), null);
                        return;
                    }
                    ui.Post(_ => OpenBrowser(), null);
                }
            });
            thread.IsBackground = true;
            thread.Start();
        }

        void OpenBrowser()
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                if (!Paths.WaitHealthy(TimeSpan.FromSeconds(60)))
                {
                    ui.Post(__ => MessageBox.Show("Plasticine 服务一分钟内没起来。\n日志在 " + Paths.Logs,
                        "Plasticine", MessageBoxButtons.OK, MessageBoxIcon.Warning), null);
                    return;
                }
                Process.Start(new ProcessStartInfo(Paths.BrowserUrl) { UseShellExecute = true });
            });
        }

        void AfterStart()
        {
            string back = updater.CheckAfterUpdate();
            if (back != null)
            {
                ui.Post(_ => Install(back), null);
                return;
            }
            Thread.Sleep(TimeSpan.FromMinutes(1));
            CheckForUpdate();
        }

        void CheckForUpdate()
        {
            try
            {
                string installer = updater.CheckAndDownload();
                if (installer != null) ui.Post(_ => Install(installer), null);
            }
            catch (Exception error)
            {
                // 网络不通、发布点暂时不可用：明天再查。
                Paths.Log("tray.log", "更新：这次没查成：" + error.Message);
            }
        }

        void RollBack()
        {
            string installer = updater.PreviousInstaller();
            if (installer == null) return;
            var answer = MessageBox.Show("回到上一版 Plasticine？数据不受影响。", "Plasticine",
                MessageBoxButtons.OKCancel, MessageBoxIcon.Question);
            if (answer != DialogResult.OK) return;
            updater.SkipCurrent();
            Install(installer);
        }

        /// <summary>停服务、静默运行安装程序、退出托盘；安装程序装完会把新托盘起来。</summary>
        void Install(string installer)
        {
            Shutdown();
            Updater.RunInstaller(installer);
            ExitThread();
        }

        void Quit()
        {
            Shutdown();
            ExitThread();
        }

        void Shutdown()
        {
            if (quitting) return;
            quitting = true;
            daily.Stop();
            server.Stop();
            icon.Visible = false;
        }

        static bool StartsAtLogin()
        {
            using (var key = Registry.CurrentUser.OpenSubKey(Paths.RunKey))
            {
                return key != null && key.GetValue(Paths.RunValue) != null;
            }
        }

        static void SetStartAtLogin(bool enabled)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(Paths.RunKey))
            {
                if (enabled) key.SetValue(Paths.RunValue, "\"" + Application.ExecutablePath + "\" --background");
                else key.DeleteValue(Paths.RunValue, false);
            }
        }

        void ToggleStartAtLogin()
        {
            SetStartAtLogin(!StartsAtLogin());
            startAtLogin.Checked = StartsAtLogin();
        }

        /// <summary>第一次运行默认开机启动；之后以托盘里的勾为准（更新、重装都不改它）。</summary>
        static void FirstRunDefaults()
        {
            Directory.CreateDirectory(Paths.Data);
            string marker = Path.Combine(Paths.Data, "first-run-done");
            if (File.Exists(marker)) return;
            SetStartAtLogin(true);
            File.WriteAllText(marker, DateTime.Now.ToString("s"));
        }

        /// <summary>托盘、EXE 和安装器共用由网页新泥团旋纹生成的原生图标。</summary>
        static Icon DrawIcon()
        {
            return Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        }
    }
}
