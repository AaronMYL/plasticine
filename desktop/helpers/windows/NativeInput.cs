using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace Plasticine.Helper
{
    static class NativeInput
    {
        const uint InputMouse = 0;
        const uint InputKeyboard = 1;
        const uint MouseMove = 0x0001;
        const uint MouseLeftDown = 0x0002;
        const uint MouseLeftUp = 0x0004;
        const uint MouseRightDown = 0x0008;
        const uint MouseRightUp = 0x0010;
        const uint MouseMiddleDown = 0x0020;
        const uint MouseMiddleUp = 0x0040;
        const uint MouseWheel = 0x0800;
        const uint MouseHWheel = 0x01000;
        const uint KeyExtended = 0x0001;
        const uint KeyUp = 0x0002;
        const uint WheelDelta = 120;
        const uint SpiGetWheelScrollLines = 0x0068;

        [StructLayout(LayoutKind.Sequential)]
        struct MouseInput { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time;
            public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        struct KeyboardInput { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time;
            public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Explicit)]
        struct InputUnion { [FieldOffset(0)] public MouseInput mi; [FieldOffset(0)] public KeyboardInput ki; }

        [StructLayout(LayoutKind.Sequential)]
        struct Input { public uint type; public InputUnion u; }

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SetCursorPos(int x, int y);

        [DllImport("user32.dll", SetLastError = true)]
        static extern uint SendInput(uint count, Input[] inputs, int size);

        [DllImport("user32.dll")]
        static extern bool SystemParametersInfo(uint action, uint param, ref uint value, uint winIni);

        static void Send(params Input[] inputs)
        {
            uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
            if (sent != inputs.Length)
                throw new HelperError("permission_denied", "系统没让模拟输入（可能有以管理员身份运行的窗口在前面）。");
        }

        static Input Mouse(uint flags, uint data)
        {
            var input = new Input { type = InputMouse };
            input.u.mi.dwFlags = flags;
            input.u.mi.mouseData = data;
            return input;
        }

        public static void MoveTo(int x, int y)
        {
            if (!SetCursorPos(x, y)) throw new HelperError("failed", "没能把鼠标移过去。");
        }

        public static void Click(int x, int y, string button, int clicks)
        {
            MoveTo(x, y);
            uint down = MouseLeftDown;
            uint up = MouseLeftUp;
            if (button == "right")
            {
                down = MouseRightDown;
                up = MouseRightUp;
            }
            else if (button == "middle")
            {
                down = MouseMiddleDown;
                up = MouseMiddleUp;
            }
            for (int i = 0; i < clicks; i++) Send(Mouse(down, 0), Mouse(up, 0));
        }

        public static void Drag(int fromX, int fromY, int toX, int toY)
        {
            MoveTo(fromX, fromY);
            Send(Mouse(MouseLeftDown, 0));
            try
            {
                for (int step = 1; step <= 10; step++)
                {
                    MoveTo(fromX + (toX - fromX) * step / 10, fromY + (toY - fromY) * step / 10);
                    Send(Mouse(MouseMove, 0));
                    Thread.Sleep(15);
                }
            }
            finally
            {
                Send(Mouse(MouseLeftUp, 0));
            }
        }

        public static void Scroll(int dx, int dy)
        {
            uint lines = 3;
            if (!SystemParametersInfo(SpiGetWheelScrollLines, 0, ref lines, 0) || lines == 0 || lines > 100) lines = 3;
            if (dy != 0) Send(Mouse(MouseWheel, unchecked((uint)(int)Math.Round(-dy * (double)WheelDelta / lines))));
            if (dx != 0) Send(Mouse(MouseHWheel, unchecked((uint)(int)Math.Round(dx * (double)WheelDelta / lines))));
        }

        static Input Key(ushort vk, bool up)
        {
            var input = new Input { type = InputKeyboard };
            input.u.ki.wVk = vk;
            input.u.ki.dwFlags = (up ? KeyUp : 0) | (KeyChord.IsExtended(vk) ? KeyExtended : 0);
            return input;
        }

        public static void Press(KeyChord chord)
        {
            var inputs = new System.Collections.Generic.List<Input>();
            foreach (ushort modifier in chord.Modifiers) inputs.Add(Key(modifier, false));
            inputs.Add(Key(chord.Key, false));
            inputs.Add(Key(chord.Key, true));
            for (int i = chord.Modifiers.Count - 1; i >= 0; i--) inputs.Add(Key(chord.Modifiers[i], true));
            Send(inputs.ToArray());
        }
    }
}
