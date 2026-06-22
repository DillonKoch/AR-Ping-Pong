import XCTest
@testable import ARPingPongCore

final class GameControllerTests: XCTestCase {
    func testPointUpdatesScore() {
        let controller = GameController()

        controller.point(to: .near)

        XCTAssertEqual(controller.score.near, 1)
        XCTAssertEqual(controller.score.far, 0)
    }

    func testServeChangesEveryTwoPointsBeforeDeuce() {
        let controller = GameController()

        controller.point(to: .near)
        XCTAssertEqual(controller.score.serving, .near)

        controller.point(to: .far)
        XCTAssertEqual(controller.score.serving, .far)
    }

    func testUndoRestoresPreviousScore() {
        let controller = GameController()

        controller.point(to: .near)
        controller.undo()

        XCTAssertEqual(controller.score, ScoreState())
    }
}
