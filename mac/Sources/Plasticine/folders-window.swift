import AppKit

@MainActor
final class FoldersWindow: NSObject, NSTableViewDataSource, NSTableViewDelegate {
    private let settings: AppSettings
    private let table = NSTableView()
    private let window: NSWindow
    var onChange: (() -> Void)?

    init(settings: AppSettings) {
        self.settings = settings
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 620, height: 380),
            styleMask: [.titled, .closable], backing: .buffered, defer: false
        )
        super.init()
        window.title = "授权目录"
        window.isReleasedWhenClosed = false
        window.center()
        let column = NativeLayout.column(in: window)
        column.addArrangedSubview(NativeLayout.label("默认授权整个家目录。移除后，后续文件动作和命令工作目录会重新检查。"))
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        table.addTableColumn(NSTableColumn(identifier: NSUserInterfaceItemIdentifier("path")))
        table.tableColumns[0].width = 540
        table.headerView = nil
        table.rowHeight = 28
        table.dataSource = self
        table.delegate = self
        scroll.documentView = table
        column.addArrangedSubview(scroll)
        scroll.widthAnchor.constraint(equalTo: column.widthAnchor).isActive = true
        scroll.heightAnchor.constraint(equalToConstant: 240).isActive = true
        column.addArrangedSubview(NativeLayout.row([
            NativeLayout.button("添加目录…", target: self, action: #selector(add)),
            NativeLayout.button("移除所选", target: self, action: #selector(remove))
        ]))
    }

    func show() {
        table.reloadData()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func numberOfRows(in tableView: NSTableView) -> Int { settings.roots.count }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        NativeLayout.label(settings.roots[row])
    }

    @objc private func add() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        panel.prompt = "授权"
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self, response == .OK else { return }
            var roots = settings.roots
            for url in panel.urls {
                let path = url.resolvingSymlinksInPath().standardizedFileURL.path
                if !roots.contains(path) { roots.append(path) }
            }
            settings.roots = roots
            table.reloadData()
            onChange?()
        }
    }

    @objc private func remove() {
        let index = table.selectedRow
        var roots = settings.roots
        guard roots.indices.contains(index) else { return }
        roots.remove(at: index)
        settings.roots = roots
        table.reloadData()
        onChange?()
    }
}
