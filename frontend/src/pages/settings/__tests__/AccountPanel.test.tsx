import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
const { invoke, isTauri, state, refresh } = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true), refresh: vi.fn(), state: {
  status: { account: null as null | { origin: string; phone?: string; email?: string; name?: string; google_linked?: boolean; yandex_linked?: boolean }, pending: 0, conflict: false, error: null }, busy: false, sync: vi.fn(),
} }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri }));
vi.mock('@/stores/cloudStore', () => ({ useCloudStore: Object.assign(() => state, { getState: () => ({ refresh }) }) }));
import AccountPanel from '../AccountPanel';
import { useI18n } from '@/i18n';

const preview = { projects: 2, tasks: 7, values: 4, can_import: true };
function mockCommands(capabilities = { google: true, sms: false }) {
  invoke.mockImplementation(async (command: string) => {
    if (command === 'cloud_import_preview') return preview;
    if (command === 'cloud_capabilities') return capabilities;
    if (command === 'cloud_start') return { challenge_id: 'challenge' };
    if (command === 'cloud_login') throw new Error('Native test stops before process restart');
  });
}

describe('native Google and optional phone account flow', () => {
  beforeEach(() => {
    invoke.mockReset(); refresh.mockReset(); isTauri.mockReturnValue(true); localStorage.clear();
    state.status.account = null; useI18n.getState().setLocale('en');
  });
  it('requires explicit import choice and delegates phone credentials entirely to native', async () => {
    localStorage.setItem('wipster-cloud-origin', 'http://127.0.0.1:8080');
    mockCommands({ google: true, sms: true });
    render(<AccountPanel />);
    fireEvent.change(await screen.findByLabelText('Phone'), { target: { value: '+14155552671' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    const code = await screen.findByLabelText('SMS code');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(await screen.findByText(/2 projects, 7 tasks, 4 field values/)).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toBeDisabled();
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cloud_login', {
      originUrl: 'http://127.0.0.1:8080', challengeId: 'challenge', code: '123456', importLocal: false,
    }));
    expect(localStorage.getItem('token')).toBeNull();
    expect(await screen.findByText(/Native test stops/)).toBeInTheDocument();
  });
  it('Google-only hides all phone requirements and passes explicit import without OAuth material', async () => {
    mockCommands();
    render(<AccountPanel />);
    const google = await screen.findByRole('button', { name: 'Sign in with Google' });
    expect(screen.getByLabelText('API origin')).toHaveValue('https://wipster.fedotovs.net');
    expect(invoke).toHaveBeenCalledWith('cloud_capabilities', { originUrl: 'https://wipster.fedotovs.net' });
    expect(screen.queryByLabelText('Phone')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('SMS code')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(google);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cloud_google_login', {
      originUrl: 'https://wipster.fedotovs.net', importLocal: true, link: false,
    }));
    expect(screen.getByText(/matching email does not transfer data/)).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBeNull();
  });
  it('shows pending browser state, supports cancellation and a fresh retry', async () => {
    let rejectLogin: (error: string) => void = () => {};
    mockCommands();
    const commands = invoke.getMockImplementation()!;
    invoke.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === 'cloud_google_login') return new Promise((_, reject) => { rejectLogin = reject; });
      if (command === 'cloud_google_cancel') { rejectLogin('Google sign-in cancelled'); return Promise.resolve(); }
      return commands(command, ...args);
    });
    render(<AccountPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByText(/Complete sign-in in your system browser/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }));
    expect(await screen.findByText('Google sign-in cancelled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
  });
  it.each(['Google sign-in was declined. Please try again.', 'Google sign-in timed out. Please try again.', 'Import stopped: the cloud account already contains data.'])('shows failure and keeps import choice for retry: %s', async message => {
    mockCommands(); const commands = invoke.getMockImplementation()!;
    invoke.mockImplementation((command: string, ...args: unknown[]) => command === 'cloud_google_login' ? Promise.reject(message) : commands(command, ...args));
    render(<AccountPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
  });
  it('fails closed when capabilities are unavailable and offers retry', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'cloud_import_preview') return preview;
      throw new Error('offline');
    });
    render(<AccountPanel />);
    expect(await screen.findByText('Could not load sign-in methods.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Phone')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).not.toBeInTheDocument();
    mockCommands(); fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
  });
  it('shows optional SMS provider errors and permits a safe retry', async () => {
    mockCommands({ google: true, sms: true }); const commands = invoke.getMockImplementation()!;
    invoke.mockImplementation((command: string, ...args: unknown[]) => command === 'cloud_start' ? Promise.reject('Phone verification unavailable') : commands(command, ...args));
    render(<AccountPanel />);
    fireEvent.change(await screen.findByLabelText('Phone'), { target: { value: '+14155552671' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText(/Phone verification unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send code' })).toBeEnabled();
    expect(screen.queryByLabelText('SMS code')).not.toBeInTheDocument();
  });
  it('displays email and name and links the existing signed-in account without import', async () => {
    state.status.account = { origin: 'https://sync.example.com', phone: '+14155552671', name: 'Person', email: 'person@example.com' };
    mockCommands(); render(<AccountPanel />);
    expect(screen.getByText('Person')).toBeInTheDocument(); expect(screen.getByText('person@example.com')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Link Google' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cloud_google_login', {
      originUrl: 'https://sync.example.com', importLocal: false, link: true,
    }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it('localizes Google action and denial in Russian', async () => {
    useI18n.getState().setLocale('ru');
    mockCommands(); const commands = invoke.getMockImplementation()!;
    invoke.mockImplementation((command: string, ...args: unknown[]) => command === 'cloud_google_login' ? Promise.reject('Google sign-in was declined.') : commands(command, ...args));
    render(<AccountPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти через Google' }));
    expect(await screen.findByText(/Вход через Google не разрешён/)).toBeInTheDocument();
  });
  it('renders browser account status without invoking native IPC', () => {
    isTauri.mockReturnValue(false);
    render(<AccountPanel />);
    expect(screen.getByText(/Изменения сначала сохраняются на устройстве/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
});


describe('primary Yandex ID flow', () => {
  beforeEach(() => {
    invoke.mockReset(); refresh.mockReset(); isTauri.mockReturnValue(true); localStorage.clear();
    state.status.account = null; useI18n.getState().setLocale('ru');
    invoke.mockImplementation(async (command: string) => {
      if (command === 'cloud_import_preview') return preview;
      if (command === 'cloud_capabilities') return { yandex: true, google: false, sms: false };
    });
  });
  it('uses Yandex ID primary without phone or frontend OAuth material', async () => {
    render(<AccountPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти с Яндекс ID' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cloud_yandex_login', {
      originUrl: 'https://wipster.fedotovs.net', importLocal: false, link: false,
    }));
    expect(screen.queryByLabelText('Телефон')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument();
    expect(screen.getByText(/без доступа к письмам/)).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBeNull();
  });
  it('links current Google account to Yandex without switching workspace or importing', async () => {
    state.status.account = { origin: 'https://old.example.com', email: 'same@example.com', google_linked: true };
    render(<AccountPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Привязать Яндекс ID' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cloud_yandex_login', {
      originUrl: 'https://old.example.com', importLocal: false, link: true,
    }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByText('same@example.com')).toBeInTheDocument();
  });
  it('cancels pending Yandex and permits retry after localized denial', async () => {
    const commands = invoke.getMockImplementation()!;
    let rejectLogin: (message: string) => void = () => {};
    invoke.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === 'cloud_yandex_login') return new Promise((_, reject) => { rejectLogin = reject; });
      if (command === 'cloud_yandex_cancel') { rejectLogin('Yandex sign-in cancelled'); return Promise.resolve(); }
      return commands(command, ...args);
    });
    render(<AccountPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти с Яндекс ID' }));
    expect(await screen.findByText(/Завершите вход в системном браузере/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить вход' }));
    expect(await screen.findByText(/Вход через Яндекс ID отменён/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Войти с Яндекс ID' })).toBeEnabled();
  });
  it.each([
    ['Yandex sign-in was declined.', /Вход через Яндекс ID не разрешён/],
    ['Yandex sign-in timed out.', /Время ожидания Яндекс ID истекло/],
    ['This Yandex ID belongs to another Wipster account.', /Аккаунты не объединены/],
  ])('localizes failure and keeps retry available: %s', async (message, expected) => {
    const commands = invoke.getMockImplementation()!;
    invoke.mockImplementation((command: string, ...args: unknown[]) => command === 'cloud_yandex_login' ? Promise.reject(message) : commands(command, ...args));
    render(<AccountPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти с Яндекс ID' }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Войти с Яндекс ID' })).toBeEnabled();
  });
});
