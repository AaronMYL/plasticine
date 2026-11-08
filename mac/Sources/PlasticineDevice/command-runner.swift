import Foundation
import Darwin

package struct CommandResult: Encodable {
    package let exitCode: Int32
    package let stdout: String
    package let stderr: String
    package let truncated: Bool
}

// Drain both pipes with nonblocking reads even after the cap; stderr cannot deadlock the child.
package final class CommandRunner: @unchecked Sendable {
    private let lock = NSLock()
    private var process: Process?
    private var cancelled = false
    private var output: BoundedOutput
    private var errors: BoundedOutput
    private let timeout: TimeInterval

    // 默认和 App 一样：stdout、stderr 各 100 KiB，120 秒。助手进程按次可以收紧输出、放宽到最多 10 分钟。
    package init(timeout: TimeInterval = AppConstants.commandSeconds, outputBytes: Int = AppConstants.commandBytes) {
        self.timeout = min(max(1, timeout), AppConstants.commandSecondsMax)
        let limit = min(max(1, outputBytes), AppConstants.commandBytes)
        output = BoundedOutput(limit: limit)
        errors = BoundedOutput(limit: limit)
    }

    package func run(command: String, directory: URL) async throws -> CommandResult {
        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async {
                    do { continuation.resume(returning: try self.runBlocking(command, directory: directory)) }
                    catch { continuation.resume(throwing: error) }
                }
            }
        }, onCancel: { self.cancel() })
    }

    private func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }

    private func append(_ data: Data, stderr: Bool) {
        lock.lock()
        if stderr { errors.append(data) } else { output.append(data) }
        lock.unlock()
    }

    private func runBlocking(_ command: String, directory: URL) throws -> CommandResult {
        let child = Process()
        guard let executable = Bundle.main.executableURL else {
            throw DeviceFailure.failed("无法找到命令执行程序，请重新安装 Plasticine。")
        }
        child.executableURL = executable
        child.arguments = [CommandChild.argument, command]
        child.currentDirectoryURL = directory
        child.standardInput = FileHandle.nullDevice
        let stdout = Pipe()
        let stderr = Pipe()
        child.standardOutput = stdout
        child.standardError = stderr
        try nonblocking(stdout.fileHandleForReading)
        try nonblocking(stderr.fileHandleForReading)
        defer {
            lock.lock()
            process = nil
            lock.unlock()
        }
        lock.lock()
        if cancelled {
            lock.unlock()
            throw CancellationError()
        }
        do { try child.run() }
        catch {
            lock.unlock()
            throw DeviceFailure.failed("命令无法启动，请检查工作目录和 zsh。")
        }
        process = child
        lock.unlock()
        let deadline = Date().addingTimeInterval(timeout)
        var timedOut = false
        while child.isRunning {
            drainAvailable(stdout.fileHandleForReading, stderr: false)
            drainAvailable(stderr.fileHandleForReading, stderr: true)
            lock.lock()
            let stopped = cancelled
            lock.unlock()
            if stopped || Date() >= deadline {
                timedOut = !stopped
                let pid = child.processIdentifier
                let ownsGroup = getpgid(pid) == pid
                Darwin.kill(ownsGroup ? -pid : pid, SIGTERM)
                Thread.sleep(forTimeInterval: 0.2)
                if ownsGroup { Darwin.kill(-pid, SIGKILL) }
                else if child.isRunning { Darwin.kill(pid, SIGKILL) }
                break
            }
            Thread.sleep(forTimeInterval: 0.05)
        }
        child.waitUntilExit()
        // A background grandchild may still hold the pipe; never wait for EOF here.
        drainAvailable(stdout.fileHandleForReading, stderr: false)
        drainAvailable(stderr.fileHandleForReading, stderr: true)
        try stdout.fileHandleForReading.close()
        try stderr.fileHandleForReading.close()
        lock.lock()
        let stopped = cancelled
        let result = CommandResult(
            exitCode: child.terminationStatus, stdout: output.text, stderr: errors.text,
            truncated: output.truncated || errors.truncated
        )
        lock.unlock()
        if stopped { throw DeviceFailure.failed("命令已取消，部分操作可能已发生，请先核实。") }
        if timedOut {
            let seconds = Int(timeout.rounded())
            throw DeviceFailure.failed("命令超过 \(seconds) 秒，已终止；部分操作可能已发生，请先核实。")
        }
        return result
    }

    private func nonblocking(_ handle: FileHandle) throws {
        let descriptor = handle.fileDescriptor
        let flags = fcntl(descriptor, F_GETFL)
        guard flags >= 0, fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0 else {
            throw DeviceFailure.failed("无法建立命令输出管道，请重新启动设备服务。")
        }
    }

    private func drainAvailable(_ handle: FileHandle, stderr: Bool) {
        let descriptor = handle.fileDescriptor
        let capacity = 8192
        var bytes = [UInt8](repeating: 0, count: capacity)
        // Bound each drain so a continuously writing child cannot starve cancellation or the other pipe.
        for _ in 0..<32 {
            let count = bytes.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, capacity) }
            if count <= 0 { break }
            append(Data(bytes.prefix(count)), stderr: stderr)
        }
    }
}
