import Foundation

// 助手的服务端循环（第 14 条）：stdin 一行一个请求，每个请求一个 Task 并发做，回执一行一个写到 stdout。
// cancel {requestId} 取消在做的那一个（命令会连进程组一起停，见 CommandRunner），被取消的请求自己回 cancelled。
// stdin 关了（壳退出或崩了）就取消全部、最多等 2 秒收尾后退出：助手不能比壳活得久。
// stdout 只写协议行；要留的话写 stderr。
@MainActor
package final class HelperServer {
    // 壳关掉 stdin 之后最多等这么久，让被取消的命令停干净。
    package static let shutdownGraceSeconds: UInt64 = 2

    private let handler: HelperHandling
    private let write: (String) -> Void
    private var running: [String: Task<Void, Never>] = [:]

    package init(handler: HelperHandling, write: @escaping (String) -> Void = HelperServer.standardOutput) {
        self.handler = handler
        self.write = write
    }

    package var inFlight: Int { running.count }

    nonisolated package static func standardOutput(_ line: String) {
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }

    /// 收一行（不含换行）。
    package func receive(_ line: String) {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return }
        switch HelperLine.decode(trimmed) {
        case .rejected(let response):
            send(response)
        case .request(let request):
            if request.method == HelperMethod.cancel.rawValue {
                cancel(request)
                return
            }
            guard running[request.id] == nil else {
                send(.error(id: request.id, HelperError(.duplicateId, "这个 id 的请求还在做，换一个 id")))
                return
            }
            // 我们在主执行器上：Task 的正文要等这一步返回才开始，登记一定在它结束之前。
            running[request.id] = Task { @MainActor [handler] in
                let response: HelperResponse
                do {
                    response = .result(id: request.id, value: try await handler.handle(request))
                } catch {
                    response = .error(id: request.id, HelperError.from(error))
                }
                self.running[request.id] = nil
                self.send(response)
            }
        }
    }

    /// 输入结束：取消在做的全部。
    package func cancelAll() {
        for task in running.values { task.cancel() }
    }

    /// 从 stdin 读到结束，再收尾退出进程。只按 \n 切行（不能用 AsyncLineSequence：它把 U+2028 也当换行，
    /// 而 JSON.stringify 不转义 U+2028）。
    package func start(input: FileHandle = .standardInput) {
        Task.detached { [weak self] in
            var buffer: [UInt8] = []
            do {
                for try await byte in input.bytes {
                    if byte == 0x0A {
                        let line = String(decoding: buffer, as: UTF8.self)
                        buffer.removeAll(keepingCapacity: true)
                        await self?.receive(line)
                    } else {
                        buffer.append(byte)
                    }
                }
            } catch {
                FileHandle.standardError.write(Data("助手读 stdin 出错：\(error.localizedDescription)\n".utf8))
            }
            if !buffer.isEmpty {
                let line = String(decoding: buffer, as: UTF8.self)
                await self?.receive(line)
            }
            await self?.shutdown()
        }
    }

    private func shutdown() async {
        cancelAll()
        let deadline = Date().addingTimeInterval(TimeInterval(Self.shutdownGraceSeconds))
        while !running.isEmpty, Date() < deadline {
            do {
                try await Task.sleep(nanoseconds: 50_000_000)
            } catch {
                break
            }
        }
        exit(0)
    }

    private func cancel(_ request: HelperRequest) {
        let target: String
        do {
            let params = try HelperParams(request.params, allowed: HelperMethod.cancel.parameters)
            target = try params.string("requestId", maxChars: HelperLine.idMaxChars)
        } catch {
            send(.error(id: request.id, HelperError.from(error)))
            return
        }
        guard let task = running[target] else {
            send(.result(id: request.id, value: .object(["cancelled": .bool(false)])))
            return
        }
        task.cancel()
        send(.result(id: request.id, value: .object(["cancelled": .bool(true)])))
    }

    private func send(_ response: HelperResponse) {
        write(HelperLine.encode(response))
    }
}
