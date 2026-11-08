// 截屏和点按：截主显示器（长边最多 1600），点按的坐标按最近一次截图换算成屏幕坐标；显示器变了或还没截过回
// screenshot_stale（壳让本体重截再定位）。点按、输入做完再截一张，回执只带摘要和画面变没变（afterShot、changed），
// 原图不进回执。和 Mac 助手的口径一样。
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
