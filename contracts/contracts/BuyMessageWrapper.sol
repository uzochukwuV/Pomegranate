// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title BuyMessageWrapper
 * @notice Wrapper over Four.meme's TokenManager2 to enable Buy-as-Vote mechanism
 * @dev Users buy tokens through this wrapper and attach directional messages
 */
interface ITokenManager2 {
    function buyTokenAMAP(
        address token,
        address to,
        uint256 funds,
        uint256 minAmount
    ) external;
}

contract BuyMessageWrapper {
    /// @notice Four.meme TokenManager2 contract
    ITokenManager2 public immutable tokenManager;

    /// @notice AgentMeme token address
    address public immutable agentMemeToken;

    /// @notice USDC token address
    IERC20 public immutable usdc;

    /// @notice Emitted when someone buys tokens with a message
    event BuyWithMessage(
        address indexed buyer,
        uint256 usdcAmount,
        string message,
        uint256 timestamp
    );

    error MessageTooLong();

    /**
     * @notice Constructor
     * @param _tokenManager TokenManager2 address
     * @param _token AgentMeme token address
     * @param _usdc USDC token address
     */
    constructor(
        address _tokenManager,
        address _token,
        address _usdc
    ) {
        require(_tokenManager != address(0), "Invalid TokenManager");
        require(_token != address(0), "Invalid token");
        require(_usdc != address(0), "Invalid USDC");

        tokenManager = ITokenManager2(_tokenManager);
        agentMemeToken = _token;
        usdc = IERC20(_usdc);
    }

    /**
     * @notice Buy tokens with a directional message
     * @param usdcAmount Amount of USDC to spend
     * @param minTokenAmount Minimum tokens to receive (slippage protection)
     * @param message Directional signal (max 280 chars)
     */
    function buyWithMessage(
        uint256 usdcAmount,
        uint256 minTokenAmount,
        string calldata message
    ) external {
        if (bytes(message).length > 280) revert MessageTooLong();

        // Transfer USDC from buyer
        require(
            usdc.transferFrom(msg.sender, address(this), usdcAmount),
            "USDC transfer failed"
        );

        // Approve TokenManager to spend USDC
        usdc.approve(address(tokenManager), usdcAmount);

        // Execute purchase through TokenManager2
        tokenManager.buyTokenAMAP(
            agentMemeToken,
            msg.sender,
            usdcAmount,
            minTokenAmount
        );

        // Emit event with message
        emit BuyWithMessage(msg.sender, usdcAmount, message, block.timestamp);
    }
}
