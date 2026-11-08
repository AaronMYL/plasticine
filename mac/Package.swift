// swift-tools-version: 5.9
import PackageDescription

// 2026-11-06《优化清单》第 14 条：设备能力做成由 Electron 壳调用的助手进程。截屏、点按、文件、命令这些实现搬进
// PlasticineDevice（两个可执行目标共用，用 `package` 访问级别，不对包外公开）；PlasticineHelper 是助手本身
// （stdin / stdout 上的 JSON 行，没有窗口、没有 Dock 图标）。原 App 目标先留着，等 Electron 版上线再删。
let package = Package(
    name: "Plasticine",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Plasticine", targets: ["Plasticine"]),
        .executable(name: "plasticine-helper", targets: ["PlasticineHelper"])
    ],
    targets: [
        .target(name: "PlasticineDevice"),
        .executableTarget(name: "Plasticine", dependencies: ["PlasticineDevice"]),
        .executableTarget(name: "PlasticineHelper", dependencies: ["PlasticineDevice"]),
        .testTarget(name: "PlasticineTests", dependencies: ["Plasticine"]),
        .testTarget(name: "PlasticineDeviceTests", dependencies: ["PlasticineDevice"])
    ],
    swiftLanguageVersions: [.v5]
)
