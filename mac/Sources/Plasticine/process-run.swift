import Foundation

struct ProcessResult {
    let exitCode: Int32
    let stdout: String
    let stderr: String
    var ok: Bool { exitCode == 0 }
}

// App 自身签名与更新用到的内部工具（security / openssl / codesign / ditto / open）的同步执行器。
// 不是设备动作，不走设备上限和授权目录。这些工具输出都很小，直读到结束即可。
// 不打印参数或输出：参数里可能带一次性口令，输出里可能带钥匙串信息。
enum Subprocess {
    @discardableResult
    static func run(_ launchPath: String, _ arguments: [String], input: Data? = nil) throws -> ProcessResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: launchPath)
        process.arguments = arguments
        let out = Pipe()
        let err = Pipe()
        process.standardOutput = out
        process.standardError = err
        if let input {
            let stdin = Pipe()
            process.standardInput = stdin
            try process.run()
            stdin.fileHandleForWriting.write(input)
            stdin.fileHandleForWriting.closeFile()
        } else {
            try process.run()
        }
        let outData = out.fileHandleForReading.readDataToEndOfFile()
        let errData = err.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return ProcessResult(
            exitCode: process.terminationStatus,
            stdout: String(data: outData, encoding: .utf8) ?? "",
            stderr: String(data: errData, encoding: .utf8) ?? ""
        )
    }
}
