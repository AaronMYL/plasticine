using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Windows.Automation;

namespace Plasticine.Helper
{
    static class Uia
    {
        const int ElementsMax = 400;
        const int DepthMax = 40;
        const int TextMax = 200;
        static readonly TimeSpan Budget = TimeSpan.FromSeconds(8);

        sealed class Snapshot
        {
            public string Version;
            public List<AutomationElement> Elements;
        }

        static readonly object Lock = new object();
        static readonly Dictionary<int, Snapshot> Snapshots = new Dictionary<int, Snapshot>();

        static readonly HashSet<ControlType> TextTypes = new HashSet<ControlType> {
            ControlType.Text, ControlType.Edit, ControlType.Document, ControlType.ComboBox, ControlType.Header,
            ControlType.HeaderItem
        };

        public static int Pid(string app)
        {
            int pid;
            if (int.TryParse(app, out pid)) return pid;
            string lower = app.ToLowerInvariant();
            var windows = Windows.All();
            foreach (Windows.Window window in windows)
            {
                if (window.App.ToLowerInvariant() == lower || ProcessName(window.Pid) == lower) return window.Pid;
            }
            foreach (Windows.Window window in windows)
            {
                if (window.App.ToLowerInvariant().Contains(lower) || window.Title.ToLowerInvariant().Contains(lower))
                    return window.Pid;
            }
            throw new HelperError("failed", "「" + app + "」没有开着的窗口：先用 open_in_app 或 app_open 打开它。");
        }

        static string ProcessName(int pid)
        {
            try
            {
                using (var process = Process.GetProcessById(pid)) return process.ProcessName.ToLowerInvariant();
            }
            catch (ArgumentException)
            {
                return "";
            }
        }

        static Windows.Window MainWindow(int pid)
        {
            IntPtr foreground = Windows.GetForegroundWindow();
            Windows.Window first = null;
            foreach (Windows.Window window in Windows.All())
            {
                if (window.Pid != pid) continue;
                if (window.Handle == foreground) return window;
                if (first == null) first = window;
            }
            if (first == null) throw new HelperError("failed", "这个应用没有开着的窗口。");
            return first;
        }

        static string Clip(string text)
        {
            if (text == null) return "";
            return text.Length > TextMax ? text.Substring(0, TextMax) + "…" : text;
        }

        static object Pattern(AutomationElement element, AutomationPattern pattern)
        {
            object found;
            return element.TryGetCurrentPattern(pattern, out found) ? found : null;
        }

        static string ValueOf(AutomationElement element)
        {
            var value = Pattern(element, ValuePattern.Pattern) as ValuePattern;
            if (value != null) return Clip(value.Current.Value);
            var range = Pattern(element, RangeValuePattern.Pattern) as RangeValuePattern;
            if (range != null) return range.Current.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
            var toggle = Pattern(element, TogglePattern.Pattern) as TogglePattern;
            if (toggle != null) return toggle.Current.ToggleState == ToggleState.On ? "on" : "off";
            return null;
        }

        static List<string> Actions(AutomationElement element)
        {
            var actions = new List<string>();
            if (Pattern(element, InvokePattern.Pattern) != null || Pattern(element, TogglePattern.Pattern) != null
                || Pattern(element, SelectionItemPattern.Pattern) != null
                || Pattern(element, ExpandCollapsePattern.Pattern) != null) actions.Add("press");
            var value = Pattern(element, ValuePattern.Pattern) as ValuePattern;
            if (value != null && !value.Current.IsReadOnly) actions.Add("set");
            if (Pattern(element, RangeValuePattern.Pattern) != null)
            {
                actions.Add("increment");
                actions.Add("decrement");
            }
            if (Pattern(element, ExpandCollapsePattern.Pattern) != null) actions.Add("menu");
            if (Pattern(element, ScrollItemPattern.Pattern) != null) actions.Add("show");
            if (element.Current.IsKeyboardFocusable) actions.Add("focus");
            return actions;
        }

        static string Role(AutomationElement element)
        {
            string name = element.Current.ControlType.ProgrammaticName;
            return name.StartsWith("ControlType.") ? name.Substring("ControlType.".Length) : name;
        }

