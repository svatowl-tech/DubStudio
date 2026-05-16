import { useState, useEffect } from 'react';
import { Settings, Save, Folder, Cpu, Key, Terminal, Cloud, RefreshCw, ExternalLink, X } from 'lucide-react';
import { ipcSafe } from '../lib/ipcSafe';

export default function SettingsPanel() {
  const [settings, setSettings] = useState({
    baseDir: '',
    ffmpegPath: '',
    useNvenc: false,
    gpuIndex: '0',
    openRouterKey: '',
    aiModel: 'google/gemini-2.0-flash-lite-preview-02-05:free',
    aiProvider: 'openrouter', // 'openrouter', 'ollama'
    ollamaEnabled: false,
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3',
    yandexClientId: 'ba2d620516e94f91b713e1afaa74283e',
    yandexClientSecret: 'd7bf8221a1a74aeea750887581de5ea6'
  });

  const [syncStatus, setSyncStatus] = useState({ connected: false, enabled: false });
  const [isSyncing, setIsSyncing] = useState(false);
  const [showAuthCodeInput, setShowAuthCodeInput] = useState(false);
  const [authCode, setAuthCode] = useState('');

  const aiModels = [
    { id: 'google/gemini-2.0-flash-lite-preview-02-05:free', name: 'Google: Gemini 2.0 Flash Lite (free)' },
    { id: 'google/gemini-2.0-flash-exp:free', name: 'Google: Gemini 2.0 Flash Exp (free)' },
    { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek: R1 (free)' },
    { id: 'deepseek/deepseek-chat:free', name: 'DeepSeek: V3 (free)' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta: Llama 3.3 70B (free)' },
    { id: 'qwen/qwen-2.5-72b-instruct:free', name: 'Qwen: 2.5 72B (free)' },
    { id: 'openrouter/auto', name: 'Free Models Router (Auto)' }
  ];

  const [gpus, setGpus] = useState<{ name: string, index: string }[]>([]);
  const [ollamaModels, setOllamaModels] = useState<{ name: string }[]>([]);
  const [isFetchingOllama, setIsFetchingOllama] = useState(false);

  useEffect(() => {
    ipcSafe.invoke('get-config').then(data => {
      if (data) {
        setSettings(prev => ({ 
          ...prev, 
          ...data,
          // Ensure defaults if missing
          baseDir: data.baseDir || '',
          ffmpegPath: data.ffmpegPath || '',
          useNvenc: !!data.useNvenc,
          gpuIndex: data.gpuIndex || '0',
          openRouterKey: data.openRouterKey || '',
          aiModel: data.aiModel || 'google/gemini-2.0-flash-lite-preview-02-05:free',
          aiProvider: data.aiProvider || 'openrouter',
          ollamaEnabled: !!data.ollamaEnabled,
          ollamaUrl: data.ollamaUrl || 'http://localhost:11434',
          ollamaModel: data.ollamaModel || 'llama3',
          yandexClientId: data.yandexClientId || 'ba2d620516e94f91b713e1afaa74283e',
          yandexClientSecret: data.yandexClientSecret || 'd7bf8221a1a74aeea750887581de5ea6'
        }));
      }
    });

    ipcSafe.invoke('get-gpus').then(setGpus);
    ipcSafe.invoke('cloud-sync-status').then(setSyncStatus);
  }, []);

  const handleConnectYandex = async () => {
    try {
      const url = await ipcSafe.invoke('yandex-get-auth-url');
      const authWindow = window.open(url, 'yandex_oauth', 'width=600,height=700');
      
      const handleMessage = async (event: MessageEvent) => {
        // Handle message from OAuth popup
        if (event.data?.type === 'YANDEX_AUTH_SUCCESS') {
          const { code } = event.data;
          const res = await ipcSafe.invoke('yandex-exchange-token', { code });
          if (res.success) {
            alert('Яндекс.Диск подключен!');
            ipcSafe.invoke('cloud-sync-status').then(setSyncStatus);
          } else {
            alert('Ошибка подключения: ' + res.error);
          }
          window.removeEventListener('message', handleMessage);
        }
      };
      window.addEventListener('message', handleMessage);

      // Manual fallback code entry - show input field instead of prompt
      setTimeout(() => {
        setShowAuthCodeInput(true);
      }, 2000);
    } catch (error) {
      console.error('Yandex connect error:', error);
    }
  };

  const handleSyncPush = async () => {
    setIsSyncing(true);
    try {
      const res = await ipcSafe.invoke('cloud-push');
      if (res.success) alert('Все данные и файлы проектов успешно выгружены на Яндекс.Диск!');
      else alert('Ошибка при выгрузке: ' + res.error);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncPull = async () => {
    if (!confirm('Это действие перезапишет локальные данные и файлы проектов данными из облака. Продолжить?')) return;
    setIsSyncing(true);
    try {
      const res = await ipcSafe.invoke('cloud-pull');
      if (res.success) {
        alert('Данные и файлы проектов успешно загружены из облака! Приложение будет перезагружено.');
        window.location.reload();
      } else {
        alert('Ошибка при загрузке: ' + res.error);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSelectFolder = async (key: 'baseDir') => {
    try {
      const res = await ipcSafe.invoke('select-folder');
      if (res && res.path) {
        setSettings(prev => ({ ...prev, [key]: res.path }));
      }
    } catch (e: any) {
      if (e && e.message !== 'Selection canceled') console.error(e);
    }
  };

  const fetchOllamaModels = async () => {
    if (isFetchingOllama) return;
    setIsFetchingOllama(true);
    try {
      const res = await ipcSafe.invoke('get-ollama-models', { url: settings.ollamaUrl });
      if (Array.isArray(res)) {
        setOllamaModels(res);
      }
    } catch (err) {
      console.error('Failed to fetch Ollama models:', err);
    } finally {
      setIsFetchingOllama(false);
    }
  };
  const handleSave = async () => {
    try {
      await ipcSafe.invoke('save-config', settings);
      alert('Настройки сохранены!');
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('Ошибка при сохранении настроек');
    }
  };

  return (
    <div className="p-8 max-w-4xl w-full mx-auto space-y-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-neutral-800 rounded-xl flex items-center justify-center shadow-lg">
          <Settings className="w-5 h-5 text-neutral-400" />
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Настройки</h1>
      </div>

      <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl p-6 space-y-8">
        {/* Пути */}
        <section>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Folder className="w-5 h-5 text-blue-400" />
            Пути к файлам
          </h2>
          <div className="grid gap-4">
            <div>
              <label className="block text-sm text-neutral-400 mb-2">Рабочая директория (База проектов)</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={settings.baseDir}
                  onChange={(e) => setSettings({...settings, baseDir: e.target.value})}
                  className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 outline-none"
                  placeholder="Выберите папку для хранения проектов"
                />
                <button 
                  onClick={() => handleSelectFolder('baseDir')}
                  className="bg-neutral-800 hover:bg-neutral-700 text-white px-4 rounded-lg transition-colors"
                  title="Выбрать папку"
                >
                  <Folder className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div>
              <label className="block text-sm text-neutral-400 mb-2">Путь к FFmpeg (ffmpeg.exe)</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={settings.ffmpegPath}
                  onChange={(e) => setSettings({...settings, ffmpegPath: e.target.value})}
                  className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 outline-none"
                  placeholder="Оставьте пустым для использования встроенного"
                />
                <button 
                  onClick={async () => {
                    try {
                      const res = await ipcSafe.invoke('select-file', {
                        filters: [{ name: 'Executables', extensions: ['exe', 'bin', 'sh'] }]
                      });
                      if (res && res.path) {
                        setSettings({...settings, ffmpegPath: res.path});
                      }
                    } catch (e: any) {
                      if (e && e.message !== 'Selection canceled') console.error(e);
                    }
                  }}
                  className="bg-neutral-800 hover:bg-neutral-700 text-white px-4 rounded-lg transition-colors"
                  title="Выбрать файл"
                >
                  <Terminal className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </section>


        {/* AI Провайдер */}
        <section>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Key className="w-5 h-5 text-amber-400" />
            Настройки AI (Перевод)
          </h2>
          
          <div className="flex gap-4 mb-6 p-1 bg-neutral-950 rounded-lg border border-neutral-800">
            <button 
              onClick={() => setSettings({...settings, aiProvider: 'openrouter'})}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${settings.aiProvider === 'openrouter' ? 'bg-amber-600 text-white' : 'text-neutral-400 hover:text-white'}`}
            >
              OpenRouter (Облако)
            </button>
            <button 
              onClick={() => setSettings({...settings, aiProvider: 'ollama'})}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${settings.aiProvider === 'ollama' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-white'}`}
            >
              Ollama (Локально)
            </button>
          </div>

          <div className="space-y-4">
            {settings.aiProvider === 'openrouter' ? (
              <>
                <div>
                  <label className="block text-sm text-neutral-400 mb-2">OpenRouter API Key</label>
                  <div className="relative">
                    <input 
                      type="password" 
                      value={settings.openRouterKey}
                      onChange={(e) => setSettings({...settings, openRouterKey: e.target.value})}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:border-amber-500 outline-none"
                      placeholder="sk-or-v1-..."
                    />
                    <Key className="w-4 h-4 text-neutral-600 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-neutral-400 mb-2">Модель OpenRouter</label>
                  <select 
                    value={settings.aiModel}
                    onChange={(e) => setSettings({...settings, aiModel: e.target.value})}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:border-amber-500 outline-none appearance-none cursor-pointer"
                  >
                    {aiModels.map(model => (
                      <option key={model.id} value={model.id}>{model.name}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm text-neutral-400 mb-2">Ollama Base URL</label>
                  <input 
                    type="text" 
                    value={settings.ollamaUrl}
                    onChange={(e) => setSettings({...settings, ollamaUrl: e.target.value})}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:border-indigo-500 outline-none"
                    placeholder="http://localhost:11434"
                  />
                </div>

                <div>
                  <label className="block text-sm text-neutral-400 mb-2">Модель Ollama</label>
                  <div className="relative">
                    <select 
                      value={settings.ollamaModel}
                      onFocus={fetchOllamaModels}
                      onChange={(e) => setSettings({...settings, ollamaModel: e.target.value})}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:border-indigo-500 outline-none appearance-none cursor-pointer"
                    >
                      <option value="" disabled>Выберите скачанную модель</option>
                      {ollamaModels.map(m => (
                        <option key={m.name} value={m.name}>{m.name}</option>
                      ))}
                      {!ollamaModels.some(m => m.name === settings.ollamaModel) && settings.ollamaModel && (
                        <option value={settings.ollamaModel}>{settings.ollamaModel} (сохранено)</option>
                      )}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-500">
                      <Terminal className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-[10px] text-neutral-500 mt-2">
                    Список загружается из вашей локальной Ollama при нажатии на поле.
                  </p>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Видеокарта */}
        <section>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-green-400" />
            Аппаратное ускорение (NVENC)
          </h2>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input 
                type="checkbox" 
                id="useNvenc"
                checked={settings.useNvenc}
                onChange={(e) => setSettings({...settings, useNvenc: e.target.checked})}
                className="w-5 h-5 rounded border-neutral-800 bg-neutral-950 text-green-600 focus:ring-green-500 focus:ring-offset-neutral-900"
              />
              <label htmlFor="useNvenc" className="text-white cursor-pointer select-none">
                Использовать NVENC для рендеринга и транскодирования
              </label>
            </div>

            {settings.useNvenc && (
              <div>
                <label className="block text-sm text-neutral-400 mb-2">Выберите видеокарту</label>
                <select 
                  value={settings.gpuIndex}
                  onChange={(e) => setSettings({...settings, gpuIndex: e.target.value})}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:border-green-500 outline-none appearance-none cursor-pointer"
                >
                  {gpus.map(gpu => (
                    <option key={gpu.index} value={gpu.index}>GPU {gpu.index}: {gpu.name}</option>
                  ))}
                  {gpus.length === 0 && <option value="0">Видеокарта по умолчанию (0)</option>}
                </select>
              </div>
            )}
          </div>
        </section>

        {/* Облачная синхронизация */}
        <section>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Cloud className="w-5 h-5 text-sky-400" />
            Синхронизация данных (Яндекс.Диск)
          </h2>
          <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-6 space-y-6">
            {!syncStatus.connected ? (
              <div className="space-y-4">
                <p className="text-neutral-400 mb-6 italic text-sm">
                  Подключите Яндекс.Диск для синхронизации проектов, участников и настроек между вашими устройствами.
                </p>

                <div className="text-center py-4 space-y-4">
                  {!showAuthCodeInput ? (
                    <button 
                      onClick={async () => {
                        // First save explicitly to make sure backend has them
                        await ipcSafe.invoke('save-config', settings);
                        handleConnectYandex();
                      }}
                      className="inline-flex items-center gap-3 bg-neutral-800 hover:bg-neutral-700 text-white px-8 py-4 rounded-xl font-bold transition-all border border-neutral-700 group"
                    >
                      <ExternalLink className="w-5 h-5 text-sky-400 group-hover:scale-110 transition-transform" />
                      Подключить Яндекс.Диск
                    </button>
                  ) : (
                    <div className="max-w-md mx-auto bg-neutral-900 p-4 rounded-xl border border-neutral-800 space-y-3">
                      <p className="text-xs text-neutral-400">Введите полученный код подтверждения:</p>
                      <div className="flex gap-2">
                        <input 
                          type="text"
                          value={authCode}
                          onChange={(e) => setAuthCode(e.target.value)}
                          placeholder="Код подтверждения"
                          className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-white outline-none focus:border-sky-500"
                        />
                        <button 
                          onClick={async () => {
                            if (!authCode.trim()) return;
                            const res = await ipcSafe.invoke('yandex-exchange-token', { code: authCode.trim() });
                            if (res === true || res?.success) {
                              alert('Яндекс.Диск подключен!');
                              ipcSafe.invoke('cloud-sync-status').then(setSyncStatus);
                              setShowAuthCodeInput(false);
                              setAuthCode('');
                            } else {
                              alert('Ошибка подключения: ' + (res?.error || 'Unknown error'));
                            }
                          }}
                          className="bg-sky-600 hover:bg-sky-500 text-white px-4 rounded-lg font-medium transition-colors"
                        >
                          ОК
                        </button>
                        <button 
                          onClick={() => {
                            setShowAuthCodeInput(false);
                            setAuthCode('');
                          }}
                          className="bg-neutral-800 hover:bg-neutral-700 text-white px-3 rounded-lg transition-colors"
                        >
                           <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-neutral-900/50 rounded-xl border border-sky-500/20">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-sky-500/10 rounded-full flex items-center justify-center text-sky-400">
                      <Cloud className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="font-bold text-white leading-tight">Яндекс.Диск подключен</p>
                      <p className="text-[10px] text-neutral-500 uppercase tracking-widest mt-1">AnimeDubManagerData folder</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={async () => {
                        if (confirm('Отключить Яндекс.Диск? Токен будет удален.')) {
                          await ipcSafe.invoke('yandex-disconnect');
                          const status = await ipcSafe.invoke('cloud-sync-status');
                          setSyncStatus(status);
                        }
                      }}
                      className="text-[10px] text-red-500 hover:text-red-400 uppercase tracking-wider font-bold px-3 py-1"
                    >
                      Отключить
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    disabled={isSyncing}
                    onClick={handleSyncPush}
                    className="flex flex-col items-center gap-3 p-6 bg-neutral-900 border border-neutral-800 rounded-xl hover:border-sky-500/50 transition-all hover:bg-neutral-800 group disabled:opacity-50"
                  >
                    <RefreshCw className={`w-8 h-8 text-sky-400 ${isSyncing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                    <div className="text-center">
                      <span className="block font-bold text-white mb-1">Выгрузить на облако</span>
                      <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Upload Local to Cloud</span>
                    </div>
                  </button>

                  <button 
                    disabled={isSyncing}
                    onClick={handleSyncPull}
                    className="flex flex-col items-center gap-3 p-6 bg-neutral-900 border border-neutral-800 rounded-xl hover:border-amber-500/50 transition-all hover:bg-neutral-800 group disabled:opacity-50"
                  >
                    <RefreshCw className={`w-8 h-8 text-amber-400 ${isSyncing ? 'animate-spin' : 'group-hover:-rotate-180 transition-transform duration-500'}`} />
                    <div className="text-center">
                      <span className="block font-bold text-white mb-1">Загрузить с облака</span>
                      <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Download Cloud to Local</span>
                    </div>
                  </button>
                </div>
                
                <p className="text-[10px] text-neutral-600 text-center uppercase tracking-[0.2em] pt-2">
                  Синхронизируются данные базы и все файлы проектов
                </p>
              </div>
            )}
          </div>
        </section>

        <button 
          onClick={handleSave}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-4 rounded-lg font-bold transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98]"
        >
          <Save className="w-5 h-5" />
          Сохранить настройки
        </button>
      </div>
    </div>
  );
}
