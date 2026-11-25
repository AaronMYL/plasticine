using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

namespace Plasticine.Helper
{
    static class Menus
    {
        [DllImport("user32.dll")]
        static extern IntPtr GetMenu(IntPtr hwnd);

        [DllImport("user32.dll")]
        static extern int GetMenuItemCount(IntPtr menu);

        [DllImport("user32.dll")]
        static extern IntPtr GetSubMenu(IntPtr menu, int position);

        [DllImport("user32.dll")]
        static extern uint GetMenuItemID(IntPtr menu, int position);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern int GetMenuString(IntPtr menu, uint item, StringBuilder text, int max, uint flags);

        [DllImport("user32.dll")]
        static extern uint GetMenuState(IntPtr menu, uint item, uint flags);

        const uint ByPosition = 0x0400;
        const uint Disabled = 0x0002;
        const uint Grayed = 0x0001;
        const uint Separator = 0x0800;
        const uint WmCommand = 0x0111;
        const int ItemsMax = 400;
        const int DepthMax = 3;

        sealed class Item
        {
            public string Path;
            public bool Enabled;
            public uint Id;
        }

        static string Clean(string text)
        {
            int tab = text.IndexOf('\t');
            if (tab >= 0) text = text.Substring(0, tab);
            return text.Replace("&&", "\u0001").Replace("&", "").Replace("\u0001", "&").Trim();
        }

        static void Walk(IntPtr menu, string prefix, int depth, List<Item> items)
        {
            int count = GetMenuItemCount(menu);
            for (int i = 0; i < count && items.Count < ItemsMax; i++)
            {
                uint state = GetMenuState(menu, (uint)i, ByPosition);
                if ((state & Separator) != 0) continue;
                var text = new StringBuilder(256);
                GetMenuString(menu, (uint)i, text, text.Capacity, ByPosition);
                string title = Clean(text.ToString());
                if (title.Length == 0) continue;
                string path = prefix.Length == 0 ? title : prefix + " > " + title;
                IntPtr sub = GetSubMenu(menu, i);
                if (sub != IntPtr.Zero && depth < DepthMax)
                {
                    Walk(sub, path, depth + 1, items);
                    continue;
                }
                items.Add(new Item { Path = path, Enabled = (state & (Disabled | Grayed)) == 0,
                    Id = GetMenuItemID(menu, i) });
            }
        }

        static string Normalize(string path)
        {
            var parts = new List<string>();
            foreach (string part in path.Split('>')) parts.Add(part.Trim());
            return string.Join(" > ", parts.ToArray());
        }

        public static Dictionary<string, object> Run(string app, string press)
        {
            int pid = Uia.Pid(app);
            Windows.Window main = null;
            foreach (Windows.Window window in Windows.All())
            {
                if (window.Pid == pid && GetMenu(window.Handle) != IntPtr.Zero) { main = window; break; }
            }
            if (main == null) return Automation(pid, press);
            var items = new List<Item>();
            Walk(GetMenu(main.Handle), "", 0, items);
            if (press == null)
            {
                var rows = new List<object>();
                foreach (Item item in items) rows.Add(Program.Result("path", item.Path, "enabled", item.Enabled));
                return Program.Result("items", rows, "pressed", null);
            }
            string wanted = Normalize(press);
            foreach (Item item in items)
            {
                if (item.Path != wanted) continue;
                if (!item.Enabled) throw new HelperError("failed", "「" + press + "」是灰的，点不了。");
                Windows.PostMessage(main.Handle, WmCommand, (IntPtr)item.Id, IntPtr.Zero);
                return Program.Result("items", new List<object>(), "pressed", press);
            }
            throw new HelperError("failed", "菜单里没有「" + press + "」：先不带 path 列出来看看。");
        }

        static Dictionary<string, object> Automation(int pid, string press)
        {
            AutomationElement bar = null;
            foreach (Windows.Window window in Windows.All())
            {
                if (window.Pid != pid) continue;
                bar = AutomationElement.FromHandle(window.Handle).FindFirst(TreeScope.Descendants,
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuBar));
                if (bar != null) break;
            }
            if (bar == null) throw new HelperError("failed", "这个应用没有菜单栏：用 app_perceive 找按钮。");
            var condition = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem);
            if (press == null)
            {
                var rows = new List<object>();
                foreach (AutomationElement item in bar.FindAll(TreeScope.Children, condition))
                    rows.Add(Program.Result("path", item.Current.Name, "enabled", item.Current.IsEnabled));
                return Program.Result("items", rows, "pressed", null);
            }
            string[] names = Normalize(press).Split(new[] { " > " }, StringSplitOptions.None);
            AutomationElement current = bar;
            for (int i = 0; i < names.Length; i++)
            {
                AutomationElement found = null;
                foreach (AutomationElement item in current.FindAll(TreeScope.Descendants, condition))
                {
                    if (Clean(item.Current.Name) == names[i]) { found = item; break; }
                }
                if (found == null && i > 0)
                {
                    foreach (AutomationElement item in AutomationElement.RootElement.FindAll(TreeScope.Descendants,
                        new AndCondition(condition, new PropertyCondition(AutomationElement.ProcessIdProperty, pid))))
                    {
                        if (Clean(item.Current.Name) == names[i]) { found = item; break; }
                    }
                }
                if (found == null) throw new HelperError("failed", "菜单里没有「" + names[i] + "」：先不带 path 列出来看看。");
                if (i == names.Length - 1)
                {
                    object invoke;
                    if (found.TryGetCurrentPattern(InvokePattern.Pattern, out invoke)) ((InvokePattern)invoke).Invoke();
                    else throw new HelperError("failed", "「" + press + "」点不了。");
                }
                else
                {
                    object expand;
                    if (found.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out expand))
                        ((ExpandCollapsePattern)expand).Expand();
                    System.Threading.Thread.Sleep(300);
                    current = found;
                }
            }
            return Program.Result("items", new List<object>(), "pressed", press);
        }
    }
}
