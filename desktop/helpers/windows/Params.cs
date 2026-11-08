// 读请求参数：缺了、类型不对一律 invalid_params（壳那头已按共享 schema 校验过，这里是最后一道）。
using System;
using System.Collections;
using System.Collections.Generic;

namespace Plasticine.Helper
{
    static class Params
    {
        public static string String(Dictionary<string, object> p, string name)
        {
            object value;
            if (!p.TryGetValue(name, out value) || !(value is string) || ((string)value).Length == 0)
                throw new HelperError("invalid_params", "缺参数 " + name + "。");
            return (string)value;
        }

        public static string OptionalString(Dictionary<string, object> p, string name)
        {
            object value;
            if (!p.TryGetValue(name, out value) || value == null) return null;
            if (!(value is string)) throw new HelperError("invalid_params", "参数 " + name + " 应该是字符串。");
            return (string)value;
        }

        public static int Int(Dictionary<string, object> p, string name)
        {
            object value;
            if (!p.TryGetValue(name, out value) || !(value is int))
                throw new HelperError("invalid_params", "缺整数参数 " + name + "。");
            return (int)value;
        }

        public static int OptionalInt(Dictionary<string, object> p, string name, int fallback)
        {
            object value;
            if (!p.TryGetValue(name, out value) || value == null) return fallback;
            if (!(value is int)) throw new HelperError("invalid_params", "参数 " + name + " 应该是整数。");
            return (int)value;
        }

        public static List<string> StringList(Dictionary<string, object> p, string name)
        {
            object value;
            if (!p.TryGetValue(name, out value) || !(value is IEnumerable) || value is string)
                throw new HelperError("invalid_params", "缺列表参数 " + name + "。");
            var list = new List<string>();
            foreach (object item in (IEnumerable)value)
            {
                if (!(item is string)) throw new HelperError("invalid_params", name + " 里只能是字符串。");
                list.Add((string)item);
            }
            return list;
        }
    }
}
