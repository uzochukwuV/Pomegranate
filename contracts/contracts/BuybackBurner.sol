// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAgentMemeToken {
    function burn(uint256 amount) external;
}

interface IPancakeV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

/**
 * @title BuybackBurner
 * @notice Swaps USDC for AgentMeme tokens via PancakeSwap V3 and burns them
 * @dev Called by AgentVault during epoch settlement to reduce token supply
 */
contract BuybackBurner is Ownable, ReentrancyGuard {
    /// @notice PancakeSwap V3 Router address (BSC mainnet: 0x1b81D678ffb9C0263b24A97847620C99d213eB14)
    IPancakeV3Router public immutable pancakeRouter;

    /// @notice USDC token address
    IERC20 public immutable usdc;

    /// @notice AgentMeme token address
    IAgentMemeToken public immutable agentMemeToken;

    /// @notice Pool fee tier (3000 = 0.3%, 500 = 0.05%, 10000 = 1%)
    uint24 public poolFee = 3000; // Default: 0.3% fee tier

    /// @notice Authorized vault that can trigger buybacks
    address public vault;

    /// @notice Total USDC spent on buybacks
    uint256 public totalUsdcSpent;

    /// @notice Total AgentMeme tokens burned
    uint256 public totalTokensBurned;

    event BuybackExecuted(
        uint256 usdcAmount,
        uint256 tokensBought,
        uint256 tokensBurned,
        uint256 timestamp
    );
    event VaultUpdated(address indexed oldVault, address indexed newVault);
    event PoolFeeUpdated(uint24 oldFee, uint24 newFee);

    error OnlyVault();
    error InsufficientOutput();
    error DeadlineExpired();
    error ZeroAmount();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    /**
     * @notice Constructor
     * @param _pancakeRouter PancakeSwap V3 Router address
     * @param _usdc USDC token address
     * @param _agentMemeToken AgentMeme token address
     * @param _vault AgentVault address
     */
    constructor(
        address _pancakeRouter,
        address _usdc,
        address _agentMemeToken,
        address _vault
    ) Ownable(msg.sender) {
        require(_pancakeRouter != address(0), "Invalid router");
        require(_usdc != address(0), "Invalid USDC");
        require(_agentMemeToken != address(0), "Invalid token");
        require(_vault != address(0), "Invalid vault");

        pancakeRouter = IPancakeV3Router(_pancakeRouter);
        usdc = IERC20(_usdc);
        agentMemeToken = IAgentMemeToken(_agentMemeToken);
        vault = _vault;
    }

    /**
     * @notice Execute buyback and burn
     * @param usdcAmount Amount of USDC to spend
     * @param minTokensOut Minimum AgentMeme tokens to receive (slippage protection)
     * @param deadline Transaction deadline timestamp
     * @return tokensBurned Amount of tokens burned
     */
    function executeBuyback(
        uint256 usdcAmount,
        uint256 minTokensOut,
        uint256 deadline
    ) external onlyVault nonReentrant returns (uint256 tokensBurned) {
        if (usdcAmount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert DeadlineExpired();

        // Transfer USDC from vault to this contract
        require(
            usdc.transferFrom(msg.sender, address(this), usdcAmount),
            "USDC transfer failed"
        );

        // Approve PancakeSwap router to spend USDC
        usdc.approve(address(pancakeRouter), usdcAmount);

        // Execute swap: USDC → AgentMeme
        IPancakeV3Router.ExactInputSingleParams memory params = IPancakeV3Router
            .ExactInputSingleParams({
                tokenIn: address(usdc),
                tokenOut: address(agentMemeToken),
                fee: poolFee,
                recipient: address(this),
                amountIn: usdcAmount,
                amountOutMinimum: minTokensOut,
                sqrtPriceLimitX96: 0 // No price limit
            });

        uint256 tokensBought = pancakeRouter.exactInputSingle(params);

        if (tokensBought < minTokensOut) revert InsufficientOutput();

        // Burn all received tokens
        agentMemeToken.burn(tokensBought);

        // Update stats
        totalUsdcSpent += usdcAmount;
        totalTokensBurned += tokensBought;

        emit BuybackExecuted(usdcAmount, tokensBought, tokensBought, block.timestamp);

        return tokensBought;
    }

    /**
     * @notice Set vault address
     * @param _vault New vault address
     */
    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "Invalid vault");
        emit VaultUpdated(vault, _vault);
        vault = _vault;
    }

    /**
     * @notice Set PancakeSwap pool fee tier
     * @param _poolFee New fee tier (500, 3000, or 10000)
     */
    function setPoolFee(uint24 _poolFee) external onlyOwner {
        require(
            _poolFee == 500 || _poolFee == 3000 || _poolFee == 10000,
            "Invalid fee tier"
        );
        emit PoolFeeUpdated(poolFee, _poolFee);
        poolFee = _poolFee;
    }

    /**
     * @notice Emergency token recovery (owner only)
     * @param token Token address to recover
     * @param amount Amount to recover
     */
    function recoverTokens(address token, uint256 amount) external onlyOwner {
        require(token != address(0), "Invalid token");
        IERC20(token).transfer(owner(), amount);
    }

    /**
     * @notice Get buyback stats
     * @return _totalUsdcSpent Total USDC spent on buybacks
     * @return _totalTokensBurned Total AgentMeme tokens burned
     * @return _burnRate Tokens burned per USDC spent (scaled by 1e18)
     */
    function getStats()
        external
        view
        returns (
            uint256 _totalUsdcSpent,
            uint256 _totalTokensBurned,
            uint256 _burnRate
        )
    {
        _totalUsdcSpent = totalUsdcSpent;
        _totalTokensBurned = totalTokensBurned;
        _burnRate = totalUsdcSpent > 0
            ? (totalTokensBurned * 1e18) / totalUsdcSpent
            : 0;
    }
}
