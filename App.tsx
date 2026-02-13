import React, {useState} from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Alert,
  View,
} from 'react-native';
import {PermissionsAndroid, Platform} from 'react-native';
import {SeedVault, SeedVaultPermissionAndroid} from '@solana-mobile/seed-vault-lib';

function App(): JSX.Element {
  const [connected, setConnected] = useState(false);
  const [accountInfo, setAccountInfo] = useState<string>('');

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

  const connectSeedVault = async () => {
    try {
      const hasPermission = await checkAndRequestPermission();
      if (!hasPermission) {
        return;
      }

      const result = await SeedVault.authorizeNewSeed();

      if (result) {
        const authToken = result.authToken;
        const accounts = await SeedVault.getUserWallets(authToken);

        if (accounts.length > 0) {
          const account = accounts[0];
          const info = `Connected!\n\nPublic Key: ${account.publicKeyEncoded}\nDerivation Path: ${account.derivationPath}`;
          setAccountInfo(info);
          setConnected(true);
        } else {
          Alert.alert('No Accounts', 'No accounts found in Seed Vault');
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Alert.alert('Error', `Failed to connect: ${errorMessage}`);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {!connected ? (
          <TouchableOpacity style={styles.button} onPress={connectSeedVault}>
            <Text style={styles.buttonText}>Connect Seed Vault</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.infoContainer}>
            <Text style={styles.infoText}>{accountInfo}</Text>
            <TouchableOpacity
              style={styles.button}
              onPress={() => {
                setConnected(false);
                setAccountInfo('');
              }}>
              <Text style={styles.buttonText}>Disconnect</Text>
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
  button: {
    backgroundColor: '#9945FF',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 30,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  infoContainer: {
    alignItems: 'center',
  },
  infoText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 24,
  },
});

export default App;
