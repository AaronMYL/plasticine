import AppKit

@MainActor
final class ActionExecutor {
    private let files = FileActions()
    private let screen = ScreenActions()
    let tabs = TabActions()

    func execute(
        _ params: ActionParams, roots: [String], sites: [String], tab: TabActionContext = .unconfirmed,
        recheck: () throws -> Void
    ) async -> ActionReport {
        do {
            try Task.checkCancellation()
            if params.kind.isTab { return .executed(try await tabs.execute(params, context: tab)) }
            return .executed(try await perform(params, roots: roots, sites: sites, recheck: recheck))
        } catch DeviceFailure.refused(let reason) {
            return .refused(reason)
        } catch DeviceFailure.failed(let reason) {
            return .failed(reason)
        } catch DeviceFailure.stale {
            return .stale()
        } catch DeviceFailure.present {
            return .present()
        } catch DeviceFailure.submitHeld(let result) {
            return .submitHeld(result)
        } catch DeviceFailure.pageStale {
            return .pageStale()
        } catch is CancellationError {
            return .failed("动作已取消，可能已产生部分结果，请核实后再派发。")
        } catch {
            return .failed("本机操作失败：\(error.localizedDescription)。请检查目标和系统权限。")
        }
    }

    private func perform(
        _ params: ActionParams, roots: [String], sites: [String], recheck: () throws -> Void
    ) async throws -> JSONValue {
        switch params.kind {
        case .fileList, .fileRead, .fileWrite:
            return try await files.execute(params, roots: roots)
        case .fileDelete:
            let policy = PathPolicy(roots: roots)
            let path = try policy.deletionEntry(params.path!)
            let target = try policy.authorize(params.path!)
            let allowed = await NativePrompts.confirm(
                "Plasticine 要删除 \(path.path)", detail: "将移到废纸篓，可从废纸篓恢复。", accept: "删除", cancel: "不删"
            )
            try Task.checkCancellation()
            guard allowed else { throw DeviceFailure.refused("用户选择不删") }
            try recheck()
            // Re-check after the confirmation, since a directory may have changed while the sheet was open.
            let current = try policy.deletionEntry(params.path!)
            guard current == path, try policy.authorize(params.path!) == target else {
                throw DeviceFailure.refused("文件路径已变化，请重新发起删除")
            }
            try FileManager.default.trashItem(at: path, resultingItemURL: nil)
            return .object([:])
        case .runCommand:
            // A command can cd anywhere, so its working directory is not held to the authorized folders.
            let directory = try PathPolicy(roots: roots).normalize(params.cwd!)
            let result = try await CommandRunner().run(command: params.command!, directory: directory)
            return try JSONValue.from(result)
        case .browserOpen:
            guard NSWorkspace.shared.open(URL(string: params.url!)!) else {
                throw DeviceFailure.failed("无法打开网页，请检查默认浏览器。")
            }
            return .object([:])
        case .browserRead: return try await BrowserReader.read(URL(string: params.url!)!, sites: sites)
        case .screenCapture: return try await screen.capture()
        case .inputClick: return try await screen.click(x: params.x!, y: params.y!)
        case .inputType: return try await screen.type(params.text!)
        case .appOpen: return try await openApp(params.app!)
        case .tabList, .tabRead, .tabOpen, .tabNavigate, .tabClick, .tabFill, .tabPerceive, .tabAct:
            return try await tabs.execute(params, context: .unconfirmed)
        }
    }

    private func openApp(_ name: String) async throws -> JSONValue {
        var url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: name)
        if url == nil {
            let filename = name.hasSuffix(".app") ? name : name + ".app"
            let roots = ["/Applications", "/System/Applications", "/System/Applications/Utilities",
                         FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications").path]
            for root in roots {
                let candidate = URL(fileURLWithPath: root).appendingPathComponent(filename)
                if FileManager.default.fileExists(atPath: candidate.path) {
                    url = candidate
                    break
                }
            }
        }
        guard let url else { throw DeviceFailure.refused("找不到应用，请使用应用名称或 bundle id") }
        let configuration = NSWorkspace.OpenConfiguration()
        _ = try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
        return .object([:])
    }
}
