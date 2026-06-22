import Foundation
import Combine
import ARPingPongCore

final class ScorekeeperViewModel: ObservableObject {
    @Published private(set) var score: ScoreState

    private let controller: GameController

    init(speech: SpeechOutput? = nil, display: ScoreDisplay? = nil) {
        let controller = GameController(speech: speech, display: display)
        self.controller = controller
        self.score = controller.score

        controller.objectWillChange.sink { [weak self, weak controller] _ in
            guard let controller else { return }
            self?.score = controller.score
        }
        .store(in: &cancellables)
    }

    private var cancellables: Set<AnyCancellable> = []

    func point(to side: PlayerSide) {
        controller.point(to: side)
    }

    func undo() {
        controller.undo()
    }

    func reset() {
        controller.reset()
    }

    func toggleServer() {
        controller.toggleServer()
    }
}
