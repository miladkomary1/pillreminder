import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

const STORAGE_KEY = 'night-dose-reminder';
const ANDROID_CHANNEL_ID = 'daily-pill-reminder';
const DEFAULT_HOUR = 21;
const DEFAULT_MINUTE = 30;

type ReminderSettings = {
  enabled: boolean;
  hour: number;
  minute: number;
  notificationId?: string;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

function makeTimeDate(hour: number, minute: number) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}

function formatTime(hour: number, minute: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(makeTimeDate(hour, minute));
}

function getNextOccurrence(hour: number, minute: number) {
  const next = makeTimeDate(hour, minute);

  if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

async function saveSettings(settings: ReminderSettings) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

async function loadSettings(): Promise<ReminderSettings> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return {
      enabled: false,
      hour: DEFAULT_HOUR,
      minute: DEFAULT_MINUTE,
    };
  }

  const parsed = JSON.parse(raw) as Partial<ReminderSettings>;

  return {
    enabled: Boolean(parsed.enabled),
    hour: typeof parsed.hour === 'number' ? parsed.hour : DEFAULT_HOUR,
    minute: typeof parsed.minute === 'number' ? parsed.minute : DEFAULT_MINUTE,
    notificationId:
      typeof parsed.notificationId === 'string' ? parsed.notificationId : undefined,
  };
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') {
    return;
  }

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Pill reminders',
    description: 'Daily pill reminder alerts',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate: true,
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.ALARM,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    },
  });
}

async function requestNotificationAccess() {
  const current = await Notifications.getPermissionsAsync();

  if (
    current.granted ||
    current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  ) {
    return true;
  }

  const requested = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: true,
    },
  });

  return (
    requested.granted ||
    requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

async function cancelReminder(notificationId?: string) {
  if (notificationId) {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  }
}

async function scheduleDailyReminder(hour: number, minute: number) {
  await ensureAndroidChannel();

  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Time for your pill',
      body: 'Take your pill now.',
      sound: 'default',
      interruptionLevel: 'timeSensitive',
      priority: Notifications.AndroidNotificationPriority.MAX,
      vibrate: [0, 250, 250, 250],
      color: '#14B8A6',
      data: {
        kind: 'pill-reminder',
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: ANDROID_CHANNEL_ID,
    },
  });
}

