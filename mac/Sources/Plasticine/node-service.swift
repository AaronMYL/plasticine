import AppKit
import Foundation

@MainActor
private final class NodeConnection {
    let api: NodeHTTP
    let journal: ActionJournal
    let nodeID: String
    var limits: DeviceLimits?
    var limitsVersion = -1
    var helloAt = Date.distantPast

    init(api: NodeHTTP, journal: ActionJournal, nodeID: String) {
        self.api = api
        self.journal = journal
        self.nodeID = nodeID
    }
}

@MainActor
final class NodeService {
    let settings: AppSettings
    private let executor = ActionExecutor()
    private var task: Task<Void, Never>?
    private var generation = UUID()
    private(set) var state = "未配对"
    private(set) var lastConnection: Date?
    private(set) var needsPairing = false
    // 有设备动作正在执行时为真；自更新据此避免替换到一半。
    private(set) var isExecuting = false
    var onChange: (() -> Void)?

    init(settings: AppSettings) { self.settings = settings }

    func restart() {
        let previous = task
        previous?.cancel()
        let current = UUID()
        generation = current
        setState(settings.paused ? "已暂停" : "正在连接")
        task = Task {
            await previous?.value
            guard !Task.isCancelled, generation == current else { return }
            if !settings.paused { await run(current) }
        }
    }

    func toggle() {
        settings.paused.toggle()
        restart()
    }

    func stop() { task?.cancel() }

    /// 网页标签动作在 Plasticine 窗口的标签里做（第 102 条第 3 批）。
    func attachWebTabs(_ tabs: WebTabs) { executor.tabs.tabs = tabs }

    func shutdown() async {
        task?.cancel()
        await task?.value
    }

    func pair(code: String, requestID: String) async throws {
        let server = settings.server
        guard ServerAddress.pairable(server) else {
            throw DeviceFailure.failed("这个服务器地址不能配对：要 HTTPS，或「这台 Mac」的本机服务。")
        }
        task?.cancel()
        await task?.value
        setState("正在配对")
        let api = NodeHTTP(server: server)
        defer { api.close() }
        do {
            let response = try await api.pair(PairRequest(
                requestId: requestID, code: code, name: settings.nodeName, capabilities: Permissions.capabilities
            ))
            guard !response.nodeId.isEmpty, response.limitsVersion >= 0 else { throw NodeHTTPError.malformed }
            try NodeCredentialStore.save(response.credential, server: server)
            settings.setNodeID(response.nodeId, for: server)
            needsPairing = false
            settings.paused = false
            restart()
        } catch {
            needsPairing = true
            setState("配对未完成，请重试")
            throw error
        }
    }

    private func run(_ current: UUID) async {
        let server = settings.server
        let connection: NodeConnection
        do {
            guard let nodeID = settings.nodeID(for: server),
                  let credential = try NodeCredentialStore.read(server: server) else {
                needsPairing = true
                setState("需要配对")
                return
            }
            connection = NodeConnection(
                api: NodeHTTP(server: server, credential: credential),
                journal: try ActionJournal(server: server, nodeID: nodeID), nodeID: nodeID
            )
        } catch {
            setState("设备服务无法启动：\(error.localizedDescription)")
            return
        }
        let heartbeat = Task { await self.heartbeat(connection, current: current) }
        defer {
            heartbeat.cancel()
            connection.api.close()
        }
        var retry = 1
        while !Task.isCancelled, generation == current {
            let action: RemoteAction?
            do {
                if connection.limits == nil || Date().timeIntervalSince(connection.helloAt) > 120 {
                    try await hello(connection)
                }
                try await flush(connection)
                action = try await connection.api.next()
                try Task.checkCancellation()
                lastConnection = Date()
                needsPairing = false
                setState("运行中")
                retry = 1
            } catch {
                if Task.isCancelled { return }
                if case DeviceFailure.failed(let message) = error {
                    setState(message)
                    return
                }
                if case NodeHTTPError.unauthorized = error {
                    invalidate()
                    return
                }
                setState("连接中断，\(retry) 秒后重试")
                guard await delay(retry) else { return }
                retry = min(32, retry * 2)
                continue
            }
            guard let action else { continue }
            do {
                try await execute(action, connection: connection)
            } catch {
                // A journal failure is not a network failure; never execute again to repair a missing receipt.
                setState("执行记录保存失败，结果待核实；请检查磁盘后重启设备服务。")
                return
            }
        }
    }

    private func heartbeat(_ connection: NodeConnection, current: UUID) async {
        // The poll loop performs the initial hello; this timer remains independent of long-running actions.
        while await delay(Int(AppConstants.heartbeatSeconds)) {
            guard generation == current else { return }
            do { try await hello(connection) }
            catch {
                if Task.isCancelled { return }
                if case NodeHTTPError.unauthorized = error {
                    invalidate()
                    return
                }
                setState("心跳未连接，稍后重试")
            }
        }
    }

    private func hello(_ connection: NodeConnection) async throws {
        let response = try await connection.api.hello(Permissions.capabilities, idleSeconds: Permissions.idleSeconds)
        try Task.checkCancellation()
        guard response.nodeId == connection.nodeID, response.limitsVersion >= 0 else { throw NodeHTTPError.malformed }
        if response.limitsVersion >= connection.limitsVersion {
            connection.limits = response.limits
            connection.limitsVersion = response.limitsVersion
        }
        connection.helloAt = Date()
        lastConnection = Date()
        onChange?()
    }

