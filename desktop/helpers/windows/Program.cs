using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace Plasticine.Helper
{
    sealed class HelperError : Exception
    {
        public readonly string Code;
        public HelperError(string code, string message) : base(message) { Code = code; }
    }

    static class Program
    {
        public const string Version = "1";
        public const int ProtocolVersion = 1;
        public static readonly string[] Methods = {
            "helper.info", "helper.configure", "cancel", "permissions.status", "permissions.request",
            "screenshot", "click", "type", "files.list", "files.read", "files.write", "command.run",
            "key", "scroll", "mouse", "screenshot.region", "screenshot.window", "apps.list", "windows.list", "window.act",
            "ax.perceive", "ax.act", "menu.list", "menu.press"
        };

        static readonly object WriteLock = new object();
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        static readonly Dictionary<string, CancellationTokenSource> Running =
            new Dictionary<string, CancellationTokenSource>();
        static int inFlight;

        [STAThread]
        static int Main(string[] args)
        {
            Native.SetProcessDPIAware();
            Console.InputEncoding = new UTF8Encoding(false);
            var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            output.AutoFlush = true;
            Console.SetOut(output);
            var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            string line;
            while ((line = input.ReadLine()) != null)
            {
                if (line.Trim().Length == 0) continue;
                Accept(line);
            }
            lock (Running)
            {
                foreach (var source in Running.Values) source.Cancel();
            }
            DateTime deadline = DateTime.UtcNow.AddSeconds(2);
            while (Interlocked.CompareExchange(ref inFlight, 0, 0) > 0 && DateTime.UtcNow < deadline) Thread.Sleep(50);
            return 0;
        }

        static void Accept(string line)
        {
            Dictionary<string, object> request;
            try
            {
                request = Json.Deserialize<Dictionary<string, object>>(line);
            }
            catch (ArgumentException)
            {
                Reply(null, null, new HelperError("invalid_request", "这一行不是 JSON。"));
                return;
            }
            object rawId;
            object rawMethod;
            string id = request != null && request.TryGetValue("id", out rawId) ? rawId as string : null;
            string method = request != null && request.TryGetValue("method", out rawMethod) ? rawMethod as string : null;
            if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(method))
            {
                Reply(null, null, new HelperError("invalid_request", "请求要有 id 和 method。"));
                return;
            }
            object rawParams;
            var parameters = request.TryGetValue("params", out rawParams) && rawParams is Dictionary<string, object>
                ? (Dictionary<string, object>)rawParams : new Dictionary<string, object>();
            var cancel = new CancellationTokenSource();
            lock (Running)
            {
                if (Running.ContainsKey(id))
                {
                    Reply(id, null, new HelperError("duplicate_id", "同一个 id 还在做。"));
                    return;
                }
                Running[id] = cancel;
            }
            Interlocked.Increment(ref inFlight);
            ThreadPool.QueueUserWorkItem(delegate { Run(id, method, parameters, cancel); });
        }

        static void Run(string id, string method, Dictionary<string, object> parameters, CancellationTokenSource cancel)
        {
            try
            {
                Reply(id, Dispatch(method, parameters, cancel.Token), null);
            }
            catch (HelperError error)
            {
                Reply(id, null, error);
            }
            catch (OperationCanceledException)
            {
                Reply(id, null, new HelperError("cancelled", "已取消，可能已产生部分结果，请先核实。"));
            }
            catch (IOException error)
            {
                Reply(id, null, new HelperError("failed", error.Message));
            }
            catch (UnauthorizedAccessException error)
            {
                Reply(id, null, new HelperError("permission_denied", error.Message));
            }
            finally
            {
                lock (Running) Running.Remove(id);
                cancel.Dispose();
                Interlocked.Decrement(ref inFlight);
            }
        }

        static Dictionary<string, object> Dispatch(string method, Dictionary<string, object> p, CancellationToken token)
        {
            switch (method)
            {
                case "helper.info":
                    return Result("name", "PlasticineHelper", "version", Version, "protocol", ProtocolVersion,
                        "methods", Methods);
                case "helper.configure":
                    return Result("roots", PathPolicy.Configure(Params.StringList(p, "roots")));
                case "cancel":
                    return Result("cancelled", CancelRequest(Params.String(p, "requestId")));
                case "permissions.status":
                    return Result("screen", true, "accessibility", true, "calendar", "restricted",
                        "reminders", "restricted");
                case "permissions.request":
                {
                    string kind = Params.String(p, "kind");
                    return Result("kind", kind, "granted", kind == "screen" || kind == "accessibility",
                        "settingsOpened", false);
                }
                case "screenshot":
                    return Screen.Capture();
                case "click":
                    return Screen.Click(Params.Int(p, "x"), Params.Int(p, "y"));
                case "type":
                    return Screen.Type(Params.String(p, "text"));
                case "key":
                    return Screen.Key(Params.String(p, "keys"));
                case "scroll":
                    return Screen.Scroll(Params.OptionalInt(p, "dx", 0), Params.OptionalInt(p, "dy", 0),
                        Params.NullableInt(p, "x"), Params.NullableInt(p, "y"));
                case "mouse":
                    return Screen.Mouse(Params.String(p, "op"), Params.Int(p, "x"), Params.Int(p, "y"),
                        Params.NullableInt(p, "toX"), Params.NullableInt(p, "toY"));
                case "screenshot.region":
                    return Screen.Region(Params.Int(p, "x"), Params.Int(p, "y"), Params.Int(p, "width"),
                        Params.Int(p, "height"));
                case "screenshot.window":
                    return Windows.Capture(Params.String(p, "window"));
                case "apps.list":
                    return Windows.Apps();
                case "windows.list":
                    return Windows.List();
                case "window.act":
                    return Windows.Act(Params.String(p, "window"), Params.String(p, "op"), Params.NullableInt(p, "x"),
                        Params.NullableInt(p, "y"), Params.NullableInt(p, "width"), Params.NullableInt(p, "height"));
                case "ax.perceive":
                    return Uia.Perceive(Params.String(p, "app"));
                case "ax.act":
                    return Uia.Act(Params.String(p, "app"), Params.String(p, "version"), Params.Int(p, "n"),
                        Params.String(p, "op"), Params.OptionalString(p, "text"));
                case "menu.list":
                    return Menus.Run(Params.String(p, "app"), null);
                case "menu.press":
                    return Menus.Run(Params.String(p, "app"), Params.String(p, "path"));
                case "files.list":
                    return Files.List(Params.String(p, "path"));
                case "files.read":
                    return Files.Read(Params.String(p, "path"));
                case "files.write":
                    return Files.Write(Params.String(p, "path"), Params.String(p, "content"),
                        Params.OptionalString(p, "baseVersion"));
                case "command.run":
                    return Commands.Run(Params.String(p, "command"), Params.String(p, "cwd"),
                        Params.OptionalInt(p, "timeoutSeconds", 120), Params.OptionalInt(p, "maxOutputBytes", 102400),
                        token);
                default:
                    throw new HelperError("unknown_method", "这台电脑的助手不会 " + method + "。");
            }
        }

        static bool CancelRequest(string requestId)
        {
            lock (Running)
            {
                CancellationTokenSource source;
                if (!Running.TryGetValue(requestId, out source)) return false;
                source.Cancel();
                return true;
            }
        }

        public static Dictionary<string, object> Result(params object[] pairs)
        {
            var result = new Dictionary<string, object>();
            for (int i = 0; i + 1 < pairs.Length; i += 2) result[(string)pairs[i]] = pairs[i + 1];
            return result;
        }

        static void Reply(string id, Dictionary<string, object> result, HelperError error)
        {
            var message = new Dictionary<string, object>();
            message["id"] = id;
            if (error != null)
            {
                message["error"] = Result("code", error.Code, "message", error.Message);
            }
            else
            {
                message["result"] = result;
            }
            string text = Json.Serialize(message);
            lock (WriteLock)
            {
                Console.Out.Write(text);
                Console.Out.Write("\n");
                Console.Out.Flush();
            }
        }
    }
}
