/**
 * MCP Standard Error Codes
 */
export var ErrorCode;
(function (ErrorCode) {
    ErrorCode["INVALID_INPUT"] = "INVALID_INPUT";
    ErrorCode["NOT_FOUND"] = "NOT_FOUND";
    ErrorCode["RATE_LIMIT"] = "RATE_LIMIT";
    ErrorCode["INTERNAL_ERROR"] = "INTERNAL_ERROR";
    ErrorCode["UNAUTHORIZED"] = "UNAUTHORIZED";
    ErrorCode["BLOCKCHAIN_ERROR"] = "BLOCKCHAIN_ERROR";
})(ErrorCode || (ErrorCode = {}));
/**
 * MCP Standard Error Class
 */
export class MCPError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "MCPError";
    }
}
/**
 * Common MYX Contract Error Selectors
 */
export const CONTRACT_ERRORS = {
    "fa52dfc0": "AccountInsufficientFreeAmount()",
    "e2a1a260": "AccountInsufficientReservedAmount()",
    "ffd10028": "AccountInsufficientTradableAmount(uint256,uint256)",
    "9996b315": "AddressEmptyCode(address)",
    "4c9c8ce3": "ERC1967InvalidImplementation(address)",
    "b398979f": "ERC1967NonPayable()",
    "d6bda275": "FailedCall()",
    "f92ee8a9": "InvalidInitialization()",
    "44d3438f": "NotAddressManager()",
    "3fc81f20": "NotDependencyManager()",
    "d7e6bcf8": "NotInitializing()",
    "507f487a": "NotProxyAdmin()",
    "e03f6024": "PermissionDenied(address,address)",
    "5274afe7": "SafeERC20FailedOperation(address)",
    "e07c8dba": "UUPSUnauthorizedCallContext()",
    "aa1d49a4": "UUPSUnsupportedProxiableUUID(bytes32)",
    "24775e06": "SafeCastOverflowedUintToInt(uint256)",
    "ba767932": "ConvertAmountMismatch(uint256,uint256)",
    "d93c0665": "EnforcedPause()",
    "8dfc202b": "ExpectedPause()",
    "059e2f49": "InRewindMode()",
    "db42144d": "InsufficientBalance(address,uint256,uint256)",
    "42301c23": "InsufficientOutputAmount()",
    "caa99aac": "MismatchExecuteFee(uint256,uint256,uint256)",
    "8637dfc0": "NotInRewindMode()",
    "4578ddb8": "OnlyRelayer()",
    "1e4fbdf7": "OwnableInvalidOwner(address)",
    "118cdaa7": "OwnableUnauthorizedAccount(address)",
    "3ee5aeb5": "ReentrancyGuardReentrantCall()",
    "90b8ec18": "TransferFailed()",
    "f4d678b8": "InsufficientBalance()",
    "6aee3c1a": "InsufficientRiskReserves()",
    "2c5211c6": "InvalidAmount()",
    "82cb17ef": "InvalidSplitConfig()",
    "f645eedf": "ECDSAInvalidSignature()",
    "fce698f7": "ECDSAInvalidSignatureLength(uint256)",
    "d78bce0c": "ECDSAInvalidSignatureS(bytes32)",
    "48834bee": "ExpiredFeeData()",
    "56d69198": "InvalidFeeRate()",
    "613970e0": "InvalidParameter()",
    "80577032": "NoRebateToClaim()",
    "27d08510": "NotActiveBroker(address)",
    "6e6b79b0": "NotBrokerSigner(address)",
    "f6412b5a": "NotOrderOwner()",
    "70d645e3": "NotPositionOwner()",
    "ff70343d": "UnsupportedAssetClass(AssetClass)",
    "185676be": "UnsupportedFeeTier(uint8)",
    "60b25fe4": "BrokerAlreadyExists()",
    "7eb4a674": "BrokerNotFound()",
    "8c3b5bf0": "NotBrokerAdmin()",
    "3733548a": "InvalidFeeTier()",
    "192105d7": "InitializationFunctionReverted(address,bytes)",
    "0dc149f0": "AlreadyInitialized()",
    "664431a8": "NotAllowedTarget(address)",
    "03357c6c": "ExceedsMaximumRelayFee()",
    "0d10f63b": "InconsistentParamsLength()",
    "38802743": "InsufficientFeeAllowance(address,uint256,uint256)",
    "d95b4ad5": "InsufficientFeeBalance(address,uint256,uint256)",
    "a3972305": "MismatchedSender(address)",
    "c3b80e86": "RelayerRegistered(address)",
    "ee0844a3": "RemoveRelayerFailed()",
    "c583a8da": "IncorrectFee(uint256)",
    "00bfc921": "InvalidPrice()",
    "d96ce906": "PriceIdMismatch()",
    "148cd0dd": "VerifyPriceFailed()",
    "b12d13eb": "ETHTransferFailed()",
    "a83325d4": "PoolOracleFeeCharged()",
    "6b75f90d": "PoolOracleFeeNotCharged()",
    "42a0e2a7": "PoolOracleFeeNotExisted()",
    "8ee01e1c": "PoolOracleFeeNotSoldOut()",
    "5e0a829b": "ETHTransferFailed(address,uint256)",
    "4ba6536f": "GasLimitExceeded(address,uint256,uint256)",
    "ca1aae4b": "GasLimitNotSet(address)",
    "3728b83d": "InvalidAmount(uint256)",
    "3484727e": "BaseFeeNotSoldOut()",
    "0251bde4": "LPNotFullyMinted()",
    "7decb035": "PoolDebtNotCleared()",
    "1acb203e": "PositionNotEmpty()",
    "2be7b24b": "UnexpectedPoolState()",
    "7bd42a2e": "NotEmptyAddress()",
    "6697b232": "AccessControlBadConfirmation()",
    "e2517d3f": "AccessControlUnauthorizedAccount(address,bytes32)",
    "7c9a1cf9": "AlreadyVoted()",
    "796ea3a6": "BondNotReleased()",
    "6511c20d": "BondZeroAmount()",
    "f38e5973": "CaseAppealNotFinished()",
    "1eaa4a59": "CaseDeadlineNotReached()",
    "e6c67e3a": "CaseDeadlineReached()",
    "0fc957b1": "CaseNotAccepted()",
    "3ddb819d": "CaseNotExist(CaseId)",
    "79eab18d": "CaseRespondentAppealed(CaseId,address)",
    "a179f8c9": "ChainIdMismatch()",
    "311c16d3": "DisputeNotAllowed()",
    "752d88c0": "InvalidAccountNonce(address,uint256)",
    "a710429d": "InvalidContractAddress()",
    "8076dd8a": "InvalidFunctionSignature()",
    "c37906a0": "InvalidPayloadLength(uint256,uint256)",
    "dcdedda9": "InvalidPoolToken()",
    "3471a3c2": "InvalidProfitAmount()",
    "1d9617a0": "InvalidResponseVersion()",
    "9284b197": "InvalidSourceChain()",
    "b9021668": "NoChainResponse()",
    "c546bca4": "NotCaseRespondent(CaseId,address)",
    "84ae4a30": "NumberOfResponsesMismatch()",
    "02164961": "RequestTypeMismatch()",
    "4cf72652": "RiskCloseNotCompleted()",
    "0819bdcd": "SignatureExpired()",
    "c00ca938": "UnexpectedCaseState()",
    "7935e939": "UnexpectedCaseType()",
    "5e7bd6ec": "UnexpectedNumberOfResults()",
    "51ee5853": "UnsupportedQueryType(uint8)",
    "29ca666b": "UntrustfulVoting()",
    "439cc0cd": "VerificationFailed()",
    "714f5513": "VersionMismatch()",
    "96b8e05b": "WrongQueryType(uint8,uint8)",
    "bb6b170d": "ZeroQueries()",
    "a9214540": "AlreadyClaimed(CaseId,address)",
    "d4ac59c1": "InvalidAmount(CaseId,address)",
    "7a6f5328": "MerkleTreeVerificationFailed(CaseId,address)",
    "094a5cfe": "ReimbursementValidity(CaseId)",
    "8b922563": "TreeAlreadySet()",
    "7b27120a": "InDisputeMode()",
    "5646203f": "InsufficientCollateral(PositionId,uint256)",
    "b04111ef": "InsufficientFreeCollateral(PositionId,uint256)",
    "12f1b11a": "InsufficientLockedCollateral(PositionId,uint256)",
    "a8ce4432": "SafeCastOverflowedIntToUint(int256)",
    "6dfcc650": "SafeCastOverflowedUintDowncast(uint8,uint256)",
    "d24b47fb": "UserProfitFrozen()",
    "1c151780": "ExceedMinOutput(uint256,uint256)",
    "e1f0493d": "NotAllowedCaller(address)",
    "fb8f41b2": "ERC20InsufficientAllowance(address,uint256,uint256)",
    "e450d38c": "ERC20InsufficientBalance(address,uint256,uint256)",
    "e602df05": "ERC20InvalidApprover(address)",
    "ec442f05": "ERC20InvalidReceiver(address)",
    "96c6fd1e": "ERC20InvalidSender(address)",
    "94280d62": "ERC20InvalidSpender(address)",
    "62791302": "ERC2612ExpiredSignature(uint256)",
    "4b800e46": "ERC2612InvalidSigner(address,address)",
    "b3512b0c": "InvalidShortString()",
    "305a27a9": "StringTooLong(string)",
    "fd0f789d": "ExceedMaxPriceDeviation()",
    "407b87e5": "ExchangeRateAlreadyApplied()",
    "5c6c5686": "ExchangeRateAlreadyDisabled()",
    "1ae17fcd": "InvalidDeviationRatio()",
    "37bc9350": "InvalidPriceTimestamp()",
    "7a5c919f": "InvalidRewindPrice()",
    "18b88897": "InvalidUpdateFee()",
    "f76740e3": "PriceDeviationBelowMinimum()",
    "49386283": "PriceDeviationThresholdReached()",
    "7f84faec": "PublishTimeMismatch()",
    "19abf40e": "StalePrice()",
    "e351cd13": "ExceedMaxExchangeableAmount()",
    "14be833f": "InsufficientReturnAmount(uint256,uint256)",
    "15912a6f": "NotSupportVersion()",
    "f1364a74": "ArrayEmpty()",
    "15ed381d": "ExceedMaxProfit()",
    "dc82bd68": "ExceedMinOutputAmount()",
    "ba01b06f": "PoolNotActive(PoolId)",
    "ba8f5df5": "PoolNotCompoundable(PoolId)",
    "51aeee6c": "PoolNotExist(PoolId)",
    "70f6c197": "InvalidQuoteTokenAddress()",
    "0b8457f4": "InvalidRatioParams()",
    "29dae146": "MarketAlreadyExisted()",
    "f040b67a": "MarketNotExisted()",
    "0e442a4a": "InvalidBaseToken()",
    "24e219c7": "MarketNotExist(MarketId)",
    "cc36f935": "PoolExists(PoolId)",
    "e84c308d": "ExceedBaseReserved(uint256,uint256)",
    "3e241751": "ExceedQuoteReserved(uint256,uint256)",
    "de656889": "ExceedReservable(uint256,uint256,uint256)",
    "d54d0fc4": "InsufficientLiquidity(uint256,uint256,uint256)",
    "7e562a65": "InvalidDistributionAmount()",
    "83c7580d": "ReservableNotEnough(uint256,uint256)",
    "94eef58a": "ERC2771ForwarderExpiredRequest(uint48)",
    "c845a056": "ERC2771ForwarderInvalidSigner(address,address)",
    "70647f79": "ERC2771ForwarderMismatchedValue(uint256,uint256)",
    "d2650cd1": "ERC2771UntrustfulTarget(address,address)",
    "cf479181": "InsufficientBalance(uint256,uint256)",
    "4c150d8f": "DifferentMarket(PoolId,PoolId)",
    "aa98b06a": "InsufficientQuoteIn(uint256,uint256,uint256)",
    "3e589bee": "InvalidLiquidityAmount()",
    "aebd3617": "InvalidTpsl(uint256)",
    "e079169e": "NotReachedPrice(OrderId,uint256,uint256,TriggerType)",
    "7fe81129": "SamePoolMigration(PoolId)",
    "71c4efed": "SlippageExceeded(uint256,uint256)",
    "62b9bc7b": "DesignatedTokenMismatch(address,address)",
    "49465eb0": "NotForwardAllowedTarget(address)",
    "e921c36b": "AlreadyMigrated(PositionId,PositionId)",
    "ddefae28": "AlreadyMinted()",
    "b4762117": "ExceedMaxLeverage(PositionId)",
    "97c7f537": "ExcessiveSlippage()",
    "301b6707": "ExecutionFeeNotCollected()",
    "1b5305a8": "InsufficientRedeemable()",
    "c6e8248a": "InsufficientSize()",
    "700deaad": "InvalidADLPosition(OrderId,PositionId)",
    "f64fa6a8": "InvalidOrder(OrderId)",
    "1dab59cf": "InvalidOrderPair(OrderId,OrderId)",
    "8ea9158f": "InvalidPosition(PositionId)",
    "d15b4fe2": "InvalidQuoteToken()",
    "d8daec7c": "MarketNotInitialized()",
    "419ecd12": "MatchNotSupported()",
    "d4944235": "NoADLNeeded(OrderId)",
    "cd4891b6": "NotInDisputeMode()",
    "17229ec4": "NotMeetEarlyCloseCriteria(PositionId)",
    "1ad308dc": "OrderExpired(OrderId)",
    "e75316c6": "OrderNotExist(OrderId)",
    "230e8e43": "PoolNotInPreBenchState(PoolId)",
    "486aa307": "PoolNotInitialized()",
    "a5afd143": "PositionNotHealthy(PositionId,uint256)",
    "ba0d3752": "PositionNotInitialized(PositionId)",
    "c53f84e7": "PositionRemainsHealthy(PositionId)",
    "107dec14": "RiskCloseNotAllowed()",
    "759b3876": "UnhealthyAfterRiskTierApplied(PositionId)",
};
/**
 * Tries to decode an error data string into a human-readable name.
 * @param errorData Hex string of the error data (e.g. "0xfa52dfc0...")
 */
