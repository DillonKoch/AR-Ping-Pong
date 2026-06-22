// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "ARPingPongScorer",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "ARPingPongCore", targets: ["ARPingPongCore"]),
    ],
    targets: [
        .target(name: "ARPingPongCore"),
        .testTarget(
            name: "ARPingPongCoreTests",
            dependencies: ["ARPingPongCore"]
        ),
    ]
)
