export type SaveFeedbackStatus = 'Unsaved' | 'Saving' | 'Saved' | 'Failed';

export interface SaveGuard {
  current: boolean;
}

export type SaveAttempt<T> =
  | { started: false }
  | { started: true; ok: true; value: T }
  | { started: true; ok: false; error: unknown };

export async function runExclusiveSave<T>(
  guard: SaveGuard,
  operation: () => Promise<T>,
  onStatus: (status: SaveFeedbackStatus) => void,
): Promise<SaveAttempt<T>> {
  if (guard.current) return { started: false };

  guard.current = true;
  onStatus('Saving');
  try {
    const value = await operation();
    onStatus('Saved');
    return { started: true, ok: true, value };
  } catch (error) {
    onStatus('Failed');
    return { started: true, ok: false, error };
  } finally {
    guard.current = false;
  }
}