export function decodeErrorSelector(errorData) {
    if (!errorData || typeof errorData !== "string")
        return null;
    // Clean prefix
    let hex = errorData.toLowerCase();
    if (hex.startsWith("0x"))
        hex = hex.slice(2);
    // Selector is first 4 bytes (8 hex chars)
    const selector = hex.slice(0, 8);
    return CONTRACT_ERRORS[selector] || null;
}
function normalizeErrorHex(errorData) {
    if (!errorData || typeof errorData !== "string")
        return null;
    let hex = errorData.trim().toLowerCase();
    if (!hex)
        return null;
    if (hex.startsWith("0x"))
        hex = hex.slice(2);
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 8)
        return null;
    return hex;
}
function readUint256Arg(hex, argIndex) {
    const start = 8 + (argIndex * 64);
    const end = start + 64;
    if (hex.length < end)
        return null;
    try {
        return BigInt(`0x${hex.slice(start, end)}`);
    }
    catch {
        return null;
    }
}
export function describeContractError(errorData) {
    const hex = normalizeErrorHex(errorData);
    if (!hex)
        return null;
    const selector = hex.slice(0, 8);
    const name = CONTRACT_ERRORS[selector];
    if (!name)
        return null;
    if (selector === "ffd10028") {
        const current = readUint256Arg(hex, 0);
        const required = readUint256Arg(hex, 1);
        if (current !== null && required !== null) {
            return `${name} [current=${current.toString()}, required=${required.toString()}]`;
        }
    }
    if (selector === "71c4efed") {
        const expected = readUint256Arg(hex, 0);
        const actual = readUint256Arg(hex, 1);
        if (expected !== null && actual !== null) {
            return `${name} [expected=${expected.toString()}, actual=${actual.toString()}]`;
        }
    }
    return name;
}
export function extractContractErrorFromText(text) {
    if (!text || typeof text !== "string")
        return null;
    const matches = text.match(/0x[0-9a-fA-F]{8,}/g);
    if (!matches)
        return null;
    for (const match of matches) {
        const decoded = describeContractError(match);
        if (decoded)
            return decoded;
    }
    return null;
}
