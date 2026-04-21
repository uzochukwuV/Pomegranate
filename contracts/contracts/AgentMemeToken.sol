// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentMemeToken
 * @notice Custom meme token with conviction tracking and tip staking
 * @dev Tracks holding duration to reward long-term holders with higher tip weight
 */
contract AgentMemeToken is ERC20, Ownable {
    /// @notice Timestamp when address first acquired tokens (for conviction multiplier)
    mapping(address => uint256) public holdingSince;

    /// @notice Total tokens staked by address (locked for tip attribution)
    mapping(address => uint256) public stakedBalance;

    /// @notice Vault address that can manage staking
    address public vault;

    event ConvictionReset(address indexed holder);
    event TokensStaked(address indexed holder, uint256 amount);
    event TokensUnstaked(address indexed holder, uint256 amount);
    event VaultUpdated(address indexed oldVault, address indexed newVault);

    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address initialOwner
    ) ERC20(name, symbol) Ownable(initialOwner) {
        _mint(initialOwner, initialSupply);
    }

    /**
     * @notice Set the vault address that can manage staking
     * @param _vault Address of the AgentVault contract
     */
    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "Invalid vault address");
        emit VaultUpdated(vault, _vault);
        vault = _vault;
    }

    /**
     * @notice Get conviction multiplier for a holder (in basis points)
     * @param holder Address to check
     * @return Multiplier in basis points (100 = 1x, 200 = 2x, 300 = 3x)
     */
    function getConvictionMultiplier(address holder) external view returns (uint256) {
        if (holdingSince[holder] == 0) return 100; // 1x (no holding history)

        uint256 holdDays = (block.timestamp - holdingSince[holder]) / 1 days;

        if (holdDays >= 60) return 300; // 3x for 60+ days
        if (holdDays >= 30) return 200; // 2x for 30-59 days
        if (holdDays >= 7)  return 150; // 1.5x for 7-29 days
        return 100;                      // 1x for < 7 days
    }

    /**
     * @notice Get effective tip weight for a holder (balance + stake) × conviction
     * @param holder Address to check
     * @param stakeAmount Additional tokens being staked with this tip
     * @return Effective weight in tokens (scaled by conviction multiplier)
     */
    function getEffectiveTipWeight(address holder, uint256 stakeAmount)
        external
        view
        returns (uint256)
    {
        uint256 baseWeight = balanceOf(holder) + stakeAmount;
        uint256 convictionBps = this.getConvictionMultiplier(holder);

        // Additional stake bonus: +10% per 1000 tokens staked (max 200% total)
        uint256 stakeBonusBps = 0;
        if (stakeAmount > 0) {
            stakeBonusBps = (stakeAmount / 1000e18) * 10; // 10 bps per 1000 tokens
            if (stakeBonusBps > 100) stakeBonusBps = 100; // Cap at 100 bps (2x total)
        }

        uint256 totalMultiplierBps = convictionBps + stakeBonusBps;
        return (baseWeight * totalMultiplierBps) / 100;
    }

    /**
     * @notice Stake tokens for a tip submission (only callable by vault)
     * @param holder Address staking tokens
     * @param amount Amount to stake
     */
    function stakeTipTokens(address holder, uint256 amount) external {
        require(msg.sender == vault, "Only vault can stake");
        require(balanceOf(holder) >= amount, "Insufficient balance");

        // Transfer tokens from holder to vault for escrow
        _transfer(holder, vault, amount);
        stakedBalance[holder] += amount;

        emit TokensStaked(holder, amount);
    }

    /**
     * @notice Unstake tokens after tip settlement (only callable by vault)
     * @param holder Address to unstake for
     * @param amount Amount to return
     * @param slash If true, slash 20% of stake as penalty
     */
    function unstakeTipTokens(address holder, uint256 amount, bool slash) external {
        require(msg.sender == vault, "Only vault can unstake");
        require(stakedBalance[holder] >= amount, "Insufficient staked balance");

        stakedBalance[holder] -= amount;

        if (slash) {
            // Slash 20% as penalty, return 80%
            uint256 slashAmount = (amount * 20) / 100;
            uint256 returnAmount = amount - slashAmount;

            _transfer(vault, holder, returnAmount);
            // Slashed amount stays in vault (can be burned or redistributed)

            emit TokensUnstaked(holder, returnAmount);
        } else {
            // No penalty, return full amount
            _transfer(vault, holder, amount);
            emit TokensUnstaked(holder, amount);
        }
    }

    /**
     * @notice Override transfer to track holding duration
     * @dev Resets conviction clock when user sells all tokens
     */
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);

        // When someone receives tokens for the first time, start their holding clock
        if (to != address(0) && to != vault && holdingSince[to] == 0 && balanceOf(to) > 0) {
            holdingSince[to] = block.timestamp;
        }

        // When someone sells ALL their tokens (and has no stake), reset conviction
        if (from != address(0) && from != vault && balanceOf(from) == 0 && stakedBalance[from] == 0) {
            holdingSince[from] = 0;
            emit ConvictionReset(from);
        }
    }

    /**
     * @notice Mint new tokens (owner only, for bonuses and rewards)
     * @param to Address to mint to
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from vault (for buyback-burn mechanism)
     * @param amount Amount to burn
     */
    function burn(uint256 amount) external {
        require(msg.sender == vault || msg.sender == owner(), "Only vault or owner can burn");
        _burn(msg.sender, amount);
    }
}
