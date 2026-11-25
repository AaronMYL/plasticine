using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

namespace Plasticine.Helper
{
    static class Windows
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }

        delegate bool EnumProc(IntPtr hwnd, IntPtr param);

        [DllImport("user32.dll")]
        static extern bool EnumWindows(EnumProc callback, IntPtr param);

        [DllImport("user32.dll")]
        static extern bool IsWindowVisible(IntPtr hwnd);

        [DllImport("user32.dll")]
        static extern bool IsIconic(IntPtr hwnd);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);

        [DllImport("user32.dll")]
        static extern int GetWindowTextLength(IntPtr hwnd);

        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);

        [DllImport("user32.dll")]
        static extern int GetWindowLong(IntPtr hwnd, int index);

        [DllImport("user32.dll")]
        static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hwnd, int cmd);

        [DllImport("user32.dll")]
        static extern bool SetForegroundWindow(IntPtr hwnd);

        [DllImport("user32.dll")]
        static extern void SwitchToThisWindow(IntPtr hwnd, bool altTab);

        [DllImport("user32.dll")]
        static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);

        [DllImport("user32.dll")]
        public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);

        [DllImport("dwmapi.dll")]
        static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);

        const int GwlExStyle = -20;
        const int WsExToolWindow = 0x00000080;
        const uint GwOwner = 4;
        const int DwmCloaked = 14;
        const int SwMinimizeNoActivate = 7;
        const int SwRestoreNoActivate = 4;
        const int SwRestore = 9;
        const uint SwpNoSize = 0x0001;
        const uint SwpNoMove = 0x0002;
        const uint SwpNoZOrder = 0x0004;
        const uint SwpNoActivate = 0x0010;
        const uint WmClose = 0x0010;
        const uint PwRenderFullContent = 2;

        public sealed class Window
        {
            public IntPtr Handle;
            public int Pid;
            public int Index;
            public string Title;
            public string App;
        }

        static string TitleOf(IntPtr hwnd)
        {
            int length = GetWindowTextLength(hwnd);
            if (length <= 0) return "";
            var text = new StringBuilder(length + 1);
            GetWindowText(hwnd, text, text.Capacity);
            return text.ToString();
        }

        static bool Listed(IntPtr hwnd)
        {
            if (!IsWindowVisible(hwnd) || GetWindowTextLength(hwnd) == 0) return false;
            if ((GetWindowLong(hwnd, GwlExStyle) & WsExToolWindow) != 0) return false;
            if (GetWindow(hwnd, GwOwner) != IntPtr.Zero) return false;
            int cloaked;
            if (DwmGetWindowAttribute(hwnd, DwmCloaked, out cloaked, sizeof(int)) == 0 && cloaked != 0) return false;
            return true;
        }

        public static string ProcessName(int pid)
        {
            try
            {
                using (var process = Process.GetProcessById(pid))
                {
                    try
                    {
                        string description = process.MainModule.FileVersionInfo.FileDescription;
                        if (!string.IsNullOrEmpty(description)) return description;
                    }
                    catch (System.ComponentModel.Win32Exception)
                    {
                    }
                    return process.ProcessName;
                }
            }
            catch (ArgumentException)
            {
                return "";
            }
        }

        public static List<Window> All()
        {
            var windows = new List<Window>();
            var counts = new Dictionary<int, int>();
            var names = new Dictionary<int, string>();
            EnumWindows(delegate (IntPtr hwnd, IntPtr param)
            {
                if (!Listed(hwnd)) return true;
                uint pid;
                GetWindowThreadProcessId(hwnd, out pid);
                int id = (int)pid;
                int index;
                counts.TryGetValue(id, out index);
                counts[id] = index + 1;
                string name;
                if (!names.TryGetValue(id, out name))
                {
                    name = ProcessName(id);
                    names[id] = name;
                }
                windows.Add(new Window { Handle = hwnd, Pid = id, Index = index, Title = TitleOf(hwnd), App = name });
                return true;
            }, IntPtr.Zero);
            return windows;
        }

        public static Window Find(string id)
        {
            string[] parts = id.Split(':');
            int pid;
            int index;
            if (parts.Length != 2 || !int.TryParse(parts[0], out pid) || !int.TryParse(parts[1], out index))
                throw new HelperError("invalid_params", "窗口 id 要是「进程号:序号」（window_list 回的）。");
            foreach (Window window in All())
            {
                if (window.Pid == pid && window.Index == index) return window;
            }
            throw new HelperError("failed", "找不到这个窗口（可能关了或前后换了）：重新 window_list。");
        }

        public static Dictionary<string, object> Frame(IntPtr hwnd, Dictionary<string, object> into)
        {
            Rect rect;
            GetWindowRect(hwnd, out rect);
            into["x"] = rect.Left;
            into["y"] = rect.Top;
            into["width"] = rect.Right - rect.Left;
            into["height"] = rect.Bottom - rect.Top;
            return into;
        }

        public static int ForegroundPid()
        {
            uint pid;
            GetWindowThreadProcessId(GetForegroundWindow(), out pid);
            return (int)pid;
        }

        public static Dictionary<string, object> Apps()
        {
            var rows = new List<object>();
            var seen = new HashSet<int>();
            int foreground = ForegroundPid();
            foreach (Window window in All())
            {
                if (!seen.Add(window.Pid)) continue;
                string exe = "";
                try
                {
                    using (var process = Process.GetProcessById(window.Pid)) exe = process.ProcessName;
                }
                catch (ArgumentException)
                {
                    continue;
                }
                rows.Add(Program.Result("pid", window.Pid, "name", window.App, "bundleId", exe,
                    "active", window.Pid == foreground, "hidden", IsIconic(window.Handle)));
            }
            return Program.Result("apps", rows);
        }

        public static Dictionary<string, object> List()
        {
            var rows = new List<object>();
            foreach (Window window in All())
            {
                rows.Add(Frame(window.Handle, Program.Result("id", window.Pid + ":" + window.Index, "pid", window.Pid,
                    "app", window.App, "title", window.Title, "minimized", IsIconic(window.Handle))));
            }
            return Program.Result("windows", rows);
        }

        public static void Raise(IntPtr hwnd)
        {
            if (IsIconic(hwnd)) ShowWindow(hwnd, SwRestore);
            if (!SetForegroundWindow(hwnd)) SwitchToThisWindow(hwnd, true);
        }

        public static Dictionary<string, object> Act(string id, string op, int? x, int? y, int? width, int? height)
        {
            Window window = Find(id);
            IntPtr hwnd = window.Handle;
            switch (op)
            {
                case "raise": Raise(hwnd); break;
                case "minimize": ShowWindow(hwnd, SwMinimizeNoActivate); break;
                case "restore": ShowWindow(hwnd, SwRestoreNoActivate); break;
                case "close": PostMessage(hwnd, WmClose, IntPtr.Zero, IntPtr.Zero); break;
                case "move":
                    if (!x.HasValue || !y.HasValue) throw new HelperError("invalid_params", "挪窗口要给 x 和 y");
                    if (!SetWindowPos(hwnd, IntPtr.Zero, x.Value, y.Value, 0, 0, SwpNoSize | SwpNoZOrder | SwpNoActivate))
                        throw new HelperError("failed", "挪不了这个窗口。");
                    break;
                case "resize":
                    if (!width.HasValue || !height.HasValue)
                        throw new HelperError("invalid_params", "改大小要给 width 和 height");
                    if (!SetWindowPos(hwnd, IntPtr.Zero, 0, 0, width.Value, height.Value,
                        SwpNoMove | SwpNoZOrder | SwpNoActivate))
                        throw new HelperError("failed", "改不了这个窗口的大小。");
                    break;
                default:
                    throw new HelperError("invalid_params", "op 只能是 raise、minimize、restore、close、move、resize");
            }
            return Program.Result("window", id);
        }

        public static Dictionary<string, object> Capture(string id)
        {
            Window window = Find(id);
            if (IsIconic(window.Handle)) throw new HelperError("failed", "这个窗口最小化了：先 window_act restore。");
            Rect rect;
            GetWindowRect(window.Handle, out rect);
            int width = Math.Max(1, rect.Right - rect.Left);
            int height = Math.Max(1, rect.Bottom - rect.Top);
            using (var image = new Bitmap(width, height, PixelFormat.Format32bppArgb))
            {
                using (var graphics = Graphics.FromImage(image))
                {
                    IntPtr hdc = graphics.GetHdc();
                    bool drawn = PrintWindow(window.Handle, hdc, PwRenderFullContent);
                    graphics.ReleaseHdc(hdc);
                    if (!drawn) throw new HelperError("failed", "这个窗口不让截（PrintWindow 失败）。");
                }
                return Screen.Png(image);
            }
        }
    }
}
