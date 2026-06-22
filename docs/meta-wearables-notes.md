# Meta Wearables Notes

## June 2026 Finding

Meta's May 14, 2026 developer blog says the Meta Wearables Device Access
Toolkit supports native iOS and Android integrations for Meta AI glasses. The
blog is centered on Meta Ray-Ban Display, but it also states the toolkit has
camera, audio, and display capabilities.

The official iOS and Android GitHub READMEs say the Device Access Toolkit lets
mobile apps connect to Meta AI glasses and use capabilities like video streaming
and photo capture.

References:

- https://developers.meta.com/blog/build-for-display-glasses/
- https://github.com/facebook/meta-wearables-dat-ios
- https://github.com/facebook/meta-wearables-dat-android
- https://github.com/facebookincubator/meta-wearables-webapp

## Product Direction

Build the iPhone app around capability abstractions so it works before Meta SDK
integration and can adopt Meta glasses later:

- `VideoFrameSource`: iPhone camera first, Meta glasses camera later.
- `SpeechOutput`: iOS text-to-speech over Bluetooth first, Meta audio path later
  if useful.
- `ScoreDisplay`: iPhone UI first, Meta Ray-Ban Display overlay later.
- `GameEventInput`: touch controls first, gestures/neural band later.

This keeps the scorekeeping, detection, and referee logic independent from the
hardware source.

## Open Questions

- Which exact non-display glasses models are supported by DAT camera streaming?
- What frame rates and resolutions are available from the glasses stream?
- Can DAT audio route app-generated speech to glasses, or should we rely on
  normal iOS Bluetooth audio routing?
- What release-channel/device registration steps are required for testing?
