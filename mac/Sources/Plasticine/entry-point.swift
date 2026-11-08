import AppKit

@main
enum PlasticineApp {
    @MainActor
    static func main() {
        CommandChild.runIfRequested()
        let application = NSApplication.shared
        application.setActivationPolicy(.regular)
        let delegate = AppDelegate()
        application.delegate = delegate
        withExtendedLifetime(delegate) { application.run() }
    }
}
