import Foundation
import Combine

public final class GameController: ObservableObject {
    @Published public private(set) var score: ScoreState

    private var history: [ScoreState] = []
    private let speech: SpeechOutput?
    private let display: ScoreDisplay?

    public init(
        score: ScoreState = ScoreState(),
        speech: SpeechOutput? = nil,
        display: ScoreDisplay? = nil
    ) {
        self.score = score
        self.speech = speech
        self.display = display
    }

    public func point(to side: PlayerSide) {
        history.append(score)
        switch side {
        case .near:
            score.near += 1
        case .far:
            score.far += 1
        }
        updateServer()
        announceAndDisplay()
    }

    public func undo() {
        guard let previous = history.popLast() else { return }
        score = previous
        announceAndDisplay()
    }

    public func reset() {
        history.append(score)
        score = ScoreState(
            serving: score.serving,
            gamePointTarget: score.gamePointTarget,
            winBy: score.winBy
        )
        announceAndDisplay()
    }

    public func toggleServer() {
        history.append(score)
        score.serving = score.serving == .near ? .far : .near
        announceAndDisplay()
    }

    private func updateServer() {
        let total = score.near + score.far
        let interval = score.near >= 10 && score.far >= 10 ? 1 : 2
        if total > 0 && total % interval == 0 {
            score.serving = score.serving == .near ? .far : .near
        }
    }

    private func announceAndDisplay() {
        speech?.speak(score.announcement)
        display?.show(score: score)
    }
}
