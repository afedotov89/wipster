import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));
// Use the actual panel, IPC wrappers, Zustand stores and refreshCloudData path.
import TaskDetailPanel from '../TaskDetailPanel';
import { refreshCloudData } from '@/stores/cloudStore';
import { useTaskStore } from '@/stores/taskStore';
import { useUiStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useTaskFieldStore } from '@/stores/taskFieldStore';
import { useAiFillStore } from '@/stores/aiFillStore';
import { useI18n } from '@/i18n';
import type { Task, TaskField } from '@/utils/tauri';

let db: Task;
let customDb: Record<string, unknown>;
let registry: TaskField[];
const original = (): Task => ({ id: 'draft-review', title: 'Saved title', status: 'queue', tags: '[]', checklist: '[{"text":"Saved step","done":false}]', next_step: null,
  project_id: null, priority: null, energy: null, due: null, estimate: null, time_estimate: null, dod: 'Saved DOD', comment: 'Saved comment',
  return_ref: null, promised_to: null, tracker_url: null, position: 0, completed_at: null, archived_at: null, created_at: 'x', updated_at: 'x' });
const fields = ['dod', 'comment', 'time_estimate', 'promised_to', 'tracker_url', 'checklist'].map((key, position) => ({
  id: `builtin-${key}`, key, kind: 'text', enabled: true, builtin: true, label: null, options: [], position, removed_at: null, column_side: null,
})) as TaskField[];
const writes = () => invoke.mock.calls.filter(([command]) => command === 'save_task_draft');
async function refresh(patch: Partial<Task> = {}) {
  db = { ...db, ...patch };
  await act(async () => { await refreshCloudData(); });
}
beforeEach(() => {
  db = original(); customDb = {}; registry = fields; invoke.mockReset();
  useI18n.getState().setLocale('en');
  useTaskStore.setState({ tasks: [db], doingTasks: [], archivedTasks: [] });
  useProjectStore.setState({ projects: [], selectedProjectId: null });
  useUiStore.setState({ selectedTaskId: db.id, detailOpen: true, detailExpanded: false });
  useAiFillStore.setState({ filling: [] });
  useTaskFieldStore.setState({ fields, removed: [], loaded: true });
  invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_tasks') return [{ ...db }, { ...original(), id: 'another-task', title: 'Another task' }];
    if (command === 'list_task_fields') return registry;
    if (['get_doing_tasks', 'list_archived_tasks', 'list_projects', 'removed_task_fields', 'get_changelog', 'get_promised_to_options', 'get_estimate_options'].includes(command)) return [];
    if (command === 'task_field_values') return { ...customDb };
    if (command === 'save_custom_field_draft') {
      const id = args!.fieldId as string;
      const applied = JSON.stringify(customDb[id] ?? null) === JSON.stringify(args!.expected);
      if (applied) customDb[id] = args!.value;
      return { applied, value: customDb[id] ?? null };
    }
    if (command === 'get_wip_limit') return 3;
    if (command === 'save_task_draft') {
      const field = args!.field as keyof Task;
      const applied = db[field] === args!.expected;
      if (applied) db = { ...db, [field]: args!.value };
      return { applied, task: { ...db } };
    }
    return null;
  });
});
afterEach(cleanup);