        public static Dictionary<string, object> Perceive(string app)
        {
            int pid = Pid(app);
            Windows.Window main = MainWindow(pid);
            AutomationElement root = AutomationElement.FromHandle(main.Handle);
            var elements = new List<AutomationElement>();
            var rows = new List<object>();
            bool truncated = false;
            DateTime deadline = DateTime.UtcNow + Budget;
            var stack = new Stack<KeyValuePair<AutomationElement, int>>();
            stack.Push(new KeyValuePair<AutomationElement, int>(root, 0));
            TreeWalker walker = TreeWalker.ControlViewWalker;
            while (stack.Count > 0)
            {
                if (elements.Count >= ElementsMax || DateTime.UtcNow > deadline)
                {
                    truncated = true;
                    break;
                }
                var next = stack.Pop();
                AutomationElement element = next.Key;
                try
                {
                    if (element.Current.IsOffscreen && next.Value > 0) continue;
                    List<string> actions = Actions(element);
                    string title = Clip(element.Current.Name);
                    string value = ValueOf(element);
                    bool listed = actions.Count > 0 && (actions.Count > 1 || actions[0] != "focus" || title.Length > 0);
                    if (listed || (TextTypes.Contains(element.Current.ControlType) && (title.Length > 0 || value != null)))
                    {
                        elements.Add(element);
                        System.Windows.Rect bounds = element.Current.BoundingRectangle;
                        bool empty = bounds.IsEmpty;
                        rows.Add(Program.Result("n", elements.Count, "role", Role(element), "title", title,
                            "value", value, "enabled", element.Current.IsEnabled,
                            "focused", element.Current.HasKeyboardFocus, "actions", actions,
                            "x", empty ? 0 : bounds.X, "y", empty ? 0 : bounds.Y,
                            "width", empty ? 0 : bounds.Width, "height", empty ? 0 : bounds.Height));
                    }
                    if (next.Value >= DepthMax) continue;
                    var children = new List<AutomationElement>();
                    for (AutomationElement child = walker.GetFirstChild(element); child != null;
                        child = walker.GetNextSibling(child)) children.Add(child);
                    for (int i = children.Count - 1; i >= 0; i--)
                        stack.Push(new KeyValuePair<AutomationElement, int>(children[i], next.Value + 1));
                }
                catch (ElementNotAvailableException)
                {
                }
            }
            string version = Guid.NewGuid().ToString("N").Substring(0, 8);
            lock (Lock) Snapshots[pid] = new Snapshot { Version = version, Elements = elements };
            return Program.Result("app", main.App, "pid", pid, "version", version, "window", main.Title,
                "elements", rows, "truncated", truncated);
        }

        static HelperError Stale()
        {
            return new HelperError("failed", "页面变了（编号过期），这一步没做：先重新感知。");
        }

        public static Dictionary<string, object> Act(string app, string version, int n, string op, string text)
        {
            int pid = Pid(app);
            Snapshot snapshot;
            lock (Lock) Snapshots.TryGetValue(pid, out snapshot);
            if (snapshot == null || snapshot.Version != version || n < 1 || n > snapshot.Elements.Count) throw Stale();
            AutomationElement element = snapshot.Elements[n - 1];
            try
            {
                Do(element, op, text);
                lock (Lock) Snapshots.Remove(pid);
                string value = null;
                try
                {
                    value = ValueOf(element);
                }
                catch (ElementNotAvailableException)
                {
                }
                return Program.Result("done", true, "value", value);
            }
            catch (ElementNotAvailableException)
            {
                throw Stale();
            }
            catch (InvalidOperationException error)
            {
                throw new HelperError("failed", "这个元素不认「" + op + "」（" + error.Message + "）：换一个编号或别的做法。");
            }
        }

        static HelperError Unsupported(string op)
        {
            return new HelperError("failed", "这个元素不认「" + op + "」：换一个编号或别的做法。");
        }

        static void Do(AutomationElement element, string op, string text)
        {
            switch (op)
            {
                case "press":
                {
                    var invoke = Pattern(element, InvokePattern.Pattern) as InvokePattern;
                    if (invoke != null) { invoke.Invoke(); return; }
                    var toggle = Pattern(element, TogglePattern.Pattern) as TogglePattern;
                    if (toggle != null) { toggle.Toggle(); return; }
                    var select = Pattern(element, SelectionItemPattern.Pattern) as SelectionItemPattern;
                    if (select != null) { select.Select(); return; }
                    var expand = Pattern(element, ExpandCollapsePattern.Pattern) as ExpandCollapsePattern;
                    if (expand == null) throw Unsupported(op);
                    if (expand.Current.ExpandCollapseState == ExpandCollapseState.Expanded) expand.Collapse();
                    else expand.Expand();
                    return;
                }
                case "focus":
                    element.SetFocus();
                    return;
                case "set":
                {
                    if (text == null) throw new HelperError("invalid_params", "set 要给 text");
                    var value = Pattern(element, ValuePattern.Pattern) as ValuePattern;
                    if (value == null || value.Current.IsReadOnly) throw Unsupported(op);
                    value.SetValue(text);
                    return;
                }
                case "increment":
                case "decrement":
                {
                    var range = Pattern(element, RangeValuePattern.Pattern) as RangeValuePattern;
                    if (range == null) throw Unsupported(op);
                    double step = range.Current.SmallChange > 0 ? range.Current.SmallChange : 1;
                    double next = range.Current.Value + (op == "increment" ? step : -step);
                    range.SetValue(Math.Max(range.Current.Minimum, Math.Min(range.Current.Maximum, next)));
                    return;
                }
                case "menu":
                {
                    var expand = Pattern(element, ExpandCollapsePattern.Pattern) as ExpandCollapsePattern;
                    if (expand == null)
                        throw new HelperError("failed", "Windows 上这个元素没有可展开的菜单：要右键菜单用 input_mouse 的 right。");
                    expand.Expand();
                    return;
                }
                case "show":
                {
                    var scroll = Pattern(element, ScrollItemPattern.Pattern) as ScrollItemPattern;
                    if (scroll == null) throw Unsupported(op);
                    scroll.ScrollIntoView();
                    return;
                }
                case "confirm":
                case "cancel":
                    throw new HelperError("failed", "Windows 上没有「" + op + "」这个动作：聚焦以后用 input_key 按 return 或 escape。");
                default:
                    throw new HelperError("invalid_params",
                        "op 只能是 press、focus、set、increment、decrement、menu、confirm、cancel、show");
            }
        }
    }
}
