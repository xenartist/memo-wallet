import React, {useState, useEffect, useCallback, useMemo, useRef} from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Alert,
  View,
  ActivityIndicator,
  Image,
  ScrollView,
  StatusBar,
  Clipboard,
  Platform,
  PermissionsAndroid,
  TextInput,
  RefreshControl,
  Modal,
  FlatList,
} from 'react-native';
import {
  SeedVault,
  SeedVaultPermissionAndroid,
} from '@solana-mobile/seed-vault-lib';
import type {Account as SeedVaultAccount} from '@solana-mobile/seed-vault-lib';
import FontAwesome from '@react-native-vector-icons/fontawesome';

import {
  SwapToken,
  SwapNetwork,
  PoolPair,
  getSwapTokens,
  fetchSwapQuote,
  executeSwap,
  toApiMint,
  toPrepareTokenInMint,
  NATIVE_MINT,
  JUPITER_SOL_MINT,
  JUPITER_DEFAULT_SOL_TOKENS,
  fetchJupiterDefaultSolTokens,
  fetchJupiterOrder,
  searchJupiterTokens,
  executeJupiterSwap,
} from './src/swap';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {fetchAllTokens, PortfolioToken} from './src/portfolio';
import {X1_RPC_URL, SOLANA_RPC_URL, setCustomRpcUrls} from './src/rpc';
import {
  isValidSolanaAddress,
  executeSend,
  estimateSendFeeForDisplay,
  loadSendHistory,
  addSendHistory,
  formatTimeAgo,
  SendHistoryRecord,
} from './src/send';
import QRScanner from './src/QRScanner';
import QRCode from 'react-native-qrcode-svg';
import {WebView} from 'react-native-webview';

// Default swap tokens shown immediately on first load (balance filled in after API loads)
const MEMO_MINT = 'memoX1sJsBY6od7CfQ58XooRALwnocAZen4L7mW1ick';
const DEFAULT_FROM_TOKEN: SwapToken = {
  mint: NATIVE_MINT,
  apiMint: toApiMint(NATIVE_MINT),
  prepareApiMint: toPrepareTokenInMint(NATIVE_MINT),
  symbol: 'XNT',
  name: 'XNT',
  logo: 'https://app.xdex.xyz/assets/images/tokens/x1.webp',
  balance: 0,
  decimals: 9,
  network: 'X1',
};
const DEFAULT_TO_TOKEN: SwapToken = {
  mint: MEMO_MINT,
  apiMint: MEMO_MINT,
  prepareApiMint: MEMO_MINT,
  symbol: 'MEMO',
  name: 'MEMO',
  logo: 'https://raw.githubusercontent.com/xenartist/memo-token/refs/heads/main/metadata/memo_token-logo.png',
  balance: 0,
  decimals: 6,
  network: 'X1',
};

