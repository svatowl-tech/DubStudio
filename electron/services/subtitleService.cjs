const fs = require('fs/promises');
const path = require('path');
const log = require('electron-log');

const SIGN_KEYWORDS = ["НАДПИСЬ", "Надпись", "надпись", "НАДПИСИ", "Надписи", "надписи", "SIGNS", "Signs", "signs", "SIGN", "Sign", "sign", "TEXT", "Text", "text", "ТЕКСТ", "Текст", '"текст"'];

// Cache for parsed subtitles to avoid memory spikes when multiple components request the same file concurrently
const subtitleCache = new Map();

/**
 * Вспомогательная функция для парсинга строки Dialogue в ASS файле.
 */
function parseDialogueLine(line, formatParts) {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) return null;

  const nameIndex = formatParts.indexOf('Name');
  const textIndex = formatParts.indexOf('Text');
  const startIndex = formatParts.indexOf('Start');
  const endIndex = formatParts.indexOf('End');
  const styleIndex = formatParts.indexOf('Style');
  const totalFields = formatParts.length;

  if (nameIndex === -1 || textIndex === -1) return null;

  const data = line.substring(colonIndex + 1);
  const allParts = data.split(',');
  
  // Standard ASS parsing: split by totalFields - 1 commas
  const standardParts = allParts.slice(0, totalFields - 1);
  standardParts.push(allParts.slice(totalFields - 1).join(','));

  return {
    start: standardParts[startIndex]?.trim() || '',
    end: standardParts[endIndex]?.trim() || '',
    style: standardParts[styleIndex]?.trim() || '',
    name: standardParts[nameIndex]?.trim() || '',
    text: standardParts[textIndex],
    standardParts,
    prefix: line.substring(0, colonIndex + 1),
    formatInfo: { nameIndex, textIndex, startIndex, endIndex, styleIndex, totalFields }
  };
}

async function cleanAssFile(assFilePath) {
  try {
    const content = await fs.readFile(assFilePath, 'utf-8');
    const lines = content.split('\n');
    let currentSection = '';
    let formatParts = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      const trimmedLine = line.trim();
      
      if (trimmedLine.startsWith('[')) {
        currentSection = trimmedLine;
        continue;
      }
      
      if (currentSection === '[Script Info]') {
        if (trimmedLine.startsWith('Video Zoom Percent:') || 
            trimmedLine.startsWith('Scroll Position:') || 
            trimmedLine.startsWith('Active Line:')) {
          lines[i] = null; // Mark for deletion
          continue;
        }
      }
      
      if (currentSection === '[V4+ Styles]') {
        if (trimmedLine.startsWith('Style:')) {
          // Replace commas between digits with dots to fix decimal separators
          // e.g. 100,00 -> 100.00
          lines[i] = line.replace(/(\d),(\d)/g, '$1.$2');
        }
      }
      
      if (currentSection === '[Events]') {
        const prefixMatch = line.match(/^(Dialogue|Comment):\s*/);
        if (prefixMatch) {
          const prefix = prefixMatch[0];
          const rest = line.substring(prefix.length);
          const parts = rest.split(',');
          if (parts.length >= 10) {
            for (let j = 0; j < 9; j++) {
              parts[j] = parts[j].trim();
            }
            lines[i] = prefix + parts.slice(0, 9).join(',') + ',' + parts.slice(9).join(',');
          }
        }
      }
    }
    
    const newContent = lines.filter(l => l !== null).join('\n');
    await fs.writeFile(assFilePath, newContent, 'utf-8');
    return { success: true };
  } catch (error) {
    log.error('Error cleaning ASS file:', error);
    return { success: false, error: error.message };
  }
}

