// Win32：按物理像素算坐标（SetProcessDPIAware）、移鼠标点一下、按 Unicode 一个个字打进去（SendInput）。
using System;
using System.Runtime.InteropServices;

namespace Plasticine.Helper
{
    static class Native
    {
        const uint InputMouse = 0;
        const uint InputKeyboard = 1;
        const uint MouseLeftDown = 0x0002;
        const uint MouseLeftUp = 0x0004;
        const uint KeyUnicode = 0x0004;
        const uint KeyUp = 0x0002;

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

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SetCursorPos(int x, int y);

        [DllImport("user32.dll", SetLastError = true)]
        static extern uint SendInput(uint count, Input[] inputs, int size);

        static void Send(Input[] inputs)
        {
            uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
            if (sent != inputs.Length)
                throw new HelperError("permission_denied", "系统没让模拟输入（可能有以管理员身份运行的窗口在前面）。");
        }

        public static void Click(int x, int y)
        {
            if (!SetCursorPos(x, y)) throw new HelperError("failed", "没能把鼠标移过去。");
            var down = new Input { type = InputMouse };
            down.u.mi.dwFlags = MouseLeftDown;
            var up = new Input { type = InputMouse };
            up.u.mi.dwFlags = MouseLeftUp;
            Send(new[] { down, up });
        }

        public static void TypeText(string text)
        {
            var inputs = new Input[text.Length * 2];
            for (int i = 0; i < text.Length; i++)
            {
                inputs[i * 2] = new Input { type = InputKeyboard };
                inputs[i * 2].u.ki.wScan = text[i];
                inputs[i * 2].u.ki.dwFlags = KeyUnicode;
                inputs[i * 2 + 1] = new Input { type = InputKeyboard };
                inputs[i * 2 + 1].u.ki.wScan = text[i];
                inputs[i * 2 + 1].u.ki.dwFlags = KeyUnicode | KeyUp;
            }
            Send(inputs);
        }
    }
}
