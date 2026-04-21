// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ManifestoLog
 * @notice Append-only on-chain reasoning log for the AI agent
 * @dev All manifestos are public and immutable. Agent publishes reasoning before executing trades.
 */
contract ManifestoLog {
    /// @notice The authorized agent address that can publish manifestos
    address public immutable agent;

    /// @notice Counter for total manifestos published
    uint256 public manifestoCount;

    /// @notice Struct representing a single manifesto entry
    struct Manifesto {
        uint256 id;
        string reasoning;      // The agent's reasoning (max 500 chars enforced off-chain)
        uint256 timestamp;
        bytes32 tradeId;       // Associated trade ID (can be 0 for non-trade manifestos)
        bool isPulse;          // True if this is a Narrative Pulse, false for trade reasoning
    }

    /// @notice Mapping from manifesto ID to Manifesto data
    mapping(uint256 => Manifesto) public manifestos;

    /// @notice Emitted when a new manifesto is published
    event ManifestoPublished(
        uint256 indexed id,
        string reasoning,
        uint256 timestamp,
        bytes32 indexed tradeId,
        bool isPulse
    );

    /// @notice Emitted when a loss autopsy is published
    event AutopsyPublished(
        uint256 indexed id,
        bytes32 indexed tradeId,
        string reasoning,
        uint256 timestamp
    );

    error OnlyAgent();

    modifier onlyAgent() {
        if (msg.sender != agent) revert OnlyAgent();
        _;
    }

    /**
     * @notice Constructor sets the agent address
     * @param _agent Address of the AI agent authorized to publish
     */
    constructor(address _agent) {
        require(_agent != address(0), "Agent cannot be zero address");
        agent = _agent;
    }

    /**
     * @notice Publish a manifesto entry
     * @param reasoning The agent's reasoning text
     * @param tradeId Associated trade ID (use bytes32(0) for non-trade entries)
     * @param isPulse True if this is a Narrative Pulse bulletin
     */
    function publishManifesto(
        string calldata reasoning,
        bytes32 tradeId,
        bool isPulse
    ) external onlyAgent {
        require(bytes(reasoning).length > 0, "Reasoning cannot be empty");
        require(bytes(reasoning).length <= 500, "Reasoning too long");

        uint256 id = manifestoCount++;

        manifestos[id] = Manifesto({
            id: id,
            reasoning: reasoning,
            timestamp: block.timestamp,
            tradeId: tradeId,
            isPulse: isPulse
        });

        emit ManifestoPublished(id, reasoning, block.timestamp, tradeId, isPulse);
    }

    /**
     * @notice Publish a loss autopsy (post-mortem for a losing trade)
     * @param tradeId The trade that resulted in a loss
     * @param reasoning Explanation of what went wrong
     */
    function publishAutopsy(
        bytes32 tradeId,
        string calldata reasoning
    ) external onlyAgent {
        require(tradeId != bytes32(0), "Trade ID required for autopsy");
        require(bytes(reasoning).length > 0, "Reasoning cannot be empty");
        require(bytes(reasoning).length <= 500, "Reasoning too long");

        uint256 id = manifestoCount++;

        manifestos[id] = Manifesto({
            id: id,
            reasoning: reasoning,
            timestamp: block.timestamp,
            tradeId: tradeId,
            isPulse: false
        });

        emit AutopsyPublished(id, tradeId, reasoning, block.timestamp);
    }

    /**
     * @notice Get a manifesto by ID
     * @param id The manifesto ID to query
     * @return The Manifesto struct
     */
    function getManifesto(uint256 id) external view returns (Manifesto memory) {
        require(id < manifestoCount, "Manifesto does not exist");
        return manifestos[id];
    }

    /**
     * @notice Get the latest N manifestos
     * @param count Number of recent manifestos to return
     * @return Array of Manifesto structs
     */
    function getRecentManifestos(uint256 count) external view returns (Manifesto[] memory) {
        uint256 total = manifestoCount;
        if (count > total) count = total;

        Manifesto[] memory recent = new Manifesto[](count);
        for (uint256 i = 0; i < count; i++) {
            recent[i] = manifestos[total - 1 - i];
        }

        return recent;
    }
}
