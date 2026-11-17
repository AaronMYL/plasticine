// 截屏和点按：截主显示器（长边最多 1600），点按的坐标按最近一次截图换算成屏幕坐标；显示器变了或还没截过回
// screenshot_stale（壳让本体重截再定位）。点按、输入做完再截一张，回执只带摘要和画面变没变（afterShot、changed），
// 原图不进回执。和 Mac 助手的口径一样。11-16 第二批加：按键、滚轮、双击 / 右键 / 中键 / 移过去 / 拖动、截一块原尺寸的图。
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Forms;

namespace Plasticine.Helper
{
    static class Screen
    {
        const int LongEdgeMax = 1600;

        sealed class Shot
        {
            public Rectangle Bounds;
            public double Scale;
            public string Sha256;
            public int Width;
            public int Height;
        }

        static readonly object Lock = new object();
        static Shot last;

        static Shot Take(out string png)
        {
            Rectangle bounds = System.Windows.Forms.Screen.PrimaryScreen.Bounds;
            double scale = Math.Min(1.0, (double)LongEdgeMax / Math.Max(bounds.Width, bounds.Height));
            int width = Math.Max(1, (int)Math.Round(bounds.Width * scale));
            int height = Math.Max(1, (int)Math.Round(bounds.Height * scale));
            using (var full = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb))
            using (var scaled = new Bitmap(width, height, PixelFormat.Format32bppArgb))
            {
                using (var graphics = Graphics.FromImage(full))
                    graphics.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
                using (var graphics = Graphics.FromImage(scaled))
                {
                    graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    graphics.DrawImage(full, 0, 0, width, height);
                }
                using (var stream = new MemoryStream())
                {
                    scaled.Save(stream, ImageFormat.Png);
                    byte[] bytes = stream.ToArray();
                    png = Convert.ToBase64String(bytes);
                    return new Shot { Bounds = bounds, Scale = scale, Sha256 = Files.Sha256(bytes), Width = width,
                        Height = height };
                }
            }
        }

        public static Dictionary<string, object> Capture()
        {
            string png;
            Shot shot = Take(out png);
            lock (Lock) last = shot;
            return Program.Result("png", png, "width", shot.Width, "height", shot.Height);
        }

        static Shot Current()
        {
            Shot shot;
            lock (Lock) shot = last;
            if (shot == null || shot.Bounds != System.Windows.Forms.Screen.PrimaryScreen.Bounds)
                throw new HelperError("screenshot_stale", "点的坐标依据的截图已经不对了（显示器变了或还没截过），先重截。");
            return shot;
        }

        static Dictionary<string, object> After(Shot before)
        {
            string png;
            Shot shot = Take(out png);
            lock (Lock) last = shot;
            var afterShot = Program.Result("sha256", shot.Sha256, "width", shot.Width, "height", shot.Height,
                "capturedAt", Files.Iso(DateTime.UtcNow));
            if (before != null) afterShot["beforeSha256"] = before.Sha256;
            var result = Program.Result("afterShot", afterShot);
            if (before != null) result["changed"] = shot.Sha256 != before.Sha256;
            return result;
        }

        public static Dictionary<string, object> Click(int x, int y)
        {
            Shot shot = Current();
            if (x >= shot.Width || y >= shot.Height) throw new HelperError("invalid_params", "坐标在截图外面。");
            int screenX = shot.Bounds.X + (int)Math.Round(x / shot.Scale);
            int screenY = shot.Bounds.Y + (int)Math.Round(y / shot.Scale);
            Native.Click(screenX, screenY);
            System.Threading.Thread.Sleep(400);
            return After(shot);
        }

        static Point ToScreen(Shot shot, int x, int y)
        {
            if (x >= shot.Width || y >= shot.Height) throw new HelperError("invalid_params", "坐标在截图外面。");
            return new Point(shot.Bounds.X + (int)Math.Round(x / shot.Scale), shot.Bounds.Y + (int)Math.Round(y / shot.Scale));
        }

        public static Dictionary<string, object> Key(string keys)
        {
            KeyChord chord = KeyChord.Parse(keys);
            Shot before;
            lock (Lock) before = last;
            NativeInput.Press(chord);
            System.Threading.Thread.Sleep(300);
            return After(before);
        }

        /// <summary>按行滚：给了坐标先把指针移过去（按最近一次截图换算）。</summary>
        public static Dictionary<string, object> Scroll(int dx, int dy, int? x, int? y)
        {
            Shot before;
            if (x.HasValue && y.HasValue)
            {
                before = Current();
                Point point = ToScreen(before, x.Value, y.Value);
                NativeInput.MoveTo(point.X, point.Y);
            }
            else
            {
                lock (Lock) before = last;
            }
            NativeInput.Scroll(dx, dy);
            System.Threading.Thread.Sleep(300);
            return After(before);
        }

        public static Dictionary<string, object> Mouse(string op, int x, int y, int? toX, int? toY)
        {
            Shot shot = Current();
            Point point = ToScreen(shot, x, y);
            switch (op)
            {
                case "double": NativeInput.Click(point.X, point.Y, "left", 2); break;
                case "right": NativeInput.Click(point.X, point.Y, "right", 1); break;
                case "middle": NativeInput.Click(point.X, point.Y, "middle", 1); break;
                case "move": NativeInput.MoveTo(point.X, point.Y); break;
                case "drag":
                {
                    if (!toX.HasValue || !toY.HasValue) throw new HelperError("invalid_params", "拖动要给 toX 和 toY");
                    Point to = ToScreen(shot, toX.Value, toY.Value);
                    NativeInput.Drag(point.X, point.Y, to.X, to.Y);
                    break;
                }
                default: throw new HelperError("invalid_params", "op 只能是 double、right、middle、move、drag");
            }
            System.Threading.Thread.Sleep(400);
            return After(shot);
        }

        /// <summary>按最近一次截图的坐标截一块，按屏幕的原始像素截（不缩小），看清小字用。</summary>
        public static Dictionary<string, object> Region(int x, int y, int width, int height)
        {
            Shot shot = Current();
            Point topLeft = ToScreen(shot, x, y);
            Point bottomRight = ToScreen(shot, Math.Min(shot.Width - 1, x + width), Math.Min(shot.Height - 1, y + height));
            var rect = new Rectangle(topLeft.X, topLeft.Y, Math.Max(1, bottomRight.X - topLeft.X),
                Math.Max(1, bottomRight.Y - topLeft.Y));
            using (var image = new Bitmap(rect.Width, rect.Height, PixelFormat.Format32bppArgb))
            {
                using (var graphics = Graphics.FromImage(image)) graphics.CopyFromScreen(rect.Location, Point.Empty, rect.Size);
                return Png(image);
            }
        }

        public static Dictionary<string, object> Png(Bitmap image)
        {
            using (var stream = new MemoryStream())
            {
                image.Save(stream, ImageFormat.Png);
                return Program.Result("png", Convert.ToBase64String(stream.ToArray()), "width", image.Width,
                    "height", image.Height);
            }
        }

        public static Dictionary<string, object> Type(string text)
        {
            Shot before;
            lock (Lock) before = last;
            Native.TypeText(text);
            System.Threading.Thread.Sleep(300);
            return After(before);
        }
    }
}
