import React, { useEffect, useState } from 'react';
import { BarCodeScanner } from 'expo-barcode-scanner';
import Constants from 'expo-constants';
import {
  Alert,
  Button,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const API_BASE =
  Constants.expoConfig?.extra?.apiBase ||
  Constants.manifest?.extra?.apiBase ||
  'http://localhost:3000';

async function apiFetch(path, options = {}) {
  const url = `${API_BASE}/api/v1${path}`;
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = { error: text || 'Unexpected server response' };
  }
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export default function ScannerScreen({ onClose }) {
  const [hasPermission, setHasPermission] = useState(null);
  const [scanned, setScanned] = useState(false);
  const [mode, setMode] = useState('replacement');
  const [code, setCode] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const handleBarCodeScanned = ({ type, data }) => {
    if (scanned) return;
    setScanned(true);
    setCode(data);
    setMessage(`Scanned ${data}`);
  };

  async function handleSubmit() {
    if (!code) return;
    setSubmitting(true);
    setMessage('');
    try {
      if (mode === 'replacement') {
        const result = await apiFetch('/inventory/consume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sku: code, quantity: Number(quantity) || 1 })
        });
        Alert.alert('Stock consumed', `${result.consumed} ${result.item?.unit || 'pcs'} of ${result.item?.name} deducted.`);
      } else {
        const result = await apiFetch('/iot-assets/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serialNumber: code, action: 'mark_broken' })
        });
        Alert.alert('Asset updated', `${result.asset.serialNumber} marked as ${result.asset.status}.`);
      }
      setCode('');
      setScanned(false);
    } catch (err) {
      Alert.alert('Submit failed', err.message);
      setMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (hasPermission === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Requesting camera permission...</Text>
      </View>
    );
  }
  if (hasPermission === false) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission denied. Enable it in device settings to scan.</Text>
        <Button title="Close" onPress={onClose} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Scan Part / Asset</Text>

      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'replacement' && styles.modeBtnActive]}
          onPress={() => { setMode('replacement'); setCode(''); setScanned(false); }}
        >
          <Text style={styles.modeText}>Replacement Part</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'broken' && styles.modeBtnActive]}
          onPress={() => { setMode('broken'); setCode(''); setScanned(false); }}
        >
          <Text style={styles.modeText}>Broken IoT Asset</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.scanner}>
        <BarCodeScanner
          onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
          barCodeScannerSettings={{ barCodeTypes: [BarCodeScanner.Constants.BarCodeType.qr, BarCodeScanner.Constants.BarCodeType.code128] }}
          style={StyleSheet.absoluteFillObject}
        />
        {scanned && (
          <View style={styles.overlay}>
            <Text style={styles.scannedLabel}>Scanned: {code}</Text>
            <Button title="Tap to scan again" onPress={() => { setScanned(false); setCode(''); }} />
          </View>
        )}
      </View>

      {mode === 'replacement' && (
        <TextInput
          style={styles.input}
          placeholder="Quantity consumed"
          placeholderTextColor="#94a3b8"
          keyboardType="numeric"
          value={quantity}
          onChangeText={setQuantity}
        />
      )}

      <TextInput
        style={styles.input}
        placeholder="Manual entry (SKU or serial)"
        placeholderTextColor="#94a3b8"
        value={code}
        onChangeText={setCode}
      />

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <View style={styles.actions}>
        <Button title="Submit" onPress={handleSubmit} disabled={!code || submitting} color="#2563eb" />
        <View style={{ height: 10 }} />
        <Button title="Close Scanner" onPress={onClose} color="#64748b" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b1120',
    padding: 16,
    paddingTop: 40,
  },
  title: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  text: {
    color: '#cbd5e1',
    fontSize: 14,
    textAlign: 'center',
  },
  modeRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  modeBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    padding: 10,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
  },
  modeBtnActive: {
    borderColor: '#2563eb',
    backgroundColor: '#1e3a8a',
  },
  modeText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '600',
  },
  scanner: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    minHeight: 200,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannedLabel: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  message: {
    color: '#f8fafc',
    fontSize: 12,
    backgroundColor: '#1e293b',
    padding: 8,
    borderRadius: 6,
    marginBottom: 10,
  },
  actions: {
    marginTop: 'auto',
    marginBottom: 20,
  },
});
