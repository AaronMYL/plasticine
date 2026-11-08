import Foundation
import XCTest
@testable import PlasticineDevice

final class ImageDiffTests: XCTestCase {
    private func solid(_ value: UInt8, width: Int = 10, height: Int = 10) -> Bitmap {
        Bitmap(width: width, height: height, pixels: [UInt8](repeating: value, count: width * height * 4))
    }

    func test完全相同的画面视为没变化() {
        XCTAssertEqual(ImageDiff.changed(solid(100), solid(100)), false)
    }

    func test整屏变化视为有变化() {
        XCTAssertEqual(ImageDiff.changed(solid(0), solid(255)), true)
    }

    func test细微噪声低于阈值视为没变化() {
        // 40×40 = 1600 像素，翻动 1 个像素远低于千分之二的阈值。
        var noisy = solid(100, width: 40, height: 40)
        noisy.pixels[0] = 200
        XCTAssertEqual(ImageDiff.changed(solid(100, width: 40, height: 40), noisy), false)
    }

    func test超过阈值的局部变化视为有变化() {
        var changed = solid(100)
        // 翻动前 20% 的像素，远超阈值。
        for index in 0..<(changed.pixels.count / 5) { changed.pixels[index] = 10 }
        XCTAssertEqual(ImageDiff.changed(solid(100), changed), true)
    }

    func test尺寸不同无法比较返回未知() {
        XCTAssertNil(ImageDiff.changed(solid(100, width: 10), solid(100, width: 8)))
    }
}
