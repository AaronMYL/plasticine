import AppKit
import Foundation

// 第 102 条：Mac 是 Plasticine 的手脚，用本机自签证书签名、自己更新。
// 菜单里「检查更新」或每 6 小时自动查一次；发现新版就下载、校验、用本机证书重签、备份旧版、换上新版、重启自己。
// 有设备动作正在执行时不替换。失败保留旧版本、记下原因，菜单显示「更新失败：原因」。
@MainActor
final class SelfUpdate {
    enum State: Equatable {
        case idle
        case checking
        case downloading
        case upToDate(String)
        case failed(String)
    }

    private static let checkInterval: TimeInterval = 6 * 60 * 60
    private static let relaunchExitSeconds: TimeInterval = 8

    private let settings: AppSettings
    /// 是否有设备动作正在执行（有就不替换）。
    var isBusy: () -> Bool = { false }
    var onChange: (() -> Void)?
    private(set) var state: State = .idle
    private var running = false
    private var timer: Timer?

    init(settings: AppSettings) { self.settings = settings }

    var stateText: String {
        switch state {
        case .idle: return "尚未检查"
        case .checking: return "正在检查…"
        case .downloading: return "正在下载新版…"
        case .upToDate(let version): return "已是最新（\(version)）"
        case .failed(let reason): return "更新失败：\(reason)"
        }
    }

