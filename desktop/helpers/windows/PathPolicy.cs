using System;
using System.Collections.Generic;
using System.IO;

namespace Plasticine.Helper
{
    static class PathPolicy
    {
        static readonly object Lock = new object();
        static List<string> roots = new List<string> {
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
        };

        public static List<string> Configure(List<string> wanted)
        {
            var normalized = new List<string>();
            foreach (string root in wanted) normalized.Add(Normalize(root));
            lock (Lock) roots = normalized;
            return normalized;
        }

        static string Normalize(string path)
        {
            if (!Path.IsPathRooted(path))
                throw new HelperError("invalid_params", "「" + path + "」不是完整路径。");
            return Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);
        }

        public static string Allowed(string raw)
        {
            string path = Normalize(raw);
            List<string> current;
            lock (Lock) current = roots;
            foreach (string root in current)
            {
                if (string.Equals(path, root, StringComparison.OrdinalIgnoreCase)
                    || path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    return path;
            }
            throw new HelperError("refused", current.Count == 0 ? "这台电脑没有授权任何目录。"
                : "「" + raw + "」不在这台电脑授权的目录里。");
        }
    }
}
