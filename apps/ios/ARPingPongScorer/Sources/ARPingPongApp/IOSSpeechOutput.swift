import AVFoundation
import ARPingPongCore

final class IOSSpeechOutput: NSObject, SpeechOutput {
    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        configureAudioSession()
    }

    func speak(_ phrase: String) {
        synthesizer.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: phrase)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        synthesizer.speak(utterance)
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [.allowBluetooth])
        try? session.setActive(true)
    }
}
