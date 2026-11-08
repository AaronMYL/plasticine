// 授权目录（壳用 helper.configure 告诉助手；默认整个用户目录，空列表是不授权文件）。壳那头已经按两层授权核过、
// 解开过符号链接；这里再按目录边界核一次（不分大小写，NTFS 不分），不在里面回 refused。
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

        /// <summary>完整路径，并且在授权目录里；否则 refused。</summary>
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
