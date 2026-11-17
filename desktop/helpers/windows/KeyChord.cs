// 助手的 key 方法：「ctrl+shift+s」「return」「escape」这样的写法解成一个虚拟键码加修饰键（和 Mac 助手的
// key-chord.swift 同一套名字）。Windows 上 cmd / command 当 Ctrl（Mac 的 ⌘C 在这里是 Ctrl+C），option / alt 是 Alt，
// win 是 Windows 键；fn 按不了。只认这里列出的名字，认不出就拒，不猜。
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Plasticine.Helper
{
    sealed class KeyChord
    {
        public readonly ushort Key;
        public readonly List<ushort> Modifiers;

        KeyChord(ushort key, List<ushort> modifiers)
        {
            Key = key;
            Modifiers = modifiers;
        }

        const ushort VkShift = 0x10;
        const ushort VkControl = 0x11;
        const ushort VkAlt = 0x12;
        const ushort VkWin = 0x5B;

        static readonly Dictionary<string, ushort> ModifierNames = new Dictionary<string, ushort> {
            { "cmd", VkControl }, { "command", VkControl }, { "ctrl", VkControl }, { "control", VkControl },
            { "shift", VkShift }, { "opt", VkAlt }, { "option", VkAlt }, { "alt", VkAlt },
            { "win", VkWin }, { "windows", VkWin }, { "meta", VkWin }
        };

        static readonly Dictionary<string, ushort> NamedKeys = new Dictionary<string, ushort> {
            { "return", 0x0D }, { "enter", 0x0D }, { "tab", 0x09 }, { "space", 0x20 }, { "delete", 0x08 },
            { "backspace", 0x08 }, { "escape", 0x1B }, { "esc", 0x1B }, { "forwarddelete", 0x2E }, { "home", 0x24 },
            { "end", 0x23 }, { "pageup", 0x21 }, { "pagedown", 0x22 }, { "left", 0x25 }, { "up", 0x26 },
            { "right", 0x27 }, { "down", 0x28 }, { "insert", 0x2D },
            { "f1", 0x70 }, { "f2", 0x71 }, { "f3", 0x72 }, { "f4", 0x73 }, { "f5", 0x74 }, { "f6", 0x75 },
            { "f7", 0x76 }, { "f8", 0x77 }, { "f9", 0x78 }, { "f10", 0x79 }, { "f11", 0x7A }, { "f12", 0x7B }
        };

        // 方向键、Home、End、翻页、插入、删除要带「扩展键」标记，不然会被当成小键盘上的那几个。
        static readonly HashSet<ushort> Extended = new HashSet<ushort> {
            0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, VkWin
        };

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern short VkKeyScan(char ch);

        public static bool IsExtended(ushort vk)
        {
            return Extended.Contains(vk);
        }

        /// <summary>「cmd+shift+4」：最后一段是键，前面都是修饰键；大小写不分，空白忽略。</summary>
        public static KeyChord Parse(string text)
        {
            string[] raw = text.ToLowerInvariant().Split('+');
            var parts = new List<string>();
            foreach (string part in raw) parts.Add(part.Trim());
            string last = parts[parts.Count - 1];
            if (last.Length == 0 && text.EndsWith("+") && parts.Count >= 2)
            {
                // 「ctrl++」：最后一个键就是加号本身。
                parts.RemoveAt(parts.Count - 1);
                parts[parts.Count - 1] = "+";
                last = "+";
            }
            if (last.Length == 0) throw new HelperError("refused", "按键写法不对：写成 ctrl+shift+s、return 这样");
            var modifiers = new List<ushort>();
            for (int i = 0; i < parts.Count - 1; i++)
            {
                ushort modifier;
                if (parts[i] == "fn") throw new HelperError("refused", "Windows 上按不了 fn 键");
                if (!ModifierNames.TryGetValue(parts[i], out modifier))
                    throw new HelperError("refused", "认不出修饰键「" + parts[i] + "」：只认 ctrl（cmd）、shift、alt（option）、win");
                if (!modifiers.Contains(modifier)) modifiers.Add(modifier);
            }
            ushort key;
            if (NamedKeys.TryGetValue(last, out key)) return new KeyChord(key, modifiers);
            if (last.Length == 1)
            {
                char character = last[0];
                if ((character >= 'a' && character <= 'z') || (character >= '0' && character <= '9'))
                    return new KeyChord((ushort)char.ToUpperInvariant(character), modifiers);
                short scan = VkKeyScan(character);
                if (scan != -1)
                {
                    // 高字节是要按的 Shift / Ctrl / Alt（比如美式键盘上的「?」要 Shift）。
                    int shiftState = (scan >> 8) & 0xFF;
                    if ((shiftState & 1) != 0 && !modifiers.Contains(VkShift)) modifiers.Add(VkShift);
                    return new KeyChord((ushort)(scan & 0xFF), modifiers);
                }
            }
            throw new HelperError("refused", "认不出按键「" + last + "」：字母、数字、标点，或 return、tab、escape、方向键、f1–f12");
        }
    }
}
