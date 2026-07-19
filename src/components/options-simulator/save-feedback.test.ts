import { describe, expect, it, vi } from 'vitest';
import { runExclusiveSave, type SaveFeedbackStatus } from './save-feedback';

describe('Options Simulator save feedback', () => {
  it('transitions from Unsaved through Saving to Saved', async () => {
    const guard = { current: false };
    const statuses: SaveFeedbackStatus[] = ['Unsaved'];

    const result = await runExclusiveSave(guard, async () => 'saved', (status) => statuses.push(status));

    expect(result).toEqual({ started: true, ok: true, value: 'saved' });
    expect(statuses).toEqual(['Unsaved', 'Saving', 'Saved']);
    expect(guard.current).toBe(false);
  });

  it('transitions to Failed and releases the guard for retry', async () => {
    const guard = { current: false };
    const statuses: SaveFeedbackStatus[] = ['Unsaved'];

    const failed = await runExclusiveSave(guard, async () => {
      throw new Error('network failed');
    }, (status) => statuses.push(status));
    const retried = await runExclusiveSave(guard, async () => 'saved on retry', (status) => statuses.push(status));

    expect(failed).toMatchObject({ started: true, ok: false });
    expect(retried).toEqual({ started: true, ok: true, value: 'saved on retry' });
    expect(statuses).toEqual(['Unsaved', 'Saving', 'Failed', 'Saving', 'Saved']);
  });

  it('prevents a double click from starting a second request', async () => {
    const guard = { current: false };
    const operation = vi.fn();
    let finish!: (value: string) => void;
    operation.mockReturnValue(new Promise<string>((resolve) => { finish = resolve; }));

    const first = runExclusiveSave(guard, operation, () => undefined);
    const second = await runExclusiveSave(guard, operation, () => undefined);

    expect(second).toEqual({ started: false });
    expect(operation).toHaveBeenCalledTimes(1);
    finish('saved');
    await expect(first).resolves.toEqual({ started: true, ok: true, value: 'saved' });
  });
});
