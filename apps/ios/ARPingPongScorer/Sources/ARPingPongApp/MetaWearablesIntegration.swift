import ARPingPongCore

// Placeholder for Meta Wearables Device Access Toolkit integration.
//
// When the SDK is added to the Xcode app target, this is where we should map
// glasses camera frames into VideoFrameSource and display/audio features into
// ScoreDisplay or SpeechOutput. Keep Meta SDK types out of ARPingPongCore.
final class MetaGlassesFrameSource: VideoFrameSource {
    func start() throws {
        throw MetaWearablesIntegrationError.sdkNotConnected
    }

    func stop() {}
}

enum MetaWearablesIntegrationError: Error {
    case sdkNotConnected
}
