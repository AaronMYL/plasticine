import Foundation
import XCTest
@testable import PlasticineDevice

final class ScreenGeometryTests: XCTestCase {
    func test视网膜截图坐标还原为全局点坐标() throws {
        let geometry = ScreenGeometry(
            frame: CGRect(x: 0, y: 0, width: 1512, height: 982), pixelWidth: 3024, pixelHeight: 1964
        )
        XCTAssertEqual(geometry.width, 1600)
        XCTAssertLessThanOrEqual(geometry.height, 1600)
        let point = try geometry.point(x: 800, y: 400)
        XCTAssertEqual(point.x, 756, accuracy: 0.01)
        XCTAssertEqual(point.y, 400 * 982 / Double(geometry.height), accuracy: 0.01)
        XCTAssertThrowsError(try geometry.point(x: 1600, y: 0))
        XCTAssertThrowsError(try geometry.point(x: -1, y: 0))
    }

    func test小屏不放大且保留显示器原点() throws {
        let geometry = ScreenGeometry(
            frame: CGRect(x: -800, y: 50, width: 800, height: 600), pixelWidth: 800, pixelHeight: 600
        )
        XCTAssertEqual(geometry.width, 800)
        XCTAssertEqual(try geometry.point(x: 100, y: 200), CGPoint(x: -700, y: 250))
    }
}
