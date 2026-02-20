import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import {Camera, CameraType} from 'react-native-camera-kit';
import FontAwesome from 'react-native-vector-icons/FontAwesome';

import {isValidSolanaAddress} from './send';

interface QRScannerProps {
  visible: boolean;
  onClose: () => void;
  onScanSuccess: (address: string) => void;
}

export default function QRScanner({
  visible,
  onClose,
  onScanSuccess,
}: QRScannerProps): JSX.Element {
  const [scanned, setScanned] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);

  // Request camera permission on Android
  React.useEffect(() => {
    const requestPermission = async (): Promise<void> => {
      if (Platform.OS === 'android') {
        try {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.CAMERA,
            {
              title: 'Camera Permission',
              message: 'This app needs camera access to scan QR codes.',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
            },
          );
          setHasPermission(granted === PermissionsAndroid.RESULTS.GRANTED);
        } catch (err) {
          console.warn('[QRScanner] Permission error:', err);
          setHasPermission(false);
        }
      } else {
        // iOS permissions are handled automatically
        setHasPermission(true);
      }
    };

    if (visible) {
      requestPermission();
      setScanned(false);
    }
  }, [visible]);

  const handleBarCodeRead = (event: {
    nativeEvent: {codeStringValue: string};
  }): void => {
    if (scanned) {
      return;
    }
    setScanned(true);

    const data = event.nativeEvent.codeStringValue;
    console.log('[QRScanner] Scanned QR code:', data);

    // Extract address from different QR formats
    let address = data;

    // Handle "solana:" URI scheme
    if (data.startsWith('solana:')) {
      // Remove "solana:" prefix and any query parameters
      address = data.replace('solana:', '').split('?')[0];
      console.log('[QRScanner] Extracted address from Solana URI:', address);
    }

    // Validate the extracted address
    if (!isValidSolanaAddress(address)) {
      Alert.alert(
        'Invalid QR Code',
        'The scanned QR code does not contain a valid Solana address.',
        [
          {
            text: 'Try Again',
            onPress: () => setScanned(false),
          },
          {
            text: 'Cancel',
            onPress: onClose,
            style: 'cancel',
          },
        ],
      );
      return;
    }

    console.log('[QRScanner] Valid address scanned:', address);
    onScanSuccess(address);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {hasPermission ? (
          <>
            <Camera
              style={styles.camera}
              cameraType={CameraType.Back}
              scanBarcode={true}
              onReadCode={handleBarCodeRead}
              showFrame={false}
            />
            <View style={styles.overlay}>
              <View style={styles.header}>
                <Text style={styles.title}>Scan QR Code</Text>
                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                  <FontAwesome name="times" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
              <View style={styles.scanArea}>
                <View style={styles.scanFrame} />
              </View>
              <Text style={styles.instruction}>
                Point camera at recipient's QR code
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.permissionContainer}>
            <FontAwesome
              name="camera"
              size={64}
              color="#666"
              style={styles.permissionIcon}
            />
            <Text style={styles.permissionTitle}>Camera Access Required</Text>
            <Text style={styles.permissionText}>
              This app needs camera access to scan QR codes for recipient
              addresses. Please grant camera permission when prompted.
            </Text>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 20,
    color: '#fff',
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 8,
  },
  scanArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderWidth: 3,
    borderColor: '#0f0',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  instruction: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 100,
    paddingHorizontal: 40,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
    backgroundColor: '#1a1a1a',
  },
  permissionIcon: {
    marginBottom: 24,
  },
  permissionTitle: {
    fontSize: 22,
    color: '#fff',
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 16,
    color: '#999',
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 24,
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  cancelButtonText: {
    color: '#007AFF',
    fontSize: 16,
  },
});
