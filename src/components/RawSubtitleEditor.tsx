import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Save, Edit3, Loader2, Languages, Eye, EyeOff, AlertCircle, Trash2, Plus, Copy, Bookmark, X } from "lucide-react";
import { ipcSafe } from '../lib/ipcSafe';
import { Episode } from "../types";
import { latinToCyrillic, polivanovToHepburn } from "../lib/translit";
import { useVideoContext } from "../contexts/VideoContext";
import { SIGN_KEYWORDS } from "../constants";
import SubtitleTimeline from "./AssEditor/SubtitleTimeline";

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

interface SubtitleLineRowProps {
  line: RawSubtitleLine;
  isSelected: boolean;
  isActive: boolean;
  updates: any;
  stableNames: string[];
  showSigns: boolean;
  onUpdate: (idx: number, update: any) => void;
  onToggleSelect: (idx: number, isShift: boolean) => void;
  onPlay: (time: string) => void;
  onDuplicate: (idx: number) => void;
  onAdd: (idx: number) => void;
  onDelete: (idx: number) => void;
  onCommitName: (name: string) => void;
  index: number;
  isBookmarked: boolean;
  onToggleBookmark: (idx: number) => void;
}

const SubtitleLineRow = React.memo(({
  line,
  isSelected,
  isActive,
  updates,
  stableNames,
  onUpdate,
  onToggleSelect,
  onPlay,
  onDuplicate,
  onAdd,
  onDelete,
  onCommitName,
  index,
  isBookmarked,
  onToggleBookmark
}: SubtitleLineRowProps) => {
  const currentName = updates?.name !== undefined ? updates.name : line.name;
  const currentText = updates?.text !== undefined ? updates.text : line.text;
  const currentStart = updates?.start !== undefined ? updates.start : line.start;
  const currentEnd = updates?.end !== undefined ? updates.end : line.end;

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '1px';
      const scrollHeight = textareaRef.current.scrollHeight;
      // limit max height so it doesn't break the UI, e.g. 200px max
      textareaRef.current.style.height = Math.max(24, Math.min(scrollHeight, 200)) + 'px';
    }
  }, [currentText]);

  return (
    <div
      id={`line-${line.rawLineIndex}`}
      onClick={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).closest('button')) return;
        onPlay(line.start);
      }}
      className={`grid grid-cols-[55px_70px_70px_100px_150px_1fr_100px] gap-3 p-2 items-start rounded-lg border transition-colors cursor-pointer group ${
        isSelected
          ? "bg-indigo-500/10 border-indigo-500/30"
          : isActive
          ? "bg-blue-500/10 border-blue-500/30 ring-1 ring-blue-500/20"
          : "bg-neutral-950 border-transparent hover:border-neutral-800 hover:bg-neutral-900"
      }`}
    >
      <div className="text-center flex items-center justify-between gap-1.5 pl-1">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(line.rawLineIndex, false)}
          className="rounded border-neutral-700 bg-neutral-900 text-indigo-500 focus:ring-indigo-500/50 cursor-pointer"
        />
        <button
          onClick={(e) => { e.stopPropagation(); onToggleBookmark(line.rawLineIndex); }}
          className={`p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 ${
            isBookmarked ? 'opacity-100 text-amber-500' : 'text-neutral-600 hover:text-neutral-400'
          } transition-opacity cursor-pointer`}
          title={isBookmarked ? "Удалить из закладок" : "В закладки"}
        >
          <Bookmark className="w-3.5 h-3.5" fill={isBookmarked ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="text-xs text-neutral-500 font-mono">
        <input
          type="text"
          className="w-full bg-transparent border-b border-transparent hover:border-neutral-700 focus:border-indigo-500 focus:outline-none transition-colors"
          value={currentStart}
          onChange={(e) => onUpdate(line.rawLineIndex, { start: e.target.value })}
        />
      </div>
      <div className="text-xs text-neutral-500 font-mono">
        <input
          type="text"
          className="w-full bg-transparent border-b border-transparent hover:border-neutral-700 focus:border-indigo-500 focus:outline-none transition-colors"
          value={currentEnd}
          onChange={(e) => onUpdate(line.rawLineIndex, { end: e.target.value })}
        />
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
          onChange={(e) => onUpdate(line.rawLineIndex, { name: e.target.value })}
          onBlur={(e) => onCommitName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={`w-full bg-neutral-900 border rounded px-2 py-1 pr-6 text-xs focus:outline-none focus:border-indigo-500 transition-colors ${
            updates?.name !== undefined
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
          ref={textareaRef}
          value={currentText}
          onChange={(e) => onUpdate(line.rawLineIndex, { text: e.target.value })}
          rows={1}
          className={`w-full bg-transparent border-none text-xs transition-colors focus:outline-none focus:text-white resize-none py-1 block leading-relaxed ${
            updates?.text !== undefined ? "text-indigo-300" : "text-neutral-200"
          }`}
        />
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end pr-2">
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(index); }}
          title="Добавить реплику ниже"
          className="p-1.5 text-neutral-500 hover:text-emerald-400 bg-neutral-800 hover:bg-neutral-700 rounded"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDuplicate(index); }}
          title="Дублировать реплику"
          className="p-1.5 text-neutral-500 hover:text-indigo-400 bg-neutral-800 hover:bg-neutral-700 rounded"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(index); }}
          title="Удалить реплику"
          className="p-1.5 text-neutral-500 hover:text-red-400 bg-neutral-800 hover:bg-neutral-700 rounded"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});

export default function RawSubtitleEditor({
  currentEpisode,
  onRefresh,
}: RawSubtitleEditorProps) {
  const [lines, setLines] = useState<RawSubtitleLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [updates, setUpdates] = useState<Record<number, { name?: string; text?: string; start?: string; end?: string; }>>({});
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null);

  const [bookmarks, setBookmarks] = useState<number[]>(() => {
    try {
      const stored = localStorage.getItem(`bookmarks-${currentEpisode?.id}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (currentEpisode?.id) {
      localStorage.setItem(`bookmarks-${currentEpisode.id}`, JSON.stringify(bookmarks));
    }
  }, [bookmarks, currentEpisode?.id]);

  const handleToggleBookmark = useCallback((rawLineIndex: number) => {
    setBookmarks(prev => {
      if (prev.includes(rawLineIndex)) {
        return prev.filter(id => id !== rawLineIndex);
      } else {
        return [...prev, rawLineIndex].sort((a, b) => a - b);
      }
    });
  }, []);

  const handleJumpToBookmark = useCallback((rawLineIndex: number) => {
    const line = lines.find(l => l.rawLineIndex === rawLineIndex);
    if (line) {
      setActiveLineIndex(rawLineIndex);
      handlePlayFromTime(line.start);

      // Scroll list
      setTimeout(() => {
        const element = document.getElementById(`line-${rawLineIndex}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    }
  }, [lines]);
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

  const unassignedCount = useMemo(() => {
    return lines.filter(l => {
      const u = updates[l.rawLineIndex] || {};
      const name = u.name !== undefined ? u.name : l.name;
      return !name || !name.trim();
    }).length;
  }, [lines, updates]);

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

  const secondsToAssTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  };

  useEffect(() => {
    if (videoRef.current) {
      const player = videoRef.current;
      
      const handleTimeUpdate = () => {
        setCurrentTime(player.currentTime);
      };

      const handlePlay = () => setIsPlaying(true);
      const handlePause = () => setIsPlaying(false);
      const handleLoadedMetadata = () => {
        setDuration(player.duration || 0);
      };
      
      player.addEventListener('timeupdate', handleTimeUpdate);
      player.addEventListener('play', handlePlay);
      player.addEventListener('pause', handlePause);
      player.addEventListener('loadedmetadata', handleLoadedMetadata);

      if (player.duration) {
        setDuration(player.duration);
      }
      setIsPlaying(!player.paused);

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
        player.removeEventListener('play', handlePlay);
        player.removeEventListener('pause', handlePause);
        player.removeEventListener('loadedmetadata', handleLoadedMetadata);
        unregisterPlayer();
      };
    }
  }, [registerPlayer, unregisterPlayer, lines]);

  const totalDuration = useMemo(() => {
    if (duration) return duration;
    if (lines.length > 0) {
      const endSecs = lines.map(line => {
        const u = updates[line.rawLineIndex] || {};
        return u.end !== undefined ? parseAssTimeToSeconds(u.end) : line.endSec;
      });
      return Math.max(...endSecs) + 10;
    }
    return 300;
  }, [duration, lines, updates]);

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

  const handleLineUpdate = (rawLineIndex: number, update: { name?: string; text?: string; start?: string; end?: string; }) => {
    setUpdates((prev) => {
      const current = prev[rawLineIndex] || {};
      const next = { ...prev, [rawLineIndex]: { ...current, ...update } };
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

  const handleDeleteLine = (index: number) => {
    if (!confirm('Удалить эту реплику?')) return;
    setLines(prev => {
      const newLines = [...prev];
      newLines.splice(index, 1);
      return newLines;
    });
    setUpdates(prev => ({ ...prev, _forceSave: true } as any));
  };

  const handleDuplicateLine = (index: number) => {
    const line = lines[index];
    if (!line) return;

    const start = parseAssTimeToSeconds(line.start);
    const end = parseAssTimeToSeconds(line.end);
    const duration = end - start;
    if (duration < 0.05) return;

    const mid = start + duration / 2;
    const midTime = secondsToAssTime(mid);

    const newId = Date.now() + Math.random();
    
    setLines(prev => {
      const newLines = [...prev];
      newLines[index] = { ...line, end: midTime, endSec: mid };
      
      const newLine = { 
        ...line, 
        start: midTime,
        startSec: mid,
        rawLineIndex: newId,
        id: undefined,
        originalIndex: undefined
      } as RawSubtitleLine;
      
      newLines.splice(index + 1, 0, newLine);
      return newLines;
    });

    setUpdates(u => ({
      ...u,
      [line.rawLineIndex]: { ...(u[line.rawLineIndex] || {}), end: midTime },
      [newId]: { start: midTime }
    }));
  };

  const handleAddLine = (index: number) => {
    const prevLine = lines[index];
    if (!prevLine) return;

    const nextLine = lines[index + 1];
    
    const startA = parseAssTimeToSeconds(prevLine.start);
    const endA = parseAssTimeToSeconds(prevLine.end);
    const durationA = endA - startA;
    const takeA = durationA / 2;
    const newEndA = endA - takeA;
    const newEndATime = secondsToAssTime(newEndA);

    const newId = Date.now() + Math.random();
    let newStart = newEndA;
    let newEnd = endA;

    if (nextLine) {
      const startB = parseAssTimeToSeconds(nextLine.start);
      const endB = parseAssTimeToSeconds(nextLine.end);
      const durationB = endB - startB;
      const takeB = durationB / 2;
      const newStartB = startB + takeB;
      const newStartBTime = secondsToAssTime(newStartB);
      
      newEnd = newStartB;

      setLines(prev => {
        const newLines = [...prev];
        newLines[index] = { ...prev[index], end: newEndATime, endSec: newEndA };
        newLines[index+1] = { ...prev[index+1], start: newStartBTime, startSec: newStartB };
        
        const newLine = { 
          ...prevLine, 
          text: '', 
          name: '',
          style: prevLine.style || 'Default',
          start: secondsToAssTime(newStart),
          end: secondsToAssTime(newEnd),
          startSec: newStart,
          endSec: newEnd,
          rawLineIndex: newId, 
          id: undefined,
          originalIndex: undefined
        } as RawSubtitleLine;
        
        newLines.splice(index + 1, 0, newLine);
        return newLines;
      });

      setUpdates(u => ({
        ...u,
        [prevLine.rawLineIndex]: { ...(u[prevLine.rawLineIndex] || {}), end: newEndATime },
        [nextLine.rawLineIndex]: { ...(u[nextLine.rawLineIndex] || {}), start: newStartBTime },
        [newId]: { start: newEndATime, end: newStartBTime }
      }));
    } else {
      setLines(prev => {
        const newLines = [...prev];
        newLines[index] = { ...prev[index], end: newEndATime, endSec: newEndA };
        
        const newLine = { 
          ...prevLine, 
          text: '', 
          name: '',
          style: prevLine.style || 'Default',
          start: secondsToAssTime(newStart),
          end: secondsToAssTime(newEnd),
          startSec: newStart,
          endSec: newEnd,
          rawLineIndex: newId, 
          id: undefined,
          originalIndex: undefined
        } as RawSubtitleLine;
        
        newLines.splice(index + 1, 0, newLine);
        return newLines;
      });

      setUpdates(u => ({
        ...u,
        [prevLine.rawLineIndex]: { ...(u[prevLine.rawLineIndex] || {}), end: newEndATime },
        [newId]: { start: newEndATime, end: secondsToAssTime(newEnd) }
      }));
    }
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
    if (!currentEpisode || lines.length === 0) return;
    setSaving(true);
    setStatus("Сохранение изменений...");

    const fullLines = lines.map(line => {
      const u = updates[line.rawLineIndex] || {};
      return {
        ...line,
        name: u.name !== undefined ? u.name : line.name,
        text: u.text !== undefined ? u.text : line.text,
        start: u.start !== undefined ? u.start : line.start,
        end: u.end !== undefined ? u.end : line.end,
      };
    });

    try {
      await ipcSafe.invoke('save-translated-subtitles', {
        assFilePath: currentEpisode.subPath,
        translatedLines: fullLines
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
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.isContentEditable
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

  function handlePlayFromTime(timeStr: string) {
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
  }

  if (!currentEpisode?.subPath) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-neutral-500">
        <Edit3 className="w-12 h-12 opacity-20 mb-4" />
        <p>Загрузите файл субтитров (.ass), чтобы начать разметку реплик.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-row h-full overflow-hidden border border-neutral-800 rounded-2xl bg-neutral-950">
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
          <div className="grid grid-cols-[30px_70px_70px_100px_150px_1fr_100px] gap-3 p-3 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-sm text-xs font-semibold text-neutral-400 uppercase tracking-wider sticky top-0 z-10">
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
            <div className="text-right">Действия</div>
          </div>

          <div className="flex-1 overflow-y-auto p-1 space-y-1">
            {lines
              .filter(line => showSigns || !isSignLine(line))
              .map((line) => {
              const isSelected = selectedLines.has(line.rawLineIndex);
              const isActive = activeLineIndex === line.rawLineIndex;

              return (
                <SubtitleLineRow
                  key={line.rawLineIndex}
                  line={line}
                  isSelected={isSelected}
                  isActive={isActive}
                  updates={updates[line.rawLineIndex]}
                  stableNames={stableNames}
                  showSigns={showSigns}
                  onUpdate={handleLineUpdate}
                  onToggleSelect={toggleLineSelection}
                  onPlay={handlePlayFromTime}
                  onDuplicate={handleDuplicateLine}
                  onAdd={handleAddLine}
                  onDelete={handleDeleteLine}
                  onCommitName={commitNewName}
                  index={lines.indexOf(line)}
                  isBookmarked={bookmarks.includes(line.rawLineIndex)}
                  onToggleBookmark={handleToggleBookmark}
                />
              );
            })}
            {lines.length === 0 && !loading && (
              <div className="text-center py-8 text-neutral-500 text-sm">
                Нет реплик для отображения.
              </div>
            )}
          </div>
        </div>

        <SubtitleTimeline
          rawPath={currentEpisode?.rawPath}
          lines={lines}
          updates={updates}
          activeLineIndex={activeLineIndex}
          currentTime={currentTime}
          totalDuration={totalDuration}
          onUpdateLine={handleLineUpdate}
          onSeek={(time) => {
            if (videoRef.current) {
              videoRef.current.currentTime = time;
            }
            setCurrentTime(time);
          }}
          onPlayPause={() => {
            if (videoRef.current) {
              if (videoRef.current.paused) {
                videoRef.current.play().catch(e => console.error('Play error', e));
              } else {
                videoRef.current.pause();
              }
            }
          }}
          isPlaying={isPlaying}
          onSelectLine={(rawLineIndex) => {
            setActiveLineIndex(rawLineIndex);
            
            const element = document.getElementById(`line-${rawLineIndex}`);
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }}
          secondsToAssTime={secondsToAssTime}
          parseAssTimeToSeconds={parseAssTimeToSeconds}
        />
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

        {/* Bookmarks Section */}
        <div className="p-4 flex flex-col gap-3 border-t border-neutral-800 bg-neutral-950/20">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5 font-sans">
              <Bookmark className="w-4 h-4 text-amber-500 fill-amber-500/20 shrink-0" />
              Закладки
            </span>
            {activeLineIndex !== null && (
              <button
                onClick={() => handleToggleBookmark(activeLineIndex)}
                className="text-[10px] bg-neutral-850 hover:bg-neutral-700 border border-neutral-700 hover:border-neutral-600 text-neutral-300 px-2 py-1 rounded transition-colors font-medium flex items-center gap-1 cursor-pointer"
              >
                <Bookmark className="w-2.5 h-2.5" />
                {bookmarks.includes(activeLineIndex) ? "Убрать текущую" : "Сюда флажок"}
              </button>
            )}
          </div>
          
          {bookmarks.length > 0 ? (
            <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto pr-1">
              {bookmarks.map((bId) => {
                const line = lines.find(l => l.rawLineIndex === bId);
                if (!line) return null;
                const formattedTime = line.start;
                const charName = updates[bId]?.name !== undefined ? updates[bId].name : line.name;
                const lineText = updates[bId]?.text !== undefined ? updates[bId].text : line.text;
                
                return (
                  <button
                    key={bId}
                    onClick={() => handleJumpToBookmark(bId)}
                    className="flex items-center justify-between p-2 bg-neutral-950 hover:bg-neutral-800/80 border border-neutral-850 hover:border-neutral-700 rounded-lg text-left transition-all group cursor-pointer"
                  >
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 font-mono">
                        <span className="text-indigo-400 font-semibold">Строка {bId + 1}</span>
                        <span className="text-neutral-600">•</span>
                        <span className="text-amber-400 font-bold">{formattedTime}</span>
                        {charName && (
                          <>
                            <span className="text-neutral-600">•</span>
                            <span className="text-emerald-400 truncate max-w-[130px]" title={charName}>[{charName}]</span>
                          </>
                        )}
                      </div>
                      <div className="text-[11px] text-neutral-300 truncate mt-0.5">
                        {lineText || "(Пустая реплика)"}
                      </div>
                    </div>
                    
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleBookmark(bId);
                      }}
                      className="p-1 text-neutral-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ml-1.5 shrink-0 cursor-pointer"
                      title="Удалить закладку"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-neutral-500 italic py-3 text-center border border-dashed border-neutral-800/65 rounded-lg bg-neutral-950/40">
              Нет сохраненных закладок.<br />
              Используйте иконку флажка в строках для быстрого возврата к работе.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
