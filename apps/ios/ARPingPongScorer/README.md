# AR Ping Pong Scorer iPhone App

This folder starts the iPhone side of the project. The first prototype is
deliberately simple:

- Manual score controls on the iPhone.
- Spoken announcements through iOS text-to-speech, which can route to paired
  Bluetooth glasses.
- Protocols for video, speech, display, and input so Meta Wearables DAT can be
  added later without rewriting game logic.

## Current Shape

`Sources/ARPingPongCore` contains platform-light scoring logic and capability
protocols.

`Sources/ARPingPongApp` contains SwiftUI and iOS implementations. To run this
on a phone, create a new iOS App target in Xcode and add these source folders to
that target. Full Xcode is not installed in this environment, so the checked-in
files are app source rather than a generated `.xcodeproj`.

The app source currently includes:

- `IOSSpeechOutput`: spoken score announcements via `AVSpeechSynthesizer`.
- `IPhoneCameraFrameSource`: a first `VideoFrameSource` backed by the iPhone
  camera.
- `MetaGlassesFrameSource`: a placeholder showing where Meta DAT should attach.

## Next Meta SDK Step

Once a phone and glasses are ready, add the Meta Wearables Device Access Toolkit
Swift package from:

```text
https://github.com/facebook/meta-wearables-dat-ios
```

Then implement:

```swift
final class MetaGlassesFrameSource: VideoFrameSource
final class MetaGlassesDisplay: ScoreDisplay
```

The core app should keep using the protocols, not direct SDK types.
