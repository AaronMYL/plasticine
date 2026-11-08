import Foundation
import XCTest
@testable import Plasticine

final class InternalPageTests: XCTestCase {
    let server = URL(string: "https://plasticine.test/")!

    func test自身网址保留具体对象和编码_根入口回首页() {
        XCTAssertEqual(InternalPageURL.hash(URL(string: "https://plasticine.test/#/notes/n1")!, server: server),
                       "#/notes/n1")
        XCTAssertEqual(InternalPageURL.hash(URL(string: "https://plasticine.test:443/#/books/b1/2/20")!, server: server),
                       "#/books/b1/2/20")
        XCTAssertEqual(InternalPageURL.hash(server, server: server), "#/today")
    }

    func test外站_不同端口_附件_API_配对查询_普通锚点都不冒充内部入口() {
        for address in ["https://other.test/#/notes", "https://plasticine.test:444/#/notes",
                        "http://plasticine.test/#/notes", "https://plasticine.test/v2/notes",
                        "https://plasticine.test/file.pdf", "https://plasticine.test/?code=example",
                        "https://plasticine.test/#section", "https://user@plasticine.test/#/notes"] {
            XCTAssertNil(InternalPageURL.hash(URL(string: address)!, server: server), address)
        }
    }

    func test本机模式仍要匹配配置的完整源() {
        let local = URL(string: "http://127.0.0.1:8790/")!
        XCTAssertEqual(InternalPageURL.hash(local.appendingPathComponent(""), server: local), "#/today")
        XCTAssertNil(InternalPageURL.hash(URL(string: "http://127.0.0.1:8791/#/notes")!, server: local))
    }
}
