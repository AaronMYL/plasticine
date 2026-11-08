import Darwin
import Foundation

// 「这台 Mac」模式（docs/install-packages.md）：App 用自己带的 Node 跑自己带的服务，窗口指向 http://127.0.0.1:8790/，
// 像 OpenClaw 带它的网关那样。崩了按 1、2、4…30 秒退避重启，稳定跑满一分钟退避归零；退出 App 时先关 stdin、发
// SIGTERM，最多等几秒再 SIGKILL。服务设了 PLASTICINE_STOP_ON_STDIN_EOF=1：App 被强制结束、管道一断，服务自己收尾，
// 不会留一个孤儿进程占着端口。数据在 ~/Library/Application Support/Plasticine/server，日志在 ~/Library/Logs/Plasticine。

/// 崩溃后隔多久重启（可单测）。
struct RestartBackoff {
    static let delays: [TimeInterval] = [1, 2, 4, 8, 16, 30]
    /// 跑满这么久才算稳定，下次崩溃从 1 秒重新数。
    static let stableSeconds: TimeInterval = 60
    private(set) var failures = 0

    mutating func next(ranFor seconds: TimeInterval) -> TimeInterval {
        if seconds >= Self.stableSeconds { failures = 0 }
        let delay = Self.delays[min(failures, Self.delays.count - 1)]
        failures += 1
        return delay
    }
}

/// 服务进程的环境（可单测）：只带几样系统变量，其余全是安装包的设置。
enum LocalServerEnvironment {
    static let inherited = ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "SHELL"]

    static func make(serverDirectory: URL, stateDirectory: URL, port: Int,
                     base: [String: String]) -> [String: String] {
        var environment: [String: String] = [:]
        for key in inherited { if let value = base[key] { environment[key] = value } }
        // 服务器命令（cloud-tools/server-shell.ts）跑的是 bash；带上 Homebrew 的路径，常用工具才找得到。
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        environment["PLASTICINE_STATE"] = stateDirectory.path
        environment["PLASTICINE_PORT"] = String(port)
        environment["PLASTICINE_CLIENT_DIR"] = serverDirectory.appendingPathComponent("client/dist").path
        environment["PLASTICINE_PLAIN_HTTP"] = "1"
        // 2026-11-05 他定：装在这台 Mac 上的实例真跑；对外的动作仍由硬线审批把关。
        environment["PLASTICINE_DRY_RUN"] = "0"
        environment["PLASTICINE_STOP_ON_STDIN_EOF"] = "1"
        return environment
    }
}

@MainActor
final class LocalServer {
    enum State: Equatable {
        case stopped
        case starting
        case running
        case failed(String)
    }

    /// 退出 App 时等服务收尾的上限；AppDelegate 整体只等 5 秒。
    private static let stopGraceSeconds: TimeInterval = 4
    /// 第一次开库、补跑任务；Linux 安装包的健康检查也给一分钟。
    static let healthTimeoutSeconds: TimeInterval = 60
    /// 日志超过这么大就换一份，只留上一份。
    private static let logLimitBytes: UInt64 = 10 * 1024 * 1024

    private(set) var state: State = .stopped
    var onChange: (() -> Void)?
    private var process: Process?
    private var input: Pipe?
    private var startedAt = Date()
    private var backoff = RestartBackoff()
    private var wanted = false
    private var restartTask: Task<Void, Never>?

    var stateText: String {
        switch state {
        case .stopped: return "已停止"
        case .starting: return "正在启动…"
        case .running: return "运行中"
        case .failed(let reason): return reason
        }
    }

    func start() {
        wanted = true
        restartTask?.cancel()
        restartTask = nil
        guard process == nil else { return }
        launch()
    }

    func stop() async {
        wanted = false
        restartTask?.cancel()
        restartTask = nil
        guard let task = process else {
            setState(.stopped)
            return
        }
        try? input?.fileHandleForWriting.close()
        if task.isRunning { task.terminate() }
        let deadline = Date().addingTimeInterval(Self.stopGraceSeconds)
        while task.isRunning && Date() < deadline {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        if task.isRunning { kill(task.processIdentifier, SIGKILL) }
        process = nil
        input = nil
        setState(.stopped)
    }

    /// 本机服务答上 /v2/health 就是 true。
    static func waitHealthy(timeout: TimeInterval = healthTimeoutSeconds) async -> Bool {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 2
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let url = LocalServerAddress.url.appendingPathComponent("v2/health")
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let answer = try? await session.data(from: url),
               (answer.1 as? HTTPURLResponse)?.statusCode == 200 {
                return true
            }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        return false
    }

    private func launch() {
        guard let node = BundledServer.node, let directory = BundledServer.directory else {
            setState(.failed("这个 App 没有带服务，请在设置里改用远程地址。"))
            return
        }
        do {
            let task = Process()
            task.executableURL = node
            task.arguments = ["agent/src/app/main.ts"]
            task.currentDirectoryURL = directory
            task.environment = LocalServerEnvironment.make(
                serverDirectory: directory, stateDirectory: try Self.stateDirectory(),
                port: LocalServerAddress.port, base: ProcessInfo.processInfo.environment
            )
            let pipe = Pipe()
            let log = try Self.logHandle()
            task.standardInput = pipe
            task.standardOutput = log
            task.standardError = log
            task.terminationHandler = { [weak self] finished in
                let status = finished.terminationStatus
                Task { @MainActor in self?.exited(finished, status: status) }
            }
            try task.run()
            process = task
            input = pipe
            startedAt = Date()
            setState(.starting)
            Task { [weak self] in
                let healthy = await LocalServer.waitHealthy()
                if healthy, self?.process === task { self?.setState(.running) }
            }
        } catch {
            setState(.failed("本机服务没能启动：\(error.localizedDescription)"))
            scheduleRestart()
        }
    }

    private func exited(_ task: Process, status: Int32) {
        guard process === task else { return }
        process = nil
        try? input?.fileHandleForWriting.close()
        input = nil
        guard wanted else {
            setState(.stopped)
            return
        }
        setState(.failed("本机服务退出了（\(status)），正在重启"))
        scheduleRestart()
    }

    private func scheduleRestart() {
        let delay = backoff.next(ranFor: Date().timeIntervalSince(startedAt))
        restartTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled, let self, self.wanted, self.process == nil else { return }
            self.launch()
        }
    }

    private func setState(_ state: State) {
        self.state = state
        onChange?()
    }

    private static func stateDirectory() throws -> URL {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                  appropriateFor: nil, create: true)
        let directory = support.appendingPathComponent("Plasticine/server", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        return directory
    }

    private static func logHandle() throws -> FileHandle {
        let library = try FileManager.default.url(for: .libraryDirectory, in: .userDomainMask,
                                                  appropriateFor: nil, create: true)
        let folder = library.appendingPathComponent("Logs/Plasticine", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent("server.log")
        let manager = FileManager.default
        if let size = (try? manager.attributesOfItem(atPath: file.path))?[.size] as? UInt64, size > logLimitBytes {
            let older = folder.appendingPathComponent("server.log.1")
            try? manager.removeItem(at: older)
            try manager.moveItem(at: file, to: older)
        }
        if !manager.fileExists(atPath: file.path) {
            manager.createFile(atPath: file.path, contents: nil, attributes: [.posixPermissions: 0o600])
        }
        let handle = try FileHandle(forWritingTo: file)
        try handle.seekToEnd()
        return handle
    }
}
