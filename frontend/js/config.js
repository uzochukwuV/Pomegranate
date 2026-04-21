export const CONFIG = {
  bscRpcUrl:    'http://127.0.0.1:8545',
  chainId:      31337,
  wsUrl:        'ws://localhost:8080',
  apiBaseUrl:   'http://localhost:3001',
  supabaseUrl:  'https://lhzhjtgrsppbeivwrayd.supabase.co',
  supabaseKey:  'sb_publishable_6TwK8e6ITCUEu-pHKucKGQ_IUK5HFXw',
  agentVault:       '0xAeCc10Aee6a995b5Dab9AeF005871CAe35AEA945',
  manifestoLog:     '0x45267a9e378983C8f7823E25c6d79F030763958C',
  agentMemeToken:   '0xd92afd776c4df16a0303c870a2ce5c450b1b4444',
  memeWar:          '0xE33862faBe08E7Ccf1e3E7E4d0bEFd740Dd8bB4B',
  buybackBurner:    '0xc2dF225fC1b3E2C90eAA921DA5E1AEda20c3D8f7',
};

export const AGENT_VAULT_ABI = [
  { name: 'epochNumber',     type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'epochActive',     type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { name: 'epochStartTime',  type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'epochDuration',   type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalAssets',     type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalSupply',     type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'deployedCapital', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'epochProfit',     type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'int256' }] },
  {
    name: 'getEpochTips', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'epoch', type: 'uint256' }],
    outputs: [{ type: 'tuple[]', components: [
      { name: 'tipper',       type: 'address' },
      { name: 'content',      type: 'string' },
      { name: 'weight',       type: 'uint256' },
      { name: 'rawBalance',   type: 'uint256' },
      { name: 'stakeAmount',  type: 'uint256' },
      { name: 'epoch',        type: 'uint256' },
      { name: 'attributed',   type: 'bool' },
      { name: 'tradeId',      type: 'bytes32' },
      { name: 'isContrarian', type: 'bool' },
    ]}],
  },
];

export const MANIFESTO_LOG_ABI = [
  { name: 'manifestoCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    name: 'getRecentManifestos', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'count', type: 'uint256' }],
    outputs: [{ type: 'tuple[]', components: [
      { name: 'id',        type: 'uint256' },
      { name: 'reasoning', type: 'string' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'tradeId',   type: 'bytes32' },
      { name: 'isPulse',   type: 'bool' },
    ]}],
  },
];

export const AGENT_MEME_TOKEN_ABI = [
  { name: 'totalSupply',             type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf',               type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'getConvictionMultiplier', type: 'function', stateMutability: 'view', inputs: [{ name: 'holder', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'holdingSince',            type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'stakedBalance',           type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }] },
];

export const MEME_WAR_ABI = [
  { name: 'currentWeek', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    name: 'getWeekMemes', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'week', type: 'uint256' }],
    outputs: [{ type: 'tuple[]', components: [
      { name: 'creator',   type: 'address' },
      { name: 'ipfsHash',  type: 'string' },
      { name: 'caption',   type: 'string' },
      { name: 'votes',     type: 'uint256' },
      { name: 'weekNumber',type: 'uint256' },
    ]}],
  },
  {
    name: 'getLeaderboard', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'topN', type: 'uint256' }],
    outputs: [{ type: 'tuple[]', components: [
      { name: 'creator',   type: 'address' },
      { name: 'ipfsHash',  type: 'string' },
      { name: 'caption',   type: 'string' },
      { name: 'votes',     type: 'uint256' },
      { name: 'weekNumber',type: 'uint256' },
    ]}],
  },
  { name: 'weekWinner', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ type: 'address' }] },
];

export const BUYBACK_BURNER_ABI = [
  { name: 'totalUsdcSpent', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalTokensBurned', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    name: 'getStats', type: 'function', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'totalUsdcSpent', type: 'uint256' },
      { name: 'totalTokensBurned', type: 'uint256' },
      { name: 'burnRate', type: 'uint256' },
    ],
  },
];
