import Foundation

// 把下载好的包装到位：解压 → 定位 .app → 用本机自签证书重签 → 校验签名 → 备份旧版 → 换上新版（只换 Contents）。
// 任何一步失败都保留旧版本：换入前旧版原封不动；换入失败则把备份改回原名。
// 旧版备份放在「~/Library/Application Support/Plasticine/上一版」，不放「应用程序」里（用户 2026-11-03：应用程序里只要
// 一个 Plasticine）；新版启动后把这份备份和以前留在「应用程序」里的 Plasticine-backup-*.app 一起清掉。
enum SelfUpdateInstaller {
    static func install(zip: Data, current: URL) throws {
        let work = try FileManager.default.url(
            for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: current, create: true
        )
        defer { try? FileManager.default.removeItem(at: work) }
        let archive = work.appendingPathComponent("update.zip")
        try zip.write(to: archive)
        let unpacked = work.appendingPathComponent("unpacked")
        try FileManager.default.createDirectory(at: unpacked, withIntermediateDirectories: true)
        let extracted = try Subprocess.run("/usr/bin/ditto", ["-x", "-k", archive.path, unpacked.path])
        guard extracted.ok else { throw DeviceFailure.failed("更新包解压失败。") }
        guard let newApp = try locateApp(in: unpacked) else {
            throw DeviceFailure.failed("更新包里没有 Plasticine.app。")
        }
        let identity = try SelfSigning.ensureIdentity()
        let signed = try Subprocess.run("/usr/bin/codesign", ["--force", "--deep", "-s", identity, newApp.path])
        guard signed.ok else { throw DeviceFailure.failed("用本机证书重签新版失败。") }
        let verified = try Subprocess.run("/usr/bin/codesign", ["--verify", "--deep", "--strict", newApp.path])
        guard verified.ok else { throw DeviceFailure.failed("新版签名校验未通过，已保留当前版本。") }
        try swap(newApp: newApp, current: current)
    }

