// 截屏、点按、文件、命令这些实现在 PlasticineDevice（和助手进程共用，第 14 条）。这里统一导出一次，
// App 里原来直接用 JSONValue、DeviceFailure、PathPolicy 的文件不必逐个加 import。
@_exported import PlasticineDevice
