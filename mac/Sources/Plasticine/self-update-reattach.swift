import Darwin
import Foundation

// 11-05 他反馈：更新后 Dock 上固定的 Plasticine 点不开，又冒出一个新的 Plasticine。
// 原因：0.7.0 及以前的更新把整个旧的 Plasticine.app 挪去「上一版」备份、再在原处放一个新文件夹。Dock 记的是文件夹本身
// （文件 ID），于是跟着旧文件夹去了备份；新版启动后清备份，Dock 的图标就失效了。
// 从这一版起更新只换 Contents（SelfUpdateInstaller.swap），文件夹不变。但下一次更新仍由旧版的安装器来装，所以新版启动
// 时再接一次：「上一版」里是旧安装器挪过去的整包（没有「只换 Contents」的记号）时，把新版的 Contents 放进那个旧文件夹，
// 再用 RENAME_SWAP 原子对调两个文件夹的位置——原路径上又是 Dock 认的那个文件夹，里面是新版。
// 任何一步不成就原样退回，什么都不改；最坏只是 Dock 图标还得他重新拖一次。
enum DockReattach {
    /// 「只换 Contents」装出来的备份里放的记号文件。
    static let marker = ".contents-only"

    /// 接成了返回 true。app：正在跑的这个 Plasticine.app；previous：「上一版」文件夹（测试用）。
    @discardableResult
    static func reattach(app: URL, previous: URL? = nil,
                         register: (URL) -> Void = SelfUpdateInstaller.registerWithLaunchServices) -> Bool {
        let manager = FileManager.default
        guard let folder = previous ?? (try? SelfUpdateInstaller.previousVersionFolder(create: false)) else {
            return false
        }
        let backups = ((try? manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "app" }
        guard backups.count == 1, let old = backups.first else { return false }
        if manager.fileExists(atPath: old.appendingPathComponent(marker).path) { return false }
        let oldContents = old.appendingPathComponent("Contents")
        let appContents = app.appendingPathComponent("Contents")
        guard manager.fileExists(atPath: oldContents.path), manager.fileExists(atPath: appContents.path) else {
            return false
        }
        let parked = old.appendingPathComponent("Contents.previous")
        do { try manager.moveItem(at: oldContents, to: parked) } catch { return false }
        do { try manager.moveItem(at: appContents, to: oldContents) } catch {
            try? manager.moveItem(at: parked, to: oldContents)
            return false
        }
        guard renamex_np(old.path, app.path, UInt32(RENAME_SWAP)) == 0 else {
            // 对调不成（比如不在同一个磁盘上）：把两边的 Contents 放回原处。
            try? manager.moveItem(at: oldContents, to: appContents)
            try? manager.moveItem(at: parked, to: oldContents)
            return false
        }
        // 现在原路径上是 Dock 认的旧文件夹（里面是新版 + 旧版的 Contents.previous），「上一版」里是空出来的新文件夹。
        try? manager.removeItem(at: app.appendingPathComponent("Contents.previous"))
        try? manager.removeItem(at: old)
        try? manager.setAttributes([.modificationDate: Date()], ofItemAtPath: app.path)
        register(app)
        return true
    }
}
