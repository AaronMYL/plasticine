import Foundation
import Darwin

package enum CommandChild {
    package static let argument = "--plasticine-command-child"

    package static func runIfRequested() {
        let arguments = CommandLine.arguments
        guard arguments.count == 3, arguments[1] == argument else { return }
        // Establish our own group before zsh can spawn anything; cancellation can then stop the whole command.
        guard setpgid(0, 0) == 0 || getpgrp() == getpid() else {
            fputs("无法创建命令进程组。\n", stderr)
            exit(126)
        }
        let words: [String] = ["/bin/zsh", "-lc", arguments[2]]
        var values: [UnsafeMutablePointer<CChar>?] = words.map { strdup($0) }
        values.append(nil)
        defer { for value in values { free(value) } }
        values.withUnsafeBufferPointer { buffer in
            _ = execv("/bin/zsh", buffer.baseAddress!)
        }
        fputs("无法执行 /bin/zsh。\n", stderr)
        exit(126)
    }
}
