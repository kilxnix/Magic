import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';

const PLAY_URL = process.env.EXPO_PUBLIC_PLAY_URL || 'http://127.0.0.1:5173/play';

export default function PlayWebViewScreen() {
  const webViewRef = useRef<WebView>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <WebView
        ref={webViewRef}
        source={{ uri: PLAY_URL }}
        style={styles.webview}
        originWhitelist={['http://*', 'https://*']}
        javaScriptEnabled
        domStorageEnabled
        allowsBackForwardNavigationGestures
        setSupportMultipleWindows={false}
        mixedContentMode="always"
        onError={() => setLoadFailed(true)}
        onHttpError={() => setLoadFailed(true)}
        onLoadStart={() => setLoadFailed(false)}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color="#f59e0b" />
          </View>
        )}
      />

      {loadFailed && (
        <View style={styles.errorPanel}>
          <Text style={styles.errorTitle}>Play UI is not reachable</Text>
          <Text style={styles.errorText}>
            Start the web app, then keep USB debugging connected for adb reverse.
          </Text>
          <Text style={styles.urlText}>{PLAY_URL}</Text>
          <Pressable
            style={styles.reloadButton}
            onPress={() => {
              setLoadFailed(false);
              webViewRef.current?.reload();
            }}
          >
            <Text style={styles.reloadText}>Reload</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0a09',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0c0a09',
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0c0a09',
  },
  errorPanel: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#92400e',
    backgroundColor: 'rgba(12, 10, 9, 0.96)',
    padding: 14,
  },
  errorTitle: {
    color: '#fbbf24',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  errorText: {
    color: '#d6d3d1',
    fontSize: 12,
    lineHeight: 17,
  },
  urlText: {
    color: '#a8a29e',
    fontSize: 11,
    marginTop: 8,
  },
  reloadButton: {
    alignSelf: 'flex-start',
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#d97706',
    marginTop: 12,
    paddingHorizontal: 14,
  },
  reloadText: {
    color: '#fff7ed',
    fontWeight: '800',
  },
});
