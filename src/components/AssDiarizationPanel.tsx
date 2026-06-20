import React, { useState, useEffect } from 'react';
import { Mic, Loader2, Play, Save, ChevronRight, AlertCircle, CheckCircle2, Download, Settings2, Sparkles, User, Users, ArrowRight, Table, Eye, EyeOff } from 'lucide-react';
import { Episode, SubtitleLine } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { toast } from 'sonner';

interface AssDiarizationPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

export default function AssDiarizationPanel({ currentEpisode, onRefresh }: AssDiarizationPanelProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [status, setStatus] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isModelDownloaded, setIsModelDownloaded] = useState(false);
  const [modelStatusText, setModelStatusText] = useState('Проверка...');
  
  // Options
  const [expectedSpeakers, setExpectedSpeakers] = useState<number>(0); // 0 means "Auto"
  const [previewLinesCount, setPreviewLinesCount] = useState<Record<string, boolean>>({});

  // Diarization results
  const [mappingResult, setMappingResult] = useState<Record<string, string> | null>(null);
  const [detectedCount, setDetectedCount] = useState<number>(0);
  const [speakerAssignments, setSpeakerAssignments] = useState<Record<string, string>>({}); // speaker -> mapped character name
  const [subLines, setSubLines] = useState<SubtitleLine[]>([]);

  // Detailed step-by-step progress
  const [currentStep, setCurrentStep] = useState(1);
  const [totalSteps, setTotalSteps] = useState(4);
  const [itemsProcessed, setItemsProcessed] = useState(0);
  const [itemsTotal, setItemsTotal] = useState(0);

  useEffect(() => {
    checkModelStatus();
    loadSubtitles();
  }, [currentEpisode?.subPath]);

  const checkModelStatus = async () => {
    try {
      const state = await ipcSafe.invoke('check-diarization-status');
      if (state) {
        setIsModelDownloaded(state.isLoaded);
        if (state.isLoaded) {
          setModelStatusText('Готова к работе');
        } else if (state.isLoading) {
          setModelStatusText(state.loadingStatus || 'Загрузка...');
          setDownloadProgress(state.downloadProgress || 0);
        } else {
          setModelStatusText('Не скачана');
        }
      }
    } catch (err) {
      console.error('Error checking diarization model status:', err);
    }
  };

  const loadSubtitles = async () => {
    if (!currentEpisode?.subPath) return;
    try {
      const result = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      setSubLines(result.lines || result || []);
    } catch (err) {
      console.error("Error loading subtitles:", err);
    }
  };

  const handleDownloadModel = async () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    setStatus('Запуск процесса скачивания модели pyannote-segmentation-3.0...');
    
    let pollInterval = setInterval(async () => {
      try {
        const state = await ipcSafe.invoke('check-diarization-status');
        if (state) {
          if (typeof state.downloadProgress === 'number') {
            setDownloadProgress(state.downloadProgress);
          }
          if (state.loadingStatus) {
            setModelStatusText(state.loadingStatus);
          }
          if (state.isLoaded) {
            setIsModelDownloaded(true);
            setModelStatusText('Готова к работе');
            clearInterval(pollInterval);
          }
        }
      } catch (pollErr) {
        console.error('Error polling download status:', pollErr);
      }
    }, 1000);

    try {
      await ipcSafe.invoke('load-diarization-model');
      toast.success('Модель pyannote-segmentation-3.0 успешно скачана и скомпилирована в памяти!');
    } catch (err: any) {
      toast.error(`Ошибка при подготовке модели: ${err.message}`);
    } finally {
      clearInterval(pollInterval);
      setIsDownloading(false);
      setStatus('');
      await checkModelStatus();
    }
  };

  const handleStartDiarization = async () => {
    if (!currentEpisode || !currentEpisode.rawPath) {
      toast.error("Не указан путь к видеофайлу");
      return;
    }
    if (!currentEpisode.subPath || subLines.length === 0) {
      toast.error("Не найдены субтитры для анализа");
      return;
    }

    setIsProcessing(true);
    setStatus('Инициализация...');
    setCurrentStep(1);
    setItemsProcessed(0);
    setItemsTotal(0);

    // Listen to progress steps from back-end
    const removeListener = ipcSafe.on('diarization-step', (data: any) => {
      if (data) {
        if (data.step) setCurrentStep(data.step);
        if (data.totalSteps) setTotalSteps(data.totalSteps);
        if (data.message) setStatus(data.message);
        if (typeof data.current === 'number') setItemsProcessed(data.current);
        if (typeof data.total === 'number') setItemsTotal(data.total);
      }
    });

    try {
      const result = await ipcSafe.invoke('run-diarization', {
        videoPath: currentEpisode.rawPath,
        subtitleLines: subLines,
        expectedSpeakersCount: expectedSpeakers > 0 ? expectedSpeakers : undefined
      });

      if (result && result.speakerMapping) {
        setMappingResult(result.speakerMapping);
        setDetectedCount(result.detectedSpeakersCount);
        
        // Initialize assignments
        const initialAssignments: Record<string, string> = {};
        for (let i = 1; i <= result.detectedSpeakersCount; i++) {
          initialAssignments[`Speaker ${i}`] = '';
        }
        setSpeakerAssignments(initialAssignments);
        toast.success(`Диаризация завершена успешно! Найдено голосов: ${result.detectedSpeakersCount}`);
      }
    } catch (err: any) {
      console.error('Diarization Error:', err);
      toast.error(`Ошибка при диаризации: ${err.message}`);
      setStatus(`Ошибка: ${err.message}`);
    } finally {
      removeListener();
      setIsProcessing(false);
    }
  };

  const handleApplySpeakers = async () => {
    if (!mappingResult || !currentEpisode?.subPath) return;

    try {
      setStatus('Применение измененных имен персонажей к репликам...');
      // Clone original lines and re-map speaker names
      const updatedLines = subLines.map(line => {
        const detectedSpeaker = mappingResult[line.id];
        if (detectedSpeaker) {
          const mappedName = speakerAssignments[detectedSpeaker];
          if (mappedName && mappedName.trim()) {
            return {
              ...line,
              name: mappedName.trim()
            };
          }
        }
        return line;
      });

      await ipcSafe.invoke('save-raw-subtitles', {
        filePath: currentEpisode.subPath,
        lines: updatedLines
      });

      toast.success('Имена персонажей успешно применены к субтитрам!');
      setMappingResult(null); // Reset results screen
      onRefresh();
      loadSubtitles();
    } catch (err: any) {
      toast.error(`Ошибка при сохранении субтитров: ${err.message}`);
    } finally {
      setStatus('');
    }
  };

  const getLinesForSpeaker = (speakerId: string) => {
    if (!mappingResult) return [];
    return subLines.filter(l => mappingResult[l.id] === speakerId);
  };

  const togglePreview = (speakerId: string) => {
    setPreviewLinesCount(prev => ({
      ...prev,
      [speakerId]: !prev[speakerId]
    }));
  };

  const availableCharacters = Array.from(new Set(
    (currentEpisode?.assignments || []).map(a => a.characterName)
  )).filter(Boolean);

  return (
    <div className="flex flex-col items-center justify-center min-h-[500px] p-6 text-center space-y-6 overflow-y-auto">
      <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center border border-indigo-500/20">
        <Users className="w-8 h-8 text-indigo-400" />
      </div>

      <div className="max-w-md space-y-2">
        <h2 className="text-xl font-bold text-white">Разделение голосов (Diarization)</h2>
        <p className="text-xs text-neutral-400 leading-relaxed">
          Локальная нейросеть pyannote-segmentation-3.0 группирует реплики субтитров по голосам говорящих персонажей прямо на вашем компьютере.
        </p>
      </div>

      {!mappingResult ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
          {/* Settings */}
          <div className="p-5 bg-neutral-900/50 border border-neutral-800 rounded-2xl text-left space-y-4">
            <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
              <Settings2 className="w-4 h-4" />
              Параметры диаризации
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-neutral-500 uppercase font-bold mb-1.5 block tracking-wider">Количество спикеров</label>
                <div className="relative">
                  <select 
                    value={expectedSpeakers}
                    onChange={(e) => setExpectedSpeakers(Number(e.target.value))}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white px-3 py-2 outline-none focus:border-indigo-500/50 transition-colors"
                  >
                    <option value={0}>Автоопределение (Рекомендуется)</option>
                    <option value={1}>1 персонаж</option>
                    <option value={2}>2 персонажа</option>
                    <option value={3}>3 персонажа</option>
                    <option value={4}>4 персонажа</option>
                    <option value={5}>5 персонажей</option>
                    <option value={6}>6 персонажей</option>
                  </select>
                </div>
                <p className="text-[10px] text-neutral-500 mt-1 leading-snug">
                  Если вы знаете точное количество говорящих персонажей, укажите его для идеальной группировки.
                </p>
              </div>

              <div>
                <label className="text-[10px] text-neutral-500 uppercase font-bold mb-1.5 block tracking-wider">Локальное ядро AI</label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-neutral-950 px-3 py-2 border border-neutral-800 rounded-xl">
                    <span className="text-xs text-neutral-300 font-medium font-mono">pyannote-segmentation-3.0 (ONNX)</span>
                    {isModelDownloaded ? (
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-2.5 py-0.5 rounded-full border border-emerald-500/20 font-bold">
                        Готова
                      </span>
                    ) : (
                      <span className="text-[10px] bg-amber-500/10 text-amber-500 px-2.5 py-0.5 rounded-full border border-amber-500/20 font-bold">
                        Не скачана
                      </span>
                    )}
                  </div>

                  {!isModelDownloaded && (
                    <button
                      onClick={handleDownloadModel}
                      disabled={isDownloading}
                      className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                    >
                      {isDownloading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      {isDownloading ? `Скачивание... ${downloadProgress}%` : 'Инициализировать / Скачать ядро'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Guidelines */}
          <div className="p-5 bg-neutral-900/50 border border-neutral-800 rounded-2xl text-left flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
                <Sparkles className="w-4 h-4" />
                Как это работает?
              </div>
              <ul className="text-[11px] text-neutral-400 space-y-2 list-none">
                <li className="flex gap-2">
                  <span className="text-indigo-500 font-bold">•</span>
                  <span>Быстро декодируется звуковая дорожка серии.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-indigo-500 font-bold">•</span>
                  <span>Нейросеть вырезает каждый отрезок по таймингу субтитров и строит его векторный отпечаток.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-indigo-500 font-bold">•</span>
                  <span>Производится математическая кластеризация векторов для определения групп голосов.</span>
                </li>
              </ul>
            </div>

            <div className="mt-4 p-2 bg-indigo-500/5 border border-indigo-500/10 rounded-xl">
               <p className="text-[10px] text-neutral-400 leading-snug">
                 <strong className="text-indigo-400">Совет:</strong> Тихие, экстремально короткие или фоновые шумы будут автоматически пропущены, чтобы не засорять разделение.
               </p>
            </div>
          </div>
        </div>
      ) : (
        /* Results and Mapping Area */
        <div className="w-full max-w-3xl bg-neutral-900/40 border border-neutral-800 rounded-2xl p-6 text-left space-y-6">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
            <div>
              <h3 className="text-lg font-bold text-white">Результат разделения</h3>
              <p className="text-xs text-neutral-400">Сопоставьте обнаруженные голоса с именами персонажей в вашем проекте.</p>
            </div>
            <span className="text-xs bg-indigo-500/10 text-indigo-300 font-bold border border-indigo-500/20 px-3 py-1 rounded-full">
              Обнаружено голосов: {detectedCount}
            </span>
          </div>

          <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1">
            {Array.from({ length: detectedCount }).map((_, idx) => {
              const speakerId = `Speaker ${idx + 1}`;
              const speakerLines = getLinesForSpeaker(speakerId);
              const previewShow = previewLinesCount[speakerId] || false;

              return (
                <div key={speakerId} className="p-4 bg-neutral-950/60 border border-neutral-800 rounded-xl space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-bold text-neutral-300">
                        {idx + 1}
                      </div>
                      <div>
                        <span className="text-xs font-bold text-white">{speakerId}</span>
                        <div className="text-[10px] text-neutral-400 font-mono">
                          Реплик: {speakerLines.length}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => togglePreview(speakerId)}
                        className="p-1 px-2.5 rounded-lg text-[10px] font-bold border border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-white hover:border-neutral-700 transition-all flex items-center gap-1 shrink-0"
                      >
                        {previewShow ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        {previewShow ? 'Скрыть примеры' : 'Слушать примеры текста'}
                      </button>

                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Имя персонажа"
                          value={speakerAssignments[speakerId]}
                          onChange={(e) => setSpeakerAssignments(prev => ({
                            ...prev,
                            [speakerId]: e.target.value
                          }))}
                          list={`characters-datalist-${speakerId}`}
                          className="bg-neutral-900 border border-neutral-800 text-xs text-white rounded-lg px-3 py-1.5 focus:border-indigo-500 outline-none w-44"
                        />
                        <datalist id={`characters-datalist-${speakerId}`}>
                          {availableCharacters.map(char => (
                            <option key={char} value={char} />
                          ))}
                        </datalist>
                      </div>
                    </div>
                  </div>

                  {previewShow && (
                    <div className="mt-2 text-[10px] text-neutral-400 space-y-1 px-3 py-2 bg-neutral-900/40 rounded-lg border border-neutral-800 divide-y divide-neutral-900">
                      {speakerLines.slice(0, 4).map(l => (
                        <div key={l.id} className="py-1 flex justify-between gap-2">
                          <span className="text-neutral-500 font-mono shrink-0">{l.start}</span>
                          <span className="truncate text-left flex-1 font-sans">"{l.text}"</span>
                          <span className="text-[9px] text-neutral-600 font-mono shrink-0">#{l.id}</span>
                        </div>
                      ))}
                      {speakerLines.length === 0 && (
                        <div className="py-1 text-center text-neutral-500">Нет подходящих примеров реплик.</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 justify-end pt-4 border-t border-neutral-800">
            <button
              onClick={() => setMappingResult(null)}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-bold transition-colors"
            >
              Отменить
            </button>
            <button
              onClick={handleApplySpeakers}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/20"
            >
              Применить имена к субтитрам
            </button>
          </div>
        </div>
      )}

      {/* Primary start block */}
      {!mappingResult && (
        <div className="space-y-4 w-full flex flex-col items-center">
          <button 
            onClick={handleStartDiarization}
            disabled={isProcessing || !currentEpisode?.rawPath || !isModelDownloaded}
            className="px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all flex items-center gap-3 disabled:opacity-50 shadow-xl shadow-indigo-500/20 group active:scale-95 text-sm"
          >
            {isProcessing ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Sparkles className="w-5 h-5 group-hover:scale-110 transition-all text-indigo-200" />
            )}
            <span>
              {isProcessing ? 'Идет распределение...' : 'Запустить диаризацию голосов'}
            </span>
          </button>

          {!currentEpisode?.rawPath && (
            <div className="flex items-center gap-2 text-amber-500 text-xs bg-amber-500/10 px-4 py-1.5 rounded-lg border border-amber-500/25 animate-pulse">
              <AlertCircle className="w-3.5 h-3.5" />
              Сначала выберите видеофайл в настройках этой серии
            </div>
          )}
        </div>
      )}

      {status && (
        <div className="flex flex-col items-center gap-2">
          <div className="px-5 py-2.5 bg-neutral-800 text-neutral-300 rounded-xl text-xs border border-neutral-700 shadow-lg">
            {status}
          </div>
          {isProcessing && (
            <div className="space-y-1 text-center">
              <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider font-mono">
                Шаг {currentStep} из {totalSteps}
              </div>
              {currentStep === 3 && itemsTotal > 0 && (
                <div className="w-48 h-1.5 bg-neutral-950 rounded-full overflow-hidden border border-neutral-800">
                  <div 
                    className="h-full bg-indigo-500 transition-all duration-300" 
                    style={{ width: `${Math.round((itemsProcessed / itemsTotal) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