async function getRawSubtitles(assFilePath) {
  try {
    const stats = await fs.stat(assFilePath);
    const mtime = stats.mtimeMs;
    
    if (subtitleCache.has(assFilePath)) {
      const cached = subtitleCache.get(assFilePath);
      if (cached.mtime === mtime) {
        return cached.data;
      }
    }

    const content = await fs.readFile(assFilePath, 'utf-8');
    const lines = content.split('\n');
    const result = [];
    
    let inEvents = false;
    let formatParts = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('[Events]')) {
        inEvents = true;
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Format:')) {
        formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Dialogue:')) {
        const parsed = parseDialogueLine(line, formatParts);
        if (parsed) {
          result.push({
            id: i,
            start: parsed.start,
            end: parsed.end,
            style: parsed.style,
            name: parsed.name,
            text: parsed.text,
            rawLineIndex: i
          });
        }
      } else if (trimmedLine.startsWith('[')) {
        if (trimmedLine !== '[Events]') inEvents = false;
      }
    }

    const actors = new Set();
    
    for (const line of result) {
      if (line.name) {
        const names = line.name.split(',').map(n => n.trim()).filter(n => n !== '');
        names.forEach(n => {
          if (!SIGN_KEYWORDS.includes(n)) {
            actors.add(n);
          }
        });
      }
    }

    const data = {
      lines: result,
      actors: Array.from(actors)
    };

    subtitleCache.set(assFilePath, { mtime, data });
    
    // Keep cache size manageable
    if (subtitleCache.size > 10) {
      const firstKey = subtitleCache.keys().next().value;
      subtitleCache.delete(firstKey);
    }

    return data;
  } catch (error) {
    log.error("Error reading subtitles:", error);
    throw error;
  }
}

async function saveRawSubtitles(assFilePath, updates) {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  let inEvents = false;
  let formatParts = [];

  const updatesMap = new Map();
  for (const update of updates) {
    updatesMap.set(update.rawLineIndex, update.name);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      if (updatesMap.has(i)) {
        const parsed = parseDialogueLine(line, formatParts);
        if (parsed) {
          const standardParts = parsed.standardParts.map((p, idx) => idx === parsed.formatInfo.textIndex ? p : p.trim());
          standardParts[parsed.formatInfo.nameIndex] = (updatesMap.get(i) || '').replace(/,/g, ';');
          lines[i] = `${parsed.prefix}${standardParts.join(',')}`;
        }
      }
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  await fs.writeFile(assFilePath, lines.join('\n'), 'utf-8');
  await cleanAssFile(assFilePath);
}

async function splitSubsByActor(assFilePath, outputDirectory, options) {
  const {
    distributeGroups = false,
    distributeMultipleRoles = false,
    saveSignsInAss = false,
    outputFormat = 'ass' // 'ass' or 'srt'
  } = options || {};

  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  const groupKeywords = ["гуры", "все"];

  let inEvents = false;
  let formatParts = [];

  const parsedLines = [];
  const uniqueActors = new Set();
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      parsedLines.push({ type: 'header', text: line });
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      parsedLines.push({ type: 'format', text: line });
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      const parsed = parseDialogueLine(line, formatParts);
      if (parsed) {
        const currentNames = parsed.name.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
        
        parsedLines.push({ 
          type: 'dialogue', 
          text: line, 
          names: currentNames,
          start: parsed.start,
          end: parsed.end,
          textContent: parsed.text
        });

        for (const name of currentNames) {
          if (SIGN_KEYWORDS.includes(name)) continue;
          if (groupKeywords.includes(name)) continue;
          if (name.startsWith('!')) continue;
          uniqueActors.add(name);
        }
      } else {
        parsedLines.push({ type: 'other', text: line });
      }
    } else {
      if (trimmedLine.startsWith('[')) {
        if (trimmedLine !== '[Events]') inEvents = false;
      }
      parsedLines.push({ type: 'other', text: line });
    }
  }

  const generatedFiles = [];
  await fs.mkdir(outputDirectory, { recursive: true });
  const originalFileName = path.basename(assFilePath, '.ass');

  function assTimeToSrtTime(assTime) {
    const parts = assTime.split(':');
    if (parts.length !== 3) return '00:00:00,000';
    const h = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const sParts = parts[2].split('.');
    const s = sParts[0].padStart(2, '0');
    const ms = (sParts[1] || '00').padEnd(3, '0').substring(0, 3);
    return `${h}:${m}:${s},${ms}`;
  }

  function cleanAssText(text) {
    return text.replace(/\{[^}]+\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n');
  }

  for (const actor of uniqueActors) {
    const actorLines = [];
    let lineCount = 0;
    let srtIndex = 1;

    for (const parsed of parsedLines) {
      if (parsed.type === 'dialogue') {
        let include = false;
        const names = parsed.names;

        if (names.length === 0) continue;

        if (names.some(n => SIGN_KEYWORDS.includes(n))) {
          continue;
        }

        if (names.some(n => n.startsWith('!'))) {
           const exclusions = names.filter(n => n.startsWith('!')).map(n => n.substring(1));
           if (distributeMultipleRoles && !exclusions.includes(actor)) include = true;
        } else if (names.some(n => groupKeywords.includes(n))) {
           if (distributeGroups) include = true;
        } else if (names.length > 1) {
           if (distributeMultipleRoles && names.includes(actor)) include = true;
        } else if (names.length === 1 && names[0] === actor) {
           include = true;
        }

        if (include) {
          if (outputFormat === 'ass') {
            actorLines.push(parsed.text);
          } else {
            if (srtIndex === 1) {
               actorLines.push('1\n00:00:00,000 --> 00:00:00,000\n \n');
               srtIndex++;
            }
            actorLines.push(`${srtIndex}\n${assTimeToSrtTime(parsed.start)} --> ${assTimeToSrtTime(parsed.end)}\n${cleanAssText(parsed.textContent)}\n`);
            srtIndex++;
          }
          lineCount++;
        }
      } else {
        if (outputFormat === 'ass') {
          actorLines.push(parsed.text);
        }
      }
    }

    if (lineCount > 0) {
      const ext = outputFormat === 'ass' ? '.ass' : '.srt';
      const outputPath = path.join(outputDirectory, `${originalFileName} - ${actor} - (${lineCount})${ext}`);
      await fs.writeFile(outputPath, actorLines.join('\n'), 'utf-8');
      if (ext === '.ass') await cleanAssFile(outputPath);
      generatedFiles.push(outputPath);
    }
  }

  if (saveSignsInAss) {
    const signLines = [];
    let signCount = 0;
    for (const parsed of parsedLines) {
      if (parsed.type === 'dialogue') {
        if (parsed.names.some(n => SIGN_KEYWORDS.includes(n))) {
          signLines.push(parsed.text);
          signCount++;
        }
      } else {
        signLines.push(parsed.text);
      }
    }
    if (signCount > 0) {
      const outputPath = path.join(outputDirectory, `${originalFileName} - Надписи.ass`);
      await fs.writeFile(outputPath, signLines.join('\n'), 'utf-8');
      await cleanAssFile(outputPath);
      generatedFiles.push(outputPath);
    }
  }

  return { success: true, generatedFiles };
}