    func startAutomaticChecks() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: Self.checkInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.check() }
        }
        Task { await check() }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    func check() async {
        guard !running else { return }
        running = true
        defer { running = false }
        SelfUpdateInstaller.expirePreviousBackups()
        setState(.checking)
        do {
            let plan = try await fetchPlan()
            guard AppVersion.isNewer(plan.version, than: plan.current) else {
                setState(.upToDate(plan.current))
                return
            }
            guard !isBusy() else {
                setState(.failed("有设备动作正在执行，稍后再更新。"))
                return
            }
            guard let current = currentAppBundle() else {
                throw DeviceFailure.failed("请从打包的 Plasticine.app 运行后再更新。")
            }
            setState(.downloading)
            let zip: Data
            if let server = plan.nodeServer {
                zip = try await download(plan.url, server: server)
            } else {
                zip = try await downloadRelease(plan.url)
            }
            guard Digest.hex(zip) == plan.sha256, plan.size.map({ $0 == zip.count }) ?? true else {
                throw DeviceFailure.failed("更新包校验值不符，已保留当前版本。")
            }
            // 解压、重签、替换会阻塞几秒，放到后台线程，别卡住主界面。
            try await Task.detached(priority: .userInitiated) {
                try SelfUpdateInstaller.install(zip: zip, current: current)
            }.value
            relaunch(current)
        } catch {
            setState(.failed(message(error)))
        }
    }

    /// 带服务清单的 App 都读公开发布点；没有清单的旧安装仍问所连服务器。不更改实例选择。
    private struct Plan {
        let version: String
        let current: String
        let url: URL
        let sha256: String
        let size: Int?
        /// 只有旧节点来源带凭据；固定本次检查时的实例，下载中切换设置也不把另一份凭据送到旧地址。
        let nodeServer: URL?
    }

    private func fetchPlan() async throws -> Plan {
        let source = try SelfUpdateSource.resolve(
            bundled: BundledServer.manifest(), appVersion: AppConstants.version, server: settings.server
        )
        switch source {
        case .release(let current, let manifestURL):
            let session = ReleaseSource.session()
            defer { session.invalidateAndCancel() }
            let manifest: ReleaseManifest
            do {
                let data = try await ReleaseSource.get(manifestURL, session: session)
                manifest = try ReleaseSource.decodeManifest(data)
            } catch let failure as NodeHTTPError {
                throw failure
            } catch {
                throw DeviceFailure.failed("发布清单格式不符。")
            }
            guard let asset = manifest.assets.mac else {
                return Plan(version: current, current: current, url: manifestURL,
                            sha256: "", size: nil, nodeServer: nil)
            }
            return Plan(version: manifest.version, current: current,
                        url: try ReleaseSource.assetURL(asset, manifest: manifestURL),
                        sha256: asset.sha256, size: asset.size, nodeServer: nil)
        case .node(let current, let server):
            let (metadata, target) = try await fetchMetadata(server: server)
            return Plan(version: metadata.version, current: current, url: target,
                        sha256: metadata.sha256, size: nil, nodeServer: server)
        }
    }

    private func downloadRelease(_ url: URL) async throws -> Data {
        let session = ReleaseSource.session()
        defer { session.invalidateAndCancel() }
        return try await ReleaseSource.get(url, session: session)
    }

    /// 一步回退：把「上一版」换回来、重启；再点一次又回到现在这版。实例选择保留在设置里。
    func rollback() async {
        guard !running else { return }
        running = true
        defer { running = false }
        do {
            guard let current = currentAppBundle() else {
                throw DeviceFailure.failed("请从打包的 Plasticine.app 运行后再回退。")
            }
            try await Task.detached(priority: .userInitiated) {
                try SelfUpdateInstaller.rollback(current: current)
            }.value
            relaunch(current)
        } catch {
            setState(.failed(message(error)))
        }
    }

    var canRollBack: Bool { SelfUpdateInstaller.latestBackup() != nil }
    var keepsPreviousVersion: Bool { BundledServer.manifest() != nil }

    private func fetchMetadata(server: URL) async throws -> (UpdateMetadata, URL) {
        let (session, credential) = try authorizedSession(server: server)
        defer { session.invalidateAndCancel() }
        let data = try await get(server.appendingPathComponent(SelfUpdateAPI.latestPath),
                                 session: session, credential: credential)
        let metadata: UpdateMetadata
        do {
            metadata = try JSONDecoder().decode(UpdateMetadata.self, from: data)
        } catch {
            throw DeviceFailure.failed("更新元数据格式不符，请核对服务端接口。")
        }
        return (metadata, try metadata.downloadURL(server: server))
    }

    private func download(_ url: URL, server: URL) async throws -> Data {
        let (session, credential) = try authorizedSession(server: server)
        defer { session.invalidateAndCancel() }
        return try await get(url, session: session, credential: credential)
    }

    private func authorizedSession(server: URL) throws -> (URLSession, String) {
        guard let credential = try NodeCredentialStore.read(server: server) else {
            throw DeviceFailure.failed("这台 Mac 还没有配对，无法检查更新。")
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 60
        // 整包可能有几十 MB，给下载更长的时限。
        configuration.timeoutIntervalForResource = 600
        let session = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
        return (session, credential)
    }

    private func get(_ url: URL, session: URLSession, credential: String) async throws -> Data {
        var request = URLRequest(url: url)
        request.setValue("Bearer " + credential, forHTTPHeaderField: "Authorization")
        // 元数据和 zip 都走这个入口，不强制 Accept，避免服务端对二进制包回 406。
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw NodeHTTPError.malformed }
        if http.statusCode == 401 { throw NodeHTTPError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw NodeHTTPError.status(http.statusCode) }
        return data
    }

    private func currentAppBundle() -> URL? {
        let url = Bundle.main.bundleURL
        return url.pathExtension == "app" ? url : nil
    }

    private func relaunch(_ app: URL) {
        // 等自己退出后再开新版，避免同一时刻两个实例争抢。第 5 条：自己没退干净也不留着——新版启动时会结束
        // 还活着的旧实例（SingleInstance），这里再兜一次底：开始退出 8 秒后这个进程还在就直接结束。
        let quoted = "'" + app.path.replacingOccurrences(of: "'", with: "'\\''") + "'"
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = ["-c", "sleep 1; open -n \(quoted)"]
        try? task.run()
        ExitWatchdog.arm(after: Self.relaunchExitSeconds)
        NSApp.terminate(nil)
    }

    private func message(_ error: Error) -> String {
        if let failure = error as? DeviceFailure { return failure.errorDescription ?? "未知错误。" }
        if let http = error as? NodeHTTPError { return http.errorDescription ?? "网络错误。" }
        return error.localizedDescription
    }

    private func setState(_ state: State) {
        self.state = state
        onChange?()
    }
}
