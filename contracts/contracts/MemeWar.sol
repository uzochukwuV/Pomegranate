// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MemeWar
 * @notice Weekly meme contest with token-weighted voting and USDC prizes
 * @dev Users submit memes (IPFS hashes), holders vote, winner gets 1% of weekly profit
 */
contract MemeWar is Ownable, ReentrancyGuard {
    /// @notice AgentMeme token for vote weighting
    IERC20 public immutable agentMeme;

    /// @notice USDC token for prizes
    IERC20 public immutable usdc;

    /// @notice Address of the vault (authorized to settle weeks)
    address public vault;

    /// @notice Current week number
    uint256 public currentWeek;

    /// @notice Meme entry struct
    struct MemeEntry {
        address creator;
        string ipfsHash;
        string caption;
        uint256 votes;
        uint256 weekNumber;
    }

    /// @notice Mapping from week to meme entries
    mapping(uint256 => MemeEntry[]) public weekEntries;

    /// @notice Mapping to track if user voted on a specific meme: week => memeIndex => voter => voted
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public hasVoted;

    /// @notice Mapping to track if week has been settled
    mapping(uint256 => bool) public weekSettled;

    /// @notice Mapping to track week winners
    mapping(uint256 => address) public weekWinner;

    /// @notice Events
    event MemeSubmitted(
        uint256 indexed week,
        uint256 indexed memeIndex,
        address indexed creator,
        string ipfsHash,
        string caption
    );

    event MemeVoted(
        uint256 indexed week,
        uint256 indexed memeIndex,
        address indexed voter,
        uint256 weight
    );

    event MemeWinner(
        uint256 indexed week,
        uint256 indexed memeIndex,
        address indexed winner,
        uint256 prize
    );

    error MustHoldTokens();
    error CaptionTooLong();
    error AlreadyVoted();
    error CannotVoteOwnMeme();
    error WeekAlreadySettled();
    error OnlyVault();
    error InvalidMemeIndex();
    error EmptyIPFSHash();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    /**
     * @notice Constructor
     * @param _agentMeme AgentMeme token address
     * @param _usdc USDC token address
     */
    constructor(
        address _agentMeme,
        address _usdc
    ) Ownable(msg.sender) {
        require(_agentMeme != address(0), "Invalid token address");
        require(_usdc != address(0), "Invalid USDC address");

        agentMeme = IERC20(_agentMeme);
        usdc = IERC20(_usdc);
        currentWeek = 1; // Start at week 1
    }

    /**
     * @notice Set vault address
     * @param _vault Vault contract address
     */
    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "Invalid vault address");
        vault = _vault;
    }

    /**
     * @notice Submit a meme for the current week
     * @param ipfsHash IPFS hash of the meme image
     * @param caption Caption for the meme (max 140 chars)
     */
    function submitMeme(
        string calldata ipfsHash,
        string calldata caption
    ) external nonReentrant {
        if (agentMeme.balanceOf(msg.sender) == 0) revert MustHoldTokens();
        if (bytes(ipfsHash).length == 0) revert EmptyIPFSHash();
        if (bytes(caption).length > 140) revert CaptionTooLong();

        uint256 memeIndex = weekEntries[currentWeek].length;

        weekEntries[currentWeek].push(MemeEntry({
            creator: msg.sender,
            ipfsHash: ipfsHash,
            caption: caption,
            votes: 0,
            weekNumber: currentWeek
        }));

        emit MemeSubmitted(currentWeek, memeIndex, msg.sender, ipfsHash, caption);
    }

    /**
     * @notice Vote on a meme (token-weighted)
     * @param memeIndex Index of the meme in current week's entries
     */
    function vote(uint256 memeIndex) external nonReentrant {
        if (memeIndex >= weekEntries[currentWeek].length) revert InvalidMemeIndex();

        MemeEntry storage meme = weekEntries[currentWeek][memeIndex];

        if (hasVoted[currentWeek][memeIndex][msg.sender]) revert AlreadyVoted();
        if (meme.creator == msg.sender) revert CannotVoteOwnMeme();

        uint256 weight = agentMeme.balanceOf(msg.sender);
        if (weight == 0) revert MustHoldTokens();

        meme.votes += weight;
        hasVoted[currentWeek][memeIndex][msg.sender] = true;

        emit MemeVoted(currentWeek, memeIndex, msg.sender, weight);
    }

    /**
     * @notice Settle the current week and distribute prize
     * @param prizeUsdc USDC prize amount (1% of weekly profit)
     */
    function settleWeek(uint256 prizeUsdc) external onlyVault nonReentrant {
        if (weekSettled[currentWeek]) revert WeekAlreadySettled();

        MemeEntry[] storage entries = weekEntries[currentWeek];

        // Find winner (highest votes)
        uint256 winnerIndex = 0;
        uint256 highestVotes = 0;

        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].votes > highestVotes) {
                highestVotes = entries[i].votes;
                winnerIndex = i;
            }
        }

        // Mark week as settled
        weekSettled[currentWeek] = true;

        // Transfer prize if there were submissions
        if (entries.length > 0 && prizeUsdc > 0) {
            address winner = entries[winnerIndex].creator;
            weekWinner[currentWeek] = winner;

            require(
                usdc.transferFrom(msg.sender, winner, prizeUsdc),
                "Prize transfer failed"
            );

            emit MemeWinner(currentWeek, winnerIndex, winner, prizeUsdc);
        }

        // Move to next week
        currentWeek++;
    }

    /**
     * @notice Get all memes for a specific week
     * @param week Week number
     * @return Array of meme entries
     */
    function getWeekMemes(uint256 week) external view returns (MemeEntry[] memory) {
        return weekEntries[week];
    }

    /**
     * @notice Get meme count for current week
     * @return Number of memes submitted this week
     */
    function getCurrentWeekMemeCount() external view returns (uint256) {
        return weekEntries[currentWeek].length;
    }

    /**
     * @notice Get current week's leaderboard (top N memes by votes)
     * @param topN Number of top memes to return
     * @return Array of meme entries sorted by votes
     */
    function getLeaderboard(uint256 topN) external view returns (MemeEntry[] memory) {
        MemeEntry[] storage allMemes = weekEntries[currentWeek];
        uint256 count = allMemes.length;

        if (topN > count) topN = count;

        // Create a copy and sort (simple bubble sort for hackathon demo)
        MemeEntry[] memory sorted = new MemeEntry[](count);
        for (uint256 i = 0; i < count; i++) {
            sorted[i] = allMemes[i];
        }

        // Bubble sort by votes (descending)
        for (uint256 i = 0; i < count; i++) {
            for (uint256 j = i + 1; j < count; j++) {
                if (sorted[j].votes > sorted[i].votes) {
                    MemeEntry memory temp = sorted[i];
                    sorted[i] = sorted[j];
                    sorted[j] = temp;
                }
            }
        }

        // Return top N
        MemeEntry[] memory result = new MemeEntry[](topN);
        for (uint256 i = 0; i < topN; i++) {
            result[i] = sorted[i];
        }

        return result;
    }

    /**
     * @notice Check if user has voted on a specific meme
     * @param week Week number
     * @param memeIndex Meme index
     * @param voter Voter address
     * @return True if user has voted
     */
    function hasUserVoted(
        uint256 week,
        uint256 memeIndex,
        address voter
    ) external view returns (bool) {
        return hasVoted[week][memeIndex][voter];
    }
}
