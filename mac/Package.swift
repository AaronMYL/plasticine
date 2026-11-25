import PackageDescription

let package = Package(
    name: "Plasticine",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "plasticine-helper", targets: ["PlasticineHelper"])
    ],
    targets: [
        .target(name: "PlasticineDevice"),
        .executableTarget(name: "PlasticineHelper", dependencies: ["PlasticineDevice"]),
        .testTarget(name: "PlasticineDeviceTests", dependencies: ["PlasticineDevice"])
    ],
    swiftLanguageVersions: [.v5]
)
