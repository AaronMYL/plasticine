import Foundation

@MainActor
package final class HelperServer {
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

    package func cancelAll() {
        for task in running.values { task.cancel() }
    }

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