function App(): JSX.Element {
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string>('');
  const [balance, setBalance] = useState<string>('');
  const [currentAuthToken, setCurrentAuthToken] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState('portfolio');
  const [tokens, setTokens] = useState<PortfolioToken[]>([
    {
      symbol: 'XNT',
      name: 'XNT',
      balance: '0.00',
      mint: null,
      network: 'X1',
      icon_uri: 'https://app.xdex.xyz/assets/images/tokens/x1.webp',
      decimals: 9,
      rawBalance: 0,
      volume_usd: 0,
    },
    {
      symbol: 'SOL',
      name: 'Solana',
      balance: '0.00',
      mint: null,
      network: 'Solana',
      icon_uri: null,
      decimals: 9,
      rawBalance: 0,
      volume_usd: 0,
    },
  ]);
  const [refreshing, setRefreshing] = useState(false);

  // ── Swap state ──────────────────────────────────────────────────────────────
  const [swapNetwork, setSwapNetwork] = useState<SwapNetwork>('X1 Mainnet');
  const [solanaDefaultTokens, setSolanaDefaultTokens] = useState<SwapToken[]>(
    JUPITER_DEFAULT_SOL_TOKENS,
  );
  const [swapTokenList, setSwapTokenList] = useState<SwapToken[]>([]);
  const [swapPoolList, setSwapPoolList] = useState<PoolPair[]>([]);
  const [swapFromToken, setSwapFromToken] = useState<SwapToken | null>(
    DEFAULT_FROM_TOKEN,
  );
  const [swapToToken, setSwapToToken] = useState<SwapToken | null>(
    DEFAULT_TO_TOKEN,
  );
  const [swapFromAmount, setSwapFromAmount] = useState('');
  const [swapToAmount, setSwapToAmount] = useState('');
  const [swapQuoteRate, setSwapQuoteRate] = useState<number | null>(null); // tokenOutAmount per tokenIn
  const [isLoadingSwapTokens, setIsLoadingSwapTokens] = useState(false);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [isExecutingSwap, setIsExecutingSwap] = useState(false);
  const [showTokenSelector, setShowTokenSelector] = useState<
    'from' | 'to' | null
  >(null);
  const [derivationPath, setDerivationPath] = useState<string>('');

  // ── Account Picker state ─────────────────────────────────────────────────────
  const [accountPickerVisible, setAccountPickerVisible] = useState(false);
  const [pendingAccounts, setPendingAccounts] = useState<SeedVaultAccount[]>(
    [],
  );
  const [pendingAuthToken, setPendingAuthToken] = useState<number | null>(null);
  const [jupiterSearchQuery, setJupiterSearchQuery] = useState('');
  const [jupiterSearchResults, setJupiterSearchResults] = useState<SwapToken[]>(
    [],
  );
  const [isSearchingJupiter, setIsSearchingJupiter] = useState(false);
  const [fromSelectorTab, setFromSelectorTab] = useState<
    'X1' | 'Solana' | 'All'
  >('X1');
  const [fromSearchQuery, setFromSearchQuery] = useState('');
  const [showSwapConfirmModal, setShowSwapConfirmModal] = useState(false);
  const [swapSuccessModalVisible, setSwapSuccessModalVisible] = useState(false);
  const [swapSuccessTxId, setSwapSuccessTxId] = useState('');

  // ── Send state ──────────────────────────────────────────────────────────────
  const [sendToken, setSendToken] = useState<PortfolioToken | null>(null);
  const [sendRecipient, setSendRecipient] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendFeeEstimate, setSendFeeEstimate] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendSuccessModalVisible, setSendSuccessModalVisible] = useState(false);
  const [sendSuccessTxId, setSendSuccessTxId] = useState('');
  const [showSendConfirmModal, setShowSendConfirmModal] = useState(false);
  const [showSendTokenSelector, setShowSendTokenSelector] = useState(false);
  const [recipientInputMode, setRecipientInputMode] = useState<
    'manual' | 'history'
  >('manual');
  const [recipientHistoryTab, setRecipientHistoryTab] = useState<
    'X1' | 'Solana' | 'All'
  >('X1');
  const [sendHistory, setSendHistory] = useState<SendHistoryRecord[]>([]);
  const [isAddressValid, setIsAddressValid] = useState<boolean | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);

  // ── Settings / RPC state ────────────────────────────────────────────────────
  const [x1RpcUrl, setX1RpcUrl] = useState(X1_RPC_URL);
  const [solanaRpcUrl, setSolanaRpcUrl] = useState(SOLANA_RPC_URL);
  const [x1RpcInput, setX1RpcInput] = useState(X1_RPC_URL);
  const [solanaRpcInput, setSolanaRpcInput] = useState(SOLANA_RPC_URL);

  // ── Swap pool list cache (session-level) ────────────────────────────────────
  // Pool lists are stable within a session; cache per network to avoid
  // re-fetching every time the user switches back to the Swap tab.
  const poolCacheRef = useRef<Partial<Record<SwapNetwork, PoolPair[]>>>({});

  // ── Receive state ───────────────────────────────────────────────────────────
  // (No state needed - only displays address and QR code)

  // ── WebView state ───────────────────────────────────────────────────────────
  const [showWebView, setShowWebView] = useState(false);
  const [webViewUrl, setWebViewUrl] = useState('');

  // Look up balance for a swap token from the already-loaded portfolio data.
  // Matching is done via apiMint (normalises native variants) + network.
  // Returns 0 if the token is not in the portfolio.
  const balanceFromPortfolio = useCallback(
    (apiMint: string, network: 'X1' | 'Solana'): number => {
      const found = tokens.find(
        p => toApiMint(p.mint) === apiMint && p.network === network,
      );
      return found?.rawBalance ?? 0;
    },
    [tokens],
  );

  useEffect(() => {
    const initAuth = async () => {
      try {
        const isAvailable = await SeedVault.isSeedVaultAvailable(false);
        if (!isAvailable) {
          setIsAuthorized(false);
          return;
        }
        // Must check permission before calling getAuthorizedSeeds(),
        // otherwise it throws a native SecurityException crash on release builds
        // where the app hasn't been granted Seed Vault access yet.
        const hasPermission = await PermissionsAndroid.check(
          SeedVaultPermissionAndroid,
        );
        if (!hasPermission) {
          setIsAuthorized(false);
          return;
        }
        const authorizedSeeds = await SeedVault.getAuthorizedSeeds();
        setIsAuthorized(authorizedSeeds.length > 0);
      } catch (error) {
        setIsAuthorized(false);
      }
    };
    initAuth();
  }, []);

  // Load saved RPC URLs from storage on mount and inject into rpc.ts
  useEffect(() => {
    const loadRpcUrls = async () => {
      try {
        const [savedX1, savedSolana] = await Promise.all([
          AsyncStorage.getItem('rpc_url_x1'),
          AsyncStorage.getItem('rpc_url_solana'),
        ]);
        const x1 = savedX1 || X1_RPC_URL;
        const sol = savedSolana || SOLANA_RPC_URL;
        setX1RpcUrl(x1);
        setSolanaRpcUrl(sol);
        setX1RpcInput(x1);
        setSolanaRpcInput(sol);
        setCustomRpcUrls(x1, sol);
      } catch (err) {
        console.warn('[App] Failed to load RPC URLs:', err);
      }
    };
    loadRpcUrls();
  }, []);

  // Load swap token list whenever we enter the swap tab or the network changes.
  // Pool lists are cached per network for the session lifetime to avoid
  // redundant fetches when the user tabs back to Swap.
  useEffect(() => {
    if (!connected || !publicKey || activeTab !== 'swap') {
      return;
    }
    const loadTokens = async () => {
      const cachedPools = poolCacheRef.current[swapNetwork];
      setIsLoadingSwapTokens(true);
      try {
        if (cachedPools) {
          // Pool list already loaded for this network — only re-fetch tokens
          const [{tokens: swapToks}, solDefaults] = await Promise.all([
            getSwapTokens(publicKey, swapNetwork),
            fetchJupiterDefaultSolTokens(),
          ]);
          setSwapTokenList(swapToks);
          setSwapPoolList(cachedPools);
          setSolanaDefaultTokens(solDefaults);
        } else {
          // First visit for this network — fetch everything
          const [{tokens: swapToks, pools: swapPools}, solDefaults] =
            await Promise.all([
              getSwapTokens(publicKey, swapNetwork),
              fetchJupiterDefaultSolTokens(),
            ]);
          poolCacheRef.current[swapNetwork] = swapPools;
          setSwapTokenList(swapToks);
          setSwapPoolList(swapPools);
          setSolanaDefaultTokens(solDefaults);
        }
      } catch (err) {
        console.error('[App] Failed to load swap tokens:', err);
      } finally {
        setIsLoadingSwapTokens(false);
      }
    };
    loadTokens();
  }, [connected, publicKey, swapNetwork, activeTab]);

  // Sync swap token balances from portfolio whenever portfolio data changes.
  // This is instant — no API call needed.
  useEffect(() => {
    setSwapFromToken(prev => {
      if (!prev) {
        return DEFAULT_FROM_TOKEN;
      }
      return {
        ...prev,
        balance: balanceFromPortfolio(prev.apiMint, prev.network),
      };
    });
    setSwapToToken(prev => {
      if (!prev) {
        return DEFAULT_TO_TOKEN;
      }
      return {
        ...prev,
        balance: balanceFromPortfolio(prev.apiMint, prev.network),
      };
    });
  }, [tokens, balanceFromPortfolio]);

  // ── Send: Load history when entering send tab ───────────────────────────────
  useEffect(() => {
    if (activeTab === 'send') {
      loadSendHistory().then(history => {
        setSendHistory(history.records);
      });
    }
  }, [activeTab]);

  // ── Send: Auto-switch history tab when token changes ─────────────────────────
  useEffect(() => {
    if (sendToken) {
      // Auto-switch to corresponding network tab when token changes
      setRecipientHistoryTab(sendToken.network);
    }
  }, [sendToken]);

  // ── Send: Validate address when recipient changes ────────────────────────────
  useEffect(() => {
    if (sendRecipient.trim().length === 0) {
      setIsAddressValid(null);
      return;
    }
    const valid = isValidSolanaAddress(sendRecipient);
    setIsAddressValid(valid);
  }, [sendRecipient]);

  const checkAndRequestPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') {
      Alert.alert('Error', 'Seed Vault is only available on Android');
      return false;
    }

    const isAvailable = await SeedVault.isSeedVaultAvailable(false);
    if (!isAvailable) {
      Alert.alert(
        'Error',
        'Seed Vault is not available on this device. Only Solana Seeker supports Seed Vault.',
      );
      return false;
    }

    const granted = await PermissionsAndroid.request(
      SeedVaultPermissionAndroid,
      {
        title: 'Seed Vault Permission',
        message: 'This app needs permission to access your wallet',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'OK',
      },
    );

    return granted === PermissionsAndroid.RESULTS.GRANTED;
  };

  const fetchBalances = async (pk: string): Promise<void> => {
    try {
      const allTokens = await fetchAllTokens(pk);
      setTokens(allTokens);
      // Calculate total USD value from all tokens
      const totalUsd = allTokens.reduce(
        (sum, t) => sum + (t.volume_usd || 0),
        0,
      );
      setBalance(totalUsd.toFixed(2));
    } catch (error) {
      console.error('Failed to fetch balances:', error);
      setBalance('Failed to fetch');
    }
  };

  const onRefresh = useCallback(async () => {
    if (!publicKey) {
      return;
    }
    setRefreshing(true);
    await fetchBalances(publicKey);
    setRefreshing(false);
  }, [publicKey]);

  const applyAccount = async (authToken: number, account: SeedVaultAccount) => {
    // Persist the chosen account so next connect skips the picker
    await AsyncStorage.setItem(
      'selected_account_pubkey',
      account.publicKeyEncoded,
    );
    setPublicKey(account.publicKeyEncoded);
    setCurrentAuthToken(authToken);
    setDerivationPath(account.derivationPath);
    setConnected(true);
    await fetchBalances(account.publicKeyEncoded);
  };

  const getAccountInfo = async (authToken: number) => {
    const accounts = await SeedVault.getUserWallets(authToken);
    if (accounts.length === 0) {
      Alert.alert('No Accounts', 'No accounts found in Seed Vault');
      return;
    }
    if (accounts.length === 1) {
      await applyAccount(authToken, accounts[0]);
      return;
    }
    // Multiple accounts: check if user already chose one previously
    const savedPubkey = await AsyncStorage.getItem('selected_account_pubkey');
    if (savedPubkey) {
      const saved = accounts.find(a => a.publicKeyEncoded === savedPubkey);
      if (saved) {
        await applyAccount(authToken, saved);
        return;
      }
    }
    // No saved choice yet — show picker
    setPendingAccounts(accounts);
    setPendingAuthToken(authToken);
    setAccountPickerVisible(true);
  };

  const connectSeedVault = async () => {
    setIsLoading(true);
    try {
      const hasPermission = await checkAndRequestPermission();
      if (!hasPermission) {
        setIsLoading(false);
        return;
      }

      const authorizedSeeds = await SeedVault.getAuthorizedSeeds();

      if (authorizedSeeds.length > 0) {
        await getAccountInfo(authorizedSeeds[0].authToken);
        setIsLoading(false);
        return;
      }

      const result = await SeedVault.authorizeNewSeed();

      if (result) {
        await getAccountInfo(result.authToken);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      Alert.alert('Error', `Failed to connect: ${errorMessage}`);
    }
    setIsLoading(false);
  };

  const disconnect = (): void => {
    // Clear saved account so next connect shows picker again
    AsyncStorage.removeItem('selected_account_pubkey');
    setConnected(false);
    setPublicKey('');
    setBalance('');
    setCurrentAuthToken(null);
    setIsAuthorized(false);
  };

  // Fetch quote rate (exchange ratio) from API - called when tokens change or periodically
  const fetchQuoteRate = useCallback(async () => {
    if (!swapFromToken || !swapToToken) {
      return;
    }
    setIsLoadingQuote(true);
    try {
      let rate: number;

      if (swapNetwork === 'Solana Mainnet') {
        // Jupiter: use 1 token (in native units) for the quote
        const oneLamport = Math.pow(10, swapFromToken.decimals);
        const inputMint =
          swapFromToken.mint === null
            ? JUPITER_SOL_MINT
            : swapFromToken.apiMint;
        const outputMint =
          swapToToken.mint === null ? JUPITER_SOL_MINT : swapToToken.apiMint;
        const order = await fetchJupiterOrder({
          inputMint,
          outputMint,
          amountLamports: oneLamport,
        });
        if (order.errorCode !== null && order.outAmount === 0) {
          throw new Error(
            order.errorMessage ?? `Jupiter quote error ${order.errorCode}`,
          );
        }
        rate = order.outAmount / Math.pow(10, swapToToken.decimals);
      } else {
        // xDEX
        const result = await fetchSwapQuote({
          network: swapNetwork,
          tokenIn: swapFromToken.apiMint,
          tokenOut: swapToToken.apiMint,
          tokenInAmount: 1,
          isExactAmountIn: true,
        });
        rate = result.tokenOutAmount;
      }

      setSwapQuoteRate(rate);
      // Recalculate output amount locally using the new rate
      if (swapFromAmount && parseFloat(swapFromAmount) > 0) {
        const decimals = Math.min(swapToToken.decimals, 6);
        setSwapToAmount((rate * parseFloat(swapFromAmount)).toFixed(decimals));
      }
    } catch (err) {
      console.error('[App] Quote rate error:', err);
      setSwapQuoteRate(null);
    } finally {
      setIsLoadingQuote(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapFromToken, swapToToken, swapNetwork]);

  // Calculate output amount locally based on existing quote rate
  const calculateOutputAmount = useCallback(
    (amount: string) => {
      if (
        !swapQuoteRate ||
        !swapToToken ||
        !amount ||
        parseFloat(amount) <= 0
      ) {
        setSwapToAmount('');
        return;
      }
      const decimals = Math.min(swapToToken.decimals, 6);
      const output = swapQuoteRate * parseFloat(amount);
      setSwapToAmount(output.toFixed(decimals));
    },
    [swapQuoteRate, swapToToken],
  );

  // Fetch quote rate when tokens change, and set up periodic refresh (every 30 seconds)
  useEffect(() => {
    if (!swapFromToken || !swapToToken) {
      return;
    }

    // Fetch immediately when tokens change
    fetchQuoteRate();

    // Set up 60-second interval to refresh quote
    const intervalId = setInterval(() => {
      fetchQuoteRate();
    }, 60000);

    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapFromToken, swapToToken, swapNetwork]);

  const handleFromAmountChange = (text: string) => {
    setSwapFromAmount(text);
    calculateOutputAmount(text);
  };

  // ── Memoised token selector lists ────────────────────────────────────────────
  // Cached portfolio tokens eligible as swap "From" tokens
  const fromTokensFromPortfolio = useMemo<SwapToken[]>(
    () =>
      tokens
        .filter(p => !p.symbol.includes('LP') && p.rawBalance > 0)
        .map(p => ({
          mint: p.mint ?? toApiMint(null),
          apiMint: toApiMint(p.mint),
          prepareApiMint: toPrepareTokenInMint(p.mint),
          symbol: p.symbol,
          name: p.name,
          logo: p.icon_uri,
          balance: p.rawBalance,
          decimals: p.decimals,
          network: p.network,
        })),
    [tokens],
  );

  // Cached xDEX "To" token list: filter by active pool, sort by liquidity depth
  const xdexToTokens = useMemo<SwapToken[]>(() => {
    const fromApiMint = swapFromToken?.apiMint ?? '';
    if (!swapFromToken) {
      return [];
    }
    return swapTokenList
      .filter(t => {
        const candidateApiMint = t.apiMint;
        return swapPoolList.some(
          pool =>
            pool.status === 0 &&
            ((pool.token1Mint === fromApiMint &&
              pool.token2Mint === candidateApiMint) ||
              (pool.token2Mint === fromApiMint &&
                pool.token1Mint === candidateApiMint)),
        );
      })
      .sort((a, b) => {
        const isXNTFrom = swapFromToken?.symbol === 'XNT';
        const MEMO_MINT_LOCAL =
          swapTokenList.find(t => t.symbol === 'MEMO')?.apiMint ?? '';
        if (isXNTFrom) {
          if (a.apiMint === MEMO_MINT_LOCAL) {
            return -1;
          }
          if (b.apiMint === MEMO_MINT_LOCAL) {
            return 1;
          }
        }
        const getFromAmount = (candidateMint: string): number => {
          const pool = swapPoolList.find(
            p =>
              p.status === 0 &&
              ((p.token1Mint === fromApiMint &&
                p.token2Mint === candidateMint) ||
                (p.token2Mint === fromApiMint &&
                  p.token1Mint === candidateMint)),
          );
          if (!pool) {
            return 0;
          }
          return pool.token1Mint === fromApiMint ? pool.amount1 : pool.amount2;
        };
        return getFromAmount(b.apiMint) - getFromAmount(a.apiMint);
      });
  }, [swapFromToken, swapTokenList, swapPoolList]);

  const handleSwapDirection = () => {
    const prev = swapFromToken;
    setSwapFromToken(swapToToken);
    setSwapToToken(prev);
    setSwapFromAmount('');
    setSwapToAmount('');
  };

  const handleSelectFromToken = (token: SwapToken) => {
    const newNetwork = token.network === 'X1' ? 'X1 Mainnet' : 'Solana Mainnet';

    setSwapFromToken(token);
    setSwapNetwork(newNetwork);

    // Auto-select To token based on From token's network and symbol
    if (token.network === 'X1') {
      // X1 network: XNT → MEMO, non-XNT → XNT
      if (token.symbol === 'XNT') {
        // Try DEFAULT_TO_TOKEN first (faster), then swapTokenList
        const memoToken =
          DEFAULT_TO_TOKEN ||
          swapTokenList.find(t => t.symbol === 'MEMO' && t.network === 'X1');
        setSwapToToken(memoToken || null);
      } else {
        // Try DEFAULT_FROM_TOKEN first (faster), then swapTokenList
        const xntToken =
          DEFAULT_FROM_TOKEN ||
          swapTokenList.find(t => t.symbol === 'XNT' && t.network === 'X1');
        setSwapToToken(xntToken || null);
      }
    } else {
      // Solana network: SOL → solXEN, non-SOL → SOL
      if (token.symbol === 'SOL') {
        // Try solanaDefaultTokens first (faster), then swapTokenList
        const solXENToken =
          solanaDefaultTokens.find(t => t.symbol === 'solXEN') ||
          swapTokenList.find(
            t => t.symbol === 'solXEN' && t.network === 'Solana',
          );
        setSwapToToken(solXENToken || null);
      } else {
        // Try solanaDefaultTokens first (faster), then swapTokenList
        const solToken =
          solanaDefaultTokens.find(t => t.symbol === 'SOL') ||
          swapTokenList.find(t => t.symbol === 'SOL' && t.network === 'Solana');
        setSwapToToken(solToken || null);
      }
    }

    setSwapFromAmount('');
    setSwapToAmount('');
    setShowTokenSelector(null);
    setFromSelectorTab('X1');
    setFromSearchQuery('');
  };

  const handleSelectToToken = (token: SwapToken) => {
    setSwapToToken(token);
    setSwapFromAmount('');
    setSwapToAmount('');
    setShowTokenSelector(null);
    setFromSelectorTab('X1');
    setFromSearchQuery('');
  };

  const handleConfirmSwap = () => {
    if (!swapFromToken) {
      Alert.alert('Error', 'Please select a token to swap from');
      return;
    }
    if (!swapToToken) {
      Alert.alert('Error', 'Please select a token to swap to');
      return;
    }
    const amount = parseFloat(swapFromAmount);
    if (!swapFromAmount || isNaN(amount) || amount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    if (amount > swapFromToken.balance) {
      Alert.alert(
        'Insufficient balance',
        `You only have ${swapFromToken.balance} ${swapFromToken.symbol}`,
      );
      return;
    }
    if (!swapQuoteRate) {
      Alert.alert('Error', 'No exchange rate available for this pair');
      return;
    }
    setShowSwapConfirmModal(true);
  };

  const handleExecuteSwap = async () => {
    if (
      !swapFromToken ||
      !swapToToken ||
      !swapFromAmount ||
      !currentAuthToken
    ) {
      return;
    }
    setShowSwapConfirmModal(false);
    const amount = parseFloat(swapFromAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid amount', 'Please enter a valid amount');
      return;
    }
    if (amount > swapFromToken.balance) {
      Alert.alert(
        'Insufficient balance',
        `You only have ${swapFromToken.balance} ${swapFromToken.symbol}`,
      );
      return;
    }
    setIsExecutingSwap(true);
    try {
      // Get derivation path if not cached
      let path = derivationPath;
      if (!path) {
        const accounts = await SeedVault.getUserWallets(currentAuthToken);
        if (accounts.length === 0) {
          throw new Error('No wallet accounts found');
        }
        path = accounts[0].derivationPath;
        setDerivationPath(path);
      }
      let result;
      if (swapNetwork === 'Solana Mainnet') {
        const inputMint =
          swapFromToken.mint === null
            ? JUPITER_SOL_MINT
            : swapFromToken.apiMint;
        const outputMint =
          swapToToken.mint === null ? JUPITER_SOL_MINT : swapToToken.apiMint;
        const amountLamports = Math.round(
          amount * Math.pow(10, swapFromToken.decimals),
        );
        result = await executeJupiterSwap({
          inputMint,
          outputMint,
          amountLamports,
          taker: publicKey,
          authToken: currentAuthToken,
          derivationPath: path,
        });
      } else {
        result = await executeSwap({
          network: swapNetwork,
          wallet: publicKey,
          tokenIn: swapFromToken,
          tokenOut: swapToToken,
          tokenInAmount: amount,
          authToken: currentAuthToken,
          derivationPath: path,
        });
      }
      if (result.success) {
        setSwapSuccessTxId(result.signature ?? '');
        setSwapSuccessModalVisible(true);
        setSwapFromAmount('');
        setSwapToAmount('');
        // Refresh token list after swap
        const {tokens: refreshedTokens, pools: refreshedPools} =
          await getSwapTokens(publicKey, swapNetwork);
        // Invalidate pool cache so next tab switch re-fetches fresh pools
        poolCacheRef.current[swapNetwork] = refreshedPools;
        setSwapTokenList(refreshedTokens);
        setSwapPoolList(refreshedPools);
        // Sync portfolio
        await fetchBalances(publicKey);
      } else {
        Alert.alert('Swap Failed', result.error || 'Unknown error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Swap Error', msg);
    } finally {
      setIsExecutingSwap(false);
    }
  };

  const checkAuthorization = async (): Promise<boolean> => {
    try {
      const hasPermission = await checkAndRequestPermission();
      if (!hasPermission) {
        return false;
      }
      const authorizedSeeds = await SeedVault.getAuthorizedSeeds();
      const authorized = authorizedSeeds.length > 0;
      setIsAuthorized(authorized);
      return authorized;
    } catch (error) {
      setIsAuthorized(false);
      return false;
    }
  };

  const handleLoginPress = async () => {
    const authorized = await checkAuthorization();
    if (authorized) {
      await connectSeedVault();
    } else {
      const result = await SeedVault.authorizeNewSeed();
      if (result) {
        setIsAuthorized(true);
        await getAccountInfo(result.authToken);
      }
    }
  };

  const copyAddress = () => {
    Clipboard.setString(publicKey);
    Alert.alert('Copied', 'Address copied to clipboard');
  };

  const formatAddress = (address: string): string => {
    if (address.length <= 16) {
      return address;
    }
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // ── Send Handlers ────────────────────────────────────────────────────────────

  const handleSendButtonPress = () => {
    setActiveTab('send');
    // Reset send form
    setSendToken(null);
    setSendRecipient('');
    setSendAmount('');
    setSendFeeEstimate(null);
    setRecipientInputMode('manual');
    setIsAddressValid(null);
  };

  const handlePasteAddress = async () => {
    const text = await Clipboard.getString();
    if (text) {
      setSendRecipient(text.trim());
    }
  };

  const handleSelectSendToken = (token: PortfolioToken) => {
    setSendToken(token);
    setShowSendTokenSelector(false);
    // Reset amount when switching tokens
    setSendAmount('');
  };

  const handleSendAmountChange = (text: string) => {
    setSendAmount(text);
    // Validate amount against balance
    if (sendToken && text) {
      const amount = parseFloat(text);
      const maxAmount = sendToken.rawBalance; // rawBalance is already in token units (ui_amount)
      if (!isNaN(amount) && amount > maxAmount) {
        // Amount exceeds balance - will show error in UI
      }
    }
  };

  const handleQuickAmount = (percentage: number) => {
    if (!sendToken) {
      return;
    }
    const maxAmount = sendToken.rawBalance; // rawBalance is already in token units
    const amount = maxAmount * percentage;
    setSendAmount(amount.toFixed(Math.min(sendToken.decimals, 6)));
  };

  const handleSelectHistoryAddress = (record: SendHistoryRecord) => {
    setSendRecipient(record.address);
    setRecipientInputMode('manual'); // Switch back to manual mode to show the address
  };

  const handleConfirmSend = () => {
    // Validate inputs
    if (!sendToken) {
      Alert.alert('Error', 'Please select a token');
      return;
    }
    if (!sendRecipient || !isAddressValid) {
      Alert.alert('Error', 'Please enter a valid recipient address');
      return;
    }
    const amount = parseFloat(sendAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    const maxAmount = sendToken.rawBalance; // rawBalance is already in token units
    if (amount > maxAmount) {
      Alert.alert(
        'Error',
        `Insufficient balance. Max: ${maxAmount.toFixed(6)} ${
          sendToken.symbol
        }`,
      );
      return;
    }

    // Use hardcoded fee estimate to avoid RPC round-trip latency
    setSendFeeEstimate(sendToken.network === 'X1' ? 0.000005 : 0.000005);

    // Show confirmation modal
    setShowSendConfirmModal(true);
  };

  const handleExecuteSend = async () => {
    if (!sendToken || !currentAuthToken) {
      return;
    }

    setShowSendConfirmModal(false);
    setIsSending(true);

    try {
      // Get derivation path if not cached
      let path = derivationPath;
      if (!path) {
        const accounts = await SeedVault.getUserWallets(currentAuthToken);
        if (accounts.length === 0) {
          throw new Error('No wallet accounts found');
        }
        path = accounts[0].derivationPath;
        setDerivationPath(path);
      }

      const result = await executeSend({
        network: sendToken.network,
        token: sendToken,
        recipient: sendRecipient,
        amount: parseFloat(sendAmount),
        authToken: currentAuthToken,
        derivationPath: path,
        wallet: publicKey,
      });

      if (result.success) {
        // Save to history
        await addSendHistory(
          sendRecipient,
          sendToken.network,
          sendToken.symbol,
        );

        // Refresh history list
        const updatedHistory = await loadSendHistory();
        setSendHistory(updatedHistory.records);

        // Show success modal
        setSendSuccessTxId(result.signature ?? '');
        setSendSuccessModalVisible(true);

        // Reset form
        setSendRecipient('');
        setSendAmount('');
        setSendFeeEstimate(null);
        setIsAddressValid(null);

        // Refresh portfolio
        await fetchBalances(publicKey);
      } else {
        Alert.alert('Send Failed', result.error || 'Unknown error');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Alert.alert('Send Error', msg);
    } finally {
      setIsSending(false);
    }
  };

  const renderLoginScreen = () => (
    <View style={styles.loginContainer}>
      <View style={styles.logoContainer}>
        <Image
          source={require('./assets/image/memo-wallet-logo-512.png')}
          style={styles.logo}
        />
      </View>
      <Text style={styles.title}>MEMO Wallet</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={handleLoginPress}
        disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {isAuthorized ? 'Enter Seed Vault' : 'Connect Seed Vault'}
          </Text>
        )}
      </TouchableOpacity>

      <Text style={styles.hint}>Powered by X1 & Solana</Text>
      <Text style={styles.versionText}>v1.0.0</Text>
    </View>
  );

  const renderWalletScreen = () => (
    <ScrollView
      style={styles.walletContainer}
      contentContainerStyle={styles.walletContent}
      alwaysBounceVertical={true}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#38B6FF"
          colors={['#38B6FF']}
        />
      }>
      <View style={styles.header}>
        <TouchableOpacity onPress={copyAddress} style={styles.addressContainer}>
          <Text style={styles.addressText}>{formatAddress(publicKey)}</Text>
          <FontAwesome
            name="copy"
            size={14}
            color="#38B6FF"
            style={styles.copyIcon}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => setActiveTab('settings')}>
          <FontAwesome name="cog" size={18} color="#888" />
        </TouchableOpacity>
      </View>

      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Total Balance</Text>
        <Text style={styles.balanceValue}>${balance}</Text>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={handleSendButtonPress}>
          <View style={styles.actionIcon}>
            <FontAwesome name="arrow-up" size={20} color="#38B6FF" />
          </View>
          <Text style={styles.actionText}>Send</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => setActiveTab('receive')}>
          <View style={styles.actionIcon}>
            <FontAwesome name="arrow-down" size={20} color="#38B6FF" />
          </View>
          <Text style={styles.actionText}>Receive</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => setActiveTab('swap')}>
          <View style={styles.actionIcon}>
            <FontAwesome name="exchange" size={20} color="#38B6FF" />
          </View>
          <Text style={styles.actionText}>Swap</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tokenSection}>
        <Text style={styles.sectionTitle}>Assets</Text>
        {tokens.map((token, index) => (
          <View key={index} style={styles.tokenItem}>
            <View style={styles.tokenIconContainer}>
              <View style={styles.tokenIcon}>
                {token.symbol === 'SOL' && token.mint === null ? (
                  <Image
                    source={require('./assets/image/sol-token.png')}
                    style={styles.tokenImage}
                  />
                ) : token.icon_uri ? (
                  <Image
                    source={{uri: token.icon_uri}}
                    style={styles.tokenImage}
                  />
                ) : token.symbol === 'XNT' && token.mint === null ? (
                  <Image
                    source={require('./assets/image/xnt-token.jpeg')}
                    style={styles.tokenImage}
                  />
                ) : (
                  <View style={styles.tokenPlaceholder}>
                    <Text style={styles.tokenPlaceholderText}>
                      {token.symbol.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
              <View
                style={[
                  styles.networkBadge,
                  token.network === 'X1'
                    ? styles.networkBadgeX1
                    : styles.networkBadgeSolana,
                ]}>
                <Text style={styles.networkBadgeText}>
                  {token.network === 'X1' ? 'X1' : 'SOL'}
                </Text>
              </View>
            </View>
            <View style={styles.tokenInfo}>
              <Text style={styles.tokenSymbol}>{token.symbol}</Text>
              <Text style={styles.tokenName}>{token.name}</Text>
            </View>
            <View style={styles.tokenBalance}>
              <Text style={styles.tokenBalanceUsd}>
                ${token.volume_usd.toFixed(2)}
              </Text>
              <Text style={styles.tokenBalanceText}>{token.balance}</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );

  const renderBottomNav = () => (
    <View style={styles.bottomNav}>
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => setActiveTab('portfolio')}>
        <FontAwesome
          name="briefcase"
          size={20}
          color={activeTab === 'portfolio' ? '#38B6FF' : '#888'}
          style={styles.navIconImg}
        />
        <Text
          style={[
            styles.navIcon,
            activeTab === 'portfolio' && styles.navIconActive,
          ]}>
          Portfolio
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => setActiveTab('swap')}>
        <FontAwesome
          name="exchange"
          size={20}
          color={activeTab === 'swap' ? '#38B6FF' : '#888'}
          style={styles.navIconImg}
        />
        <Text
          style={[
            styles.navIcon,
            activeTab === 'swap' && styles.navIconActive,
          ]}>
          Swap
        </Text>
      </TouchableOpacity>
    </View>
  );

  const handleSaveRpcUrls = async () => {
    const x1 = x1RpcInput.trim() || X1_RPC_URL;
    const sol = solanaRpcInput.trim() || SOLANA_RPC_URL;
    setX1RpcUrl(x1);
    setSolanaRpcUrl(sol);
    setX1RpcInput(x1);
    setSolanaRpcInput(sol);
    setCustomRpcUrls(x1, sol);
    try {
      await AsyncStorage.setItem('rpc_url_x1', x1);
      await AsyncStorage.setItem('rpc_url_solana', sol);
      Alert.alert('Saved', 'RPC URLs updated successfully');
    } catch (err) {
      Alert.alert('Error', 'Failed to save RPC URLs');
    }
  };

  const handleResetRpcUrls = async () => {
    setX1RpcInput(X1_RPC_URL);
    setSolanaRpcInput(SOLANA_RPC_URL);
    setX1RpcUrl(X1_RPC_URL);
    setSolanaRpcUrl(SOLANA_RPC_URL);
    setCustomRpcUrls(X1_RPC_URL, SOLANA_RPC_URL);
    try {
      await AsyncStorage.removeItem('rpc_url_x1');
      await AsyncStorage.removeItem('rpc_url_solana');
    } catch (err) {
      console.warn('[App] Failed to clear RPC URLs:', err);
    }
  };

  const renderSettingsScreen = () => (
    <View style={styles.screenContainer}>
      <View style={styles.screenHeader}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => setActiveTab('portfolio')}>
          <FontAwesome name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Settings</Text>
        <View style={styles.placeholder} />
      </View>
      <ScrollView style={styles.settingsContent}>
        {/* RPC Settings */}
        <Text style={styles.settingsSectionTitle}>RPC Endpoints</Text>

        <View style={[styles.rpcSettingItem, {borderColor: '#38B6FF'}]}>
          <Text style={[styles.rpcLabel, {color: '#38B6FF'}]}>X1 Mainnet</Text>
          <TextInput
            style={styles.rpcInput}
            value={x1RpcInput}
            onChangeText={setX1RpcInput}
            placeholder={X1_RPC_URL}
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {x1RpcUrl !== X1_RPC_URL && (
            <Text style={styles.rpcCustomBadge}>Custom</Text>
          )}
        </View>

        <View style={[styles.rpcSettingItem, {borderColor: '#9945FF'}]}>
          <Text style={[styles.rpcLabel, {color: '#9945FF'}]}>
            Solana Mainnet
          </Text>
          <TextInput
            style={styles.rpcInput}
            value={solanaRpcInput}
            onChangeText={setSolanaRpcInput}
            placeholder={SOLANA_RPC_URL}
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {solanaRpcUrl !== SOLANA_RPC_URL && (
            <Text style={[styles.rpcCustomBadge, {color: '#9945FF'}]}>
              Custom
            </Text>
          )}
        </View>

        <View style={styles.rpcButtonRow}>
          <TouchableOpacity
            style={[styles.rpcButton, {backgroundColor: '#38B6FF'}]}
            onPress={handleSaveRpcUrls}>
            <Text style={styles.rpcButtonText}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.rpcButton, {backgroundColor: '#333'}]}
            onPress={handleResetRpcUrls}>
            <Text style={styles.rpcButtonText}>Reset to Default</Text>
          </TouchableOpacity>
        </View>

        {/* Danger Zone */}
        <Text style={styles.settingsSectionTitle}>Account</Text>
        <TouchableOpacity
          style={[styles.settingItem, styles.dangerItem]}
          onPress={() => {
            if (currentAuthToken !== null) {
              SeedVault.deauthorizeSeed(currentAuthToken);
              disconnect();
            }
          }}>
          <Text style={[styles.settingText, styles.dangerText]}>
            Remove Authorization
          </Text>
        </TouchableOpacity>
        <Text style={styles.settingsVersionText}>v1.0.0</Text>
      </ScrollView>
    </View>
  );

  // ── Token icon helper ────────────────────────────────────────────────────────
  const renderTokenIcon = (token: SwapToken | null, size: number = 28) => {
    if (!token) {
      return (
        <View
          style={[
            styles.swapTokenIconPlaceholder,
            {width: size, height: size, borderRadius: size / 2},
          ]}>
          <Text style={styles.swapTokenIconText}>?</Text>
        </View>
      );
    }
    if (token.logo) {
      return (
        <Image
          source={{uri: token.logo}}
          style={[
            styles.swapTokenIcon,
            {width: size, height: size, borderRadius: size / 2},
          ]}
        />
      );
    }
    return (
      <View
        style={[
          styles.swapTokenIconPlaceholder,
          {width: size, height: size, borderRadius: size / 2},
        ]}>
        <Text style={styles.swapTokenIconText}>
          {token.symbol.charAt(0).toUpperCase()}
        </Text>
      </View>
    );
  };

  // ── Jupiter search handler ────────────────────────────────────────────────────
  const handleJupiterSearch = useCallback(async (query: string) => {
    setJupiterSearchQuery(query);
    if (!query || query.trim().length < 1) {
      setJupiterSearchResults([]);
      return;
    }
    setIsSearchingJupiter(true);
    try {
      const results = await searchJupiterTokens(query);
      setJupiterSearchResults(results);
    } finally {
      setIsSearchingJupiter(false);
    }
  }, []);

  // ── Token icon with network badge (for selector modal) ────────────────────────
  const renderTokenIconWithBadge = (
    token: SwapToken | null,
    size: number = 36,
  ) => {
    return (
      <View style={[styles.tokenIconContainer, {width: size, height: size}]}>
        {token?.logo ? (
          <Image
            source={{uri: token.logo}}
            style={[
              styles.tokenSelectorIcon,
              {width: size, height: size, borderRadius: size / 2},
            ]}
          />
        ) : (
          <View
            style={[
              styles.swapTokenIconPlaceholder,
              {width: size, height: size, borderRadius: size / 2},
            ]}>
            <Text style={styles.swapTokenIconText}>
              {token?.symbol.charAt(0).toUpperCase() ?? '?'}
            </Text>
          </View>
        )}
        {token && (
          <View
            style={[
              styles.tokenSelectorNetworkBadge,
              token.network === 'X1'
                ? styles.networkBadgeX1
                : styles.networkBadgeSolana,
            ]}>
            <Text style={styles.tokenSelectorNetworkBadgeText}>
              {token.network === 'X1' ? 'X1' : 'SOL'}
            </Text>
          </View>
        )}
      </View>
    );
  };

  // ── Token Selector Modal ─────────────────────────────────────────────────────
  const renderTokenSelectorModal = () => {
    const isFrom = showTokenSelector === 'from';
    const onSelect = isFrom ? handleSelectFromToken : handleSelectToToken;
    const disabledToken = isFrom ? swapToToken : swapFromToken;

    // Determine if this is a Solana-To selector (Jupiter path)
    const isJupiterToSelector = !isFrom && swapNetwork === 'Solana Mainnet';

    // Jupiter To list: search results if query present, else default list
    const jupiterToTokens = isJupiterToSelector
      ? jupiterSearchQuery.trim().length > 0
        ? jupiterSearchResults
        : solanaDefaultTokens
      : [];

    const filteredTokens = isFrom
      ? fromTokensFromPortfolio
      : isJupiterToSelector
      ? jupiterToTokens
      : xdexToTokens;

    // From selector: apply tab + search filters
    const fromQ = fromSearchQuery.trim().toLowerCase();
    const fromTabFiltered = isFrom
      ? fromSelectorTab === 'All'
        ? fromTokensFromPortfolio
        : fromTokensFromPortfolio.filter(t => t.network === fromSelectorTab)
      : filteredTokens;
    const fromDisplayTokens =
      isFrom && fromQ.length > 0
        ? fromTabFiltered.filter(
            t =>
              t.symbol.toLowerCase().includes(fromQ) ||
              t.name.toLowerCase().includes(fromQ),
          )
        : fromTabFiltered;

    const x1Tokens = (isFrom ? fromDisplayTokens : filteredTokens).filter(
      t => t.network === 'X1',
    );
    const solTokens = (isFrom ? fromDisplayTokens : filteredTokens).filter(
      t => t.network === 'Solana',
    );

    // In From selector with a single-network tab, no group headers needed
    const showGroupHeaders = !isFrom || fromSelectorTab === 'All';

    return (
      <Modal
        visible={showTokenSelector !== null}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setShowTokenSelector(null);
          setJupiterSearchQuery('');
          setJupiterSearchResults([]);
          setFromSelectorTab('X1');
          setFromSearchQuery('');
        }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Select {isFrom ? 'From' : 'To'} Token
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowTokenSelector(null);
                  setJupiterSearchQuery('');
                  setJupiterSearchResults([]);
                  setFromSelectorTab('X1');
                  setFromSearchQuery('');
                }}
                style={styles.modalCloseButton}
                hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
                <FontAwesome name="times" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* From selector: network tab + search */}
            {isFrom && (
              <>
                <View style={styles.fromTabRow}>
                  {(['X1', 'Solana', 'All'] as const).map(tab => {
                    const isActive = fromSelectorTab === tab;
                    const activeColor =
                      tab === 'X1'
                        ? '#38B6FF'
                        : tab === 'Solana'
                        ? '#9945FF'
                        : '#F0B429';
                    return (
                      <TouchableOpacity
                        key={tab}
                        style={[
                          styles.fromTab,
                          isActive && {backgroundColor: activeColor},
                        ]}
                        onPress={() => {
                          setFromSelectorTab(tab);
                          setFromSearchQuery('');
                        }}>
                        <Text
                          style={[
                            styles.fromTabText,
                            isActive && styles.fromTabTextActive,
                          ]}>
                          {tab === 'X1'
                            ? 'X1 Mainnet'
                            : tab === 'Solana'
                            ? 'Solana'
                            : 'All'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.jupiterSearchContainer}>
                  <FontAwesome name="search" size={14} color="#888" />
                  <TextInput
                    style={styles.jupiterSearchInput}
                    placeholder="Search symbol or name..."
                    placeholderTextColor="#555"
                    value={fromSearchQuery}
                    onChangeText={setFromSearchQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </>
            )}

            {/* Jupiter search box (Solana To only) */}
            {isJupiterToSelector && (
              <View style={styles.jupiterSearchContainer}>
                <FontAwesome name="search" size={14} color="#888" />
                <TextInput
                  style={styles.jupiterSearchInput}
                  placeholder="Search token name, symbol or mint..."
                  placeholderTextColor="#555"
                  value={jupiterSearchQuery}
                  onChangeText={handleJupiterSearch}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {isSearchingJupiter && (
                  <ActivityIndicator size="small" color="#38B6FF" />
                )}
              </View>
            )}

            <FlatList
              data={[
                ...(x1Tokens.length > 0 && showGroupHeaders
                  ? [{type: 'header', label: 'X1 Mainnet', key: 'h-x1'}]
                  : []),
                ...x1Tokens.map(t => ({
                  type: 'token',
                  token: t,
                  key: `X1:${t.mint}`,
                })),
                ...(solTokens.length > 0 && showGroupHeaders
                  ? [{type: 'header', label: 'Solana Mainnet', key: 'h-sol'}]
                  : []),
                ...solTokens.map(t => ({
                  type: 'token',
                  token: t,
                  key: `Solana:${t.mint}`,
                })),
              ]}
              keyExtractor={item => item.key}
              renderItem={({item}: {item: any}) => {
                if (item.type === 'header') {
                  return (
                    <View style={styles.tokenGroupHeader}>
                      <View
                        style={[
                          styles.networkDot,
                          item.label.includes('X1')
                            ? styles.networkDotX1
                            : styles.networkDotSol,
                        ]}
                      />
                      <Text style={styles.tokenGroupLabel}>{item.label}</Text>
                    </View>
                  );
                }
                const t: SwapToken = item.token;
                const disabled =
                  t.apiMint === disabledToken?.apiMint &&
                  t.network === disabledToken?.network;
                return (
                  <TouchableOpacity
                    style={[
                      styles.tokenListItem,
                      disabled && styles.tokenListItemDisabled,
                    ]}
                    onPress={() => !disabled && onSelect(t)}
                    disabled={disabled}>
                    {renderTokenIconWithBadge(t, 36)}
                    <View style={styles.tokenListInfo}>
                      <Text style={styles.tokenListSymbol}>{t.symbol}</Text>
                      <Text style={styles.tokenListName}>{t.name}</Text>
                    </View>
                    <Text style={styles.tokenListBalance}>
                      {t.balance > 0
                        ? t.balance.toFixed(Math.min(t.decimals, 4))
                        : ''}
                    </Text>
                  </TouchableOpacity>
                );
              }}
              style={styles.tokenFlatList}
            />
          </View>
        </View>
      </Modal>
    );
  };

  // ── Swap Confirm Modal ────────────────────────────────────────────────────────
  const renderSwapConfirmModal = () => {
    if (!swapFromToken || !swapToToken) {
      return null;
    }
    const fromAmount = parseFloat(swapFromAmount);
    const toAmount = parseFloat(swapToAmount);
    const network = swapNetwork === 'X1 Mainnet' ? 'X1' : 'Solana';
    const accentColor =
      swapNetwork === 'Solana Mainnet' ? '#9945FF' : '#38B6FF';
    // X1: fixed ~0.001 XNT; Solana: ~0.0001 SOL based on testing
    const estimatedFee = swapNetwork === 'X1 Mainnet' ? 0.001 : 0.0001;

    return (
      <Modal
        visible={showSwapConfirmModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowSwapConfirmModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.swapSuccessModal}>
            <Text style={styles.swapSuccessTitle}>Confirm Swap</Text>

            <View style={styles.swapSuccessRow}>
              <Text style={styles.swapSuccessLabel}>From</Text>
              <View style={styles.swapSuccessValueRow}>
                <Text style={styles.swapSuccessValue}>
                  {fromAmount} {swapFromToken.symbol}
                </Text>
              </View>
            </View>

            <View style={styles.swapSuccessRow}>
              <Text style={styles.swapSuccessLabel}>To</Text>
              <View style={styles.swapSuccessValueRow}>
                <Text style={styles.swapSuccessValue}>
                  {toAmount.toFixed(Math.min(swapToToken.decimals, 6))}{' '}
                  {swapToToken.symbol}
                </Text>
              </View>
            </View>

            {swapQuoteRate && (
              <View style={styles.swapSuccessRow}>
                <Text style={styles.swapSuccessLabel}>Rate</Text>
                <View style={styles.swapSuccessValueRow}>
                  <Text style={styles.swapSuccessValue}>
                    1 {swapFromToken.symbol} = {swapQuoteRate.toFixed(6)}{' '}
                    {swapToToken.symbol}
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.swapSuccessRow}>
              <Text style={styles.swapSuccessLabel}>Network</Text>
              <View style={styles.swapSuccessValueRow}>
                <Text style={styles.swapSuccessValue}>{network}</Text>
              </View>
            </View>

            <View style={styles.swapSuccessRow}>
              <Text style={styles.swapSuccessLabel}>Est. Fee</Text>
              <View style={styles.swapSuccessValueRow}>
                <Text style={styles.swapSuccessValue}>
                  ~{estimatedFee.toFixed(6)} {network === 'X1' ? 'XNT' : 'SOL'}
                </Text>
              </View>
            </View>

            <View style={{flexDirection: 'row', gap: 12, marginTop: 24}}>
              <TouchableOpacity
                style={[
                  styles.swapSuccessCloseBtn,
                  {backgroundColor: '#333', flex: 1},
                ]}
                onPress={() => setShowSwapConfirmModal(false)}>
                <Text style={styles.swapSuccessCloseBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.swapSuccessCloseBtn,
                  {backgroundColor: accentColor, flex: 1},
                ]}
                onPress={handleExecuteSwap}
                disabled={isExecutingSwap}>
                {isExecutingSwap ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.swapSuccessCloseBtnText}>Confirm</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  // ── Swap Success Modal ────────────────────────────────────────────────────────
  const renderSwapSuccessModal = () => {
    const txId = swapSuccessTxId;
    const explorerBaseUrl =
      swapNetwork === 'Solana Mainnet'
        ? 'https://explorer.solana.com/tx/'
        : 'https://explorer.mainnet.x1.xyz/tx/';
    const explorerUrl = `${explorerBaseUrl}${txId}`;
    const accentColor =
      swapNetwork === 'Solana Mainnet' ? '#9945FF' : '#38B6FF';

    const copyToClipboard = (text: string, label: string) => {
      Clipboard.setString(text);
      Alert.alert('Copied', `${label} copied to clipboard`);
    };

    const openExplorer = () => {
      setWebViewUrl(explorerUrl);
      setShowWebView(true);
    };

    return (
      <Modal
        visible={swapSuccessModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setSwapSuccessModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.swapSuccessModal}>
            <View style={styles.swapSuccessHeader}>
              <FontAwesome name="check-circle" size={48} color="#4CAF50" />
              <Text style={styles.swapSuccessTitle}>Swap Successful!</Text>
            </View>

            {/* Transaction ID */}
            <View style={styles.swapSuccessRow}>
              <Text style={styles.swapSuccessLabel}>Transaction ID</Text>
              <View style={styles.swapSuccessValueRow}>
                <Text style={styles.swapSuccessValue}>
                  {txId.slice(0, 8)}...{txId.slice(-8)}
                </Text>
                <TouchableOpacity
                  onPress={() => copyToClipboard(txId, 'Transaction ID')}
                  style={styles.swapSuccessCopyBtn}>
                  <FontAwesome name="copy" size={16} color={accentColor} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Explorer URL */}
            <TouchableOpacity
              style={styles.swapSuccessRow}
              onPress={openExplorer}
              activeOpacity={0.7}>
              <Text style={styles.swapSuccessLabel}>Explorer</Text>
              <View style={styles.swapSuccessValueRow}>
                <Text style={styles.swapSuccessValue} numberOfLines={1}>
                  {explorerUrl.slice(0, 30)}...
                </Text>
                <FontAwesome
                  name="external-link"
                  size={16}
                  color={accentColor}
                />
              </View>
            </TouchableOpacity>

            {/* Close Button */}
            <TouchableOpacity
              style={[
                styles.swapSuccessCloseBtn,
                {backgroundColor: accentColor},
              ]}
              onPress={() => setSwapSuccessModalVisible(false)}>
              <Text style={styles.swapSuccessCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  // ── Receive Screen ────────────────────────────────────────────────────────────
  const renderReceiveScreen = () => {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.screenHeader}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setActiveTab('portfolio')}>
            <FontAwesome name="arrow-left" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Receive</Text>
          <View style={styles.placeholder} />
        </View>

        <ScrollView
          style={styles.receiveContent}
          contentContainerStyle={styles.receiveContentInner}>
          {/* QR Code Section */}
          <View style={styles.qrSection}>
            <View style={styles.qrCodeContainer}>
              <QRCode value={publicKey} size={220} backgroundColor="#fff" />
            </View>

            <Text style={styles.qrHint}>Scan to receive on X1 & Solana</Text>
          </View>

          {/* Address Section */}
          <View style={styles.addressSection}>
            <Text style={styles.addressLabel}>Your Wallet Address</Text>
            <View style={styles.addressBox}>
              <Text style={styles.addressFullText} selectable>
                {publicKey}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.copyAddressButton}
              onPress={copyAddress}>
              <FontAwesome name="copy" size={16} color="#fff" />
              <Text style={styles.copyAddressText}>Copy Address</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  };

  // ── Account Picker Modal ──────────────────────────────────────────────────────
  const renderAccountPickerModal = () => (
    <Modal
      visible={accountPickerVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setAccountPickerVisible(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Account</Text>
          </View>
          <Text style={styles.accountPickerSubtitle}>
            Multiple accounts found. Choose one to import.
          </Text>
          <FlatList
            data={pendingAccounts}
            keyExtractor={item => String(item.id)}
            renderItem={({item, index}) => {
              const pk = item.publicKeyEncoded;
              const shortPk =
                pk.length > 12 ? `${pk.slice(0, 6)}...${pk.slice(-6)}` : pk;
              const displayName =
                item.name && item.name.trim().length > 0
                  ? item.name.trim()
                  : `Account ${index + 1}`;
              return (
                <TouchableOpacity
                  style={styles.accountPickerItem}
                  onPress={async () => {
                    setAccountPickerVisible(false);
                    if (pendingAuthToken !== null) {
                      await applyAccount(pendingAuthToken, item);
                    }
                    setPendingAccounts([]);
                    setPendingAuthToken(null);
                  }}>
                  <View style={styles.accountPickerIcon}>
                    <FontAwesome name="user-circle" size={32} color="#38B6FF" />
                  </View>
                  <View style={styles.accountPickerInfo}>
                    <Text style={styles.accountPickerName}>{displayName}</Text>
                    <Text style={styles.accountPickerAddress}>{shortPk}</Text>
                    <Text style={styles.accountPickerPath}>
                      {item.derivationPath}
                    </Text>
                  </View>
                  <FontAwesome name="chevron-right" size={14} color="#555" />
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );

  // ── WebView Modal ─────────────────────────────────────────────────────────────
  const renderWebViewModal = () => {
    return (
      <Modal
        visible={showWebView}
        animationType="slide"
        onRequestClose={() => setShowWebView(false)}>
        <View style={styles.webViewContainer}>
          <View style={styles.webViewHeader}>
            <Text style={styles.webViewTitle}>Transaction Explorer</Text>
            <TouchableOpacity
              onPress={() => setShowWebView(false)}
              style={styles.webViewCloseButton}>
              <FontAwesome name="times" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          <WebView
            source={{uri: webViewUrl}}
            style={styles.webView}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={styles.webViewLoading}>
                <ActivityIndicator size="large" color="#38B6FF" />
              </View>
            )}
          />
        </View>
      </Modal>
    );
  };

  // ── Swap Screen ───────────────────────────────────────────────────────────────
  const renderSwapScreen = () => {
    // Accent color based on network: blue for X1, purple for Solana
    const accentColor =
      swapNetwork === 'Solana Mainnet' ? '#9945FF' : '#38B6FF';

    const canSwap =
      !!swapFromToken &&
      !!swapToToken &&
      !!swapFromAmount &&
      parseFloat(swapFromAmount) > 0 &&
      !isExecutingSwap;

    return (
      <View style={styles.screenContainer}>
        {renderTokenSelectorModal()}

        <View style={styles.screenHeader}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setActiveTab('portfolio')}>
            <FontAwesome name="arrow-left" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Swap</Text>
          {/* Network badge on the right */}
          <View
            style={[
              styles.networkBadgePill,
              swapNetwork === 'X1 Mainnet'
                ? styles.networkBadgePillX1
                : styles.networkBadgePillSol,
            ]}>
            <Text style={styles.networkBadgePillText}>
              {swapNetwork === 'X1 Mainnet' ? 'X1' : 'SOL'}
            </Text>
          </View>
        </View>

        <View style={styles.swapContent}>
          {/* ── From ── */}
          <View
            style={[
              styles.swapCard,
              swapFromToken?.network === 'Solana'
                ? styles.swapCardSolana
                : styles.swapCardX1,
            ]}>
            <Text style={styles.tokenLabel}>From</Text>
            <View style={styles.tokenRow}>
              <TouchableOpacity
                style={styles.tokenSelector}
                onPress={() => {
                  if (isLoadingSwapTokens) {
                    return;
                  }
                  const net = swapFromToken?.network;
                  setFromSelectorTab(
                    net === 'X1' || net === 'Solana' ? net : 'X1',
                  );
                  setFromSearchQuery('');
                  setShowTokenSelector('from');
                }}
                disabled={isLoadingSwapTokens}>
                {renderTokenIcon(swapFromToken)}
                <Text style={styles.swapTokenSymbol}>
                  {swapFromToken?.symbol ?? 'Select'}
                </Text>
                <FontAwesome name="chevron-down" size={12} color="#888" />
              </TouchableOpacity>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.amountInput}
                  value={swapFromAmount}
                  onChangeText={handleFromAmountChange}
                  placeholder="0.00"
                  placeholderTextColor="#888"
                  keyboardType="decimal-pad"
                  editable={!isExecutingSwap}
                />
              </View>
            </View>
            <Text style={styles.swapBalanceLabel}>
              Balance:{' '}
              {swapFromToken
                ? swapFromToken.balance.toFixed(
                    Math.min(swapFromToken.decimals, 4),
                  )
                : '—'}
            </Text>
          </View>

          {/* ── Direction button ── */}
          <TouchableOpacity
            style={styles.swapDirectionButton}
            onPress={handleSwapDirection}>
            <FontAwesome name="arrow-down" size={16} color={accentColor} />
          </TouchableOpacity>

          {/* ── To ── */}
          <View
            style={[
              styles.swapCard,
              swapToToken?.network === 'Solana'
                ? styles.swapCardSolana
                : styles.swapCardX1,
            ]}>
            <Text style={styles.tokenLabel}>To</Text>
            <View style={styles.tokenRow}>
              <TouchableOpacity
                style={styles.tokenSelector}
                onPress={() =>
                  !isLoadingSwapTokens && setShowTokenSelector('to')
                }
                disabled={isLoadingSwapTokens}>
                {renderTokenIcon(swapToToken)}
                <Text style={styles.swapTokenSymbol}>
                  {swapToToken?.symbol ?? 'Select'}
                </Text>
                <FontAwesome name="chevron-down" size={12} color="#888" />
              </TouchableOpacity>
              <View style={styles.inputContainer}>
                {isLoadingQuote ? (
                  <ActivityIndicator size="small" color="#38B6FF" />
                ) : (
                  <Text style={styles.outputAmount}>
                    {swapToAmount || '0.00'}
                  </Text>
                )}
              </View>
            </View>
            <Text style={styles.swapBalanceLabel}>
              Balance:{' '}
              {swapToToken
                ? swapToToken.balance.toFixed(Math.min(swapToToken.decimals, 4))
                : '—'}
            </Text>
          </View>

          {/* ── Exchange Rate ── */}
          {swapFromToken &&
            swapToToken &&
            (isLoadingQuote ? (
              <ActivityIndicator size="small" color="#38B6FF" />
            ) : swapQuoteRate ? (
              <Text style={styles.exchangeRateText}>
                1 {swapFromToken.symbol} = {swapQuoteRate.toFixed(4)}{' '}
                {swapToToken.symbol}
              </Text>
            ) : (
              <Text style={styles.noPoolText}>
                No liquidity pool found for this pair
              </Text>
            ))}

          {/* ── Swap Button ── */}
          <TouchableOpacity
            style={[
              styles.swapButton,
              canSwap
                ? {backgroundColor: accentColor}
                : styles.swapButtonDisabled,
            ]}
            disabled={!canSwap}
            onPress={handleConfirmSwap}>
            {isExecutingSwap ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.swapButtonText}>
                {!swapFromToken || !swapToToken
                  ? 'Select Tokens'
                  : !swapFromAmount || parseFloat(swapFromAmount) <= 0
                  ? 'Enter Amount'
                  : swapNetwork === 'Solana Mainnet'
                  ? 'Swap on Solana'
                  : 'Swap on X1'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Swap Confirm Modal */}
        {renderSwapConfirmModal()}

        {/* Swap Success Modal */}
        {renderSwapSuccessModal()}
      </View>
    );
  };

  // ── Send Token Selector ───────────────────────────────────────────────────────
  const renderSendTokenSelector = () => {
    const portfolioTokens = tokens.filter(t => t.rawBalance > 0);

    return (
      <Modal
        visible={showSendTokenSelector}
        animationType="slide"
        transparent
        onRequestClose={() => setShowSendTokenSelector(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Token</Text>
              <TouchableOpacity
                onPress={() => setShowSendTokenSelector(false)}
                style={styles.modalCloseButton}
                hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
                <FontAwesome name="times" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <FlatList
              data={portfolioTokens}
              keyExtractor={(item, index) =>
                `${item.network}:${item.mint ?? 'native'}:${index}`
              }
              renderItem={({item}) => (
                <TouchableOpacity
                  style={styles.tokenListItem}
                  onPress={() => handleSelectSendToken(item)}>
                  <View style={styles.tokenIconContainer}>
                    {item.icon_uri ? (
                      <Image
                        source={{uri: item.icon_uri}}
                        style={[
                          styles.tokenSelectorIcon,
                          {width: 36, height: 36, borderRadius: 18},
                        ]}
                      />
                    ) : (
                      <View
                        style={[
                          styles.swapTokenIconPlaceholder,
                          {width: 36, height: 36, borderRadius: 18},
                        ]}>
                        <Text style={styles.swapTokenIconText}>
                          {item.symbol.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View
                      style={[
                        styles.tokenSelectorNetworkBadge,
                        item.network === 'X1'
                          ? styles.networkBadgeX1
                          : styles.networkBadgeSolana,
                      ]}>
                      <Text style={styles.tokenSelectorNetworkBadgeText}>
                        {item.network === 'X1' ? 'X1' : 'SOL'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.tokenListInfo}>
                    <Text style={styles.tokenListSymbol}>{item.symbol}</Text>
                    <Text style={styles.tokenListName}>{item.name}</Text>
                  </View>
                  <Text style={styles.tokenListBalance}>{item.balance}</Text>
                </TouchableOpacity>
              )}
              style={styles.tokenFlatList}
            />
          </View>
        </View>
      </Modal>
    );
  };

  // ── Send History List ─────────────────────────────────────────────────────────
  const renderSendHistoryList = () => {
    // Filter by network tab
    const filteredHistory = sendHistory.filter(record => {
      if (recipientHistoryTab === 'All') {
        return true;
      }
      return record.network === recipientHistoryTab;
    });

    if (filteredHistory.length === 0) {
      return (
        <View style={styles.emptyHistoryState}>
          <FontAwesome name="clock-o" size={32} color="#444" />
          <Text style={styles.emptyHistoryText}>
            {recipientHistoryTab === 'All'
              ? 'No send history'
              : `No ${
                  recipientHistoryTab === 'X1' ? 'X1' : 'Solana'
                } send history`}
          </Text>
        </View>
      );
    }

    return (
      <ScrollView style={styles.historyList}>
        {filteredHistory.map((record, index) => {
          const timeAgo = formatTimeAgo(record.lastSentAt);
          const showFrequency = record.sendCount > 1;

          return (
            <TouchableOpacity
              key={`${record.address}:${record.network}:${index}`}
              style={styles.historyItem}
              onPress={() => handleSelectHistoryAddress(record)}>
              <View style={styles.historyIcon}>
                <FontAwesome name="location-arrow" size={14} color="#38B6FF" />
              </View>
              <View style={styles.historyInfo}>
                <Text style={styles.historyAddress}>
                  {formatAddress(record.address)}
                </Text>
                <Text style={styles.historyMeta}>
                  {record.tokenSymbol || '—'} · {timeAgo}
                  {showFrequency && ` · ${record.sendCount}x`}
                </Text>
              </View>
              {recipientHistoryTab === 'All' && (
                <View
                  style={[
                    styles.historyNetworkBadge,
                    record.network === 'X1'
                      ? styles.networkBadgeX1
                      : styles.networkBadgeSolana,
                  ]}>
                  <Text style={styles.networkBadgeText}>
                    {record.network === 'X1' ? 'X1' : 'SOL'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  };

  // ── Send Confirm Modal ────────────────────────────────────────────────────────
  const renderSendConfirmModal = () => {
    if (!sendToken) {
      return null;
    }

    const amount = parseFloat(sendAmount);
    const network = sendToken.network === 'X1' ? 'X1' : 'Solana';
    const accentColor = sendToken.network === 'Solana' ? '#9945FF' : '#38B6FF';

    return (
      <Modal
        visible={showSendConfirmModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowSendConfirmModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.swapSuccessModal}>
            <Text style={styles.swapSuccessTitle}>Confirm Send</Text>

            <View style={styles.swapSuccessRow}>
              <Text style={styles.swapSuccessLabel}>Token</Text>
              <View style={styles.swapSuccessValueRow}>
                <Text style={styles.swapSuccessValue}>{sendToken.symbol}</Text>
              </View>
            </View>

            <View style={styles.swapSuccessRow}>
              <Text style={styles.swapSuccessLabel}>Amount</Text>
              <View style={styles.swapSuccessValueRow}>
                <Text style={styles.swapSuccessValue}>
                  {amount} {sendToken.symbol}
                </Text>
              </View>
            </View>

            <View style={styles.swapSuccessRow}>
              <Text style={styles.swapSuccessLabel}>Recipient</Text>
              <View style={styles.swapSuccessValueRow}>
                <Text style={styles.swapSuccessValue}>
                  {formatAddress(sendRecipient)}
                </Text>
              </View>
            </View>

            <View style={styles.swapSuccessRow}>
              <Text style={styles.swapSuccessLabel}>Network</Text>
              <View style={styles.swapSuccessValueRow}>
                <Text style={styles.swapSuccessValue}>{network}</Text>
              </View>
            </View>

            <View style={styles.swapSuccessRow}>
              <Text style={styles.swapSuccessLabel}>Est. Fee</Text>
              <View style={styles.swapSuccessValueRow}>
                <Text style={styles.swapSuccessValue}>
                  {'~' +
                    (sendToken.network === 'X1'
                      ? '0.000005 XNT'
                      : '0.000005 SOL')}
                </Text>
              </View>
            </View>

            <View style={{flexDirection: 'row', gap: 12, marginTop: 24}}>
              <TouchableOpacity
                style={[
                  styles.swapSuccessCloseBtn,
                  {backgroundColor: '#333', flex: 1},
                ]}
                onPress={() => setShowSendConfirmModal(false)}>
                <Text style={styles.swapSuccessCloseBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.swapSuccessCloseBtn,
                  {backgroundColor: accentColor, flex: 1},
                ]}
                onPress={handleExecuteSend}>
                <Text style={styles.swapSuccessCloseBtnText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  // ── Send Success Modal ────────────────────────────────────────────────────────
  const renderSendSuccessModal = () => {
    const txId = sendSuccessTxId;
    const network = sendToken?.network || 'X1';
    const explorerBaseUrl =
      network === 'Solana'
        ? 'https://explorer.solana.com/tx/'
        : 'https://explorer.mainnet.x1.xyz/tx/';
    const explorerUrl = `${explorerBaseUrl}${txId}`;
    const accentColor = network === 'Solana' ? '#9945FF' : '#38B6FF';

    const copyToClipboard = (text: string, label: string) => {
      Clipboard.setString(text);
      Alert.alert('Copied', `${label} copied to clipboard`);
    };

    const openExplorer = () => {
      setWebViewUrl(explorerUrl);
      setShowWebView(true);
    };

    return (
      <Modal
        visible={sendSuccessModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setSendSuccessModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.swapSuccessModal}>
            <View style={styles.swapSuccessHeader}>
              <FontAwesome name="check-circle" size={48} color="#4CAF50" />
              <Text style={styles.swapSuccessTitle}>Send Successful!</Text>
            </View>

            <View style={styles.swapSuccessRow}>
              <Text style={styles.swapSuccessLabel}>Transaction ID</Text>
              <View style={styles.swapSuccessValueRow}>
                <Text style={styles.swapSuccessValue}>
                  {txId.slice(0, 8)}...{txId.slice(-8)}
                </Text>
                <TouchableOpacity
                  onPress={() => copyToClipboard(txId, 'Transaction ID')}
                  style={styles.swapSuccessCopyBtn}>
                  <FontAwesome name="copy" size={16} color={accentColor} />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={styles.swapSuccessRow}
              onPress={openExplorer}
              activeOpacity={0.7}>
              <Text style={styles.swapSuccessLabel}>Explorer</Text>
              <View style={styles.swapSuccessValueRow}>
                <Text style={styles.swapSuccessValue} numberOfLines={1}>
                  {explorerUrl.slice(0, 30)}...
                </Text>
                <FontAwesome
                  name="external-link"
                  size={16}
                  color={accentColor}
                />
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.swapSuccessCloseBtn,
                {backgroundColor: accentColor},
              ]}
              onPress={() => setSendSuccessModalVisible(false)}>
              <Text style={styles.swapSuccessCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  // ── Send Screen ───────────────────────────────────────────────────────────────
  const renderSendScreen = () => {
    const accentColor = sendToken?.network === 'Solana' ? '#9945FF' : '#38B6FF';

    // Calculate if send is valid
    let canSend = false;
    if (
      sendToken &&
      sendRecipient &&
      isAddressValid === true &&
      sendAmount &&
      !isSending
    ) {
      const amount = parseFloat(sendAmount);
      const maxAmount = sendToken.rawBalance; // rawBalance is already in token units
      canSend = amount > 0 && amount <= maxAmount;
    }

    return (
      <View style={styles.screenContainer}>
        {/* Token Selector Modal */}
        {renderSendTokenSelector()}

        {/* Confirm Modal */}
        {renderSendConfirmModal()}

        {/* Success Modal */}
        {renderSendSuccessModal()}

        {/* QR Scanner */}
        <QRScanner
          visible={showQRScanner}
          onClose={() => setShowQRScanner(false)}
          onScanSuccess={address => {
            setSendRecipient(address);
            setRecipientInputMode('manual');
            setShowQRScanner(false);
          }}
        />

        {/* Header */}
        <View style={styles.screenHeader}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setActiveTab('portfolio')}>
            <FontAwesome name="arrow-left" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Send</Text>
          {sendToken && (
            <View
              style={[
                styles.networkBadgePill,
                sendToken.network === 'X1'
                  ? styles.networkBadgePillX1
                  : styles.networkBadgePillSol,
              ]}>
              <Text style={styles.networkBadgePillText}>
                {sendToken.network === 'X1' ? 'X1' : 'SOL'}
              </Text>
            </View>
          )}
          {!sendToken && <View style={styles.placeholder} />}
        </View>

        <View style={styles.swapContent}>
          {/* Token Selector */}
          <Text style={styles.sendLabel}>Select Token</Text>
          <TouchableOpacity
            style={styles.sendTokenCard}
            onPress={() => setShowSendTokenSelector(true)}>
            {sendToken ? (
              <View style={styles.sendTokenRow}>
                <View style={styles.sendTokenLeft}>
                  {sendToken.icon_uri ? (
                    <Image
                      source={{uri: sendToken.icon_uri}}
                      style={styles.sendTokenIcon}
                    />
                  ) : (
                    <View style={styles.sendTokenPlaceholder}>
                      <Text style={styles.sendTokenPlaceholderText}>
                        {sendToken.symbol.charAt(0)}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.sendTokenSymbol}>{sendToken.symbol}</Text>
                </View>
                <Text style={styles.sendTokenBalance}>
                  Balance: {sendToken.balance}
                </Text>
              </View>
            ) : (
              <Text style={styles.sendTokenPlaceholderLabel}>
                Tap to select token
              </Text>
            )}
          </TouchableOpacity>

          {/* Recipient Address Section */}
          <Text style={styles.sendLabel}>Recipient Address</Text>

          {/* Mode Tab: Manual vs History */}
          <View style={styles.recipientModeTab}>
            <TouchableOpacity
              style={[
                styles.recipientModeButton,
                recipientInputMode === 'manual' && {
                  backgroundColor: accentColor,
                },
              ]}
              onPress={() => setRecipientInputMode('manual')}>
              <Text
                style={[
                  styles.recipientModeText,
                  recipientInputMode === 'manual' &&
                    styles.recipientModeTextActive,
                ]}>
                Manual Input
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.recipientModeButton,
                recipientInputMode === 'history' && {
                  backgroundColor: accentColor,
                },
              ]}
              onPress={() => setRecipientInputMode('history')}>
              <Text
                style={[
                  styles.recipientModeText,
                  recipientInputMode === 'history' &&
                    styles.recipientModeTextActive,
                ]}>
                Recent
              </Text>
            </TouchableOpacity>
          </View>

          {/* Manual Input Mode */}
          {recipientInputMode === 'manual' && (
            <>
              <View style={styles.sendRecipientRow}>
                <TextInput
                  style={styles.sendRecipientInput}
                  value={sendRecipient}
                  onChangeText={setSendRecipient}
                  placeholder="Enter recipient address"
                  placeholderTextColor="#555"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.sendIconButton}
                  onPress={() => setShowQRScanner(true)}>
                  <FontAwesome name="camera" size={18} color="#888" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.sendIconButton}
                  onPress={handlePasteAddress}>
                  <FontAwesome name="paste" size={18} color="#888" />
                </TouchableOpacity>
              </View>
              {isAddressValid === true && (
                <Text style={styles.addressValidText}>✓ Valid address</Text>
              )}
              {isAddressValid === false && (
                <Text style={styles.addressInvalidText}>✗ Invalid address</Text>
              )}
            </>
          )}

          {/* History Mode */}
          {recipientInputMode === 'history' && (
            <>
              {/* Network Tab */}
              <View style={styles.historyTabRow}>
                {(['X1', 'Solana', 'All'] as const).map(tab => {
                  const isActive = recipientHistoryTab === tab;
                  const activeColor =
                    tab === 'X1'
                      ? '#38B6FF'
                      : tab === 'Solana'
                      ? '#9945FF'
                      : '#F0B429';
                  return (
                    <TouchableOpacity
                      key={tab}
                      style={[
                        styles.historyTab,
                        isActive && {backgroundColor: activeColor},
                      ]}
                      onPress={() => setRecipientHistoryTab(tab)}>
                      <Text
                        style={[
                          styles.historyTabText,
                          isActive && styles.historyTabTextActive,
                        ]}>
                        {tab === 'X1'
                          ? 'X1 Mainnet'
                          : tab === 'Solana'
                          ? 'Solana'
                          : 'All'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* History List */}
              {renderSendHistoryList()}
            </>
          )}

          {/* Amount Input */}
          <Text style={styles.sendLabel}>Amount</Text>
          <View style={styles.sendAmountCard}>
            <TextInput
              style={styles.sendAmountInput}
              value={sendAmount}
              onChangeText={handleSendAmountChange}
              placeholder="0.00"
              placeholderTextColor="#555"
              keyboardType="decimal-pad"
              editable={!isSending}
            />
            {sendToken && (
              <Text style={styles.sendAmountUnit}>{sendToken.symbol}</Text>
            )}
          </View>

          {/* Balance validation */}
          {sendToken &&
            sendAmount &&
            (() => {
              const amount = parseFloat(sendAmount);
              const maxAmount = sendToken.rawBalance; // rawBalance is already in token units
              if (!isNaN(amount) && amount > maxAmount) {
                return (
                  <Text style={styles.addressInvalidText}>
                    ✗ Insufficient balance. Max:{' '}
                    {maxAmount.toFixed(Math.min(sendToken.decimals, 6))}{' '}
                    {sendToken.symbol}
                  </Text>
                );
              }
              return null;
            })()}

          {/* Quick Amount Buttons */}
          {sendToken && (
            <View style={styles.quickAmountRow}>
              <TouchableOpacity
                style={styles.quickAmountButton}
                onPress={() => handleQuickAmount(0.25)}>
                <Text style={[styles.quickAmountText, {color: accentColor}]}>
                  25%
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickAmountButton}
                onPress={() => handleQuickAmount(0.5)}>
                <Text style={[styles.quickAmountText, {color: accentColor}]}>
                  50%
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickAmountButton}
                onPress={() => handleQuickAmount(0.75)}>
                <Text style={[styles.quickAmountText, {color: accentColor}]}>
                  75%
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickAmountButton}
                onPress={() => handleQuickAmount(1.0)}>
                <Text style={[styles.quickAmountText, {color: accentColor}]}>
                  MAX
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Fee Estimate (placeholder for now) */}
          {sendFeeEstimate !== null && (
            <Text style={styles.sendFeeText}>
              Est. Fee: {sendFeeEstimate.toFixed(6)}{' '}
              {sendToken?.network === 'X1' ? 'XNT' : 'SOL'}
            </Text>
          )}

          {/* Send Button */}
          <TouchableOpacity
            style={[
              styles.swapButton,
              canSend
                ? {backgroundColor: accentColor}
                : styles.swapButtonDisabled,
            ]}
            disabled={!canSend}
            onPress={handleConfirmSend}>
            {isSending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.swapButtonText}>
                {!sendToken
                  ? 'Select Token'
                  : !sendRecipient || isAddressValid !== true
                  ? 'Enter Valid Address'
                  : !sendAmount || parseFloat(sendAmount) <= 0
                  ? 'Enter Amount'
                  : 'Send'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'send':
        return renderSendScreen();
      case 'swap':
        return renderSwapScreen();
      case 'receive':
        return renderReceiveScreen();
      case 'settings':
        return renderSettingsScreen();
      default:
        return renderWalletScreen();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={styles.contentInner}>
        {!connected ? (
          renderLoginScreen()
        ) : activeTab === 'swap' ||
          activeTab === 'send' ||
          activeTab === 'receive' ? (
          <View style={styles.swapScrollView}>
            <ScrollView
              style={styles.swapScrollView}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.swapScrollContent}>
              {renderContent()}
            </ScrollView>
            {renderBottomNav()}
          </View>
        ) : (
          <View style={styles.walletWrapper}>
            {renderContent()}
            {renderBottomNav()}
          </View>
        )}
      </View>
      {/* Account Picker Modal */}
      {renderAccountPickerModal()}
      {/* WebView Modal */}
      {renderWebViewModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  content: {
    flex: 1,
  },
  contentInner: {
    flex: 1,
  },
  swapScrollView: {
    flex: 1,
  },
  swapScrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  loginContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  logoContainer: {
    marginBottom: 24,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 12,
  },
  title: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 48,
  },
  hint: {
    color: '#555',
    fontSize: 12,
    marginTop: 24,
  },
  versionText: {
    color: '#444',
    fontSize: 11,
    marginTop: 8,
  },
  button: {
    backgroundColor: '#38B6FF',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    marginBottom: 16,
    width: 280,
    alignItems: 'center',
    minHeight: 56,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    flexWrap: 'nowrap',
  },
  walletWrapper: {
    flex: 1,
    justifyContent: 'space-between',
  },
  walletContainer: {
    flex: 1,
  },
  walletContent: {
    padding: 16,
    paddingBottom: 80,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addressText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  copyIcon: {
    color: '#38B6FF',
    fontSize: 12,
    marginLeft: 8,
  },
  settingsButton: {
    padding: 8,
  },
  settingsIcon: {
    color: '#888',
    fontSize: 14,
  },
  balanceCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  balanceLabel: {
    color: '#888',
    fontSize: 14,
    marginBottom: 8,
  },
  balanceValue: {
    color: '#fff',
    fontSize: 42,
    fontWeight: 'bold',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 24,
  },
  actionButton: {
    alignItems: 'center',
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionIconText: {
    color: '#38B6FF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  actionText: {
    color: '#888',
    fontSize: 12,
  },
  tokenSection: {
    flex: 1,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 14,
    marginBottom: 12,
  },
  tokenList: {
    flex: 1,
  },
  tokenItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  tokenIconContainer: {
    position: 'relative',
    marginRight: 12,
  },
  tokenIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#38B6FF',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  tokenImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  tokenPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tokenPlaceholderText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  tokenIconText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  tokenSelectorIcon: {
    backgroundColor: 'transparent',
  },
  networkBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  networkBadgeX1: {
    backgroundColor: '#38B6FF',
  },
  networkBadgeSolana: {
    backgroundColor: '#9945FF',
  },
  networkBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: 'bold',
  },
  tokenSelectorNetworkBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 3,
  },
  tokenSelectorNetworkBadgeText: {
    color: '#fff',
    fontSize: 7,
    fontWeight: 'bold',
  },
  tokenInfo: {
    flex: 1,
  },
  tokenSymbol: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  tokenName: {
    color: '#888',
    fontSize: 12,
  },
  tokenBalance: {
    alignItems: 'flex-end',
  },
  tokenBalanceText: {
    color: '#888',
    fontSize: 12,
  },
  tokenBalanceUsd: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    paddingVertical: 8,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  navIconImg: {
    marginBottom: 2,
  },
  navIcon: {
    color: '#888',
    fontSize: 12,
  },
  navIconActive: {
    color: '#38B6FF',
  },
  screenContainer: {
    flex: 1,
    padding: 16,
  },
  screenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  backButton: {
    padding: 8,
  },
  screenTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  placeholder: {
    width: 40,
  },
  settingsContent: {
    flex: 1,
  },
  settingItem: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  settingText: {
    color: '#fff',
    fontSize: 16,
  },
  dangerItem: {
    backgroundColor: '#2a1a1a',
  },
  dangerText: {
    color: '#FF4444',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#888',
    marginTop: 12,
  },
  swapContent: {
    marginTop: 24,
  },
  swapCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 12,
  },
  swapCardX1: {
    borderWidth: 1,
    borderColor: '#38B6FF',
  },
  swapCardSolana: {
    borderWidth: 1,
    borderColor: '#9945FF',
  },
  tokenRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  tokenLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 4,
  },
  tokenLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  tokenSelector: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  swapTokenSymbol: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginRight: 4,
  },
  swapTokenIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 6,
  },
  swapTokenIconPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#444',
    marginRight: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swapTokenIconText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  swapBalanceLabel: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
  swapBalanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  balanceSpinner: {
    marginTop: 2,
  },
  percentButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 2,
  },
  percentButton: {
    backgroundColor: '#333',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 4,
  },
  percentButtonText: {
    color: '#38B6FF',
    fontSize: 12,
    fontWeight: '600',
  },
  inputContainer: {
    flex: 1,
    alignItems: 'flex-end',
  },
  amountInput: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'right',
    minWidth: 120,
  },
  outputAmount: {
    color: '#888',
    fontSize: 24,
    fontWeight: '600',
  },
  swapDirectionButton: {
    alignSelf: 'center',
    backgroundColor: '#2a2a2a',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 4,
  },
  priceInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
  },
  priceLabel: {
    color: '#888',
    fontSize: 14,
  },
  priceValue: {
    color: '#fff',
    fontSize: 14,
  },
  exchangeRateText: {
    color: '#888',
    fontSize: 12,
    marginTop: 12,
    textAlign: 'center',
  },
  noPoolText: {
    color: '#ff6b6b',
    fontSize: 12,
    marginTop: 12,
    textAlign: 'center',
  },
  fromTabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  fromTab: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
  },
  fromTabActive: {
    backgroundColor: '#38B6FF',
  },
  fromTabText: {
    color: '#555',
    fontSize: 13,
    fontWeight: '600',
  },
  fromTabTextActive: {
    color: '#fff',
  },
  jupiterSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  jupiterSearchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    padding: 0,
  },
  swapButton: {
    backgroundColor: '#38B6FF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  swapButtonDisabled: {
    backgroundColor: '#333',
  },
  swapButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  poolInfo: {
    color: '#555',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#888',
    fontSize: 16,
  },
  // ── Token selector modal ──────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#111',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    height: '75%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  modalCloseButton: {
    padding: 8,
  },
  tokenFlatList: {
    flex: 1,
  },
  tokenGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0a0a0a',
  },
  networkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  networkDotX1: {
    backgroundColor: '#38B6FF',
  },
  networkDotSol: {
    backgroundColor: '#9945FF',
  },
  tokenGroupLabel: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tokenListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  tokenListItemDisabled: {
    opacity: 0.35,
  },
  tokenListInfo: {
    flex: 1,
    marginLeft: 12,
  },
  tokenListSymbol: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  tokenListName: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  tokenListBalance: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '500',
  },
  // ── Network badge pill ────────────────────────────────────
  networkBadgePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  networkBadgePillX1: {
    backgroundColor: '#38B6FF22',
    borderWidth: 1,
    borderColor: '#38B6FF',
  },
  networkBadgePillSol: {
    backgroundColor: '#9945FF22',
    borderWidth: 1,
    borderColor: '#9945FF',
  },
  networkBadgePillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  swapSuccessModal: {
    backgroundColor: '#111',
    borderRadius: 20,
    padding: 24,
    marginHorizontal: 20,
    width: '90%',
    alignSelf: 'center',
  },
  swapSuccessHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  swapSuccessTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    marginTop: 12,
  },
  swapSuccessRow: {
    marginBottom: 16,
  },
  swapSuccessLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 6,
  },
  swapSuccessValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 10,
  },
  swapSuccessValue: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  swapSuccessCopyBtn: {
    padding: 8,
    marginLeft: 8,
  },
  swapSuccessCloseBtn: {
    backgroundColor: '#38B6FF',
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 8,
    alignItems: 'center',
  },
  swapSuccessCloseBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // ── Send Styles ────────────────────────────────────────────────────────────
  sendLabel: {
    color: '#888',
    fontSize: 13,
    marginBottom: 8,
    marginTop: 16,
  },
  sendTokenCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  sendTokenRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sendTokenLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sendTokenIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  sendTokenPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendTokenPlaceholderText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '600',
  },
  sendTokenSymbol: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  sendTokenBalance: {
    color: '#888',
    fontSize: 14,
  },
  sendTokenPlaceholderLabel: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
  },

  // Recipient Mode Tab
  recipientModeTab: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 4,
    marginBottom: 12,
  },
  recipientModeButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  recipientModeText: {
    color: '#888',
    fontSize: 14,
  },
  recipientModeTextActive: {
    color: '#fff',
    fontWeight: '600',
  },

  // Recipient Input
  sendRecipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 8,
  },
  sendRecipientInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    paddingVertical: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  sendIconButton: {
    padding: 8,
  },
  addressValidText: {
    color: '#4CAF50',
    fontSize: 12,
    marginTop: 6,
  },
  addressInvalidText: {
    color: '#F44336',
    fontSize: 12,
    marginTop: 6,
  },

  // History Placeholder
  historyPlaceholder: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
  },
  historyPlaceholderText: {
    color: '#888',
    fontSize: 14,
  },

  // Amount Input
  sendAmountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 8,
  },
  sendAmountInput: {
    flex: 1,
    color: '#fff',
    fontSize: 24,
    fontWeight: '600',
    paddingVertical: 16,
  },
  sendAmountUnit: {
    color: '#888',
    fontSize: 16,
  },

  // Quick Amount Buttons
  quickAmountRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  quickAmountButton: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  quickAmountText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Fee Estimate
  sendFeeText: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
  },

  // History Tab
  historyTabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  historyTab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    alignItems: 'center',
  },
  historyTabText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '500',
  },
  historyTabTextActive: {
    color: '#fff',
    fontWeight: '600',
  },

  // History List
  historyList: {
    maxHeight: 200,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
  },
  historyIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  historyInfo: {
    flex: 1,
  },
  historyAddress: {
    color: '#fff',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 3,
  },
  historyMeta: {
    color: '#888',
    fontSize: 11,
  },
  historyNetworkBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    marginLeft: 8,
  },
  emptyHistoryState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  emptyHistoryText: {
    color: '#666',
    fontSize: 13,
    marginTop: 12,
  },
  // ── Receive Screen Styles ────────────────────────────────────────────────
  receiveContent: {
    flex: 1,
  },
  receiveContentInner: {
    padding: 20,
  },
  qrSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  qrCodeContainer: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
  },
  qrHint: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
  },
  addressSection: {
    marginBottom: 32,
  },
  addressLabel: {
    color: '#888',
    fontSize: 14,
    marginBottom: 8,
  },
  addressBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  addressFullText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    lineHeight: 20,
  },
  copyAddressButton: {
    backgroundColor: '#38B6FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
  },
  copyAddressText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  historySection: {
    marginBottom: 20,
  },
  historySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  historySectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  emptyHistoryContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyHistoryIcon: {
    marginBottom: 16,
  },
  emptyHistoryHint: {
    color: '#666',
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  historyItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  historyItemIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1a3a1a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  historyItemInfo: {
    flex: 1,
  },
  historyItemAmount: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  historyItemFrom: {
    color: '#888',
    fontSize: 13,
  },
  historyItemRight: {
    alignItems: 'flex-end',
  },
  historyItemTime: {
    color: '#888',
    fontSize: 12,
    marginBottom: 6,
  },
  historyItemNetworkBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  historyItemNetworkText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  // ── WebView styles ──────────────────────────────────────────────────────────
  webViewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  webViewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#111',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  webViewTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  webViewCloseButton: {
    padding: 8,
  },
  webView: {
    flex: 1,
    backgroundColor: '#000',
  },
  webViewLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  settingsSectionTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  settingsVersionText: {
    color: '#444',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 32,
    marginBottom: 16,
  },
  rpcSettingItem: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  rpcLabel: {
    color: '#aaa',
    fontSize: 12,
    marginBottom: 6,
  },
  rpcInput: {
    color: '#fff',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    backgroundColor: '#111',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  rpcCustomBadge: {
    color: '#38B6FF',
    fontSize: 11,
    marginTop: 4,
    fontWeight: '600',
  },
  rpcButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    marginBottom: 8,
  },
  rpcButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  rpcButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },

  // ── Account Picker styles ────────────────────────────────────────────────────
  accountPickerSubtitle: {
    color: '#888',
    fontSize: 13,
    marginBottom: 16,
    paddingHorizontal: 4,
    lineHeight: 18,
  },
  accountPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  accountPickerIcon: {
    marginRight: 14,
  },
  accountPickerInfo: {
    flex: 1,
  },
  accountPickerName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  accountPickerAddress: {
    color: '#38B6FF',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 2,
  },
  accountPickerPath: {
    color: '#555',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});

export default App;
