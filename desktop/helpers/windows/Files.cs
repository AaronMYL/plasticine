// 文件：列目录、读（最多 10 MiB，UTF-8 无效时回 base64）、写（比对读时的版本，原子替换，回执的版本是写完重新读盘
// 算的）。回执形状就是设备动作 file_list / file_read / file_write 的回执（agent/shared/api/node-channel.ts）。
using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Plasticine.Helper
{
    static class Files
    {
        const long ReadMaxBytes = 10L * 1024 * 1024;

        public static string Sha256(byte[] bytes)
        {
            using (var sha = SHA256.Create())
            {
                var hex = new StringBuilder(64);
                foreach (byte b in sha.ComputeHash(bytes)) hex.Append(b.ToString("x2"));
                return hex.ToString();
            }
        }

        public static string Iso(DateTime time)
        {
            return time.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
        }

        public static Dictionary<string, object> List(string raw)
        {
            string path = PathPolicy.Allowed(raw);
            if (!Directory.Exists(path)) throw new HelperError("not_found", "没有这个目录：" + raw);
            var entries = new List<object>();
            foreach (string entry in Directory.EnumerateFileSystemEntries(path))
            {
                var info = new FileInfo(entry);
                bool link = (info.Attributes & FileAttributes.ReparsePoint) != 0;
                bool directory = (info.Attributes & FileAttributes.Directory) != 0;
                entries.Add(Program.Result("name", Path.GetFileName(entry),
                    "type", link ? "link" : directory ? "dir" : "file",
                    "size", directory ? 0L : info.Length, "modifiedAt", Iso(info.LastWriteTimeUtc)));
            }
            return Program.Result("entries", entries);
        }

        public static Dictionary<string, object> Read(string raw)
        {
            string path = PathPolicy.Allowed(raw);
            if (!File.Exists(path)) throw new HelperError("not_found", "没有这个文件：" + raw);
            if (new FileInfo(path).Length > ReadMaxBytes) throw new HelperError("refused", "文件超过 10 MiB，没读。");
            byte[] bytes = File.ReadAllBytes(path);
            string text;
            try
            {
                text = new UTF8Encoding(false, true).GetString(bytes);
            }
            catch (DecoderFallbackException)
            {
                return Program.Result("content", Convert.ToBase64String(bytes), "encoding", "base64",
                    "version", Sha256(bytes));
            }
            return Program.Result("content", text, "encoding", "utf8", "version", Sha256(bytes));
        }

        public static Dictionary<string, object> Write(string raw, string content, string baseVersion)
        {
            string path = PathPolicy.Allowed(raw);
            bool exists = File.Exists(path);
            if (baseVersion == null && exists) throw new HelperError("refused", "文件已经有了：只能按读时的版本改。");
            if (baseVersion != null && (!exists || Sha256(File.ReadAllBytes(path)) != baseVersion))
                throw new HelperError("refused", "文件在读过之后变了，没写。先重新读。");
            string directory = Path.GetDirectoryName(path);
            if (!Directory.Exists(directory)) throw new HelperError("not_found", "没有这个目录：" + directory);
            string temporary = Path.Combine(directory, "." + Path.GetFileName(path) + "." + Guid.NewGuid().ToString("N"));
            File.WriteAllBytes(temporary, new UTF8Encoding(false).GetBytes(content));
            if (exists) File.Replace(temporary, path, null);
            else File.Move(temporary, path);
            return Program.Result("version", Sha256(File.ReadAllBytes(path)));
        }
    }
}
