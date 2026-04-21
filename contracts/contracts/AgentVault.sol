// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAgentMemeToken {
    function getConvictionMultiplier(address holder) external view returns (uint256);
    function getEffectiveTipWeight(address holder, uint256 stakeAmount) external view returns (uint256);
    function stakeTipTokens(address holder, uint256 amount) external;
    function unstakeTipTokens(address holder, uint256 amount, bool slash) external;
    function mint(address to, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

interface IBuybackBurner {
    function executeBuyback(uint256 usdcAmount, uint256 minTokensOut, uint256 deadline) external;
}

/**
 * @title AgentVault
 * @notice ERC4626 vault with epoch-based trading, participatory oracle, and social intelligence layers
 * @dev Core vault managing USDC deposits and AI-driven trading with MYX Finance
 */
contract AgentVault is ERC4626, Ownable, ReentrancyGuard {
    /// @notice The AgentMeme token (for conviction tracking and bonuses)
    IAgentMemeToken public immutable agentMemeToken;

    /// @notice BuybackBurner contract for token burns
    IBuybackBurner public buybackBurner;

    /// @notice Authorized agent address that can execute trades
    address public agent;

    /// @notice Current epoch number
    uint256 public epochNumber;

    /// @notice Whether the current epoch is active
    bool public epochActive;

    /// @notice Epoch start timestamp
    uint256 public epochStartTime;

    /// @notice Epoch duration in seconds (default: 7 days)
    uint256 public epochDuration = 7 days;

    /// @notice Total capital deployed in active trades
    uint256 public deployedCapital;

    /// @notice Exit fee in basis points (default: 100 = 1%)
    uint256 public exitFeeBps = 100;

    /// @notice Minimum tip submission requirement (tokens)
    uint256 public constant MIN_TIP_TOKENS = 1_000e18;

    /// @notice Minimum pair proposal requirement (tokens)
    uint256 public constant MIN_PROPOSAL_TOKENS = 10_000e18;

    /// @notice Tip struct
    struct Tip {
        address tipper;
        string content;
        uint256 weight;        // tipper's effective weight (balance * multiplier * stake bonus)
        uint256 rawBalance;    // tipper's raw token balance at submission
        uint256 stakeAmount;   // additional tokens staked with this tip
        uint256 epoch;
        bool attributed;
        bytes32 tradeId;
        bool isContrarian;
    }

    /// @notice Withdrawal request struct
    struct WithdrawalRequest {
        address user;
        uint256 shares;
        uint256 requestTime;
        bool processed;
    }

    /// @notice Mapping from epoch to tips array
    mapping(uint256 => Tip[]) public epochTips;

    /// @notice Mapping from tradeId to winning tipper address
    mapping(bytes32 => address) public tradeAttribution;

    /// @notice Mapping from tradeId to profit/loss
    mapping(bytes32 => int256) public tradePnL;

    /// @notice Pair whitelist (pairIndex => approved)
    mapping(uint256 => bool) public pairWhitelist;

    /// @notice Withdrawal queue
    WithdrawalRequest[] public withdrawalQueue;

    /// @notice Mapping of user to their withdrawal request index
    mapping(address => uint256) public userWithdrawalIndex;

    /// @notice Total epoch profit for current epoch
    int256 public epochProfit;

    /// @notice Events
    event EpochStarted(uint256 indexed epochNumber, uint256 startTime);
    event EpochSettled(uint256 indexed epochNumber, int256 profit, uint256 settleTime);
    event TipSubmitted(address indexed tipper, string content, uint256 weight, uint256 epoch);
    event TradeAttributed(bytes32 indexed tradeId, address indexed tipper, uint256 tipIndex);
    event ContrarianFlagged(uint256 indexed epoch, uint256 tipIndex, address indexed tipper);
    event TipBonusesDistributed(uint256 indexed epoch, uint256 bonusPool);
    event PairProposed(uint256 indexed pairIndex, address indexed proposer, string rationale, uint256 timestamp);
    event PairApproved(uint256 indexed pairIndex, uint256 timestamp);
    event CapitalDeployed(uint256 amount, uint256 timestamp);
    event CapitalReturned(uint256 amount, int256 pnl, uint256 timestamp);
    event WithdrawalRequested(address indexed user, uint256 shares, uint256 timestamp);
    event WithdrawalProcessed(address indexed user, uint256 shares, uint256 assets, uint256 timestamp);

    error OnlyAgent();
    error EpochNotActive();
    error EpochStillActive();
    error InsufficientTokens();
    error TipTooLong();
    error TradeAlreadyAttributed();
    error InsufficientDeployableCapital();

    modifier onlyAgent() {
        if (msg.sender != agent) revert OnlyAgent();
        _;
    }

    /**
     * @notice Constructor
     * @param _asset USDC token address
     * @param _agentMemeToken AgentMeme token address
     * @param _agent AI agent address
     */
    constructor(
        IERC20 _asset,
        address _agentMemeToken,
        address _agent
    ) ERC4626(_asset) ERC20("AgentMeme Vault", "amVault") Ownable(msg.sender) {
        require(_agentMemeToken != address(0), "Invalid token address");
        require(_agent != address(0), "Invalid agent address");

        agentMemeToken = IAgentMemeToken(_agentMemeToken);
        agent = _agent;

        // Initialize safe pairs (BTC, ETH, BNB)
        pairWhitelist[0] = true; // BTC-USDC
        pairWhitelist[1] = true; // ETH-USDC
        pairWhitelist[2] = true; // BNB-USDC
    }

    /**
     * @notice Set buyback burner contract
     * @param _buybackBurner BuybackBurner contract address
     */
    function setBuybackBurner(address _buybackBurner) external onlyOwner {
        require(_buybackBurner != address(0), "Invalid address");
        buybackBurner = IBuybackBurner(_buybackBurner);
    }

    /**
     * @notice Set agent address
     * @param _agent New agent address
     */
    function setAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "Invalid address");
        agent = _agent;
    }

    /**
     * @notice Start a new epoch
     */
    function startEpoch() external onlyAgent {
        require(!epochActive, "Epoch already active");

        epochNumber++;
        epochActive = true;
        epochStartTime = block.timestamp;
        epochProfit = 0;

        emit EpochStarted(epochNumber, block.timestamp);
    }

    /**
     * @notice Submit a trading tip with optional stake
     * @param content Tip content (max 500 chars)
     * @param stakeAmount Additional tokens to stake (0 = no stake, increases tip weight)
     */
    function submitTip(string calldata content, uint256 stakeAmount) external nonReentrant {
        if (!epochActive) revert EpochNotActive();

        uint256 balance = agentMemeToken.balanceOf(msg.sender);
        if (balance < MIN_TIP_TOKENS) revert InsufficientTokens();
        if (bytes(content).length > 500) revert TipTooLong();

        // If staking, transfer tokens to this contract via AgentMemeToken
        if (stakeAmount > 0) {
            agentMemeToken.stakeTipTokens(msg.sender, stakeAmount);
        }

        // Get effective weight (includes conviction + stake bonus)
        uint256 effectiveWeight = agentMemeToken.getEffectiveTipWeight(msg.sender, stakeAmount);

        epochTips[epochNumber].push(Tip({
            tipper: msg.sender,
            content: content,
            weight: effectiveWeight,
            rawBalance: balance,
            stakeAmount: stakeAmount,
            epoch: epochNumber,
            attributed: false,
            tradeId: bytes32(0),
            isContrarian: false
        }));

        emit TipSubmitted(msg.sender, content, effectiveWeight, epochNumber);
    }

    /**
     * @notice Attribute a trade to a specific tip (called by agent before trade execution)
     * @param tradeId Unique trade identifier
     * @param tipper Address of the tipper
     * @param tipIndex Index in the epoch tips array
     */
    function attributeTrade(
        bytes32 tradeId,
        address tipper,
        uint256 tipIndex
    ) external onlyAgent {
        if (tradeAttribution[tradeId] != address(0)) revert TradeAlreadyAttributed();

        tradeAttribution[tradeId] = tipper;
        epochTips[epochNumber][tipIndex].attributed = true;
        epochTips[epochNumber][tipIndex].tradeId = tradeId;

        emit TradeAttributed(tradeId, tipper, tipIndex);
    }

    /**
     * @notice Flag a tip as contrarian
     * @param tipIndex Index in the epoch tips array
     */
    function flagContrarian(uint256 tipIndex) external onlyAgent {
        require(tipIndex < epochTips[epochNumber].length, "Invalid tip index");

        epochTips[epochNumber][tipIndex].isContrarian = true;

        emit ContrarianFlagged(
            epochNumber,
            tipIndex,
            epochTips[epochNumber][tipIndex].tipper
        );
    }

    /**
     * @notice Propose a new trading pair
     * @param pairIndex MYX pair index
     * @param rationale Reason for proposal
     */
    function proposePair(uint256 pairIndex, string calldata rationale) external {
        uint256 balance = agentMemeToken.balanceOf(msg.sender);
        if (balance < MIN_PROPOSAL_TOKENS) revert InsufficientTokens();

        emit PairProposed(pairIndex, msg.sender, rationale, block.timestamp);
    }

    /**
     * @notice Approve a proposed pair (simplified for hackathon - admin approval)
     * @param pairIndex MYX pair index
     */
    function approvePair(uint256 pairIndex) external onlyOwner {
        pairWhitelist[pairIndex] = true;
        emit PairApproved(pairIndex, block.timestamp);
    }

    /**
     * @notice Withdraw USDC from vault for trading (agent only)
     * @param amount Amount of USDC to withdraw
     * @return success True if withdrawal succeeded
     */
    function withdrawForTrading(uint256 amount) external onlyAgent nonReentrant returns (bool success) {
        require(amount <= getDeployableCapital(), "Insufficient deployable capital");
        require(epochActive, "Epoch not active");

        // Update tracking
        deployedCapital += amount;

        // Transfer USDC to agent
        success = IERC20(asset()).transfer(agent, amount);
        require(success, "USDC transfer failed");

        emit CapitalDeployed(amount, block.timestamp);
    }

    /**
     * @notice Return USDC to vault after trading (agent only)
     * @param amount Amount of USDC to return
     * @param pnl Profit or loss from trades
     * @return success True if return succeeded
     */
    function returnFromTrading(uint256 amount, int256 pnl) external onlyAgent nonReentrant returns (bool success) {
        // Transfer USDC from agent back to vault
        success = IERC20(asset()).transferFrom(agent, address(this), amount);
        require(success, "USDC transfer failed");

        // Update tracking
        if (amount <= deployedCapital) {
            deployedCapital -= amount;
        } else {
            deployedCapital = 0; // Safety check
        }

        epochProfit += pnl;

        emit CapitalReturned(amount, pnl, block.timestamp);
    }

    /**
     * @notice Update deployed capital (legacy - kept for compatibility)
     * @param amount Amount of capital deployed/returned
     * @param isDeployment True if deploying, false if returning
     * @param pnl Profit/loss if returning capital
     */
    function updateDeployedCapital(
        uint256 amount,
        bool isDeployment,
        int256 pnl
    ) external onlyAgent {
        if (isDeployment) {
            require(amount <= getDeployableCapital(), "Insufficient deployable capital");
            deployedCapital += amount;
            emit CapitalDeployed(amount, block.timestamp);
        } else {
            deployedCapital -= amount;
            epochProfit += pnl;
            emit CapitalReturned(amount, pnl, block.timestamp);
        }
    }

    /**
     * @notice Record trade P&L
     * @param tradeId Trade identifier
     * @param pnl Profit or loss
     */
    function recordTradePnL(bytes32 tradeId, int256 pnl) external onlyAgent {
        tradePnL[tradeId] = pnl;
    }

    /**
     * @notice Get deployable capital (total assets - deployed capital)
     */
    function getDeployableCapital() public view returns (uint256) {
        uint256 total = totalAssets();
        if (deployedCapital >= total) return 0;
        return total - deployedCapital;
    }

    /**
     * @notice Settle the current epoch
     */
    function settleEpoch() external onlyAgent nonReentrant {
        if (!epochActive) revert EpochNotActive();
        require(deployedCapital == 0, "Cannot settle with open positions");

        epochActive = false;

        // If profitable epoch, distribute rewards
        if (epochProfit > 0) {
            uint256 profit = uint256(epochProfit);

            // 85% stays in vault
            // 15% split: 12% buyback & burn, 3% tip bonuses

            uint256 buybackAmount = (profit * 1200) / 10000; // 12%
            uint256 tipBonusAmount = (profit * 300) / 10000; // 3%

            // Execute buyback and burn
            if (address(buybackBurner) != address(0) && buybackAmount > 0) {
                IERC20(asset()).approve(address(buybackBurner), buybackAmount);
                // Note: In production, calculate minTokensOut from price oracle
                // For hackathon, this would be set by the agent
            }

            // Distribute tip bonuses
            if (tipBonusAmount > 0) {
                _distributeTipBonuses(tipBonusAmount);
            }
        }

        emit EpochSettled(epochNumber, epochProfit, block.timestamp);
    }

    /**
     * @notice Distribute tip bonuses to attributed tippers (internal)
     * @param bonusPool Total USDC available for bonuses
     */
    function _distributeTipBonuses(uint256 bonusPool) internal {
        Tip[] storage tips = epochTips[epochNumber];

        // Calculate total weight of attributed tips from profitable trades
        uint256 totalAttributedWeight = 0;
        for (uint256 i = 0; i < tips.length; i++) {
            if (tips[i].attributed) {
                bytes32 tradeId = tips[i].tradeId;
                // Only reward if trade was profitable
                if (tradePnL[tradeId] > 0) {
                    uint256 weight = tips[i].weight;
                    // Double weight for contrarian tips
                    if (tips[i].isContrarian) {
                        weight *= 2;
                    }
                    totalAttributedWeight += weight;
                }
            }
        }

        // Process all attributed tips (unstake and distribute bonuses)
        for (uint256 i = 0; i < tips.length; i++) {
            Tip storage tip = tips[i];

            if (tip.attributed && tip.stakeAmount > 0) {
                bytes32 tradeId = tip.tradeId;
                bool tradeProfitable = tradePnL[tradeId] > 0;

                if (tradeProfitable) {
                    // Return full stake (no slash)
                    agentMemeToken.unstakeTipTokens(tip.tipper, tip.stakeAmount, false);

                    // Calculate and mint bonus tokens
                    if (totalAttributedWeight > 0) {
                        uint256 weight = tip.weight;
                        if (tip.isContrarian) weight *= 2;

                        // Convert USDC bonus to AgentMeme tokens (simplified: 1:1 for demo)
                        uint256 tokenBonus = (bonusPool * weight) / totalAttributedWeight;
                        if (tokenBonus > 0) {
                            agentMemeToken.mint(tip.tipper, tokenBonus);
                        }
                    }
                } else {
                    // Trade was unprofitable - slash 20% of stake
                    agentMemeToken.unstakeTipTokens(tip.tipper, tip.stakeAmount, true);
                }
            }
        }

        emit TipBonusesDistributed(epochNumber, bonusPool);
    }

    /**
     * @notice Request withdrawal (queued for next epoch settlement)
     * @param shares Amount of vault shares to withdraw
     */
    function requestWithdrawal(uint256 shares) external nonReentrant {
        require(shares > 0, "Shares must be > 0");
        require(balanceOf(msg.sender) >= shares, "Insufficient shares");

        // Transfer shares to vault for escrow
        _transfer(msg.sender, address(this), shares);

        withdrawalQueue.push(WithdrawalRequest({
            user: msg.sender,
            shares: shares,
            requestTime: block.timestamp,
            processed: false
        }));

        userWithdrawalIndex[msg.sender] = withdrawalQueue.length - 1;

        emit WithdrawalRequested(msg.sender, shares, block.timestamp);
    }

    /**
     * @notice Process withdrawal queue (called by agent after epoch settlement)
     * @param maxProcessed Maximum number of withdrawals to process
     */
    function processWithdrawals(uint256 maxProcessed) external onlyAgent nonReentrant {
        uint256 processed = 0;

        for (uint256 i = 0; i < withdrawalQueue.length && processed < maxProcessed; i++) {
            WithdrawalRequest storage request = withdrawalQueue[i];

            if (!request.processed) {
                uint256 assets = convertToAssets(request.shares);

                // Apply exit fee
                uint256 fee = (assets * exitFeeBps) / 10000;
                uint256 netAssets = assets - fee;

                // Burn the shares
                _burn(address(this), request.shares);

                // Transfer assets to user
                IERC20(asset()).transfer(request.user, netAssets);

                request.processed = true;
                processed++;

                emit WithdrawalProcessed(request.user, request.shares, netAssets, block.timestamp);
            }
        }
    }

    /**
     * @notice Get all tips for a specific epoch
     * @param epoch Epoch number
     * @return Array of tips
     */
    function getEpochTips(uint256 epoch) external view returns (Tip[] memory) {
        return epochTips[epoch];
    }

    /**
     * @notice Get whitelisted pairs (returns first 100)
     * @return Array of whitelisted pair indices
     */
    function getWhitelistedPairs() external view returns (uint256[] memory) {
        uint256[] memory pairs = new uint256[](100);
        uint256 count = 0;

        for (uint256 i = 0; i < 100; i++) {
            if (pairWhitelist[i]) {
                pairs[count] = i;
                count++;
            }
        }

        // Resize array to actual count
        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = pairs[i];
        }

        return result;
    }

    /**
     * @notice Emergency pause (admin only)
     */
    function pause() external onlyOwner {
        epochActive = false;
    }
}