async function splitSubsByDubber(assFilePath, outputDirectory, assignments, dubbersData) {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  const dubberIds = Array.from(new Set(assignments.map(a => a.substituteId || a.dubberId).filter(id => id)));
  const dubbers = dubbersData.filter(d => dubberIds.includes(d.id));
  
  const dubberMap = new Map();
  for (const dubber of dubbers) {
    dubberMap.set(dubber.id, dubber);
  }

  const generatedFiles = [];
  await fs.mkdir(outputDirectory, { recursive: true });

  for (const dubberId of dubberIds) {
    const dubber = dubberMap.get(dubberId);
    if (!dubber) continue;

    const assignedCharacters = assignments
      .filter(a => (a.substituteId || a.dubberId) === dubberId)
      .map(a => a.characterName.trim());

    const mapping = {};
    for (const assignment of assignments) {
      const targetId = assignment.substituteId || assignment.dubberId;
      if (targetId === dubberId) {
        const charName = assignment.characterName.trim();
        const dubber = dubberMap.get(targetId);
        if (dubber) {
          if (!mapping[charName]) mapping[charName] = [];
          mapping[charName].push(dubber.nickname);
        }
      }
    }

    const newLines = [];
    let inEvents = false;
    let formatParts = [];
    let lineCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('[Events]')) {
        inEvents = true;
        newLines.push(line);
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Format:')) {
        formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
        newLines.push(line);
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Dialogue:')) {
        const parsed = parseDialogueLine(line, formatParts);
        if (parsed) {
          const currentNames = parsed.name.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
          const isAssigned = currentNames.some(name => assignedCharacters.includes(name));

          if (isAssigned) {
            const mappedNames = currentNames.flatMap(name => {
              if (mapping[name] && mapping[name].length > 0) {
                return mapping[name];
              }
              return [name];
            });
            const standardParts = parsed.standardParts.map((p, idx) => idx === parsed.formatInfo.textIndex ? p : p.trim());
            standardParts[parsed.formatInfo.nameIndex] = mappedNames.join('; ');
            newLines.push(`${parsed.prefix}${standardParts.join(',')}`);
            lineCount++;
          }
        } else {
          newLines.push(line);
        }
      } else {
        if (trimmedLine.startsWith('[')) {
          if (trimmedLine !== '[Events]') inEvents = false;
        }
        newLines.push(line);
      }
    }

    const outputPath = path.join(outputDirectory, `${dubber.nickname} (${lineCount}).ass`);
    await fs.writeFile(outputPath, newLines.join('\n'), 'utf-8');
    await cleanAssFile(outputPath);
    generatedFiles.push(outputPath);
  }

  return { success: true, generatedFiles };
}

