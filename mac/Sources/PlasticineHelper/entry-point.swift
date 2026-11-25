import AppKit
import PlasticineDevice

@main
enum PlasticineHelperMain {
    @MainActor
    static func main() {
        CommandChild.runIfRequested()
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)
        let server = HelperServer(handler: HelperDispatcher())
        server.start()
        withExtendedLifetime(server) { application.run() }
    }
}
