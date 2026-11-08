import Foundation

enum NodeHTTPError: Error, LocalizedError {
    case unauthorized
    case status(Int)
    case malformed

    var errorDescription: String? {
        switch self {
        case .unauthorized: return "凭证失效，需要重新配对。"
        case .status(let code): return "服务器返回 HTTP \(code)，请检查连接或稍后重试。"
        case .malformed: return "服务器回答格式不符，请核对节点协议版本。"
        }
    }
}

final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) {
        // Node credentials belong to exactly one origin; API redirects are configuration errors.
        completionHandler(nil)
    }
}

final class NodeHTTP {
    let server: URL
    private let credential: String?
    private let session: URLSession

    init(server: URL, credential: String? = nil) {
        self.server = server
        self.credential = credential
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 40
        configuration.timeoutIntervalForResource = 50
        session = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }

    func close() { session.invalidateAndCancel() }

    func pair(_ request: PairRequest) async throws -> PairResponse {
        let data = try await send("v2/nodes/pair", body: JSONEncoder().encode(request))
        return try decode(PairResponse.self, data)
    }

    func hello(_ capabilities: [ActionKind], idleSeconds: Int?) async throws -> HelloResponse {
        let request = HelloRequest(capabilities: capabilities, idleSeconds: idleSeconds)
        let response = try await send("v2/nodes/hello", body: try JSONEncoder().encode(request))
        return try decode(HelloResponse.self, response)
    }

    func next() async throws -> RemoteAction? {
        let data = try await send("v2/nodes/actions/next", query: "wait=25")
        if data.isEmpty { return nil }
        return try decode(NextAction.self, data).action
    }

    func report(id: String, value: ActionReport) async throws {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
        guard !id.isEmpty, let encoded = id.addingPercentEncoding(withAllowedCharacters: allowed) else {
            throw NodeHTTPError.malformed
        }
        var parts = URLComponents(url: server, resolvingAgainstBaseURL: false)!
        parts.percentEncodedPath = "/v2/nodes/actions/" + encoded + "/result"
        _ = try await request(url: parts.url!, body: JSONEncoder().encode(value))
    }

    /// 节点换到的是独立系统会话；令牌只经 HTTPS Set-Cookie 进入本站 Cookie store，不经网页脚本或工具回答。
    func browserSessionCookie() async throws -> HTTPCookie {
        let (_, http) = try await response(url: server.appendingPathComponent("v2/nodes/browser-session"),
                                           body: Data("{}".utf8))
        guard let header = http.value(forHTTPHeaderField: "Set-Cookie"),
              let cookie = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: server)
                .first(where: { $0.name == "plasticine_session" }),
              cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
                == server.host?.lowercased(), cookie.path == "/", cookie.isHTTPOnly,
              server.scheme != "https" || cookie.isSecure else { throw NodeHTTPError.malformed }
        return cookie
    }

    private func send(_ path: String, body: Data? = nil, query: String? = nil) async throws -> Data {
        var parts = URLComponents(url: server.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        parts.percentEncodedQuery = query
        return try await request(url: parts.url!, body: body)
    }

    private func request(url: URL, body: Data?) async throws -> Data {
        try await response(url: url, body: body).0
    }

    private func response(url: URL, body: Data?) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: url)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let credential { request.setValue("Bearer " + credential, forHTTPHeaderField: "Authorization") }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw NodeHTTPError.malformed }
        if http.statusCode == 401 { throw NodeHTTPError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw NodeHTTPError.status(http.statusCode) }
        return (data, http)
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try JSONDecoder().decode(type, from: data) }
        catch { throw NodeHTTPError.malformed }
    }
}
