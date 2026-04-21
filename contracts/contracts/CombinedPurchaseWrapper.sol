// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CombinedPurchaseWrapper
 * @notice One-click purchase: splits USDC between token purchase and vault deposit
 * @dev Simplifies UX by combining two actions into one transaction
 */
interface ITokenManager2 {
    function buyTokenAMAP(
        address token,
        address to,
        uint256 funds,
        uint256 minAmount
    ) external;
}

interface IAgentVault {
    function deposit(uint256 assets, address receiver) external returns (uint256);
}

contract CombinedPurchaseWrapper is Ownable, ReentrancyGuard {
    /// @notice Four.meme TokenManager2
    ITokenManager2 public immutable tokenManager;

    /// @notice AgentVault for USDC deposits
    IAgentVault public immutable vault;

    /// @notice AgentMeme token address (on Four.meme)
    address public immutable agentMemeToken;

    /// @notice USDC token
    IERC20 public immutable usdc;

    /// @notice Default split: 20% to tokens, 80% to vault (in basis points)
    uint256 public defaultTokenPercentBps = 2000; // 20%

    /// @notice Emitted when user makes a combined purchase
    event CombinedPurchase(
        address indexed user,
        uint256 totalUsdc,
        uint256 tokenPurchaseAmount,
        uint256 vaultDepositAmount,
        uint256 tokensReceived,
        uint256 vaultSharesReceived,
        string message
    );

    error InvalidSplit();
    error InsufficientAmount();

    /**
     * @notice Constructor
     * @param _tokenManager Four.meme TokenManager2 address
     * @param _vault AgentVault address
     * @param _agentMemeToken AgentMeme token address
     * @param _usdc USDC token address
     */
    constructor(
        address _tokenManager,
        address _vault,
        address _agentMemeToken,
        address _usdc
    ) Ownable(msg.sender) {
        require(_tokenManager != address(0), "Invalid TokenManager");
        require(_vault != address(0), "Invalid vault");
        require(_agentMemeToken != address(0), "Invalid token");
        require(_usdc != address(0), "Invalid USDC");

        tokenManager = ITokenManager2(_tokenManager);
        vault = IAgentVault(_vault);
        agentMemeToken = _agentMemeToken;
        usdc = IERC20(_usdc);
    }

    /**
     * @notice Update default split percentage
     * @param tokenPercentBps Percentage to token purchase (in basis points, e.g., 2000 = 20%)
     */
    function setDefaultSplit(uint256 tokenPercentBps) external onlyOwner {
        if (tokenPercentBps > 10000) revert InvalidSplit();
        defaultTokenPercentBps = tokenPercentBps;
    }

    /**
     * @notice Combined purchase with default split (20/80)
     * @param totalUsdc Total USDC to invest
     * @param minTokens Minimum tokens to receive (slippage protection)
     * @param message Optional directional message (max 280 chars)
     */
    function investWithDefaultSplit(
        uint256 totalUsdc,
        uint256 minTokens,
        string calldata message
    ) external nonReentrant {
        _investWithSplit(totalUsdc, defaultTokenPercentBps, minTokens, message);
    }

    /**
     * @notice Combined purchase with custom split
     * @param totalUsdc Total USDC to invest
     * @param tokenPercentBps Percentage to tokens (e.g., 3000 = 30%)
     * @param minTokens Minimum tokens to receive
     * @param message Optional directional message (max 280 chars)
     */
    function investWithCustomSplit(
        uint256 totalUsdc,
        uint256 tokenPercentBps,
        uint256 minTokens,
        string calldata message
    ) external nonReentrant {
        if (tokenPercentBps > 10000) revert InvalidSplit();
        _investWithSplit(totalUsdc, tokenPercentBps, minTokens, message);
    }

    /**
     * @notice Internal function to handle split purchase
     */
    function _investWithSplit(
        uint256 totalUsdc,
        uint256 tokenPercentBps,
        uint256 minTokens,
        string calldata message
    ) internal {
        if (totalUsdc < 1e6) revert InsufficientAmount(); // Min $1 USDC
        if (bytes(message).length > 280) revert("Message too long");

        // Transfer USDC from user
        require(
            usdc.transferFrom(msg.sender, address(this), totalUsdc),
            "USDC transfer failed"
        );

        // Calculate split
        uint256 tokenPurchaseAmount = (totalUsdc * tokenPercentBps) / 10000;
        uint256 vaultDepositAmount = totalUsdc - tokenPurchaseAmount;

        // Track user's token balance before purchase
        uint256 tokenBalanceBefore = IERC20(agentMemeToken).balanceOf(msg.sender);

        // 1. Buy tokens on Four.meme
        if (tokenPurchaseAmount > 0) {
            usdc.approve(address(tokenManager), tokenPurchaseAmount);
            tokenManager.buyTokenAMAP(
                agentMemeToken,
                msg.sender, // Tokens go directly to user
                tokenPurchaseAmount,
                minTokens
            );
        }

        // Calculate tokens received
        uint256 tokenBalanceAfter = IERC20(agentMemeToken).balanceOf(msg.sender);
        uint256 tokensReceived = tokenBalanceAfter - tokenBalanceBefore;

        // 2. Deposit to vault
        uint256 vaultShares = 0;
        if (vaultDepositAmount > 0) {
            usdc.approve(address(vault), vaultDepositAmount);
            vaultShares = vault.deposit(vaultDepositAmount, msg.sender);
        }

        emit CombinedPurchase(
            msg.sender,
            totalUsdc,
            tokenPurchaseAmount,
            vaultDepositAmount,
            tokensReceived,
            vaultShares,
            message
        );
    }

    /**
     * @notice Emergency function to recover accidentally sent tokens
     * @param token Token address to recover
     * @param amount Amount to recover
     */
    function recoverToken(address token, uint256 amount) external onlyOwner {
        require(token != address(usdc), "Cannot recover USDC");
        require(IERC20(token).transfer(owner(), amount), "Recovery failed");
    }
}
