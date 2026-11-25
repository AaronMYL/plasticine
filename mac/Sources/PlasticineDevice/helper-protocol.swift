import Foundation

package enum HelperErrorCode: String, Codable, CaseIterable {
    case invalidRequest = "invalid_request"
    case unknownMethod = "unknown_method"
    case invalidParams = "invalid_params"
    case refused
    case failed
    case cancelled
    case permissionDenied = "permission_denied"
    case needsConfirmation = "needs_confirmation"
    case screenshotStale = "screenshot_stale"
    case notFound = "not_found"
    case duplicateId = "duplicate_id"
}

package struct HelperError: Error, Equatable {
    package let code: HelperErrorCode
    package let message: String

    package init(_ code: HelperErrorCode, _ message: String) {
        self.code = code
        self.message = message
    }

    package static func from(_ error: Error) -> HelperError {
        if let error = error as? HelperError { return error }
        if error is CancellationError { return HelperError(.cancelled, "已取消，可能已产生部分结果，请先核实。") }
        if let failure = error as? DeviceFailure {
            switch failure {
            case .refused(let message): return HelperError(.refused, message)
            case .failed(let message): return HelperError(.failed, message)
            case .stale: return HelperError(.screenshotStale, failure.errorDescription ?? "截图已失效")
            default: return HelperError(.failed, failure.errorDescription ?? "本机操作失败")
            }
        }
        return HelperError(.failed, "本机操作失败：\(error.localizedDescription)")
    }
}

package struct HelperRequest: Equatable {
    package let id: String
    package let method: String
    package let params: JSONValue

    package init(id: String, method: String, params: JSONValue) {
        self.id = id
        self.method = method
        self.params = params
    }
}

package enum HelperResponse: Equatable {
    case result(id: String, value: JSONValue)
    case error(id: String?, HelperError)
}

package enum HelperDecoded: Equatable {
    case request(HelperRequest)
    case rejected(HelperResponse)
}

package enum HelperLine {
    package static let idMaxChars = 200

    package static func decode(_ line: String) -> HelperDecoded {
        let value: JSONValue
        do {
            value = try JSONDecoder().decode(JSONValue.self, from: Data(line.utf8))
        } catch {
            return .rejected(.error(id: nil, HelperError(.invalidRequest, "这一行不是 JSON")))
        }
        guard case .object(let fields) = value else {
            return .rejected(.error(id: nil, HelperError(.invalidRequest, "请求要是一个 JSON 对象")))
        }
        guard case .string(let id)? = fields["id"], !id.isEmpty, id.count <= idMaxChars else {
            return .rejected(.error(id: nil, HelperError(.invalidRequest, "请求缺 id（1–\(idMaxChars) 字的字符串）")))
        }
        guard case .string(let method)? = fields["method"], !method.isEmpty else {
            return .rejected(.error(id: id, HelperError(.invalidRequest, "请求缺 method")))
        }
        let unknown = Set(fields.keys).subtracting(["id", "method", "params"])
        guard unknown.isEmpty else {
            let names = unknown.sorted().joined(separator: "、")
            return .rejected(.error(id: id, HelperError(.invalidRequest, "请求里有认不出的字段：\(names)")))
        }
        let params = fields["params"] ?? .null
        switch params {
        case .object, .null: return .request(HelperRequest(id: id, method: method, params: params))
        default: return .rejected(.error(id: id, HelperError(.invalidParams, "params 要是一个对象")))
        }
    }

    package static func encode(_ response: HelperResponse) -> String {
        let value: JSONValue
        switch response {
        case .result(let id, let result):
            value = .object(["id": .string(id), "result": result])
        case .error(let id, let error):
            value = .object([
                "id": id.map(JSONValue.string) ?? .null,
                "error": .object(["code": .string(error.code.rawValue), "message": .string(error.message)])
            ])
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(value), let text = String(data: data, encoding: .utf8) else {
            return #"{"error":{"code":"failed","message":"回执编码失败"},"id":null}"#
        }
        return text
    }
}
