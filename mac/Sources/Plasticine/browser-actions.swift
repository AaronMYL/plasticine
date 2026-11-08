import Foundation

final class BrowserRedirects: NSObject, URLSessionTaskDelegate {
    let sites: [String]
    init(sites: [String]) { self.sites = sites }

    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard let url = request.url, let host = url.host,
              url.scheme == "https" || url.scheme == "http", LimitPolicy.siteAllowed(host, sites: sites) else {
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }
}

enum BrowserReader {
    static func read(_ url: URL, sites: [String]) async throws -> JSONValue {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 45
        let session = URLSession(
            configuration: configuration, delegate: BrowserRedirects(sites: sites), delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        let (stream, response) = try await session.bytes(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw DeviceFailure.failed("网页读取失败或跳转到未授权站点，请检查地址和站点上限。")
        }
        var output = BoundedOutput(limit: AppConstants.pageBytes)
        var chunk = Data()
        for try await byte in stream {
            try Task.checkCancellation()
            chunk.append(byte)
            if chunk.count >= 4096 {
                output.append(chunk)
                chunk.removeAll(keepingCapacity: true)
                if output.truncated { break }
            }
        }
        output.append(chunk)
        // This is the HTTP text (including HTML), not a browser DOM or a logged-in browser session.
        return .object(["text": .string(output.text), "truncated": .bool(output.truncated)])
    }
}