export default function App() {
  const [settings, setSettings] = useState<ReminderSettings>({
    enabled: false,
    hour: DEFAULT_HOUR,
    minute: DEFAULT_MINUTE,
  });
  const [selectedTime, setSelectedTime] = useState(
    makeTimeDate(DEFAULT_HOUR, DEFAULT_MINUTE)
  );
  const [showPicker, setShowPicker] = useState(Platform.OS === 'ios');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;

    loadSettings()
      .then((stored) => {
        if (!mounted) {
          return;
        }

        setSettings(stored);
        setSelectedTime(makeTimeDate(stored.hour, stored.minute));
      })
      .catch(() => {
        Alert.alert('Could not load reminder', 'The app will use the default time.');
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const selectedHour = selectedTime.getHours();
  const selectedMinute = selectedTime.getMinutes();
  const selectedLabel = formatTime(selectedHour, selectedMinute);
  const savedLabel = formatTime(settings.hour, settings.minute);
  const nextReminderLabel = useMemo(() => {
    const next = getNextOccurrence(settings.hour, settings.minute);

    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
    }).format(next);
  }, [settings.hour, settings.minute]);
  const hasUnsavedTime =
    selectedHour !== settings.hour || selectedMinute !== settings.minute;

  const handleTimeChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
    }

    if (date) {
      setSelectedTime(date);
    }
  };

  const handleEnableReminder = async () => {
    try {
      setBusy(true);
      const allowed = await requestNotificationAccess();

      if (!allowed) {
        Alert.alert(
          'Notifications are off',
          'Turn on notifications for this app in your phone settings, then try again.'
        );
        return;
      }

      await cancelReminder(settings.notificationId);
      const notificationId = await scheduleDailyReminder(selectedHour, selectedMinute);
      const nextSettings = {
        enabled: true,
        hour: selectedHour,
        minute: selectedMinute,
        notificationId,
      };

      await saveSettings(nextSettings);
      setSettings(nextSettings);
      Alert.alert('Reminder set', `Your daily reminder is set for ${selectedLabel}.`);
    } catch (error) {
      Alert.alert(
        'Could not set reminder',
        error instanceof Error ? error.message : 'Try again in a moment.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDisableReminder = async () => {
    try {
      setBusy(true);
      await cancelReminder(settings.notificationId);

      const nextSettings = {
        ...settings,
        enabled: false,
        notificationId: undefined,
      };

      await saveSettings(nextSettings);
      setSettings(nextSettings);
    } catch (error) {
      Alert.alert(
        'Could not turn off reminder',
        error instanceof Error ? error.message : 'Try again in a moment.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleTestNotification = async () => {
    try {
      setBusy(true);
      const allowed = await requestNotificationAccess();

      if (!allowed) {
        Alert.alert(
          'Notifications are off',
          'Turn on notifications for this app in your phone settings, then try again.'
        );
        return;
      }

      await ensureAndroidChannel();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Night Dose test',
          body: 'This is how your pill reminder will sound.',
          sound: 'default',
          interruptionLevel: 'timeSensitive',
          priority: Notifications.AndroidNotificationPriority.MAX,
          vibrate: [0, 250, 250, 250],
          color: '#14B8A6',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 2,
        },
      });
    } catch (error) {
      Alert.alert(
        'Could not send test',
        error instanceof Error ? error.message : 'Try again in a moment.'
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#14B8A6" />
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.appName}>Night Dose</Text>
          <Switch
            accessibilityLabel="Reminder enabled"
            onValueChange={(value) => {
              if (value) {
                void handleEnableReminder();
              } else {
                void handleDisableReminder();
              }
            }}
            thumbColor="#FFFFFF"
            trackColor={{ false: '#CBD5E1', true: '#99F6E4' }}
            value={settings.enabled}
            disabled={busy}
          />
        </View>

        <View style={styles.statusPanel}>
          <Text style={styles.statusLabel}>
            {settings.enabled ? 'Reminder active' : 'Reminder off'}
          </Text>
          <Text style={styles.statusTime}>
            {settings.enabled ? savedLabel : selectedLabel}
          </Text>
          <Text style={styles.statusDetail}>
            {settings.enabled
              ? `Next alert: ${nextReminderLabel}`
              : 'Choose a nightly time and enable the reminder.'}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reminder time</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowPicker(true)}
            style={({ pressed }) => [
              styles.timeButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.timeButtonLabel}>{selectedLabel}</Text>
            <Text style={styles.timeButtonHint}>
              {Platform.OS === 'ios' ? 'Adjust below' : 'Tap to change'}
            </Text>
          </Pressable>

          {showPicker && (
            <DateTimePicker
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              mode="time"
              onChange={handleTimeChange}
              value={selectedTime}
            />
          )}
        </View>

        <View style={styles.traits}>
          <View style={styles.trait}>
            <Text style={styles.traitValue}>Daily</Text>
            <Text style={styles.traitLabel}>Repeats</Text>
          </View>
          <View style={styles.trait}>
            <Text style={styles.traitValue}>Sound on</Text>
            <Text style={styles.traitLabel}>Default alert</Text>
          </View>
        </View>

        {hasUnsavedTime && settings.enabled ? (
          <Text style={styles.unsaved}>Press Update reminder to save this time.</Text>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={handleEnableReminder}
            style={({ pressed }) => [
              styles.primaryButton,
              (pressed || busy) && styles.pressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {settings.enabled ? 'Update reminder' : 'Enable reminder'}
            </Text>
          </Pressable>

          <View style={styles.secondaryActions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={handleTestNotification}
              style={({ pressed }) => [
                styles.secondaryButton,
                (pressed || busy) && styles.pressed,
              ]}
            >
              <Text style={styles.secondaryButtonText}>Send test</Text>
            </Pressable>

            {settings.enabled ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={handleDisableReminder}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  (pressed || busy) && styles.pressed,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Turn off</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <Text style={styles.footerNote}>
          Alerts follow your phone notification, volume, silent mode, and Do Not
          Disturb settings.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  loadingScreen: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    alignSelf: Platform.OS === 'web' ? 'flex-start' : 'stretch',
    flexGrow: 1,
    gap: 20,
    marginHorizontal: Platform.OS === 'web' ? 24 : 0,
    maxWidth: 342,
    paddingHorizontal: Platform.OS === 'web' ? 0 : 24,
    paddingVertical: 24,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  appName: {
    color: '#111827',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 0,
  },
  statusPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DDE7EF',
    borderRadius: 8,
    borderWidth: 1,
    padding: 24,
    shadowColor: '#0F172A',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
  },
  statusLabel: {
    color: '#0F766E',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  statusTime: {
    color: '#111827',
    fontSize: 46,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 54,
    marginTop: 12,
  },
  statusDetail: {
    color: '#475569',
    fontSize: 16,
    lineHeight: 23,
    marginTop: 10,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '700',
  },
  timeButton: {
    alignItems: 'center',
    backgroundColor: '#ECFEFF',
    borderColor: '#99F6E4',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingHorizontal: 18,
  },
  timeButtonLabel: {
    color: '#134E4A',
    fontSize: 24,
    fontWeight: '800',
  },
  timeButtonHint: {
    color: '#0F766E',
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 0,
  },
  traits: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  trait: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 16,
  },
  traitValue: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  traitLabel: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 6,
  },
  unsaved: {
    color: '#7C3AED',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  actions: {
    gap: 12,
    marginTop: 'auto',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#14B8A6',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 58,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  secondaryButtonText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  footerNote: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
});
