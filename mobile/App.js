import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  FlatList,
  Image,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Network from 'expo-network';
import * as TaskManager from 'expo-task-manager';
import ScannerScreen from './ScannerScreen';

const API_BASE =
  Constants.expoConfig?.extra?.apiBase ||
  Constants.manifest?.extra?.apiBase ||
  'http://localhost:3000';

const GEO_FENCE_METERS = 15;
const SYNC_QUEUE_KEY = 'DRAINPULSE_SYNC_QUEUE';
const DRAFT_KEY = (ticketId) => `DRAINPULSE_DRAFT_${ticketId}`;
const AUTH_KEY = 'DRAINPULSE_AUTH';
const BACKGROUND_SYNC_TASK = 'drainpulse-background-sync';

// -------------------- Helpers --------------------

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(m) {
  if (m == null || Number.isNaN(m)) return 'unknown';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

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

async function getQueue() {
  const raw = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function setQueue(queue) {
  await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
}

async function getDraft(ticketId) {
  const raw = await AsyncStorage.getItem(DRAFT_KEY(ticketId));
  return raw
    ? JSON.parse(raw)
    : { beforeUris: [], afterUris: [], resolutionNotes: '', selectedMemberId: '' };
}

async function setDraft(ticketId, draft) {
  await AsyncStorage.setItem(DRAFT_KEY(ticketId), JSON.stringify(draft));
}

function buildPhotoForm(beforeUris, afterUris) {
  const form = new FormData();
  beforeUris.forEach((uri, i) => {
    const name = uri.split('/').pop() || `before-${i}.jpg`;
    form.append('beforePhotos', { uri, name, type: 'image/jpeg' });
  });
  afterUris.forEach((uri, i) => {
    const name = uri.split('/').pop() || `after-${i}.jpg`;
    form.append('afterPhotos', { uri, name, type: 'image/jpeg' });
  });
  return form;
}

async function sendPhotos(ticketId, beforeUris, afterUris) {
  const form = buildPhotoForm(beforeUris, afterUris);
  return apiFetch(`/tickets/${ticketId}/photos`, {
    method: 'PATCH',
    body: form,
    headers: { Accept: 'application/json' },
  });
}

async function sendResolve(ticketId, resolutionNotes, memberId, memberName) {
  return apiFetch(`/tickets/${ticketId}/resolve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolutionNotes, memberId, memberName }),
  });
}

async function flushPendingQueue() {
  const queue = await getQueue();
  if (queue.length === 0) return false;

  const remaining = [];
  let anyFlushed = false;

  for (const action of queue) {
    try {
      if (action.type === 'photos') {
        await sendPhotos(action.ticketId, action.beforeUris, action.afterUris);
      } else if (action.type === 'resolve') {
        await sendResolve(
          action.ticketId,
          action.resolutionNotes,
          action.memberId,
          action.memberName
        );
      }
      anyFlushed = true;
    } catch (err) {
      console.warn('[SYNC] Action failed, keeping in queue:', err.message);
      remaining.push(action);
    }
  }

  await setQueue(remaining);
  return anyFlushed;
}

// -------------------- Background Sync --------------------

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    const flushed = await flushPendingQueue();
    return flushed ? BackgroundFetch.Result.NewData : BackgroundFetch.Result.NoData;
  } catch (err) {
    console.error('[BACKGROUND SYNC] error', err);
    return BackgroundFetch.Result.Failed;
  }
});

// -------------------- Components --------------------

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function PhotoThumb({ uri, onRemove }) {
  return (
    <View style={styles.thumbWrap}>
      <Image source={{ uri }} style={styles.thumb} />
      <TouchableOpacity style={styles.removeBtn} onPress={onRemove}>
        <Text style={styles.removeText}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function App() {
  const [auth, setAuth] = useState(null);
  const [crews, setCrews] = useState([]);
  const [activeTicket, setActiveTicket] = useState(null);
  const [node, setNode] = useState(null);
  const [deviceLocation, setDeviceLocation] = useState(null);
  const [distance, setDistance] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const [beforeUris, setBeforeUris] = useState([]);
  const [afterUris, setAfterUris] = useState([]);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState('');

  const locationSubscription = useRef(null);
  const networkSubscription = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    loadAuth();
    setupLocation();
    setupNetwork();
    registerBackgroundSync();
    return () => {
      mounted.current = false;
      if (locationSubscription.current) locationSubscription.current.remove();
      if (networkSubscription.current) networkSubscription.current.remove();
    };
  }, []);

  useEffect(() => {
    updateQueueBadge();
  }, []);

  useEffect(() => {
    if (!activeTicket) return;
    loadDraft(activeTicket.ticketId);
  }, [activeTicket]);

  useEffect(() => {
    if (!deviceLocation || !node || !node.location || !node.location.coordinates) {
      setDistance(null);
      return;
    }
    const [lon, lat] = node.location.coordinates;
    const d = haversineMeters(
      deviceLocation.latitude,
      deviceLocation.longitude,
      lat,
      lon
    );
    setDistance(d);
  }, [deviceLocation, node]);

  async function loadAuth() {
    try {
      const raw = await AsyncStorage.getItem(AUTH_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        setAuth(saved);
        fetchActiveTicket(saved.crew.crewName);
      }
      const crewsData = await apiFetch('/crews');
      setCrews(crewsData);
    } catch (err) {
      console.warn('[AUTH] load failed', err.message);
    }
  }

  async function saveAuth(value) {
    setAuth(value);
    if (value) await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(value));
    else await AsyncStorage.removeItem(AUTH_KEY);
  }

  async function setupLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setMessage('Location permission denied. Geofence will not work.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      setDeviceLocation(loc.coords);
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 2,
          timeInterval: 5000,
        },
        (l) => {
          if (mounted.current) setDeviceLocation(l.coords);
        }
      );
      locationSubscription.current = sub;
    } catch (err) {
      console.warn('[LOCATION] error', err.message);
    }
  }

  async function setupNetwork() {
    try {
      const state = await Network.getNetworkStateAsync();
      setIsOnline(!!(state.isInternetReachable ?? state.isConnected));
      if (state.isInternetReachable) flushPendingQueue().then(updateQueueBadge);
      networkSubscription.current = Network.addNetworkStateListener((state) => {
        const online = !!(state.isInternetReachable ?? state.isConnected);
        setIsOnline(online);
        if (online) flushPendingQueue().then(updateQueueBadge);
      });
    } catch (err) {
      console.warn('[NETWORK] error', err.message);
    }
  }

  async function registerBackgroundSync() {
    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
      if (!isRegistered) {
        await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
          minimumInterval: 15 * 60,
          stopOnTerminate: false,
          startOnBoot: true,
        });
      }
    } catch (err) {
      console.warn('[BACKGROUND] registration failed', err.message);
    }
  }

  async function updateQueueBadge() {
    const q = await getQueue();
    setQueueCount(q.length);
  }

  async function fetchActiveTicket(crewName) {
    setLoading(true);
    try {
      const data = await apiFetch(`/tickets/active?crewName=${encodeURIComponent(crewName)}`);
      if (mounted.current) {
        setActiveTicket(data.ticket);
        setNode(data.node);
      }
    } catch (err) {
      if (mounted.current) setMessage(`Could not load active ticket: ${err.message}`);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  async function loadDraft(ticketId) {
    const draft = await getDraft(ticketId);
    setBeforeUris(draft.beforeUris || []);
    setAfterUris(draft.afterUris || []);
    setResolutionNotes(draft.resolutionNotes || '');
    setSelectedMemberId(draft.selectedMemberId || '');
  }

  async function persistDraft(next) {
    if (!activeTicket) return;
    const draft = {
      beforeUris: next.beforeUris ?? beforeUris,
      afterUris: next.afterUris ?? afterUris,
      resolutionNotes: next.resolutionNotes ?? resolutionNotes,
      selectedMemberId: next.selectedMemberId ?? selectedMemberId,
    };
    await setDraft(activeTicket.ticketId, draft);
  }

  async function handleLogin() {
    if (!loginIdentifier || !password) {
      setMessage('Please enter crew identifier and password.');
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch('/crews/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginIdentifier, password }),
      });
      await saveAuth(data);
      await fetchActiveTicket(data.crew.crewName);
      setMessage(`Welcome ${data.crew.crewName}`);
    } catch (err) {
      setMessage(`Login failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await saveAuth(null);
    setActiveTicket(null);
    setNode(null);
    setLoginIdentifier('');
    setPassword('');
    setMessage('Logged out');
  }

  async function pickPhotos(type) {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaType.Images,
        allowsMultipleSelection: true,
        selectionLimit: 3,
        quality: 0.7,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const copied = [];
      for (const [i, asset] of result.assets.entries()) {
        const ext = asset.uri.split('.').pop() || 'jpg';
        const fileName = `${type}-${Date.now()}-${i}.${ext}`;
        const dest = FileSystem.documentDirectory + fileName;
        await FileSystem.copyAsync({ from: asset.uri, to: dest });
        copied.push(dest);
      }

      const next =
        type === 'before'
          ? { beforeUris: [...beforeUris, ...copied].slice(0, 3) }
          : { afterUris: [...afterUris, ...copied].slice(0, 3) };

      if (type === 'before') setBeforeUris(next.beforeUris);
      else setAfterUris(next.afterUris);
      await persistDraft(next);
    } catch (err) {
      Alert.alert('Photo error', err.message);
    }
  }

  function removePhoto(type, index) {
    if (type === 'before') {
      const next = { beforeUris: beforeUris.filter((_, i) => i !== index) };
      setBeforeUris(next.beforeUris);
      persistDraft(next);
    } else {
      const next = { afterUris: afterUris.filter((_, i) => i !== index) };
      setAfterUris(next.afterUris);
      persistDraft(next);
    }
  }

  function isInsideGeofence() {
    return distance != null && distance <= GEO_FENCE_METERS;
  }

  function geofenceMessage() {
    if (distance == null) return 'Waiting for GPS fix...';
    return `You are ${formatDistance(distance)} from node. Must be within ${GEO_FENCE_METERS} m.`;
  }

  async function queueAction(action) {
    const queue = await getQueue();
    queue.push(action);
    await setQueue(queue);
    setQueueCount(queue.length);
    setMessage('Saved locally. Will sync when connection returns.');
  }

  async function handleUploadAfterPhotos() {
    if (!isInsideGeofence()) {
      Alert.alert('Geofence', 'Move within 15 m of the node to upload after photos.');
      return;
    }
    if (afterUris.length === 0) {
      Alert.alert('Missing photos', 'Please select at least one after photo.');
      return;
    }
    setLoading(true);
    try {
      if (isOnline) {
        await sendPhotos(activeTicket.ticketId, beforeUris, afterUris);
        setMessage('Photos uploaded.');
      } else {
        await queueAction({
          id: `${activeTicket.ticketId}-${Date.now()}`,
          type: 'photos',
          ticketId: activeTicket.ticketId,
          beforeUris,
          afterUris,
        });
      }
    } catch (err) {
      Alert.alert('Upload failed', `${err.message}\nIt will be retried when you are back online.`);
      await queueAction({
        id: `${activeTicket.ticketId}-${Date.now()}`,
        type: 'photos',
        ticketId: activeTicket.ticketId,
        beforeUris,
        afterUris,
      });
    } finally {
      setLoading(false);
      await updateQueueBadge();
    }
  }

  async function handleResolveTicket() {
    if (!isInsideGeofence()) {
      Alert.alert('Geofence', 'Move within 15 m of the node to resolve this ticket.');
      return;
    }
    if (afterUris.length === 0) {
      Alert.alert('Missing after photos', 'Capture and upload after photos before resolving.');
      return;
    }
    const member = (auth?.crew?.members || []).find((m) => m.memberId === selectedMemberId);
    setLoading(true);
    try {
      if (isOnline) {
        await sendResolve(
          activeTicket.ticketId,
          resolutionNotes,
          selectedMemberId,
          member?.name || ''
        );
        setMessage('Ticket resolved.');
        await clearDraft(activeTicket.ticketId);
        setBeforeUris([]);
        setAfterUris([]);
        setResolutionNotes('');
        setSelectedMemberId('');
        await fetchActiveTicket(auth.crew.crewName);
      } else {
        await queueAction({
          id: `${activeTicket.ticketId}-${Date.now()}`,
          type: 'resolve',
          ticketId: activeTicket.ticketId,
          resolutionNotes,
          memberId: selectedMemberId,
          memberName: member?.name || '',
        });
      }
    } catch (err) {
      Alert.alert('Resolve failed', `${err.message}\nIt will be retried when you are back online.`);
      await queueAction({
        id: `${activeTicket.ticketId}-${Date.now()}`,
        type: 'resolve',
        ticketId: activeTicket.ticketId,
        resolutionNotes,
        memberId: selectedMemberId,
        memberName: member?.name || '',
      });
    } finally {
      setLoading(false);
      await updateQueueBadge();
    }
  }

  async function handleManualSync() {
    setLoading(true);
    try {
      const flushed = await flushPendingQueue();
      setMessage(flushed ? 'Pending items synced.' : 'Nothing to sync.');
    } catch (err) {
      setMessage(`Sync error: ${err.message}`);
    } finally {
      setLoading(false);
      await updateQueueBadge();
    }
  }

  async function clearDraft(ticketId) {
    await AsyncStorage.removeItem(DRAFT_KEY(ticketId));
  }

  function renderLogin() {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>DrainPulse Field</Text>
        <Text style={styles.subtitle}>Crew Login</Text>
        {crews.length > 0 ? (
          <FlatList
            data={crews}
            keyExtractor={(item) => item.loginIdentifier}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.crewItem,
                  loginIdentifier === item.loginIdentifier && styles.crewItemActive,
                ]}
                onPress={() => setLoginIdentifier(item.loginIdentifier)}
              >
                <Text style={styles.crewItemText}>{item.crewName}</Text>
              </TouchableOpacity>
            )}
            style={{ maxHeight: 200, width: '100%', marginBottom: 12 }}
          />
        ) : (
          <Text style={styles.hint}>No crews loaded. Check API_BASE in app.json.</Text>
        )}
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#94a3b8"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <Button title="Login" onPress={handleLogin} color="#2563eb" />
      </View>
    );
  }

  function renderTicket() {
    if (showScanner) return <ScannerScreen onClose={() => setShowScanner(false)} />;
    if (loading && !activeTicket) return <ActivityIndicator size="large" color="#2563eb" />;
    if (!activeTicket) {
      return (
        <View style={styles.container}>
          <Text style={styles.subtitle}>No active dispatch</Text>
          <Text style={styles.hint}>{message}</Text>
          <Button title="Refresh" onPress={() => fetchActiveTicket(auth.crew.crewName)} />
          <View style={{ height: 12 }} />
          <Button title="Logout" onPress={handleLogout} />
        </View>
      );
    }

    const members = auth?.crew?.members || [];
    const canAct = isInsideGeofence();

    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <ScrollView style={{ width: '100%' }} contentContainerStyle={{ padding: 16 }}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>{activeTicket.ticketId}</Text>
              <Text style={styles.subtitle}>{activeTicket.locationName}</Text>
              <Text style={styles.hint}>Node: {activeTicket.nodeId}</Text>
            </View>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{activeTicket.status}</Text>
            </View>
          </View>

          <View style={[styles.geoBanner, canAct ? styles.geoIn : styles.geoOut]}>
            <Text style={styles.geoText}>{geofenceMessage()}</Text>
            <Text style={styles.geoText}>
              GPS: {deviceLocation
                ? `${deviceLocation.latitude.toFixed(5)}, ${deviceLocation.longitude.toFixed(5)}`
                : 'acquiring...'}
            </Text>
            <Text style={styles.geoText}>
              Network: {isOnline ? 'online' : 'offline'} | Queue: {queueCount}
            </Text>
          </View>

          <Section title="Diagnostic">
            <Text style={styles.body}>{activeTicket.diagnosticSummary || activeTicket.notes || 'N/A'}</Text>
          </Section>

          <Section title="Verified Operator">
            <FlatList
              data={members}
              keyExtractor={(item) => item.memberId}
              horizontal
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.memberChip,
                    selectedMemberId === item.memberId && styles.memberChipActive,
                  ]}
                  onPress={() => {
                    setSelectedMemberId(item.memberId);
                    persistDraft({ selectedMemberId: item.memberId });
                  }}
                >
                  <Text style={styles.memberChipText}>{item.name}</Text>
                </TouchableOpacity>
              )}
              showsHorizontalScrollIndicator={false}
            />
          </Section>

          <Section title="Before Remediation Photos">
            <View style={styles.photoRow}>
              {beforeUris.map((uri, i) => (
                <PhotoThumb key={uri} uri={uri} onRemove={() => removePhoto('before', i)} />
              ))}
            </View>
            <Button
              title="Select Before Photos (up to 3)"
              onPress={() => pickPhotos('before')}
              color="#d97706"
            />
          </Section>

          <Section title="After Remediation Photos">
            <View style={styles.photoRow}>
              {afterUris.map((uri, i) => (
                <PhotoThumb key={uri} uri={uri} onRemove={() => removePhoto('after', i)} />
              ))}
            </View>
            <Button
              title="Select After Photos (up to 3)"
              onPress={() => pickPhotos('after')}
              color="#059669"
            />
            <View style={{ height: 10 }} />
            <Button
              title="Upload After Photos"
              onPress={handleUploadAfterPhotos}
              color="#2563eb"
              disabled={!canAct || afterUris.length === 0 || loading}
            />
          </Section>

          <Section title="Resolution Notes">
            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              placeholder="Enter resolution notes..."
              placeholderTextColor="#94a3b8"
              multiline
              value={resolutionNotes}
              onChangeText={(text) => {
                setResolutionNotes(text);
                persistDraft({ resolutionNotes: text });
              }}
            />
          </Section>

          <View style={styles.actionBlock}>
            <Button
              title="Resolve Ticket"
              onPress={handleResolveTicket}
              color="#16a34a"
              disabled={!canAct || afterUris.length === 0 || loading}
            />
            <View style={{ height: 10 }} />
            <Button title="Scan Parts / Assets" onPress={() => setShowScanner(true)} color="#7c3aed" />
            <View style={{ height: 10 }} />
            <Button title="Sync Now" onPress={handleManualSync} color="#64748b" />
            <View style={{ height: 10 }} />
            <Button title="Logout" onPress={handleLogout} color="#64748b" />
          </View>

          {message ? <Text style={styles.message}>{message}</Text> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      {auth ? renderTicket() : renderLogin()}
      {loading && (
        <View style={styles.spinnerOverlay}>
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0b1120',
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#0b1120',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#cbd5e1',
    marginBottom: 12,
  },
  hint: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 8,
  },
  input: {
    width: '100%',
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  crewItem: {
    backgroundColor: '#1e293b',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  crewItemActive: {
    borderColor: '#2563eb',
    backgroundColor: '#1e3a8a',
  },
  crewItemText: {
    color: '#f8fafc',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  badge: {
    backgroundColor: '#1e3a8a',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  geoBanner: {
    width: '100%',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  geoIn: {
    backgroundColor: '#064e3b',
  },
  geoOut: {
    backgroundColor: '#7f1d1d',
  },
  geoText: {
    color: '#f8fafc',
    fontSize: 12,
    marginBottom: 2,
  },
  section: {
    width: '100%',
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  body: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 20,
  },
  photoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  thumbWrap: {
    position: 'relative',
    marginRight: 8,
    marginBottom: 8,
  },
  thumb: {
    width: 80,
    height: 80,
    borderRadius: 6,
    backgroundColor: '#1e293b',
  },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#ef4444',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
    lineHeight: 16,
  },
  memberChip: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  memberChipActive: {
    borderColor: '#2563eb',
    backgroundColor: '#1e3a8a',
  },
  memberChipText: {
    color: '#f8fafc',
    fontSize: 12,
  },
  actionBlock: {
    width: '100%',
    marginTop: 8,
    marginBottom: 24,
  },
  message: {
    color: '#f8fafc',
    fontSize: 13,
    backgroundColor: '#1e293b',
    padding: 10,
    borderRadius: 6,
    width: '100%',
    textAlign: 'center',
  },
  spinnerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
