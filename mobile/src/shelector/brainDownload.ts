import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

export type ShelectorBrainPhase =
  | 'notAsked'
  | 'deferred'
  | 'downloading'
  | 'ready'
  | 'error';

export interface ShelectorBrainStatus {
  phase: ShelectorBrainPhase;
  allowBackground: boolean;
  progress: number;
  bytesWritten: number;
  totalBytes: number;
  localUri: string | null;
  error: string | null;
  updatedAt: string;
}

interface StartDownloadOptions {
  allowBackground: boolean;
  onProgress?: (status: ShelectorBrainStatus) => void;
}

const STATUS_KEY = '@shelector/brain-download/status';
const RESUME_KEY = '@shelector/brain-download/resume';
const MODEL_DIRECTORY_NAME = 'shelector-brain';
const MODEL_FILENAME =
  process.env.EXPO_PUBLIC_SHELECTOR_BRAIN_MODEL_FILENAME ||
  'shelector-brain-q4.gguf';
const MODEL_URL = process.env.EXPO_PUBLIC_SHELECTOR_BRAIN_MODEL_URL || '';

function now() {
  return new Date().toISOString();
}

function defaultStatus(): ShelectorBrainStatus {
  return {
    phase: 'notAsked',
    allowBackground: true,
    progress: 0,
    bytesWritten: 0,
    totalBytes: 0,
    localUri: null,
    error: null,
    updatedAt: now(),
  };
}

function getBrainDirectory() {
  if (!FileSystem.documentDirectory) {
    throw new Error('Device document directory is unavailable');
  }
  return `${FileSystem.documentDirectory}${MODEL_DIRECTORY_NAME}/`;
}

export function getShelectorBrainLocalUri() {
  return `${getBrainDirectory()}${MODEL_FILENAME}`;
}

async function saveStatus(status: ShelectorBrainStatus) {
  await AsyncStorage.setItem(STATUS_KEY, JSON.stringify(status));
}

async function readSavedStatus(): Promise<ShelectorBrainStatus> {
  const raw = await AsyncStorage.getItem(STATUS_KEY);
  if (!raw) return defaultStatus();

  try {
    return { ...defaultStatus(), ...JSON.parse(raw) };
  } catch {
    return defaultStatus();
  }
}

export async function getShelectorBrainStatus(): Promise<ShelectorBrainStatus> {
  const saved = await readSavedStatus();
  const localUri = getShelectorBrainLocalUri();
  const fileInfo = await FileSystem.getInfoAsync(localUri, { size: true });

  if (fileInfo.exists) {
    const readyStatus: ShelectorBrainStatus = {
      ...saved,
      phase: 'ready',
      progress: 1,
      bytesWritten: fileInfo.size ?? saved.bytesWritten,
      totalBytes: fileInfo.size ?? saved.totalBytes,
      localUri,
      error: null,
      updatedAt: now(),
    };
    await saveStatus(readyStatus);
    return readyStatus;
  }

  return {
    ...saved,
    localUri: saved.phase === 'ready' ? null : saved.localUri,
  };
}

export function shouldPromptForShelectorBrain(status: ShelectorBrainStatus) {
  return status.phase === 'notAsked' || status.phase === 'error' || status.phase === 'downloading';
}

export async function deferShelectorBrainDownload(
  allowBackground: boolean,
): Promise<ShelectorBrainStatus> {
  const status: ShelectorBrainStatus = {
    ...defaultStatus(),
    phase: 'deferred',
    allowBackground,
    updatedAt: now(),
  };
  await saveStatus(status);
  return status;
}

export async function startShelectorBrainDownload({
  allowBackground,
  onProgress,
}: StartDownloadOptions): Promise<ShelectorBrainStatus> {
  if (!MODEL_URL) {
    const missingUrlStatus: ShelectorBrainStatus = {
      ...defaultStatus(),
      phase: 'error',
      allowBackground,
      error: 'Set EXPO_PUBLIC_SHELECTOR_BRAIN_MODEL_URL to enable the first-run brain download.',
      updatedAt: now(),
    };
    await saveStatus(missingUrlStatus);
    onProgress?.(missingUrlStatus);
    return missingUrlStatus;
  }

  const directory = getBrainDirectory();
  const localUri = getShelectorBrainLocalUri();
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });

  const initialStatus: ShelectorBrainStatus = {
    ...defaultStatus(),
    phase: 'downloading',
    allowBackground,
    localUri,
    updatedAt: now(),
  };
  await saveStatus(initialStatus);
  onProgress?.(initialStatus);

  const updateProgress = async (bytesWritten: number, totalBytes: number) => {
    const nextStatus: ShelectorBrainStatus = {
      ...initialStatus,
      progress: totalBytes > 0 ? Math.min(bytesWritten / totalBytes, 1) : 0,
      bytesWritten,
      totalBytes,
      updatedAt: now(),
    };
    await saveStatus(nextStatus);
    onProgress?.(nextStatus);
  };

  const savedResumeState = await AsyncStorage.getItem(RESUME_KEY);
  const resumeState = savedResumeState ? JSON.parse(savedResumeState) : null;
  const sessionType = allowBackground
    ? FileSystem.FileSystemSessionType.BACKGROUND
    : FileSystem.FileSystemSessionType.FOREGROUND;

  const download = FileSystem.createDownloadResumable(
    resumeState?.url || MODEL_URL,
    resumeState?.fileUri || localUri,
    { md5: true, sessionType },
    progress => {
      updateProgress(
        progress.totalBytesWritten,
        progress.totalBytesExpectedToWrite,
      );
    },
    resumeState?.resumeData,
  );

  await AsyncStorage.setItem(RESUME_KEY, JSON.stringify(download.savable()));

  try {
    const result = await download.downloadAsync();
    if (!result) {
      throw new Error('Download was cancelled.');
    }

    await AsyncStorage.removeItem(RESUME_KEY);
    const fileInfo = await FileSystem.getInfoAsync(result.uri, { size: true });
    const readyStatus: ShelectorBrainStatus = {
      phase: 'ready',
      allowBackground,
      progress: 1,
      bytesWritten: fileInfo.exists ? fileInfo.size ?? 0 : 0,
      totalBytes: fileInfo.exists ? fileInfo.size ?? 0 : 0,
      localUri: result.uri,
      error: null,
      updatedAt: now(),
    };
    await saveStatus(readyStatus);
    onProgress?.(readyStatus);
    return readyStatus;
  } catch (error) {
    const failedStatus: ShelectorBrainStatus = {
      ...initialStatus,
      phase: 'error',
      error: error instanceof Error ? error.message : 'Shelector brain download failed.',
      updatedAt: now(),
    };
    await saveStatus(failedStatus);
    onProgress?.(failedStatus);
    return failedStatus;
  }
}
