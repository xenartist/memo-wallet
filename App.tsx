import React, {useState, useEffect, useCallback} from 'react';
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
  JUPITER_SOL_MINT,
  JUPITER_DEFAULT_SOL_TOKENS,
  fetchJupiterOrder,
  searchJupiterTokens,
  executeJupiterSwap,
} from './src/swap';
import {fetchAllTokens, PortfolioToken} from './src/portfolio';

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
  const [swapTokenList, setSwapTokenList] = useState<SwapToken[]>([]);
  const [swapPoolList, setSwapPoolList] = useState<PoolPair[]>([]);
  const [swapFromToken, setSwapFromToken] = useState<SwapToken | null>(null);
  const [swapToToken, setSwapToToken] = useState<SwapToken | null>(null);
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
  const [jupiterSearchQuery, setJupiterSearchQuery] = useState('');
  const [jupiterSearchResults, setJupiterSearchResults] = useState<SwapToken[]>(
    [],
  );
  const [isSearchingJupiter, setIsSearchingJupiter] = useState(false);
  const [swapSuccessModalVisible, setSwapSuccessModalVisible] = useState(false);
  const [swapSuccessTxId, setSwapSuccessTxId] = useState('');

  useEffect(() => {
    const initAuth = async () => {
      try {
        const isAvailable = await SeedVault.isSeedVaultAvailable(false);
        if (!isAvailable) {
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

  // Load swap token list whenever we enter the swap tab or the network changes
  useEffect(() => {
    if (!connected || !publicKey || activeTab !== 'swap') {
      return;
    }
    const loadTokens = async () => {
      setIsLoadingSwapTokens(true);
      try {
        const {tokens: swapToks, pools: swapPools} = await getSwapTokens(
          publicKey,
          swapNetwork,
        );
        setSwapTokenList(swapToks);
        setSwapPoolList(swapPools);
        // Default from: XNT (must have balance)
        if (swapToks.length >= 1 && !swapFromToken) {
          const xntToken = swapToks.find(
            t => t.symbol === 'XNT' && t.balance > 0,
          );
          setSwapFromToken(
            xntToken || swapToks.find(t => t.balance > 0) || null,
          );
        }
        // Default to: MEMO
        if (swapToks.length >= 1 && !swapToToken) {
          const memoToken = swapToks.find(t => t.symbol === 'MEMO');
          if (memoToken) {
            setSwapToToken(memoToken);
          } else {
            // Fallback: first token that is different from from token
            const toDefault = swapToks.find(
              t => t.mint !== (swapFromToken?.mint ?? swapToks[0]?.mint),
            );
            if (toDefault) {
              setSwapToToken(toDefault);
            }
          }
        }
      } catch (err) {
        console.error('[App] Failed to load swap tokens:', err);
      } finally {
        setIsLoadingSwapTokens(false);
      }
    };
    loadTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey, swapNetwork, activeTab]);

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

  const getAccountInfo = async (authToken: number) => {
    const accounts = await SeedVault.getUserWallets(authToken);
    if (accounts.length > 0) {
      const account = accounts[0];
      setPublicKey(account.publicKeyEncoded);
      setConnected(true);
      setCurrentAuthToken(authToken);

      await fetchBalances(account.publicKeyEncoded);
    } else {
      Alert.alert('No Accounts', 'No accounts found in Seed Vault');
    }
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
      // If user has entered an amount, recalculate locally
      if (swapFromAmount && parseFloat(swapFromAmount) > 0) {
        const decimals = Math.min(swapToToken.decimals, 6);
        const output = rate * parseFloat(swapFromAmount);
        setSwapToAmount(output.toFixed(decimals));
      }
    } catch (err) {
      console.error('[App] Quote rate error:', err);
      setSwapQuoteRate(null);
    } finally {
      setIsLoadingQuote(false);
    }
  }, [swapFromToken, swapToToken, swapNetwork, swapFromAmount]);

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

    // Set up 30-second interval to refresh quote
    const intervalId = setInterval(() => {
      fetchQuoteRate();
    }, 30000);

    return () => clearInterval(intervalId);
  }, [swapFromToken, swapToToken, swapNetwork, fetchQuoteRate]);

  const handleFromAmountChange = (text: string) => {
    setSwapFromAmount(text);
    calculateOutputAmount(text);
  };

  const handleSwapDirection = () => {
    const prev = swapFromToken;
    setSwapFromToken(swapToToken);
    setSwapToToken(prev);
    setSwapFromAmount('');
    setSwapToAmount('');
  };

  const handleSelectFromToken = (token: SwapToken) => {
    setSwapFromToken(token);
    setSwapNetwork(token.network === 'X1' ? 'X1 Mainnet' : 'Solana Mainnet');
    // Clear to-token if it's same as newly selected from-token
    if (swapToToken?.mint === token.mint) {
      setSwapToToken(null);
    }
    setSwapFromAmount('');
    setSwapToAmount('');
    setShowTokenSelector(null);
  };

  const handleSelectToToken = (token: SwapToken) => {
    setSwapToToken(token);
    setSwapFromAmount('');
    setSwapToAmount('');
    setShowTokenSelector(null);
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
        <TouchableOpacity style={styles.actionButton}>
          <View style={styles.actionIcon}>
            <FontAwesome name="arrow-up" size={20} color="#38B6FF" />
          </View>
          <Text style={styles.actionText}>Send</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton}>
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
      <View style={styles.settingsContent}>
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
      </View>
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

  // ── Token Selector Modal ─────────────────────────────────────────────────────
  const renderTokenSelectorModal = () => {
    const isFrom = showTokenSelector === 'from';
    const onSelect = isFrom ? handleSelectFromToken : handleSelectToToken;
    const disabledMint = isFrom ? swapToToken?.mint : swapFromToken?.mint;

    // Determine if this is a Solana-To selector (Jupiter path)
    const isJupiterToSelector = !isFrom && swapNetwork === 'Solana Mainnet';

    // From: portfolio tokens (local, balance > 0)
    const fromTokensFromPortfolio: SwapToken[] = tokens
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
      }));

    // xDEX To list (X1 network)
    const fromApiMint = swapFromToken?.apiMint ?? '';
    const xdexToTokens = swapTokenList.filter(t => {
      if (!swapFromToken) {
        return false;
      }
      const candidateApiMint = t.apiMint;
      return swapPoolList.some(
        pool =>
          pool.status === 0 &&
          ((pool.token1Mint === fromApiMint &&
            pool.token2Mint === candidateApiMint) ||
            (pool.token2Mint === fromApiMint &&
              pool.token1Mint === candidateApiMint)),
      );
    });

    // Jupiter To list: search results if query present, else default list
    const jupiterToTokens = isJupiterToSelector
      ? jupiterSearchQuery.trim().length > 0
        ? jupiterSearchResults
        : JUPITER_DEFAULT_SOL_TOKENS
      : [];

    const filteredTokens = isFrom
      ? fromTokensFromPortfolio
      : isJupiterToSelector
      ? jupiterToTokens
      : xdexToTokens;

    const x1Tokens = filteredTokens.filter(t => t.network === 'X1');
    const solTokens = filteredTokens.filter(t => t.network === 'Solana');

    return (
      <Modal
        visible={showTokenSelector !== null}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setShowTokenSelector(null);
          setJupiterSearchQuery('');
          setJupiterSearchResults([]);
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
                }}>
                <FontAwesome name="times" size={20} color="#fff" />
              </TouchableOpacity>
            </View>

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
                ...(x1Tokens.length > 0
                  ? [{type: 'header', label: 'X1 Mainnet', key: 'h-x1'}]
                  : []),
                ...x1Tokens.map(t => ({type: 'token', token: t, key: t.mint})),
                ...(solTokens.length > 0
                  ? [{type: 'header', label: 'Solana Mainnet', key: 'h-sol'}]
                  : []),
                ...solTokens.map(t => ({type: 'token', token: t, key: t.mint})),
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
                const disabled = t.mint === disabledMint;
                return (
                  <TouchableOpacity
                    style={[
                      styles.tokenListItem,
                      disabled && styles.tokenListItemDisabled,
                    ]}
                    onPress={() => !disabled && onSelect(t)}
                    disabled={disabled}>
                    {renderTokenIcon(t, 36)}
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

  // ── Swap Success Modal ────────────────────────────────────────────────────────
  const renderSwapSuccessModal = () => {
    const txId = swapSuccessTxId;
    const explorerBaseUrl =
      swapNetwork === 'Solana Mainnet'
        ? 'https://explorer.solana.com/tx/'
        : 'https://explorer.mainnet.x1.xyz/tx/';
    const explorerUrl = `${explorerBaseUrl}${txId}`;

    const copyToClipboard = (text: string, label: string) => {
      Clipboard.setString(text);
      Alert.alert('Copied', `${label} copied to clipboard`);
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
                  <FontAwesome name="copy" size={16} color="#38B6FF" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Explorer URL */}
            <View style={styles.swapSuccessRow}>
              <Text style={styles.swapSuccessLabel}>Explorer</Text>
              <View style={styles.swapSuccessValueRow}>
                <Text style={styles.swapSuccessValue} numberOfLines={1}>
                  {explorerUrl.slice(0, 30)}...
                </Text>
                <TouchableOpacity
                  onPress={() => copyToClipboard(explorerUrl, 'Explorer URL')}
                  style={styles.swapSuccessCopyBtn}>
                  <FontAwesome name="copy" size={16} color="#38B6FF" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Close Button */}
            <TouchableOpacity
              style={styles.swapSuccessCloseBtn}
              onPress={() => setSwapSuccessModalVisible(false)}>
              <Text style={styles.swapSuccessCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  // ── Swap Screen ───────────────────────────────────────────────────────────────
  const renderSwapScreen = () => {
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

        {isLoadingSwapTokens ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#38B6FF" />
            <Text style={styles.loadingText}>Loading tokens...</Text>
          </View>
        ) : (
          <View style={styles.swapContent}>
            {/* ── From ── */}
            <View style={styles.swapCard}>
              <Text style={styles.tokenLabel}>From</Text>
              <View style={styles.tokenRow}>
                <TouchableOpacity
                  style={styles.tokenSelector}
                  onPress={() =>
                    !isLoadingSwapTokens && setShowTokenSelector('from')
                  }
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
              <FontAwesome name="arrow-down" size={16} color="#38B6FF" />
            </TouchableOpacity>

            {/* ── To ── */}
            <View style={styles.swapCard}>
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
                  ? swapToToken.balance.toFixed(
                      Math.min(swapToToken.decimals, 4),
                    )
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
              style={[styles.swapButton, !canSwap && styles.swapButtonDisabled]}
              disabled={!canSwap}
              onPress={handleExecuteSwap}>
              {isExecutingSwap ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.swapButtonText}>
                  {!swapFromToken || !swapToToken
                    ? 'Select Tokens'
                    : !swapFromAmount || parseFloat(swapFromAmount) <= 0
                    ? 'Enter Amount'
                    : 'Swap'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Swap Success Modal */}
        {renderSwapSuccessModal()}
      </View>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'swap':
        return renderSwapScreen();
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
        ) : activeTab === 'swap' ? (
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
});

export default App;
