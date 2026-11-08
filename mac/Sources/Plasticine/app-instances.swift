import AppKit
import Darwin
import Foundation

// 第 5 条（他 2026-11-05：每次更新装了新的 Plasticine，老版本占着内存关不掉，要去活动监视器强制结束）。
// 三道保险，互不依赖：
// 1. 退出时设备服务最多等 5 秒（app-delegate.swift），再点一次退出立刻退；
// 2. 新版启动时结束同一个 bundle id、比自己先启动的旧实例：先 terminate()（发「退出」，不要自动化授权），
//    几秒后还在就 forceTerminate()；旧实例开的命令子进程（command-child.swift，各自一个进程组）一并结束；
// 3. 进程级兜底 ExitWatchdog：开始退出后到点还活着就直接结束进程，主线程卡住（比如开着模态框）也拦不住它。
// 设备服务就在 App 进程里（node-service.swift 是长轮询，不是另起的 Node 进程）；它跑的命令被取消时
// CommandRunner 自己先 SIGTERM 整个进程组、0.2 秒后 SIGKILL，所以正常退出不会留子进程，只有被强制结束时才会。
// 注意：这台机器没有 Xcode，写的时候没能编译，等 GitHub macOS 机器上跑 swift build / swift test。

/// 一个正在运行的实例（从 NSRunningApplication 取，拆出来好测）。
struct RunningInstance: Equatable {
    let pid: pid_t
    let bundleID: String?
    let launched: Date?
}

enum SingleInstance {
    /// 发了「退出」之后等旧实例自己退的秒数，过了就强制结束。
    static let gracefulSeconds: TimeInterval = 3
    /// 强制结束之后再等的秒数（SIGKILL 一般立刻生效）。
    static let forcedSeconds: TimeInterval = 2

    /// 要结束的旧实例：同一个 bundle id、不是自己、比自己先启动（不知道启动时间的按旧的算）。
    static func stale(_ running: [RunningInstance], bundleID: String, ownPID: pid_t, ownLaunch: Date) -> [pid_t] {
        running.filter { instance in
            guard instance.bundleID == bundleID, instance.pid != ownPID else { return false }
            guard let launched = instance.launched else { return true }
            return launched <= ownLaunch
        }.map { $0.pid }
    }

    /// `pgrep -P` 的输出：一行一个进程号，读不懂的行跳过。
    static func parsePIDs(_ text: String) -> [pid_t] {
        text.split(whereSeparator: \.isNewline).compactMap { line in
            pid_t(line.trimmingCharacters(in: .whitespaces))
        }.filter { $0 > 1 }
    }

    /// 结束还活着的旧实例；没有旧实例立刻返回。返回后旧实例都已退出（或强制结束后仍报未退，不再等）。
    @MainActor
    static func endOlderInstances() async {
        guard let bundleID = Bundle.main.bundleIdentifier else { return }
        let current = NSRunningApplication.current
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
        let described = running.map { app in
            RunningInstance(pid: app.processIdentifier, bundleID: app.bundleIdentifier, launched: app.launchDate)
        }
        let targets = Set(stale(described, bundleID: bundleID, ownPID: current.processIdentifier,
                                ownLaunch: current.launchDate ?? Date()))
        let old = running.filter { targets.contains($0.processIdentifier) }
        guard !old.isEmpty else { return }
        // 旧实例退出后它的子进程就换了父进程，查不到了：先记下来。
        let children = old.flatMap { childProcesses(of: $0.processIdentifier) }
        for app in old { app.terminate() }
        await waitForExit(old, seconds: gracefulSeconds)
        for app in old where !app.isTerminated { app.forceTerminate() }
        await waitForExit(old, seconds: forcedSeconds)
        await endProcesses(children)
    }

    private static func childProcesses(of pid: pid_t) -> [pid_t] {
        guard let result = try? Subprocess.run("/usr/bin/pgrep", ["-P", String(pid)]) else { return [] }
        return parsePIDs(result.stdout)
    }

    @MainActor
    private static func waitForExit(_ apps: [NSRunningApplication], seconds: TimeInterval) async {
        let deadline = Date().addingTimeInterval(seconds)
        while apps.contains(where: { !$0.isTerminated }), Date() < deadline {
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
    }

    /// 命令子进程自己是进程组组长（command-child.swift），连组一起结束；不是组长的只结束它自己。
    private static func endProcesses(_ pids: [pid_t]) async {
        let alive = pids.filter { Darwin.kill($0, 0) == 0 }
        guard !alive.isEmpty else { return }
        for pid in alive { Darwin.kill(target(pid), SIGTERM) }
        try? await Task.sleep(nanoseconds: 500_000_000)
        for pid in alive where Darwin.kill(pid, 0) == 0 { Darwin.kill(target(pid), SIGKILL) }
    }

    private static func target(_ pid: pid_t) -> pid_t {
        getpgid(pid) == pid ? -pid : pid
    }
}

enum ExitWatchdog {
    /// 到点这个进程还在就直接结束。用 _exit：不跑 atexit，卡住的收尾拦不住它；回执在执行前后已原子落盘。
    static func arm(after seconds: TimeInterval) {
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + seconds) { _exit(0) }
    }
}
