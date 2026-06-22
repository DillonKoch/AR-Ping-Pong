import SwiftUI
import ARPingPongCore

@main
struct ARPingPongScorerApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView(
                viewModel: ScorekeeperViewModel(
                    speech: IOSSpeechOutput()
                )
            )
        }
    }
}