    /// 换新版只换包里的 Contents，Plasticine.app 这个文件夹本身不动（11-05 他反馈：更新后 Dock 上固定的图标点不开、
    /// 又冒出一个新的 Plasticine）。原因：Dock 记的是这个文件夹本身（文件 ID），以前把整个旧包挪去备份，Dock 跟着
    /// 文件 ID 指到了备份，新版启动后备份被清掉，Dock 那个图标就失效了。只换 Contents，文件夹还是原来那个，Dock、
    /// 「应用程序」和登录项里的引用都照旧。internal 以便单测；register 默认向 LaunchServices 重新登记。
    static func swap(newApp: URL, current: URL, backupFolder: URL? = nil,
                     register: (URL) -> Void = SelfUpdateInstaller.registerWithLaunchServices) throws {
        let manager = FileManager.default
        let folder = try backupFolder ?? previousVersionFolder()
        // 上一次更新留下的备份先清掉，只留这一份。
        for stale in (try? manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [] {
            try? manager.removeItem(at: stale)
        }
        let backup = folder.appendingPathComponent("Plasticine-\(timestamp()).app")
        try manager.createDirectory(at: backup, withIntermediateDirectories: true)
        // 记号：这份备份是「只换 Contents」装出来的，Dock 没指着它，新版启动时不用接回（DockReattach）。
        manager.createFile(atPath: backup.appendingPathComponent(DockReattach.marker).path, contents: Data())
        let currentContents = current.appendingPathComponent("Contents")
        let backupContents = backup.appendingPathComponent("Contents")
        let newContents = newApp.appendingPathComponent("Contents")
        guard manager.fileExists(atPath: newContents.path) else {
            throw DeviceFailure.failed("更新包里的 Plasticine.app 不完整，已保留当前版本。")
        }
        do {
            try manager.moveItem(at: currentContents, to: backupContents)
        } catch {
            throw DeviceFailure.failed("没能腾出旧版本，已保留当前版本。")
        }
        do {
            try manager.moveItem(at: newContents, to: currentContents)
        } catch {
            // 换入失败：删掉半成品、把旧的 Contents 放回去，旧版照旧可用。
            try? manager.removeItem(at: currentContents)
            try? manager.moveItem(at: backupContents, to: currentContents)
            throw DeviceFailure.failed("替换新版失败，已恢复当前版本。")
        }
        // 改一下文件夹的修改时间，Finder 和 Dock 才会重新读图标和版本。
        try? manager.setAttributes([.modificationDate: Date()], ofItemAtPath: current.path)
        register(current)
    }

    /// 向 LaunchServices 重新登记，Dock、「打开方式」认到新版本。失败不影响更新本身。
    static func registerWithLaunchServices(_ app: URL) {
        let tool = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework"
            + "/Support/lsregister"
        _ = try? Subprocess.run(tool, ["-f", app.path])
    }

    /// 一步回退：「上一版」里那份换回来（swap 会把现在这版存成新的「上一版」，所以再回退一次又回来）。
    /// internal 以便单测；backupFolder、register 同 swap。
    static func rollback(current: URL, backupFolder: URL? = nil,
                         register: (URL) -> Void = SelfUpdateInstaller.registerWithLaunchServices) throws {
        let manager = FileManager.default
        let folder = try backupFolder ?? previousVersionFolder()
        guard let backup = latestBackup(in: folder) else { throw DeviceFailure.failed("没有上一版可以回退。") }
        let work = try manager.url(for: .itemReplacementDirectory, in: .userDomainMask,
                                   appropriateFor: current, create: true)
        defer { try? manager.removeItem(at: work) }
        let staged = work.appendingPathComponent("Plasticine.app")
        try manager.moveItem(at: backup, to: staged)
        do {
            try swap(newApp: staged, current: current, backupFolder: folder, register: register)
        } catch {
            // 没换成：备份放回原处，下次还能回退。
            try? manager.moveItem(at: staged, to: backup)
            throw error
        }
    }

    /// 「上一版」里最新的一份完整备份（有 Contents）。
    static func latestBackup(in folder: URL? = nil) -> URL? {
        guard let folder = folder ?? (try? previousVersionFolder(create: false)) else { return nil }
        let entries = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        return entries
            .filter { $0.pathExtension == "app" }
            .filter { FileManager.default.fileExists(atPath: $0.appendingPathComponent("Contents").path) }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
            .first
    }

    /// 新版启动后调：清掉旧版本更新时留在 App 旁边的 Plasticine-backup-*.app，以及上一版备份
    /// （keepPrevious 时留着上一版，供一步回退：「这台 Mac」模式）。返回清掉的个数。
    @discardableResult
    static func removeLeftoverBackups(besides app: URL, previous: URL? = nil, keepPrevious: Bool = false) -> Int {
        var removed = 0
        let manager = FileManager.default
        let siblings = (try? manager.contentsOfDirectory(at: app.deletingLastPathComponent(),
                                                          includingPropertiesForKeys: nil)) ?? []
        for item in siblings where isLeftoverBackup(item.lastPathComponent) {
            if (try? manager.removeItem(at: item)) != nil { removed += 1 }
        }
        if !keepPrevious, let folder = previous ?? (try? previousVersionFolder(create: false)) {
            for item in (try? manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [] {
                if (try? manager.removeItem(at: item)) != nil { removed += 1 }
            }
        }
        return removed
    }

    /// 「上一版」留满 7 天就删（2026-11-13 定：备份最多 2 份、每份 7 天；这里只有一份）。按备份文件夹的创建时间算，
    /// 打开、复制都不会让它重新计时。每次查更新都调，所以没有新版本也会到期清。返回删掉的个数。
    @discardableResult
    static func expirePreviousBackups(in folder: URL? = nil, now: Date = Date(),
                                      keep: TimeInterval = 7 * 24 * 60 * 60) -> Int {
        let manager = FileManager.default
        guard let target = folder ?? (try? previousVersionFolder(create: false)) else { return 0 }
        let items = (try? manager.contentsOfDirectory(at: target, includingPropertiesForKeys: [.creationDateKey])) ?? []
        var removed = 0
        for item in items {
            guard let created = (try? item.resourceValues(forKeys: [.creationDateKey]))?.creationDate,
                  now.timeIntervalSince(created) >= keep else { continue }
            if (try? manager.removeItem(at: item)) != nil { removed += 1 }
        }
        return removed
    }

    /// 只认自更新起的名字：Plasticine-backup-<时间>-<进程号>.app。internal 以便单测。
    static func isLeftoverBackup(_ name: String) -> Bool {
        name.hasPrefix("Plasticine-backup-") && name.hasSuffix(".app")
    }

    static func previousVersionFolder(create: Bool = true) throws -> URL {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                  appropriateFor: nil, create: create)
        let folder = support.appendingPathComponent("Plasticine/上一版", isDirectory: true)
        if create { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }
        return folder
    }

    /// 在解压目录（含子目录）里找到第一个 .app。internal 以便单测。
    static func locateApp(in directory: URL) throws -> URL? {
        let entries = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        if let app = entries.first(where: { $0.pathExtension == "app" }) { return app }
        for entry in entries where (try? entry.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true {
            if let nested = try locateApp(in: entry) { return nested }
        }
        return nil
    }

    private static func timestamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: Date())
    }
}
