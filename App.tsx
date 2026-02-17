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
} from 'react-native';
import {
  SeedVault,
  SeedVaultPermissionAndroid,
} from '@solana-mobile/seed-vault-lib';
import FontAwesome from '@react-native-vector-icons/fontawesome';

import {
  rpcCall,
  USDC_MINT,
  WRAPPED_XNT_MINT,
  PoolPrice,
  fetchPoolFromAPI,
  PoolInfoFromAPI,
  getTokenBalance,
  getTokenMetadata,
  TokenMetadata,
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
      usdPrice: null,
      usdValue: null,
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
      usdPrice: null,
      usdValue: null,
    },
  ]);
  const [refreshing, setRefreshing] = useState(false);

  const [swapFromToken, setSwapFromToken] = useState<'XNT' | 'USDC'>('XNT');
  const [swapToToken, setSwapToToken] = useState<'XNT' | 'USDC'>('USDC');
  const [swapFromAmount, setSwapFromAmount] = useState('');
  const [swapToAmount, setSwapToAmount] = useState('');
  const [swapPrice, setSwapPrice] = useState<PoolPrice | null>(null);
  const [swapPoolApi, setSwapPoolApi] = useState<PoolInfoFromAPI | null>(null);
  const [isLoadingSwap, setIsLoadingSwap] = useState(false);
  const [xntBalance, setXntBalance] = useState<string>('0.00');
  const [usdcBalance, setUsdcBalance] = useState<string>('0.00');
  const [usdcMetadata, setUsdcMetadata] = useState<TokenMetadata | null>(null);
  const [slippage, setSlippage] = useState<number>(0.5);
  const [showSlippageModal, setShowSlippageModal] = useState(false);
  const [customSlippage, setCustomSlippage] = useState<string>('');

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

  useEffect(() => {
    const loadSwapPool = async () => {
      if (!publicKey) {
        return;
      }
      try {
        setIsLoadingSwap(true);

        const [nativeXntBal, usdcBal, poolApi, usdcMeta] = await Promise.all([
          rpcCall('getBalance', [publicKey]),
          getTokenBalance(publicKey, USDC_MINT),
          fetchPoolFromAPI(WRAPPED_XNT_MINT, USDC_MINT),
          getTokenMetadata(USDC_MINT),
        ]);

        setUsdcMetadata(usdcMeta);

        const xntBalanceLamports = nativeXntBal.value || 0;
        setXntBalance((xntBalanceLamports / 1e9).toFixed(4));
        setUsdcBalance((usdcBal / 1e6).toFixed(4));

        if (poolApi) {
          setSwapPoolApi(poolApi);

          const price: PoolPrice = {
            pool_address: poolApi.pool_address,
            token_0_mint: poolApi.token1_address,
            token_1_mint: poolApi.token2_address,
            reserve_0: poolApi.amount1_without_fee,
            reserve_1: poolApi.amount2_without_fee,
            price:
              poolApi.amount1_without_fee > 0
                ? poolApi.amount2_without_fee / poolApi.amount1_without_fee
                : 0,
            token_0_usd_price: null,
            token_1_usd_price: 1,
          };
          setSwapPrice(price);
        }
      } catch (error) {
        console.error('Failed to load swap pool:', error);
      } finally {
        setIsLoadingSwap(false);
      }
    };
    if (connected) {
      loadSwapPool();
    }
  }, [connected, publicKey]);

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
      // Set main balance from XNT (first native token)
      const xntToken = allTokens.find(
        t => t.symbol === 'XNT' && t.network === 'X1',
      );
      setBalance(xntToken ? xntToken.balance : '0.00');
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

  const calculateSwapOutput = useCallback(
    (amount: string) => {
      if (!amount || !swapPrice || !swapPoolApi) {
        setSwapToAmount('');
        return;
      }

      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        setSwapToAmount('');
        return;
      }

      const inputMint = swapFromToken === 'XNT' ? WRAPPED_XNT_MINT : USDC_MINT;
      const isInputToken0 = inputMint === swapPrice.token_0_mint;

      let output: number;
      if (isInputToken0) {
        output = amountNum * swapPrice.price;
      } else {
        output = amountNum / swapPrice.price;
      }

      setSwapToAmount(output.toFixed(6));
    },
    [swapPrice, swapPoolApi, swapFromToken],
  );

  const handleFromAmountChange = (text: string) => {
    setSwapFromAmount(text);
    calculateSwapOutput(text);
  };

  const handleSwapTokens = () => {
    const newFromToken = swapToToken;
    const newToToken = swapFromToken;
    setSwapFromToken(newFromToken);
    setSwapToToken(newToToken);
    setSwapFromAmount('');
    setSwapToAmount('');
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
        <Text style={styles.balanceValue}>{balance} XNT</Text>
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
              {token.usdValue !== null ? (
                <>
                  <Text style={styles.tokenBalanceText}>
                    $
                    {token.usdValue < 0.01
                      ? '<0.01'
                      : token.usdValue.toFixed(2)}
                  </Text>
                  <Text style={styles.tokenBalanceUsd}>
                    {token.balance} {token.symbol}
                  </Text>
                </>
              ) : (
                <Text style={styles.tokenBalanceText}>{token.balance}</Text>
              )}
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
        <TouchableOpacity style={styles.settingItem} onPress={disconnect}>
          <Text style={styles.settingText}>Disconnect Wallet</Text>
        </TouchableOpacity>
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

  const renderSwapScreen = () => (
    <View style={styles.screenContainer}>
      <View style={styles.screenHeader}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => setActiveTab('portfolio')}>
          <FontAwesome name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Swap</Text>
        <View style={styles.placeholder} />
      </View>

      {isLoadingSwap ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#38B6FF" />
          <Text style={styles.loadingText}>Loading pool...</Text>
        </View>
      ) : swapPrice ? (
        <View style={styles.swapContent}>
          <View style={styles.swapCard}>
            <View style={styles.tokenRow}>
              <View style={styles.tokenInfo}>
                <Text style={styles.tokenLabel}>From</Text>
                <TouchableOpacity
                  style={styles.tokenSelector}
                  onPress={() =>
                    setSwapFromToken(swapFromToken === 'XNT' ? 'USDC' : 'XNT')
                  }>
                  {swapFromToken === 'XNT' ? (
                    <Image
                      source={{
                        uri: 'https://app.xdex.xyz/assets/images/tokens/x1.webp',
                      }}
                      style={styles.swapTokenIcon}
                    />
                  ) : swapFromToken === 'USDC' && usdcMetadata?.logo_uri ? (
                    <Image
                      source={{uri: usdcMetadata.logo_uri}}
                      style={styles.swapTokenIcon}
                    />
                  ) : (
                    <View style={styles.swapTokenIconPlaceholder}>
                      <Text style={styles.swapTokenIconText}>U</Text>
                    </View>
                  )}
                  <Text style={styles.swapTokenSymbol}>
                    {swapFromToken === 'XNT' ? 'XNT' : 'USDC.X'}
                  </Text>
                  <FontAwesome name="chevron-down" size={12} color="#888" />
                </TouchableOpacity>
                <Text style={styles.tokenBalance}>
                  Balance: {swapFromToken === 'XNT' ? xntBalance : usdcBalance}
                </Text>
              </View>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.amountInput}
                  value={swapFromAmount}
                  onChangeText={handleFromAmountChange}
                  placeholder="0.00"
                  placeholderTextColor="#888"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <View style={styles.percentButtons}>
              {[25, 50, 75, 100].map(percent => (
                <TouchableOpacity
                  key={percent}
                  style={styles.percentButton}
                  onPress={() => {
                    const tokenBalance =
                      swapFromToken === 'XNT' ? xntBalance : usdcBalance;
                    if (parseFloat(tokenBalance) > 0) {
                      const amount = (parseFloat(tokenBalance) * percent) / 100;
                      const decimals = swapFromToken === 'XNT' ? 4 : 2;
                      setSwapFromAmount(amount.toFixed(decimals));
                      calculateSwapOutput(amount.toFixed(decimals));
                    }
                  }}>
                  <Text style={styles.percentButtonText}>{percent}%</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={styles.swapDirectionButton}
              onPress={handleSwapTokens}>
              <FontAwesome name="arrow-down" size={16} color="#38B6FF" />
            </TouchableOpacity>

            <View style={styles.tokenRow}>
              <View style={styles.tokenInfo}>
                <Text style={styles.tokenLabel}>To</Text>
                <TouchableOpacity
                  style={styles.tokenSelector}
                  onPress={() =>
                    setSwapToToken(swapToToken === 'XNT' ? 'USDC' : 'XNT')
                  }>
                  {swapToToken === 'XNT' ? (
                    <Image
                      source={{
                        uri: 'https://app.xdex.xyz/assets/images/tokens/x1.webp',
                      }}
                      style={styles.swapTokenIcon}
                    />
                  ) : swapToToken === 'USDC' && usdcMetadata?.logo_uri ? (
                    <Image
                      source={{uri: usdcMetadata.logo_uri}}
                      style={styles.swapTokenIcon}
                    />
                  ) : (
                    <View style={styles.swapTokenIconPlaceholder}>
                      <Text style={styles.swapTokenIconText}>U</Text>
                    </View>
                  )}
                  <Text style={styles.swapTokenSymbol}>
                    {swapToToken === 'XNT' ? 'XNT' : 'USDC.X'}
                  </Text>
                  <FontAwesome name="chevron-down" size={12} color="#888" />
                </TouchableOpacity>
                <Text style={styles.tokenBalance}>
                  Balance: {swapToToken === 'XNT' ? xntBalance : usdcBalance}
                </Text>
              </View>
              <View style={styles.inputContainer}>
                <Text style={styles.outputAmount}>
                  {swapToAmount || '0.00'}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.priceInfo}>
            <Text style={styles.priceLabel}>Price</Text>
            <Text style={styles.priceValue}>
              1 {swapFromToken === 'XNT' ? 'XNT' : 'USDC.X'} ={' '}
              {swapPrice.price.toFixed(6)}{' '}
              {swapToToken === 'XNT' ? 'XNT' : 'USDC.X'}
            </Text>
          </View>

          <View style={styles.slippageRow}>
            <Text style={styles.slippageLabel}>Slippage</Text>
            <TouchableOpacity
              style={styles.slippageButton}
              onPress={() => setShowSlippageModal(true)}>
              <Text style={styles.slippageButtonText}>
                {slippage < 0 ? `${customSlippage}%` : `${slippage}%`}
              </Text>
              <FontAwesome name="chevron-down" size={12} color="#888" />
            </TouchableOpacity>
          </View>

          {showSlippageModal && (
            <View style={styles.slippageModal}>
              {[0.5, 1, 2, 5].map(value => (
                <TouchableOpacity
                  key={value}
                  style={[
                    styles.slippageOption,
                    slippage === value && styles.slippageOptionActive,
                  ]}
                  onPress={() => {
                    setSlippage(value);
                    setShowSlippageModal(false);
                  }}>
                  <Text
                    style={[
                      styles.slippageOptionText,
                      slippage === value && styles.slippageOptionTextActive,
                    ]}>
                    {value}%
                  </Text>
                </TouchableOpacity>
              ))}
              <View style={styles.slippageCustomRow}>
                <Text style={styles.slippageCustomLabel}>Custom:</Text>
                <TextInput
                  style={styles.slippageCustomInput}
                  value={customSlippage}
                  onChangeText={text => {
                    const num = parseFloat(text);
                    if (!isNaN(num) && num >= 0 && num <= 100) {
                      setCustomSlippage(text);
                      setSlippage(-1);
                    }
                  }}
                  onEndEditing={() => setShowSlippageModal(false)}
                  placeholder="0"
                  placeholderTextColor="#555"
                  keyboardType="decimal-pad"
                />
                <Text style={styles.slippageCustomLabel}>%</Text>
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.swapButton,
              (!swapFromAmount || parseFloat(swapFromAmount) <= 0) &&
                styles.swapButtonDisabled,
            ]}
            disabled={!swapFromAmount || parseFloat(swapFromAmount) <= 0}>
            <Text style={styles.swapButtonText}>Swap</Text>
          </TouchableOpacity>

          <Text style={styles.poolInfo}>
            Pool: {swapPoolApi?.pool_address.slice(0, 8)}...
            {swapPoolApi?.pool_address.slice(-4)}
          </Text>
        </View>
      ) : (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>No XNT/USDC pool available</Text>
        </View>
      )}
    </View>
  );

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
          <ScrollView
            style={styles.swapScrollView}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.swapScrollContent}>
            {renderContent()}
            {renderBottomNav()}
          </ScrollView>
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
    width: 240,
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
  tokenBalanceText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  tokenBalanceUsd: {
    color: '#888',
    fontSize: 12,
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
  tokenBalance: {
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
  slippageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
  },
  slippageLabel: {
    color: '#888',
    fontSize: 14,
  },
  slippageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  slippageButtonText: {
    color: '#fff',
    fontSize: 14,
    marginRight: 4,
  },
  slippageModal: {
    backgroundColor: '#222',
    borderRadius: 8,
    marginTop: 8,
    padding: 8,
  },
  slippageOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  slippageOptionActive: {
    backgroundColor: '#38B6FF',
  },
  slippageOptionText: {
    color: '#fff',
    fontSize: 16,
  },
  slippageOptionTextActive: {
    color: '#000',
    fontWeight: 'bold',
  },
  slippageCustomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#444',
  },
  slippageCustomLabel: {
    color: '#888',
    fontSize: 14,
    marginRight: 8,
  },
  slippageCustomInput: {
    backgroundColor: '#333',
    color: '#fff',
    fontSize: 14,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    width: 60,
    textAlign: 'center',
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
});

export default App;
