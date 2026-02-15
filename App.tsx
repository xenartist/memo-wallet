import React, {useState} from 'react';
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
} from 'react-native';
import {
  SeedVault,
  SeedVaultPermissionAndroid,
} from '@solana-mobile/seed-vault-lib';

const SOLANA_RPC_URL = 'https://rpc.mainnet.x1.xyz';

const rpcCall = async (
  method: string,
  params: any[] = [],
  rpcUrl: string = SOLANA_RPC_URL,
): Promise<any> => {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message);
  }
  return data.result;
};

interface TokenInfo {
  symbol: string;
  name: string;
  balance: string;
  icon?: number;
}

function App(): JSX.Element {
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string>('');
  const [balance, setBalance] = useState<string>('');
  const [currentAuthToken, setCurrentAuthToken] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [tokens, setTokens] = useState<TokenInfo[]>([
    {symbol: 'XNT', name: 'XNT', balance: '0.00'},
    {symbol: 'SOL', name: 'Solana', balance: '0.00'},
  ]);

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
      const [xntResult, solResult] = await Promise.all([
        rpcCall('getBalance', [pk]),
        rpcCall('getBalance', [pk], 'https://api.mainnet-beta.solana.com'),
      ]);
      const balanceXNT = xntResult.value / 1000000000;
      const balanceSOL = solResult.value / 1000000000;
      setBalance(balanceXNT.toFixed(4));
      setTokens([
        {symbol: 'XNT', name: 'XNT', balance: balanceXNT.toFixed(4)},
        {symbol: 'SOL', name: 'Solana', balance: balanceSOL.toFixed(4)},
      ]);
    } catch (error) {
      console.error('Failed to fetch balances:', error);
      setBalance('Failed to fetch');
    }
  };

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

  const disconnect = () => {
    setConnected(false);
    setPublicKey('');
    setBalance('');
    setCurrentAuthToken(null);
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
        onPress={connectSeedVault}
        disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Connect Seed Vault</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.hint}>Powered by X1 & Solana</Text>
    </View>
  );

  const renderWalletScreen = () => (
    <View style={styles.walletContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={copyAddress} style={styles.addressContainer}>
          <Text style={styles.addressText}>{formatAddress(publicKey)}</Text>
          <Text style={styles.copyIcon}> Copy</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.settingsButton}>
          <Text style={styles.settingsIcon}>Settings</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Total Balance</Text>
        <Text style={styles.balanceValue}>{balance} XNT</Text>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionButton}>
          <View style={styles.actionIcon}>
            <Text style={styles.actionIconText}>↑</Text>
          </View>
          <Text style={styles.actionText}>Send</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton}>
          <View style={styles.actionIcon}>
            <Text style={styles.actionIconText}>↓</Text>
          </View>
          <Text style={styles.actionText}>Receive</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton}>
          <View style={styles.actionIcon}>
            <Text style={styles.actionIconText}>⇄</Text>
          </View>
          <Text style={styles.actionText}>Swap</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tokenSection}>
        <Text style={styles.sectionTitle}>Assets</Text>
        <ScrollView style={styles.tokenList}>
          {tokens.map((token, index) => (
            <View key={index} style={styles.tokenItem}>
              <View style={styles.tokenIcon}>
                <Text style={styles.tokenIconText}>{token.symbol[0]}</Text>
              </View>
              <View style={styles.tokenInfo}>
                <Text style={styles.tokenSymbol}>{token.symbol}</Text>
                <Text style={styles.tokenName}>{token.name}</Text>
              </View>
              <View style={styles.tokenBalance}>
                <Text style={styles.tokenBalanceText}>{token.balance}</Text>
                <Text style={styles.tokenBalanceUsd}>${token.balance}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );

  const renderBottomNav = () => (
    <View style={styles.bottomNav}>
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => setActiveTab('home')}>
        <Text
          style={[
            styles.navIcon,
            activeTab === 'home' && styles.navIconActive,
          ]}>
          Home
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => setActiveTab('send')}>
        <Text style={styles.navIcon}>Send</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => setActiveTab('receive')}>
        <Text style={styles.navIcon}>Receive</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => setActiveTab('settings')}>
        <Text style={styles.navIcon}>Settings</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSettingsScreen = () => (
    <View style={styles.settingsContainer}>
      <Text style={styles.settingsTitle}>Settings</Text>
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
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'settings':
        return renderSettingsScreen();
      default:
        return renderWalletScreen();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={styles.content}>
        {!connected ? (
          renderLoginScreen()
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
    minWidth: 200,
    alignItems: 'center',
    minHeight: 56,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  walletWrapper: {
    flex: 1,
  },
  walletContainer: {
    flex: 1,
    padding: 16,
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
  tokenIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#38B6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  tokenIconText: {
    color: '#fff',
    fontSize: 16,
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
  navIcon: {
    color: '#888',
    fontSize: 12,
  },
  navIconActive: {
    color: '#38B6FF',
  },
  settingsContainer: {
    flex: 1,
    padding: 16,
  },
  settingsTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
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
});

export default App;
