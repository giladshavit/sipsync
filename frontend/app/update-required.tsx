import { useState } from 'react';
import { View, Text, Pressable, Platform, ActivityIndicator } from 'react-native';
import * as Updates from 'expo-updates';
import { RefreshCw } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';

// Filled in Phase 4 once the store listings exist.
const STORE_URL: string | null = null;

export default function UpdateRequiredScreen() {
  const [busy, setBusy] = useState(false);
  const [otaFailed, setOtaFailed] = useState(false);

  async function handleUpdate() {
    if (Platform.OS === 'web') { window.location.reload(); return; }
    setBusy(true);
    try {
      const check = await Updates.checkForUpdateAsync();
      if (check.isAvailable) {
        await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
        return;
      }
      setOtaFailed(true);   // no OTA — a store build is required
    } catch {
      setOtaFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, justifyContent: 'center', paddingHorizontal: 28 }}>
      <Text style={{ ...typography.title, color: colors.amber, fontSize: 28, textAlign: 'center' }}>
        Update required
      </Text>
      <Text style={{ color: colors.chalk, fontSize: 16, lineHeight: 24, textAlign: 'center', marginTop: 16 }}>
        This version of Quickle is too old to join the party. Grab the latest
        one and jump back in.
      </Text>
      {busy ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: 32 }} />
      ) : (
        <Pressable
          onPress={handleUpdate}
          style={{ marginTop: 32, backgroundColor: colors.amber, borderRadius: 16, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
        >
          <RefreshCw size={18} color={colors.ink} strokeWidth={2.5} />
          <Text style={{ ...typography.label, color: colors.ink, fontSize: 15 }}>
            {Platform.OS === 'web' ? 'Refresh' : 'Update now'}
          </Text>
        </Pressable>
      )}
      {otaFailed && (
        <Text style={{ color: colors.fog, fontSize: 13, textAlign: 'center', marginTop: 16 }}>
          {STORE_URL ? 'Get the update from the store.' : 'A new app version is on its way to the store — check back soon.'}
        </Text>
      )}
    </View>
  );
}