async function exportFullAssWithRoles(assFilePath, outputPath, assignments, participantsData) {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  const mapping = {};
  for (const assignment of assignments) {
    const targetId = assignment.substituteId || assignment.dubberId;
    if (!targetId) continue;
    const dubber = participantsData.find(p => p.id === targetId);
    if (dubber) {
      const charName = assignment.characterName.trim();
      if (!mapping[charName]) {
        mapping[charName] = [];
      }
      mapping[charName].push(dubber.nickname);
    }
  }

  let inEvents = false;
  let formatParts = [];
  let replacedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      const parsed = parseDialogueLine(line, formatParts);
      if (parsed) {
        const currentNames = parsed.name.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
        
        let changed = false;
        const mappedNames = currentNames.flatMap(name => {
          if (mapping[name] && mapping[name].length > 0) {
            changed = true;
            return mapping[name];
          }
          return [name];
        });
        
        if (changed) {
          const standardParts = parsed.standardParts.map((p, idx) => idx === parsed.formatInfo.textIndex ? p : p.trim());
          standardParts[parsed.formatInfo.nameIndex] = mappedNames.join('; ');
          lines[i] = `${parsed.prefix}${standardParts.join(',')}`;
          replacedCount++;
        }
      }
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, lines.join('\n'), 'utf-8');
  await cleanAssFile(outputPath);
  return outputPath;
}

async function saveTranslatedSubtitles(assFilePath, translatedLines) {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  let inEvents = false;
  let formatParts = [];

  const translatedMap = new Map();
  for (const line of translatedLines) {
    translatedMap.set(line.rawLineIndex, line.text);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      if (translatedMap.has(i)) {
        const parsed = parseDialogueLine(line, formatParts);
        if (parsed) {
          const standardParts = parsed.standardParts.map((p, idx) => idx === parsed.formatInfo.textIndex ? p : p.trim());
          standardParts[parsed.formatInfo.textIndex] = translatedMap.get(i) || '';
          lines[i] = `${parsed.prefix}${standardParts.join(',')}`;
        }
      }
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  await fs.writeFile(assFilePath, lines.join('\n'), 'utf-8');
  await cleanAssFile(assFilePath);
}

async function extractSignsAss(assFilePath, outputPath) {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  let inEvents = false;
  let formatParts = [];
  const newLines = [];
  let signCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      newLines.push(line);
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      newLines.push(line);
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      const parsed = parseDialogueLine(line, formatParts);
      if (parsed) {
        const currentNames = parsed.name.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
        if (currentNames.some(n => SIGN_KEYWORDS.includes(n))) {
          newLines.push(line);
          signCount++;
        }
      } else {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }

  if (signCount > 0) {
    await fs.writeFile(outputPath, newLines.join('\n'), 'utf-8');
    await cleanAssFile(outputPath);
    return true;
  }
  return false;
}

module.exports = {
  getRawSubtitles,
  saveRawSubtitles,
  saveTranslatedSubtitles,
  splitSubsByActor,
  splitSubsByDubber,
  exportFullAssWithRoles,
  extractSignsAss,
  cleanAssFile
};

