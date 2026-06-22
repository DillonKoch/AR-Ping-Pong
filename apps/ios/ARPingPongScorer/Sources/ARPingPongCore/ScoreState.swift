import Foundation

public enum PlayerSide: String, Codable, CaseIterable, Equatable {
    case near
    case far

    public var displayName: String {
        switch self {
        case .near: "Near"
        case .far: "Far"
        }
    }
}

public struct ScoreState: Codable, Equatable {
    public var near: Int
    public var far: Int
    public var serving: PlayerSide
    public var gamePointTarget: Int
    public var winBy: Int

    public init(
        near: Int = 0,
        far: Int = 0,
        serving: PlayerSide = .near,
        gamePointTarget: Int = 11,
        winBy: Int = 2
    ) {
        self.near = near
        self.far = far
        self.serving = serving
        self.gamePointTarget = gamePointTarget
        self.winBy = winBy
    }

    public var winner: PlayerSide? {
        if near >= gamePointTarget && near - far >= winBy { return .near }
        if far >= gamePointTarget && far - near >= winBy { return .far }
        return nil
    }

    public var announcement: String {
        if let winner {
            return "\(winner.displayName) wins, \(near) \(far)"
        }
        return "\(near) \(far), \(serving.displayName) serve"
    }
}
