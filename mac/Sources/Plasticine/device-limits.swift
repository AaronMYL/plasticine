import Foundation

enum LimitPolicy {
    static func check(
        _ params: ActionParams, limits: DeviceLimits, localRoots: [String], used: Int, attended: Bool
    ) throws -> Bool {
        guard let rule = limits.classes[params.kind.actionClass],
              ["allow", "confirm_each", "deny"].contains(rule.mode), rule.perHour >= 0 else {
            throw DeviceFailure.refused("设备上限格式不完整，请在网页设备设置中核对")
        }
        guard rule.mode != "deny" else { throw DeviceFailure.refused("设备上限不允许这类动作") }
        guard used < rule.perHour else { throw DeviceFailure.refused("已达到这类动作的每小时上限") }
        // File actions stay inside the authorized folders; a command's working directory does not (see ActionExecutor).
        if let path = params.path {
            _ = try PathPolicy(roots: localRoots).authorize(path)
            // Decision 97: an empty cloud list means no extra limit; the folders authorized on this Mac still apply.
            if !limits.roots.isEmpty { _ = try PathPolicy(roots: limits.roots).authorize(path) }
        }
        if let address = params.url {
            guard let host = URL(string: address)?.host, siteAllowed(host, sites: limits.sites) else {
                throw DeviceFailure.refused("站点不在设备上限内，请在网页设备设置中授权")
            }
        }
        if let app = params.app, !limits.apps.isEmpty, !limits.apps.contains(app), !limits.apps.contains("*") {
            throw DeviceFailure.refused("应用不在设备上限内，请在网页设备设置中授权")
        }
        if params.kind.actionClass == "input", !limits.unattendedInput, !attended {
            throw DeviceFailure.refused("设备前无人，当前上限不允许操作屏幕和应用")
        }
        return rule.mode == "confirm_each" && params.kind != .fileDelete
    }

    static func siteAllowed(_ host: String, sites: [String]) -> Bool {
        sites.isEmpty || sites.contains {
            $0 == "*" || host.lowercased() == $0.lowercased() || host.lowercased().hasSuffix("." + $0.lowercased())
        }
    }
}
