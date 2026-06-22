import AVFoundation
import CoreMedia
import CoreVideo
import ARPingPongCore

final class IPhoneCameraFrameSource: NSObject, VideoFrameSource {
    var onFrame: ((CVPixelBuffer, CMTime) -> Void)?

    private let session = AVCaptureSession()
    private let output = AVCaptureVideoDataOutput()
    private let queue = DispatchQueue(label: "ar-ping-pong.camera")

    func start() throws {
        session.beginConfiguration()
        session.sessionPreset = .hd1280x720

        guard
            let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
            let input = try? AVCaptureDeviceInput(device: camera),
            session.canAddInput(input)
        else {
            session.commitConfiguration()
            throw CameraFrameSourceError.cameraUnavailable
        }

        session.addInput(input)
        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        ]
        output.setSampleBufferDelegate(self, queue: queue)

        guard session.canAddOutput(output) else {
            session.commitConfiguration()
            throw CameraFrameSourceError.outputUnavailable
        }

        session.addOutput(output)
        session.commitConfiguration()
        session.startRunning()
    }

    func stop() {
        session.stopRunning()
    }
}

extension IPhoneCameraFrameSource: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        onFrame?(pixelBuffer, CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
    }
}

enum CameraFrameSourceError: Error {
    case cameraUnavailable
    case outputUnavailable
}