    private func flush(_ connection: NodeConnection) async throws {
        for entry in connection.journal.pending {
            try Task.checkCancellation()
            try await connection.api.report(id: entry.id, value: entry.report!)
            do { try connection.journal.markUploaded(entry.id) }
            catch { throw DeviceFailure.failed("回执确认记录保存失败，请检查磁盘后重启设备服务。") }
        }
    }

    private func execute(_ action: RemoteAction, connection: NodeConnection) async throws {
        if let previous = connection.journal.lookup(action.id) {
            // The next loop uploads this exact prior result, even when the first acknowledgement was lost.
            try connection.journal.finish(action.id, report: previous)
            return
        }
        let actionClass = ActionKind(rawValue: action.kind)?.actionClass ?? "unknown"
        let used = connection.journal.usedThisHour(actionClass)
        isExecuting = true
        defer { isExecuting = false }
        try connection.journal.begin(action, actionClass: actionClass)
        let report: ActionReport
        do {
            guard let expiry = action.expiry, expiry > Date() else { throw DeviceFailure.refused("动作已过期") }
            let params = try action.validatedParams()
            guard let limits = connection.limits else { throw DeviceFailure.refused("设备上限尚未同步") }
            // 设备侧最后一道墙（第 102 条）：付款类未签名放开直接拒；敏感类弹一次原生确认，和逐次确认合成一次。
            let lane = laneFor(params)
            if lane == .deny, limits.payments != "confirm_each" {
                throw DeviceFailure.refused("付款、下单、转账这一类设备上一律不做；要放开只能在设备上改上限。")
            }
            let classConfirm = try LimitPolicy.check(
                params, limits: limits, localRoots: settings.roots, used: used, attended: Permissions.attended
            )
            var confirmed = false
            if let detail = confirmDetail(lane: lane, classConfirm: classConfirm, params: params) {
                let allowed = await NativePrompts.confirm("Plasticine 请求执行 \(params.kind.rawValue)", detail: detail)
                guard allowed else { throw DeviceFailure.refused("用户未允许这次动作") }
                // 只有按道（付款 / 敏感）问过的才算网页标签那一步也问过；按上限逐次确认的没说到密码框这类。
                confirmed = lane != .allow
            }
            try Task.checkCancellation()
            guard expiry > Date() else { throw DeviceFailure.refused("动作在等待确认时已过期") }
            // Settings may have been tightened while the confirmation was open.
            _ = try LimitPolicy.check(
                params, limits: connection.limits ?? limits, localRoots: settings.roots,
                used: used, attended: Permissions.attended
            )
            let tab = TabActionContext(paymentsOpen: limits.payments == "confirm_each", confirmed: confirmed,
                                       sites: (connection.limits ?? limits).sites)
            report = await executor.execute(params, roots: settings.roots, sites: limits.sites, tab: tab) {
                guard expiry > Date() else { throw DeviceFailure.refused("动作在等待确认时已过期") }
                _ = try LimitPolicy.check(
                    params, limits: connection.limits ?? limits, localRoots: self.settings.roots,
                    used: used, attended: Permissions.attended
                )
            }
        } catch DeviceFailure.refused(let reason) {
            report = .refused(reason)
        } catch is CancellationError {
            report = .refused("设备服务已暂停或退出")
        } catch is DecodingError {
            report = .refused("动作参数无法解析，请检查节点协议和参数。")
        } catch {
            report = .failed("设备执行出错：\(error.localizedDescription)")
        }
        try connection.journal.finish(action.id, report: report)
    }

    private func laneFor(_ params: ActionParams) -> DeviceLane {
        var inSettingsApp = false
        if params.kind == .inputClick {
            let front = NSWorkspace.shared.frontmostApplication
            inSettingsApp = [front?.bundleIdentifier, front?.localizedName]
                .compactMap { $0 }.contains { DeviceLanePolicy.isSettingsApp($0) }
        }
        return DeviceLanePolicy.classify(params, inSettingsApp: inSettingsApp)
    }

    private func confirmDetail(lane: DeviceLane, classConfirm: Bool, params: ActionParams) -> String? {
        switch lane {
        case .deny: return "这是付款 / 下单 / 转账类动作，确认后才在这台设备上执行。"
        case .confirm: return "这一步会读密码、改系统设置或在系统设置里操作，确认后才执行。"
        case .allow:
            guard classConfirm else { return nil }
            return params.path ?? params.cwd ?? params.url ?? params.app ?? params.tabId.map { "网页标签 " + $0 }
                ?? "按设备上限逐次确认。"
        }
    }

    private func invalidate() {
        needsPairing = true
        setState("需要重新配对")
        task?.cancel()
    }

    private func setState(_ state: String) {
        self.state = state
        onChange?()
    }

    private func delay(_ seconds: Int) async -> Bool {
        do {
            try await Task.sleep(nanoseconds: UInt64(seconds) * 1_000_000_000)
            return !Task.isCancelled
        } catch { return false }
    }
}
