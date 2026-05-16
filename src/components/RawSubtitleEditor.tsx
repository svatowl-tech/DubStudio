import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Save, Edit3, Loader2, Languages, Eye, EyeOff, AlertCircle } from "lucide-react";
import { ipcSafe } from '../lib/ipcSafe';
import { Episode } from "../types";
import { latinToCyrillic, polivanovToHepburn } from "../lib/translit";
import { useVideoContext } from "../contexts/VideoContext";
import { SIGN_KEYWORDS } from "../constants";

const SHORTCUT_KEYS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
  'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p',
  'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l',
  'z', 'x', 'c', 'v', 'b', 'n', 'm'
];

const SHORTCUT_CODES = [
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0',
  'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP',
  'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL',
  'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM'
];

interface RawSubtitleLine {
  id: number;
  start: string;
  end: string;
  startSec: number;
  endSec: number;
  style: string;
  name: string;
  text: string;
  rawLineIndex: number;
}

interface RawSubtitleEditorProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

export default function RawSubtitleEditor({
  currentEpisode,
  onRefresh,
}: RawSubtitleEditorProps) {
  const [lines, setLines] = useState<RawSubtitleLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [updates, setUpdates] = useState<Record<number, { name?: string; text?: string }>>({});
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null);
  const [showSigns, setShowSigns] = useState(false);
  const [stableNames, setStableNames] = useState<string[]>([]);

  // Only add a name to stable list when it's "committed" (input blured or enter pressed)
  // or if it's already in the file or project characters.
  const commitNewName = (name: string) => {
    if (!name || !name.trim()) return;
    setStableNames(prev => {
      if (!prev.includes(name)) {
        return [...prev, name].sort();
      }
      return prev;
    });
  };

  // For mass assignment
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());
  const [lastSelectedLine, setLastSelectedLine] = useState<number | null>(null);
  const [massName, setMassName] = useState("");

  const { registerPlayer, unregisterPlayer } = useVideoContext();
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

  const parseAssTimeToSeconds = (timeStr: string) => {
    const parts = timeStr.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseFloat(parts[2]);
      return (hours * 3600) + (minutes * 60) + seconds;
    }
    return 0;
  };

  useEffect(() => {
    if (videoRef.current) {
      const player = videoRef.current;
      
      const handleTimeUpdate = () => {
        setCurrentTime(player.currentTime);
      };
      
      player.addEventListener('timeupdate', handleTimeUpdate);

      registerPlayer({
        togglePlayPause: () => {
          if (player.paused) {
            player.play().catch(e => console.error('Play error', e));
          } else {
            player.pause();
          }
        },
        seekToNext: () => {
          const nextSub = lines.find(l => {
            return l.startSec > player.currentTime + 0.1;
          });
          if (nextSub) {
            player.currentTime = nextSub.startSec;
          }
        }
      });

      return () => {
        player.removeEventListener('timeupdate', handleTimeUpdate);
        unregisterPlayer();
      };
    }
  }, [registerPlayer, unregisterPlayer, lines]);

  const isSignLine = useCallback((line: RawSubtitleLine) => {
    const name = (line.name || "").toLowerCase();
    const style = (line.style || "").toLowerCase();
    
    const signs = ["sign", "signs", "title", "op", "ed", "song", "note", "music", "logo", "staff", "credit", "credits", "надпись", "титры", "инфо", "info"];
    
    const isSign = signs.some(s => {
      if (s === 'op' || s === 'ed') {
        const regex = new RegExp(`(^|[^a-z])${s}([^a-z]|$)`, 'i');
        return regex.test(name) || regex.test(style);
      }
      return name.includes(s) || style.includes(s);
    }) || SIGN_KEYWORDS.some(k => name.includes(k.toLowerCase()) || style.includes(k.toLowerCase()));

    return isSign;
  }, []);

  useEffect(() => {
    const active = lines.find(line => {
      if (!showSigns && isSignLine(line)) return false;
      return currentTime >= line.startSec && currentTime <= line.endSec;
    });
    
    if (active && active.rawLineIndex !== activeLineIndex) {
      setActiveLineIndex(active.rawLineIndex);
      // Scroll to active line if it's not in view
      const element = document.getElementById(`line-${active.rawLineIndex}`);
      if (element && !videoRef.current?.paused) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else if (!active && activeLineIndex !== null) {
      setActiveLineIndex(null);
    }
  }, [currentTime, lines, activeLineIndex, showSigns, isSignLine]);

  useEffect(() => {
    if (currentEpisode?.subPath) {
      loadRawSubtitles();
    } else {
      setLines([]);
      setUpdates({});
      setSelectedLines(new Set());
      setLastSelectedLine(null);
    }
  }, [currentEpisode]);

  const loadRawSubtitles = async () => {
    if (!currentEpisode) return;
    setLoading(true);
    setStatus("Загрузка субтитров...");
    try {
      const data = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      const subtitleLines = (data.lines || data).map((l: any) => ({
        ...l,
        startSec: parseAssTimeToSeconds(l.start),
        endSec: parseAssTimeToSeconds(l.end)
      })).sort((a: any, b: any) => a.startSec - b.startSec);
      
      setLines(subtitleLines);
      
      const unassigned = subtitleLines.filter((l: any) => !l.name || !l.name.trim()).length;
      setUnassignedCount(unassigned);
      
      setUpdates({});
      setSelectedLines(new Set());
      setLastSelectedLine(null);
      setStatus(`Загружено ${subtitleLines.length} реплик.`);
    } catch (error) {
      console.error(error);
      setStatus("Ошибка загрузки субтитров.");
    } finally {
      setLoading(false);
    }
  };

  const handleLineUpdate = (rawLineIndex: number, update: { name?: string; text?: string }) => {
    setUpdates((prev) => {
      const current = prev[rawLineIndex] || {};
      const next = { ...prev, [rawLineIndex]: { ...current, ...update } };
      
      // Recalculate unassigned count based on updates
      const newUnassigned = lines.filter(l => {
        const u = next[l.rawLineIndex] || {};
        const name = u.name !== undefined ? u.name : l.name;
        return !name || !name.trim();
      }).length;
      setUnassignedCount(newUnassigned);
      
      return next;
    });
  };

  const toggleLineSelection = (
    rawLineIndex: number,
    isShiftKey: boolean = false,
  ) => {
    setSelectedLines((prev) => {
      const next = new Set(prev);

      if (isShiftKey && lastSelectedLine !== null) {
        // Find indices in the lines array
        const currentIndex = lines.findIndex(
          (l) => l.rawLineIndex === rawLineIndex,
        );
        const lastIndex = lines.findIndex(
          (l) => l.rawLineIndex === lastSelectedLine,
        );

        if (currentIndex !== -1 && lastIndex !== -1) {
          const start = Math.min(currentIndex, lastIndex);
          const end = Math.max(currentIndex, lastIndex);

          // Add all lines in range
          for (let i = start; i <= end; i++) {
            next.add(lines[i].rawLineIndex);
          }
          return next;
        }
      }

      if (next.has(rawLineIndex)) {
        next.delete(rawLineIndex);
      } else {
        next.add(rawLineIndex);
      }
      return next;
    });
    setLastSelectedLine(rawLineIndex);
  };

  const handleMassAssign = () => {
    if (selectedLines.size === 0 || !massName.trim()) return;

    const newUpdates = { ...updates };
    selectedLines.forEach((index) => {
      newUpdates[index] = { ...newUpdates[index], name: massName.trim() };
    });
    setUpdates(newUpdates);
    commitNewName(massName.trim());
    setSelectedLines(new Set());
    setMassName("");
  };

  const handleMassTransliterate = () => {
    if (lines.length === 0) return;
    
    const newUpdates = { ...updates };
    lines.forEach(line => {
      const current = newUpdates[line.rawLineIndex] || {};
      const currentName = current.name !== undefined ? current.name : line.name;
      const currentText = current.text !== undefined ? current.text : line.text;

      const newName = latinToCyrillic(currentName);
      const newText = latinToCyrillic(currentText);
      
      if (newName !== currentName) {
        newUpdates[line.rawLineIndex] = { ...newUpdates[line.rawLineIndex], name: newName };
      }
      
      if (newText !== currentText) {
        newUpdates[line.rawLineIndex] = { ...newUpdates[line.rawLineIndex], text: newText };
      }
    });
    
    setUpdates(newUpdates);
    setStatus("Имена и текст транслитерированы.");
  };

  const handleMassPolivanovToHepburn = () => {
    if (lines.length === 0) return;
    
    const newUpdates = { ...updates };
    lines.forEach(line => {
      const current = newUpdates[line.rawLineIndex] || {};
      const currentName = current.name !== undefined ? current.name : line.name;
      const newName = polivanovToHepburn(currentName);
      
      if (newName !== currentName) {
        newUpdates[line.rawLineIndex] = { ...newUpdates[line.rawLineIndex], name: newName };
      }
    });
    
    setUpdates(newUpdates);
    setStatus("Имена персонажей переведены на систему Хэпберна.");
  };

  const handleSave = async () => {
    if (!currentEpisode || Object.keys(updates).length === 0) return;
    setSaving(true);
    setStatus("Сохранение изменений...");

    const updatesArray = Object.entries(updates).map(
      ([rawLineIndex, update]) => ({
        rawLineIndex: parseInt(rawLineIndex, 10),
        name: update.name,
        text: update.text
      }),
    );

    try {
      await ipcSafe.invoke('save-raw-subtitles', {
        filePath: currentEpisode.subPath,
        lines: updatesArray
      });

      setStatus("Изменения сохранены!");
      setUpdates({});
      // Reload to reflect changes
      await loadRawSubtitles();
      onRefresh();
    } catch (error) {
      console.error(error);
      setStatus("Ошибка при сохранении.");
    } finally {
      setSaving(false);
    }
  };

  const projectCharacters = (() => {
    const raw = currentEpisode?.project?.globalMapping || '[]';
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((c: any) => c.characterName);
      } else {
        return Object.keys(parsed);
      }
    } catch (e) {
      return [];
    }
  })();

  const uniqueNames = useMemo(() => {
    return Array.from(
      new Set([
        ...lines.map((l) => l.name).filter((n) => n && n.trim() !== ""),
        ...projectCharacters,
      ]),
    ).sort();
  }, [lines, projectCharacters]);

  useEffect(() => {
    setStableNames(prev => {
      const next = [...prev];
      let changed = false;
      uniqueNames.forEach(name => {
        if (!next.includes(name)) {
          next.push(name);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [uniqueNames]);

  const handleQuickAssign = useCallback((name: string) => {
    if (selectedLines.size > 0) {
      const newUpdates = { ...updates };
      selectedLines.forEach((index) => {
        newUpdates[index] = { ...newUpdates[index], name };
      });
      setUpdates(newUpdates);
      setSelectedLines(new Set());
    } else if (activeLineIndex !== null) {
      const newUpdates = { ...updates };
      newUpdates[activeLineIndex] = { ...newUpdates[activeLineIndex], name };
      setUpdates(newUpdates);
    } else {
      setMassName(name);
    }
  }, [selectedLines, updates, activeLineIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input or textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const code = e.code;
      const index = SHORTCUT_CODES.indexOf(code);
      
      if (index !== -1 && index < stableNames.length) {
        e.preventDefault();
        handleQuickAssign(stableNames[index]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stableNames, handleQuickAssign]);

  const handleApplyAliases = () => {
    if (!currentEpisode?.project?.characterAliases) return;
    const aliases: Record<string, string> = JSON.parse(currentEpisode.project.characterAliases);
    const newUpdates = { ...updates };
    lines.forEach((line) => {
      const index = line.rawLineIndex;
      const currentName = updates[index]?.name || line.name;
      if (aliases[currentName]) {
        newUpdates[index] = { ...newUpdates[index], name: aliases[currentName] };
      }
    });
    setUpdates(newUpdates);
  };

  const handlePlayFromTime = (timeStr: string) => {
    if (!videoRef.current) return;
    
    // Parse ASS time format: H:MM:SS.cs
    const parts = timeStr.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseFloat(parts[2]);
      
      const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;
      videoRef.current.currentTime = totalSeconds;
      videoRef.current.play().catch(e => console.error('Play error', e));
    }
  };

  if (!currentEpisode?.subPath) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-neutral-500">
        <Edit3 className="w-12 h-12 opacity-20 mb-4" />
        <p>Загрузите файл субтитров (.ass), чтобы начать разметку реплик.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-row h-full overflow-hidden">
      {/* Left Column - Subtitles */}
      <div className="flex-1 flex flex-col bg-neutral-950 border-r border-neutral-800 overflow-hidden relative">
        <div className="flex items-center justify-between p-3 border-b border-neutral-800 bg-neutral-900 shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-neutral-300">Реплики</span>
            <button
              onClick={loadRawSubtitles}
              disabled={loading || saving}
              title="Обновить список субтитров"
              className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs transition-colors border border-neutral-700 flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Обновить"}
            </button>
            <span className="text-xs text-neutral-400">{status}</span>
            {unassignedCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 border border-red-500/20 rounded-full text-red-400 text-xs font-bold animate-pulse">
                <AlertCircle className="w-3.5 h-3.5" />
                Не размечено: {unassignedCount}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowSigns(!showSigns)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              showSigns 
                ? "bg-amber-600/20 text-amber-400 border-amber-500/30 hover:bg-amber-600/30" 
                : "bg-neutral-800 text-neutral-400 border-neutral-700 hover:bg-neutral-700 hover:text-white"
            }`}
            title={showSigns ? "Скрыть технические субтитры" : "Показать технические субтитры"}
          >
            {showSigns ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {showSigns ? "Надписи: ВКЛ" : "Надписи: ВЫКЛ"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col p-2 space-y-1">
          <div className="grid grid-cols-[30px_70px_70px_100px_150px_1fr] gap-3 p-3 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-sm text-xs font-semibold text-neutral-400 uppercase tracking-wider sticky top-0 z-10">
            <div className="text-center">
              <input
                type="checkbox"
                checked={lines.length > 0 && selectedLines.size === lines.length}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedLines(new Set(lines.map((l) => l.rawLineIndex)));
                  } else {
                    setSelectedLines(new Set());
                  }
                }}
                className="rounded border-neutral-700 bg-neutral-900 text-indigo-500 focus:ring-indigo-500/50"
              />
            </div>
            <div>Начало</div>
            <div>Конец</div>
            <div>Стиль</div>
            <div>Актер / Имя</div>
            <div>Текст</div>
          </div>

          <div className="flex-1 overflow-y-auto p-1 space-y-1">
            {lines
              .filter(line => showSigns || !isSignLine(line))
              .map((line) => {
              const isSelected = selectedLines.has(line.rawLineIndex);
              const isActive = activeLineIndex === line.rawLineIndex;
              const currentName =
                updates[line.rawLineIndex]?.name !== undefined
                  ? updates[line.rawLineIndex].name
                  : line.name;

              return (
                <div
                  key={line.rawLineIndex}
                  id={`line-${line.rawLineIndex}`}
                  onClick={(e) => {
                    const tag = (e.target as HTMLElement).tagName;
                    if (tag === "INPUT" || tag === "TEXTAREA") return;
                    handlePlayFromTime(line.start);
                  }}
                  className={`grid grid-cols-[30px_70px_70px_100px_150px_1fr] gap-3 p-2 items-center rounded-lg border transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-indigo-500/10 border-indigo-500/30"
                      : isActive
                      ? "bg-blue-500/10 border-blue-500/30 ring-1 ring-blue-500/20"
                      : "bg-neutral-950 border-transparent hover:border-neutral-800 hover:bg-neutral-900"
                  }`}
                >
                  <div className="text-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleLineSelection(line.rawLineIndex)}
                      className="rounded border-neutral-700 bg-neutral-900 text-indigo-500 focus:ring-indigo-500/50 cursor-pointer"
                    />
                  </div>
                  <div className="text-xs text-neutral-500 font-mono">
                    {line.start}
                  </div>
                  <div className="text-xs text-neutral-500 font-mono">
                    {line.end}
                  </div>
                  <div
                    className="text-xs text-neutral-400 truncate"
                    title={line.style}
                  >
                    {line.style}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      value={currentName}
                      onChange={(e) =>
                        handleLineUpdate(line.rawLineIndex, { name: e.target.value })
                      }
                      onBlur={(e) => commitNewName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      className={`w-full bg-neutral-900 border rounded px-2 py-1 pr-6 text-xs focus:outline-none focus:border-indigo-500 transition-colors ${
                        updates[line.rawLineIndex]?.name !== undefined
                          ? "border-indigo-500/50 text-indigo-300"
                          : !currentName || !currentName.trim()
                          ? "border-red-500/50 text-red-300 bg-red-500/5"
                          : "border-neutral-800 text-neutral-300"
                      }`}
                      placeholder="Имя..."
                      list={`names-${line.rawLineIndex}`}
                    />
                    <datalist id={`names-${line.rawLineIndex}`}>
                      {stableNames.map(name => <option key={name} value={name} />)}
                    </datalist>
                    {(!currentName || !currentName.trim()) && (
                      <AlertCircle className="w-3 h-3 text-red-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                    )}
                  </div>
                  <div className="flex-grow min-w-0">
                    <textarea
                      value={updates[line.rawLineIndex]?.text !== undefined ? updates[line.rawLineIndex].text : line.text}
                      onChange={(e) => handleLineUpdate(line.rawLineIndex, { text: e.target.value })}
                      rows={1}
                      className={`w-full bg-transparent border-none text-xs transition-colors focus:outline-none focus:text-white resize-none py-1 block leading-relaxed ${
                        updates[line.rawLineIndex]?.text !== undefined ? "text-indigo-300" : "text-neutral-200"
                      }`}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = 'auto';
                        target.style.height = target.scrollHeight + 'px';
                      }}
                    />
                  </div>
                </div>
              );
            })}
            {lines.length === 0 && !loading && (
              <div className="text-center py-8 text-neutral-500 text-sm">
                Нет реплик для отображения.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Column - Video & Controls */}
      <div className="w-[420px] flex flex-col shrink-0 bg-neutral-900 overflow-y-auto border-l border-neutral-800">
        {currentEpisode?.rawPath && (
          <div className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950 p-3 shadow-lg">
            <video ref={videoRef} src={currentEpisode.rawPath} controls className="w-full rounded bg-black aspect-video object-contain" />
          </div>
        )}
        
        <div className="p-4 flex flex-col gap-4 border-b border-neutral-800">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">Управление</span>
          </div>
          
          <div className="flex flex-col gap-2">
            <label className="text-xs text-neutral-500">Массовое назначение роли:</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={massName}
                onChange={(e) => setMassName(e.target.value)}
                placeholder="Имя (или Имя1, Имя2)"
                title="Можно указать несколько имен через запятую"
                className="flex-1 bg-neutral-950 border border-neutral-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <button
                onClick={handleMassAssign}
                disabled={selectedLines.size === 0 || !massName.trim()}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm transition-colors border border-indigo-500 whitespace-nowrap"
              >
                Применить ({selectedLines.size})
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button
              onClick={handleMassTransliterate}
              disabled={loading || saving || lines.length === 0}
              className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors border border-neutral-700"
              title="Транслитерация имен (Lat -> Cyr)"
            >
              <Languages className="w-3.5 h-3.5" />
              Транслит
            </button>

            <button
              onClick={handleMassPolivanovToHepburn}
              disabled={loading || saving || lines.length === 0}
              className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors border border-neutral-700"
              title="Поливанов -> Хэпберн (Кириллица)"
            >
              <Languages className="w-3.5 h-3.5 text-amber-400" />
              Хэпберн
            </button>
            
            {currentEpisode?.project?.characterAliases && (
              <button
                onClick={handleApplyAliases}
                disabled={loading || saving || lines.length === 0}
                className="col-span-2 flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors border border-neutral-700"
                title="Автоматически заменить имена-алиасы на основные имена персонажей"
              >
                <Languages className="w-3.5 h-3.5 text-indigo-400" />
                Применить алиасы из словаря
              </button>
            )}
          </div>
          
          <button
            onClick={handleSave}
            disabled={Object.keys(updates).length === 0 || saving}
            title="Сохранить изменения"
            className="flex items-center justify-center gap-2 mt-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Сохранить изменения ({Object.keys(updates).length})
          </button>
        </div>

        {stableNames.length > 0 && (
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">Персонажи</span>
              <span className="text-[10px] text-neutral-500">Авто-назначение: выберите строки и нажмите цифру</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {stableNames.map((name, index) => (
                <button
                  key={name}
                  onClick={() => handleQuickAssign(name)}
                  className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-xs transition-colors border border-neutral-700 flex items-center gap-2 group"
                  title={
                    selectedLines.size > 0
                      ? `Применить к выбранным (${selectedLines.size})`
                      : "Выбрать имя"
                  }
                >
                  {index < SHORTCUT_KEYS.length && (
                    <span className="text-[9px] bg-neutral-950 text-neutral-400 px-1.5 py-0.5 rounded border border-neutral-800 group-hover:text-indigo-400 group-hover:border-indigo-500/30 transition-colors uppercase font-mono shadow-sm">
                      {SHORTCUT_KEYS[index]}
                    </span>
                  )}
                  <span className="truncate max-w-[150px]">{name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
