// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Royalty.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title MemeWarNFT
 * @notice Weekly meme contest where memes are minted as NFTs with dynamic metadata
 * @dev Winners get special badge overlay + USDC prize, all NFTs are tradable with royalties
 */
contract MemeWarNFT is ERC721, ERC721Royalty, Ownable, ReentrancyGuard {
    using Strings for uint256;

    /// @notice AgentMeme token for voting weight
    IERC20 public immutable agentMeme;

    /// @notice USDC token for prizes
    IERC20 public immutable usdc;

    /// @notice Address of the vault (authorized to settle weeks)
    address public vault;

    /// @notice Mint fee in BNB (0.01 BNB = ~$3-5)
    uint256 public mintFee = 0.01 ether;

    /// @notice Current week number
    uint256 public currentWeek = 1;

    /// @notice Next token ID
    uint256 public nextTokenId = 1;

    /// @notice Royalty percentage in basis points (500 = 5%)
    uint96 public constant ROYALTY_BPS = 500;

    /// @notice Meme NFT metadata
    struct MemeNFT {
        uint256 tokenId;
        address creator;
        string ipfsHash;       // IPFS hash of original meme image
        string caption;        // Caption (max 140 chars)
        uint256 votes;         // Current vote count (dynamic)
        uint256 weekNumber;
        bool isWinner;         // True if won the week
        uint256 prizeAmount;   // USDC prize if winner
        uint256 mintedAt;      // Timestamp
    }

    /// @notice Mapping from tokenId to meme data
    mapping(uint256 => MemeNFT) public memes;

    /// @notice Mapping from week to array of token IDs
    mapping(uint256 => uint256[]) public weekTokenIds;

    /// @notice Mapping to track votes: tokenId => voter => voted
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    /// @notice Mapping to track if week has been settled
    mapping(uint256 => bool) public weekSettled;

    /// @notice Mapping to track week winners
    mapping(uint256 => uint256) public weekWinnerTokenId;

    /// @notice Events
    event MemeNFTMinted(
        uint256 indexed tokenId,
        address indexed creator,
        uint256 indexed week,
        string ipfsHash,
        string caption
    );

    event MemeVoted(
        uint256 indexed tokenId,
        address indexed voter,
        uint256 weight,
        uint256 newTotalVotes
    );

    event WeekWinner(
        uint256 indexed week,
        uint256 indexed tokenId,
        address indexed winner,
        uint256 prize
    );

    event MintFeeUpdated(uint256 oldFee, uint256 newFee);

    error MustHoldTokens();
    error CaptionTooLong();
    error AlreadyVoted();
    error CannotVoteOwnMeme();
    error WeekAlreadySettled();
    error OnlyVault();
    error InvalidTokenId();
    error EmptyIPFSHash();
    error InsufficientMintFee();

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
    ) ERC721("AgentMeme War NFT", "AMMEME") Ownable(msg.sender) {
        require(_agentMeme != address(0), "Invalid token");
        require(_usdc != address(0), "Invalid USDC");

        agentMeme = IERC20(_agentMeme);
        usdc = IERC20(_usdc);

        // Set default royalty: 5% to this contract (will be split between vault and creator)
        _setDefaultRoyalty(address(this), ROYALTY_BPS);
    }

    /**
     * @notice Set vault address
     * @param _vault Vault contract address
     */
    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "Invalid vault");
        vault = _vault;
    }

    /**
     * @notice Set mint fee
     * @param _mintFee New mint fee in wei
     */
    function setMintFee(uint256 _mintFee) external onlyOwner {
        emit MintFeeUpdated(mintFee, _mintFee);
        mintFee = _mintFee;
    }

    /**
     * @notice Submit a meme and mint as NFT
     * @param ipfsHash IPFS hash of the meme image
     * @param caption Caption for the meme (max 140 chars)
     */
    function submitMeme(
        string calldata ipfsHash,
        string calldata caption
    ) external payable nonReentrant returns (uint256 tokenId) {
        if (agentMeme.balanceOf(msg.sender) == 0) revert MustHoldTokens();
        if (bytes(ipfsHash).length == 0) revert EmptyIPFSHash();
        if (bytes(caption).length > 140) revert CaptionTooLong();
        if (msg.value < mintFee) revert InsufficientMintFee();

        tokenId = nextTokenId++;

        // Mint NFT to creator
        _safeMint(msg.sender, tokenId);

        // Store metadata
        memes[tokenId] = MemeNFT({
            tokenId: tokenId,
            creator: msg.sender,
            ipfsHash: ipfsHash,
            caption: caption,
            votes: 0,
            weekNumber: currentWeek,
            isWinner: false,
            prizeAmount: 0,
            mintedAt: block.timestamp
        });

        // Add to week's token IDs
        weekTokenIds[currentWeek].push(tokenId);

        // Transfer mint fee to vault
        if (vault != address(0) && msg.value > 0) {
            (bool success, ) = vault.call{value: msg.value}("");
            require(success, "Fee transfer failed");
        }

        emit MemeNFTMinted(tokenId, msg.sender, currentWeek, ipfsHash, caption);
    }

    /**
     * @notice Vote on a meme (token-weighted)
     * @param tokenId Token ID of the meme to vote for
     */
    function vote(uint256 tokenId) external nonReentrant {
        if (_ownerOf(tokenId) == address(0)) revert InvalidTokenId();

        MemeNFT storage meme = memes[tokenId];

        if (hasVoted[tokenId][msg.sender]) revert AlreadyVoted();
        if (meme.creator == msg.sender) revert CannotVoteOwnMeme();

        uint256 weight = agentMeme.balanceOf(msg.sender);
        if (weight == 0) revert MustHoldTokens();

        // Add vote weight
        meme.votes += weight;
        hasVoted[tokenId][msg.sender] = true;

        emit MemeVoted(tokenId, msg.sender, weight, meme.votes);
    }

    /**
     * @notice Settle the current week and distribute prize
     * @param prizeUsdc USDC prize amount (1% of weekly profit)
     */
    function settleWeek(uint256 prizeUsdc) external onlyVault nonReentrant {
        if (weekSettled[currentWeek]) revert WeekAlreadySettled();

        uint256[] storage tokenIds = weekTokenIds[currentWeek];

        // Find winner (highest votes)
        uint256 winnerTokenId = 0;
        uint256 highestVotes = 0;

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            if (memes[tokenId].votes > highestVotes) {
                highestVotes = memes[tokenId].votes;
                winnerTokenId = tokenId;
            }
        }

        // Mark week as settled
        weekSettled[currentWeek] = true;

        // If there were submissions and a prize
        if (winnerTokenId != 0 && prizeUsdc > 0) {
            // Mark NFT as winner (permanent badge)
            memes[winnerTokenId].isWinner = true;
            memes[winnerTokenId].prizeAmount = prizeUsdc;

            // Store week winner
            weekWinnerTokenId[currentWeek] = winnerTokenId;

            address winner = ownerOf(winnerTokenId);

            // Transfer USDC prize
            require(
                usdc.transferFrom(msg.sender, winner, prizeUsdc),
                "Prize transfer failed"
            );

            emit WeekWinner(currentWeek, winnerTokenId, winner, prizeUsdc);
        }

        // Move to next week
        currentWeek++;
    }

    /**
     * @notice Generate dynamic SVG with winner badge overlay
     * @param tokenId Token ID
     * @return SVG string
     */
    function generateSVG(uint256 tokenId) public view returns (string memory) {
        MemeNFT memory meme = memes[tokenId];

        // Base SVG with IPFS image
        string memory svg = string(abi.encodePacked(
            '<svg width="500" height="500" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">',
            '<image href="https://ipfs.io/ipfs/', meme.ipfsHash, '" width="500" height="500"/>',

            // Vote count badge (bottom left)
            '<rect x="10" y="450" width="120" height="40" rx="10" fill="rgba(0,0,0,0.8)"/>',
            '<text x="70" y="475" text-anchor="middle" font-family="Arial" font-size="18" fill="white" font-weight="bold">',
            unicode"🔥 ", meme.votes.toString(), ' votes',
            '</text>'
        ));

        // Winner badge overlay (top right)
        if (meme.isWinner) {
            svg = string(abi.encodePacked(
                svg,
                '<rect x="350" y="10" width="140" height="50" rx="10" fill="rgba(255,215,0,0.95)"/>',
                '<text x="420" y="40" text-anchor="middle" font-family="Arial" font-size="24" fill="#000" font-weight="bold">',
                unicode"👑 WINNER",
                '</text>',
                '<rect x="350" y="70" width="140" height="30" rx="5" fill="rgba(0,200,0,0.9)"/>',
                '<text x="420" y="90" text-anchor="middle" font-family="Arial" font-size="14" fill="white" font-weight="bold">',
                '$', (meme.prizeAmount / 1e6).toString(), ' USDC',
                '</text>'
            ));
        }

        svg = string(abi.encodePacked(svg, '</svg>'));

        return svg;
    }

    /**
     * @notice Generate dynamic metadata JSON
     * @param tokenId Token ID
     * @return Base64-encoded JSON metadata
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        MemeNFT memory meme = memes[tokenId];

        // Generate SVG
        string memory svg = generateSVG(tokenId);
        string memory svgBase64 = Base64.encode(bytes(svg));

        // Build attributes array
        string memory attributes = string(abi.encodePacked(
            '[',
            '{"trait_type":"Week","value":', meme.weekNumber.toString(), '},',
            '{"trait_type":"Votes","value":', meme.votes.toString(), '},',
            '{"trait_type":"Creator","value":"', _addressToString(meme.creator), '"},',
            meme.isWinner ? '{"trait_type":"Status","value":"Winner"},' : '{"trait_type":"Status","value":"Participant"},',
            meme.isWinner ? string(abi.encodePacked('{"trait_type":"Prize","value":', (meme.prizeAmount / 1e6).toString(), '},')) : '',
            '{"trait_type":"Minted At","value":', meme.mintedAt.toString(), '}',
            ']'
        ));

        // Build JSON metadata
        string memory json = string(abi.encodePacked(
            '{',
            '"name":"AgentMeme War #', tokenId.toString(), '",',
            '"description":"', _escapeQuotes(meme.caption), '",',
            '"image":"data:image/svg+xml;base64,', svgBase64, '",',
            '"external_url":"https://agentmeme.app/meme/', tokenId.toString(), '",',
            '"attributes":', attributes,
            '}'
        ));

        return string(abi.encodePacked(
            'data:application/json;base64,',
            Base64.encode(bytes(json))
        ));
    }

    /**
     * @notice Get all memes for a specific week
     * @param week Week number
     * @return Array of meme NFT data
     */
    function getWeekMemes(uint256 week) external view returns (MemeNFT[] memory) {
        uint256[] storage tokenIds = weekTokenIds[week];
        MemeNFT[] memory weekMemes = new MemeNFT[](tokenIds.length);

        for (uint256 i = 0; i < tokenIds.length; i++) {
            weekMemes[i] = memes[tokenIds[i]];
        }

        return weekMemes;
    }

    /**
     * @notice Get current week's leaderboard (top N)
     * @param topN Number of top memes to return
     * @return Array of meme NFT data sorted by votes
     */
    function getLeaderboard(uint256 topN) external view returns (MemeNFT[] memory) {
        uint256[] storage tokenIds = weekTokenIds[currentWeek];
        uint256 count = tokenIds.length;

        if (topN > count) topN = count;
        if (count == 0) return new MemeNFT[](0);

        // Create array and sort by votes
        MemeNFT[] memory sorted = new MemeNFT[](count);
        for (uint256 i = 0; i < count; i++) {
            sorted[i] = memes[tokenIds[i]];
        }

        // Bubble sort (simple for demo)
        for (uint256 i = 0; i < count; i++) {
            for (uint256 j = i + 1; j < count; j++) {
                if (sorted[j].votes > sorted[i].votes) {
                    MemeNFT memory temp = sorted[i];
                    sorted[i] = sorted[j];
                    sorted[j] = temp;
                }
            }
        }

        // Return top N
        MemeNFT[] memory result = new MemeNFT[](topN);
        for (uint256 i = 0; i < topN; i++) {
            result[i] = sorted[i];
        }

        return result;
    }

    /**
     * @notice Withdraw accumulated royalties (owner only)
     */
    function withdrawRoyalties() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success, ) = owner().call{value: balance}("");
            require(success, "Withdrawal failed");
        }
    }

    /**
     * @notice Receive royalty payments
     */
    receive() external payable {}

    /**
     * @dev Override required by Solidity for ERC721Royalty
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Royalty)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @dev Override required by Solidity for ERC721Royalty
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    /**
     * @notice Helper to convert address to string
     */
    function _addressToString(address _addr) internal pure returns (string memory) {
        bytes32 value = bytes32(uint256(uint160(_addr)));
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = '0';
        str[1] = 'x';
        for (uint256 i = 0; i < 20; i++) {
            str[2 + i * 2] = alphabet[uint8(value[i + 12] >> 4)];
            str[3 + i * 2] = alphabet[uint8(value[i + 12] & 0x0f)];
        }
        return string(str);
    }

    /**
     * @notice Helper to escape quotes in captions
     */
    function _escapeQuotes(string memory str) internal pure returns (string memory) {
        bytes memory strBytes = bytes(str);
        uint256 quoteCount = 0;

        // Count quotes
        for (uint256 i = 0; i < strBytes.length; i++) {
            if (strBytes[i] == '"') quoteCount++;
        }

        if (quoteCount == 0) return str;

        // Create new string with escaped quotes
        bytes memory escaped = new bytes(strBytes.length + quoteCount);
        uint256 j = 0;

        for (uint256 i = 0; i < strBytes.length; i++) {
            if (strBytes[i] == '"') {
                escaped[j++] = '\\';
            }
            escaped[j++] = strBytes[i];
        }

        return string(escaped);
    }
}
