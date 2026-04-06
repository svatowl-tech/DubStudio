import React, { useState, useEffect, useRef, useCallback } from "react";
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
  const [updates, setUpdates] = useState<Record<number, string>>({});
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null);
  const [showSigns, setShowSigns] = useState(false);

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

  useEffect(() => {
    const active = lines.find(line => {
      return currentTime >= line.startSec && currentTime <= line.endSec;
    });
    
    if (active && active.rawLineIndex !== activeLineIndex) {
      setActiveLineIndex(active.rawLineIndex);
      // Scroll to active line if it's not in view
      const element = document.getElementById(`line-${active.rawLineIndex}`);
      if (element && !videoRef.current?.paused) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentTime, lines, activeLineIndex]);

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

  const handleNameChange = (rawLineIndex: number, newName: string) => {
    setUpdates((prev) => {
      const next = { ...prev, [rawLineIndex]: newName };
      
      // Recalculate unassigned count based on updates
      const newUnassigned = lines.filter(l => {
        const name = next[l.rawLineIndex] !== undefined ? next[l.rawLineIndex] : l.name;
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
      newUpdates[index] = massName.trim();
    });
    setUpdates(newUpdates);
    setSelectedLines(new Set());
    setMassName("");
  };

  const handleMassTransliterate = () => {
    if (lines.length === 0) return;
    
    const newUpdates = { ...updates };
    lines.forEach(line => {
      const newName = latinToCyrillic(line.name);
      const newText = latinToCyrillic(line.text);
      
      if (newName !== line.name) {
        // We'll handle name updates if needed, but the current UI focuses on names
        newUpdates[line.rawLineIndex] = newName;
      }
      
      // Note: The current RawSubtitleEditor only allows editing names, not text.
      // If we want to support text transliteration, we'd need to update the text in the file.
      // For now, let's focus on names as that's what's editable in the UI.
    });
    
    setUpdates(newUpdates);
    setStatus("Имена персонажей транслитерированы.");
  };

  const handleMassPolivanovToHepburn = () => {
    if (lines.length === 0) return;
    
    const newUpdates = { ...updates };
    lines.forEach(line => {
      const currentName = updates[line.rawLineIndex] !== undefined ? updates[line.rawLineIndex] : line.name;
      const newName = polivanovToHepburn(currentName);
      
      if (newName !== currentName) {
        newUpdates[line.rawLineIndex] = newName;
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
      ([rawLineIndex, name]) => ({
        rawLineIndex: parseInt(rawLineIndex, 10),
        name,
      }),
    );

    try {
      await ipcSafe.invoke('save-raw-subtitles', {
        assFilePath: currentEpisode.subPath,
        updates: updatesArray
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

  const uniqueNames = Array.from(
    new Set([
      ...lines.map((l) => l.name).filter((n) => n && n.trim() !== ""),
      ...(Object.values(updates) as string[]).filter(
        (n) => n && n.trim() !== "",
      ),
      ...projectCharacters,
    ]),
  ).sort();

  const handleQuickAssign = useCallback((name: string) => {
    if (selectedLines.size > 0) {
      const newUpdates = { ...updates };
      selectedLines.forEach((index) => {
        const line = lines.find(l => l.rawLineIndex === index);
        const currentVal = newUpdates[index] !== undefined ? newUpdates[index] : (line?.name || "");
        
        if (currentVal) {
          const names = currentVal.split(/[,;]/).map(n => n.trim()).filter(Boolean);
          if (!names.includes(name)) {
            newUpdates[index] = [...names, name].join('; ');
          }
        } else {
          newUpdates[index] = name;
        }
      });
      setUpdates(newUpdates);
      setSelectedLines(new Set());
    } else if (activeLineIndex !== null) {
      const newUpdates = { ...updates };
      const line = lines.find(l => l.rawLineIndex === activeLineIndex);
      const currentVal = newUpdates[activeLineIndex] !== undefined ? newUpdates[activeLineIndex] : (line?.name || "");
      
      if (currentVal) {
        const names = currentVal.split(/[,;]/).map(n => n.trim()).filter(Boolean);
        if (!names.includes(name)) {
          newUpdates[activeLineIndex] = [...names, name].join('; ');
        }
      } else {
        newUpdates[activeLineIndex] = name;
      }
      setUpdates(newUpdates);
    } else {
      setMassName(name);
    }
  }, [selectedLines, updates, lines, activeLineIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input or textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      const index = SHORTCUT_KEYS.indexOf(key);
      
      if (index !== -1 && index < uniqueNames.length) {
        e.preventDefault();
        handleQuickAssign(uniqueNames[index]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [uniqueNames, handleQuickAssign]);

  const handleApplyAliases = () => {
    if (!currentEpisode?.project?.characterAliases) return;
    const aliases: Record<string, string> = JSON.parse(currentEpisode.project.characterAliases);
    const newUpdates = { ...updates };
    lines.forEach((line, index) => {
      const currentName = updates[index] || line.name;
      if (aliases[currentName]) {
        newUpdates[index] = aliases[currentName];
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
    <div className="flex flex-col h-full overflow-hidden">
      {currentEpisode?.rawPath && (
        <div className="bg-neutral-900 border-b border-neutral-800 p-4 shadow-lg shrink-0 z-20 sticky top-0">
          <video ref={videoRef} src={currentEpisode.rawPath} controls className="w-full h-64 object-contain" />
        </div>
      )}
      
      <div className="flex items-center justify-between bg-neutral-900 border-b border-neutral-800 p-4 shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={loadRawSubtitles}
            disabled={loading || saving}
            title="Обновить список субтитров"
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-sm transition-colors border border-neutral-700 flex items-center gap-2"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Обновить"
            )}
          </button>
          <span className="text-sm text-neutral-400">{status}</span>
          {unassignedCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1 bg-red-500/10 border border-red-500/20 rounded-full text-red-400 text-xs font-bold animate-pulse">
              <AlertCircle className="w-3.5 h-3.5" />
              Не размечено: {unassignedCount}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 border-r border-neutral-800 pr-4">
            <input
              type="text"
              value={massName}
              onChange={(e) => setMassName(e.target.value)}
              placeholder="Имя (или Имя1, Имя2)"
              title="Можно указать несколько имен через запятую"
              className="bg-neutral-950 border border-neutral-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500 w-40"
            />
            <button
              onClick={handleMassAssign}
              disabled={selectedLines.size === 0 || !massName.trim()}
              className="px-3 py-1.5 bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 disabled:opacity-50 rounded-lg text-sm transition-colors border border-indigo-500/30"
            >
              Применить к ({selectedLines.size})
            </button>
          </div>

          <button
            onClick={handleMassTransliterate}
            disabled={loading || saving || lines.length === 0}
            className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors border border-neutral-700"
            title="Транслитерация имен (Lat -> Cyr)"
          >
            <Languages className="w-4 h-4" />
            Транслит
          </button>

          <button
            onClick={handleMassPolivanovToHepburn}
            disabled={loading || saving || lines.length === 0}
            className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors border border-neutral-700"
            title="Поливанов -> Хэпберн (Кириллица)"
          >
            <Languages className="w-4 h-4 text-amber-400" />
            Хэпберн
          </button>

          {currentEpisode?.project?.characterAliases && (
            <button
              onClick={handleApplyAliases}
              disabled={loading || saving || lines.length === 0}
              className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors border border-neutral-700"
              title="Автоматически заменить имена-алиасы на основные имена персонажей"
            >
              <Languages className="w-4 h-4 text-indigo-400" />
              Алиасы
            </button>
          )}

          <button
            onClick={handleSave}
            disabled={Object.keys(updates).length === 0 || saving}
            title="Сохранить изменения"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Сохранить ({Object.keys(updates).length})
          </button>

          <button
            onClick={() => setShowSigns(!showSigns)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
              showSigns 
                ? "bg-amber-600/20 text-amber-400 border-amber-500/30 hover:bg-amber-600/30" 
                : "bg-neutral-800 text-neutral-400 border-neutral-700 hover:bg-neutral-700 hover:text-white"
            }`}
            title={showSigns ? "Скрыть технические субтитры" : "Показать технические субтитры"}
          >
            {showSigns ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            {showSigns ? "Надписи: ВКЛ" : "Надписи: ВЫКЛ"}
          </button>
        </div>
      </div>

      {uniqueNames.length > 0 && (
        <div className="bg-neutral-900 border-b border-neutral-800 p-3 flex flex-wrap gap-2 items-center shrink-0">
          <span className="text-xs text-neutral-500 uppercase tracking-wider mr-2">
            Быстрый выбор:
          </span>
          {uniqueNames.map((name, index) => (
            <button
              key={name}
              onClick={() => handleQuickAssign(name)}
              className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded text-xs transition-colors border border-neutral-700 flex items-center gap-2 group"
              title={
                selectedLines.size > 0
                  ? `Применить к выбранным (${selectedLines.size})`
                  : "Выбрать имя"
              }
            >
              {index < SHORTCUT_KEYS.length && (
                <span className="text-[9px] bg-neutral-950 text-neutral-500 px-1 rounded border border-neutral-800 group-hover:text-indigo-400 group-hover:border-indigo-500/30 transition-colors uppercase">
                  {SHORTCUT_KEYS[index]}
                </span>
              )}
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-neutral-950">
        <div className="grid grid-cols-[40px_100px_100px_150px_200px_1fr] gap-4 p-3 border-b border-neutral-800 bg-neutral-950/50 text-xs font-semibold text-neutral-400 uppercase tracking-wider sticky top-0 bg-neutral-950 z-10">
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

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {lines
            .filter(line => {
              if (showSigns) return true;
              const name = (line.name || "").toLowerCase();
              const style = (line.style || "").toLowerCase();
              const text = (line.text || "").toLowerCase();
              
              const signs = ["sign", "signs", "title", "op", "ed", "song", "note", "music", "logo", "staff", "credit", "credits", "надпись", "титры", "инфо", "info"];
              
              const isSign = signs.some(s => {
                if (s === 'op' || s === 'ed') {
                  const regex = new RegExp(`(^|[^a-z])${s}([^a-z]|$)`, 'i');
                  return regex.test(name) || regex.test(style);
                }
                return name.includes(s) || style.includes(s);
              }) || SIGN_KEYWORDS.some(k => name.includes(k.toLowerCase()) || style.includes(k.toLowerCase()));

              // Also check if it's a technical line by style if it doesn't have a name
              if (!name && style && isSign) return false;
              
              return !isSign;
            })
            .map((line) => {
            const isSelected = selectedLines.has(line.rawLineIndex);
            const isActive = activeLineIndex === line.rawLineIndex;
            const currentName =
              updates[line.rawLineIndex] !== undefined
                ? updates[line.rawLineIndex]
                : line.name;
            const isModified = updates[line.rawLineIndex] !== undefined;

            return (
              <div
                key={line.rawLineIndex}
                id={`line-${line.rawLineIndex}`}
                onClick={(e) => {
                  // Don't toggle if clicking on the input
                  if ((e.target as HTMLElement).tagName === "INPUT") return;
                  // toggleLineSelection(line.rawLineIndex, e.shiftKey);
                  handlePlayFromTime(line.start);
                }}
                className={`grid grid-cols-[40px_100px_100px_150px_200px_1fr] gap-4 p-2 items-center rounded-lg border transition-colors cursor-pointer ${
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
                      handleNameChange(line.rawLineIndex, e.target.value)
                    }
                    className={`w-full bg-neutral-900 border rounded px-2 py-1 pr-8 text-sm focus:outline-none focus:border-indigo-500 transition-colors ${
                      isModified
                        ? "border-indigo-500/50 text-indigo-300"
                        : !currentName || !currentName.trim()
                        ? "border-red-500/50 text-red-300 bg-red-500/5"
                        : "border-neutral-800 text-neutral-300"
                    }`}
                    placeholder="Имя (Имя1, Имя2)..."
                    title="Можно указать несколько имен через запятую"
                  />
                  {(!currentName || !currentName.trim()) && (
                    <AlertCircle className="w-3.5 h-3.5 text-red-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  )}
                </div>
                <div
                  className="text-sm text-neutral-200 truncate"
                  title={line.text}
                >
                  {line.text}
                </div>
              </div>
            );
          })}
          {lines.length === 0 && !loading && (
            <div className="text-center py-8 text-neutral-500">
              Нет реплик для отображения.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
