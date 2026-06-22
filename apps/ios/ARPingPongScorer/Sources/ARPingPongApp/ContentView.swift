import SwiftUI
import ARPingPongCore

struct ContentView: View {
    @ObservedObject var viewModel: ScorekeeperViewModel

    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 8) {
                Text("AR Ping Pong")
                    .font(.title2.weight(.semibold))
                Text(viewModel.score.serving == .near ? "Near serve" : "Far serve")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 32) {
                scorePanel(title: "Near", score: viewModel.score.near) {
                    viewModel.point(to: .near)
                }

                scorePanel(title: "Far", score: viewModel.score.far) {
                    viewModel.point(to: .far)
                }
            }

            if let winner = viewModel.score.winner {
                Text("\(winner.displayName) wins")
                    .font(.headline)
                    .foregroundStyle(.green)
            }

            HStack(spacing: 12) {
                Button("Undo") {
                    viewModel.undo()
                }
                .buttonStyle(.bordered)

                Button("Switch Serve") {
                    viewModel.toggleServer()
                }
                .buttonStyle(.bordered)

                Button("Reset") {
                    viewModel.reset()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding()
    }

    private func scorePanel(title: String, score: Int, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 10) {
                Text(title)
                    .font(.headline)
                Text("\(score)")
                    .font(.system(size: 72, weight: .bold, design: .rounded))
                    .monospacedDigit()
            }
            .frame(maxWidth: .infinity, minHeight: 180)
        }
        .buttonStyle(.borderedProminent)
    }
}
