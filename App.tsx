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
} from 'react-native';
import {PermissionsAndroid, Platform} from 'react-native';
import {
  SeedVault,
  SeedVaultPermissionAndroid,
} from '@solana-mobile/seed-vault-lib';

const RPC_URL = 'https://rpc.mainnet.x1.xyz';

const rpcCall = async (method: string, params: any[] = []): Promise<any> => {
  const response = await fetch(RPC_URL, {
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

function App(): JSX.Element {
  const [connected, setConnected] = useState(false);
  const [accountInfo, setAccountInfo] = useState<string>('');
  const [balance, setBalance] = useState<string>('');
  const [currentAuthToken, setCurrentAuthToken] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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

  const fetchBalance = async (publicKey: string): Promise<void> => {
    try {
      const result = await rpcCall('getBalance', [publicKey]);
      const balanceLamports = result.value;
      const balanceXNT = balanceLamports / 1000000000;
      setBalance(balanceXNT.toFixed(6));
    } catch (error) {
      console.error('Failed to fetch balance:', error);
      setBalance('Failed to fetch');
    }
  };

  const getAccountInfo = async (authToken: number) => {
    const accounts = await SeedVault.getUserWallets(authToken);
    if (accounts.length > 0) {
      const account = accounts[0];
      const info = `Public Key: ${account.publicKeyEncoded}\nDerivation Path: ${account.derivationPath}`;
      setAccountInfo(info);
      setConnected(true);
      setCurrentAuthToken(authToken);

      await fetchBalance(account.publicKeyEncoded);
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
    setAccountInfo('');
    setBalance('');
    setCurrentAuthToken(null);
  };

  const deauthorize = () => {
    Alert.alert(
      'Deauthorize',
      'Are you sure you want to remove this wallet authorization?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Deauthorize',
          style: 'destructive',
          onPress: () => {
            if (currentAuthToken !== null) {
              SeedVault.deauthorizeSeed(currentAuthToken);
              disconnect();
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {!connected ? (
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
        ) : (
          <View style={styles.infoContainer}>
            <Text style={styles.rpcText}>RPC: {RPC_URL}</Text>
            <Text style={styles.infoText}>{accountInfo}</Text>
            <Text style={styles.balanceText}>Balance: {balance} XNT</Text>
            <TouchableOpacity style={styles.button} onPress={disconnect}>
              <Text style={styles.buttonText}>Disconnect</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.deauthButton]}
              onPress={deauthorize}>
              <Text style={styles.buttonText}>Remove Authorization</Text>
            </TouchableOpacity>
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
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loginContainer: {
    alignItems: 'center',
    width: '100%',
  },
  logoContainer: {
    marginBottom: 24,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 16,
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
    borderRadius: 30,
    marginBottom: 16,
    minWidth: 200,
    alignItems: 'center',
    minHeight: 56,
  },
  deauthButton: {
    backgroundColor: '#FF4444',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  infoContainer: {
    alignItems: 'center',
    width: '100%',
  },
  rpcText: {
    color: '#888',
    fontSize: 12,
    marginBottom: 16,
  },
  infoText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
  balanceText: {
    color: '#00FF00',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
  },
});

export default App;
