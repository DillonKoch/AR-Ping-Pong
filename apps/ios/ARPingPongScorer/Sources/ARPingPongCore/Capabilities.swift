import Foundation

public protocol SpeechOutput {
    func speak(_ phrase: String)
    func stop()
}

public protocol ScoreDisplay {
    func show(score: ScoreState)
}

public protocol GameEventInput {
    var onNearPoint: (() -> Void)? { get set }
    var onFarPoint: (() -> Void)? { get set }
    var onUndo: (() -> Void)? { get set }
}

public protocol VideoFrameSource {
    func start() throws
    func stop()
}
