import Foundation

// App 的文件设备动作：把长轮询下发的 ActionParams 交给共用的 FileActions（PlasticineDevice）。
extension FileActions {
    func execute(_ params: ActionParams, roots: [String]) throws -> JSONValue {
        try Task.checkCancellation()
        let path = try PathPolicy(roots: roots).authorize(params.path!)
        switch params.kind {
        case .fileList: return try list(path)
        case .fileRead: return try read(path)
        case .fileWrite: return try write(path, content: params.content!, baseVersion: params.baseVersion)
        default: throw DeviceFailure.refused("不支持的文件动作")
        }
    }
}