describe('TaskDetailPanel drafts during real store refreshes', () => {
  it('keeps unblurred title/DOD drafts on equivalent objects, unrelated changes and own feed echoes', async () => {
    render(<TaskDetailPanel />);
    fireEvent.change(screen.getByDisplayValue('Saved title'), { target: { value: 'New title still being typed' } });
    fireEvent.change(screen.getByDisplayValue('Saved DOD'), { target: { value: 'Unblurred DOD' } });
    await refresh();
    expect(screen.getByDisplayValue('New title still being typed')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Unblurred DOD')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    await refresh({ comment: 'Remote clean-field update' });
    expect(screen.getByDisplayValue('Remote clean-field update')).toBeInTheDocument();
    expect(screen.getByDisplayValue('New title still being typed')).toBeInTheDocument();
    fireEvent.blur(screen.getByDisplayValue('New title still being typed'));
    await waitFor(() => expect(db.title).toBe('New title still being typed'));
    expect(writes()[0][1]).toMatchObject({ field: 'title', expected: 'Saved title', value: 'New title still being typed' });
  });
  it('keeps same-field remote changes and local drafts distinct until an explicit choice', async () => {
    render(<TaskDetailPanel />);
    fireEvent.change(screen.getByDisplayValue('Saved title'), { target: { value: 'My draft' } });
    await refresh({ title: 'Remote title', comment: 'Clean comment refreshed' });
    expect(screen.getByDisplayValue('My draft')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Clean comment refreshed')).toBeInTheDocument();
    fireEvent.blur(screen.getByDisplayValue('My draft'));
    expect(writes()).toHaveLength(0);
    expect(db.title).toBe('Remote title');
    fireEvent.click(screen.getByRole('button', { name: 'Use updated value' }));
    expect(screen.getByDisplayValue('Remote title')).toBeInTheDocument();
    await act(async () => { fireEvent.blur(screen.getByDisplayValue('Remote title')); });
    expect(writes()).toHaveLength(0);
  });
  it('rejects stale blur even when the incoming SQLite update has not reached React yet', async () => {
    render(<TaskDetailPanel />);
    fireEvent.change(screen.getByDisplayValue('Saved title'), { target: { value: 'My draft' } });
    db = { ...db, title: 'Remote before IPC' }; // no store refresh: the native CAS must catch this race
    fireEvent.blur(screen.getByDisplayValue('My draft'));
    await screen.findByRole('button', { name: 'Save my draft' });
    expect(db.title).toBe('Remote before IPC');
    expect(screen.getByDisplayValue('My draft')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save my draft' }));
    await waitFor(() => expect(db.title).toBe('My draft'));
    expect(writes()[1][1]).toMatchObject({ expected: 'Remote before IPC', value: 'My draft' });
  });
  it('refreshes and blurs clean fields without issuing stale writes', async () => {
    render(<TaskDetailPanel />);
    await refresh({ title: 'Remote title', dod: 'Remote DOD', time_estimate: '2h' });
    fireEvent.blur(screen.getByDisplayValue('Remote title'));
    fireEvent.blur(screen.getByDisplayValue('Remote DOD'));
    fireEvent.blur(screen.getByDisplayValue('2h'));
    await act(async () => {});
    expect(writes()).toHaveLength(0);
  });
  it('retains an in-progress checklist text edit and does not overwrite a changed remote checklist on blur', async () => {
    render(<TaskDetailPanel />);
    fireEvent.doubleClick(screen.getByText('Saved step'));
    fireEvent.change(screen.getByDisplayValue('Saved step'), { target: { value: 'Draft step' } });
    await refresh({ checklist: '[{"text":"Remote step","done":false}]' });
    expect(screen.getByDisplayValue('Draft step')).toBeInTheDocument();
    fireEvent.blur(screen.getByDisplayValue('Draft step'));
    expect(writes()).toHaveLength(0);
    expect(db.checklist).toContain('Remote step');
    fireEvent.click(screen.getByRole('button', { name: 'Use updated value' }));
    expect(screen.getByText('Remote step')).toBeInTheDocument();
  });
  it('preserves custom text drafts and compares their original values before saving', async () => {
    registry = [...fields, { ...fields[0], id: 'custom', key: 'custom', label: 'My field', builtin: false, kind: 'text' }];
    customDb.custom = 'Saved custom';
    useTaskFieldStore.setState({ fields: registry });
    render(<TaskDetailPanel />);
    fireEvent.change(await screen.findByDisplayValue('Saved custom'), { target: { value: 'My custom draft' } });
    customDb.custom = 'Remote custom';
    await refresh({ comment: 'Clean update' });
    expect(screen.getByDisplayValue('My custom draft')).toBeInTheDocument();
    fireEvent.blur(screen.getByDisplayValue('My custom draft'));
    expect(invoke.mock.calls.filter(c => c[0] === 'save_custom_field_draft')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Save my draft' }));
    await waitFor(() => expect(customDb.custom).toBe('My custom draft'));
    expect(invoke).toHaveBeenCalledWith('save_custom_field_draft', { taskId: db.id, fieldId: 'custom', expected: 'Remote custom', value: 'My custom draft' });
  });

  it('keeps custom markdown in progress across a same-field remote update', async () => {
    registry = [...fields, { ...fields[0], id: 'markdown', key: 'markdown', label: 'Notes', builtin: false, kind: 'markdown' }];
    customDb.markdown = 'Saved markdown';
    useTaskFieldStore.setState({ fields: registry });
    render(<TaskDetailPanel />);
    fireEvent.doubleClick(await screen.findByText('Saved markdown'));
    fireEvent.change(screen.getByDisplayValue('Saved markdown'), { target: { value: 'Unblurred markdown' } });
    customDb.markdown = 'Remote markdown'; await refresh();
    expect(screen.getByDisplayValue('Unblurred markdown')).toBeInTheDocument();
    fireEvent.blur(screen.getByDisplayValue('Unblurred markdown'));
    expect(customDb.markdown).toBe('Remote markdown');
    expect(invoke.mock.calls.filter(c => c[0] === 'save_custom_field_draft')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Use updated value' }));
    expect(screen.getByText('Remote markdown')).toBeInTheDocument();
  });

  it('keeps typing made while a previous blur acknowledgement is in flight', async () => {
    let complete!: () => void;
    const existing = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'save_task_draft' && args!.value === 'First edit') {
        await new Promise<void>(resolve => { complete = resolve; });
      }
      return existing(command, args);
    });
    render(<TaskDetailPanel />);
    fireEvent.change(screen.getByDisplayValue('Saved title'), { target: { value: 'First edit' } });
    fireEvent.blur(screen.getByDisplayValue('First edit'));
    fireEvent.change(screen.getByDisplayValue('First edit'), { target: { value: 'Second edit while saving' } });
    await act(async () => { complete(); });
    expect(screen.getByDisplayValue('Second edit while saving')).toBeInTheDocument();
    fireEvent.blur(screen.getByDisplayValue('Second edit while saving'));
    await waitFor(() => expect(db.title).toBe('Second edit while saving'));
    expect(writes()[1][1]).toMatchObject({ expected: 'First edit', value: 'Second edit while saving' });
  });
  it('keeps an unblurred draft visible even if the task is remotely deleted', async () => {
    render(<TaskDetailPanel />);
    fireEvent.change(screen.getByDisplayValue('Saved title'), { target: { value: 'Draft before deletion' } });
    await act(async () => { useTaskStore.setState({ tasks: [] }); });
    expect(screen.getByDisplayValue('Draft before deletion')).toBeInTheDocument();
    expect(screen.getByText(/This task was deleted/)).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('does not inject a previous task custom-save acknowledgement into the newly opened task', async () => {
    registry = [...fields, { ...fields[0], id: 'custom', key: 'custom', label: 'My field', builtin: false, kind: 'text' }];
    customDb.custom = 'First task saved';
    useTaskFieldStore.setState({ fields: registry });
    let complete!: () => void;
    const existing = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'task_field_values' && args!.taskId === 'second-task') return { custom: 'Second task saved' };
      if (command === 'save_custom_field_draft') {
        await new Promise<void>(resolve => { complete = resolve; });
        return { applied: true, value: 'First task draft' };
      }
      return existing(command, args);
    });
    render(<TaskDetailPanel />);
    fireEvent.change(await screen.findByDisplayValue('First task saved'), { target: { value: 'First task draft' } });
    fireEvent.blur(screen.getByDisplayValue('First task draft'));
    await act(async () => {
      useTaskStore.setState({ tasks: [db, { ...db, id: 'second-task', title: 'Second task' }] });
      useUiStore.setState({ selectedTaskId: 'second-task' });
    });
    await screen.findByDisplayValue('Second task saved');
    await act(async () => { complete(); });
    expect(screen.getByDisplayValue('Second task saved')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('First task draft')).not.toBeInTheDocument();
  });

});
