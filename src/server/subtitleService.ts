import fs from 'fs/promises';
import path from 'path';
import { parse } from 'ass-compiler';
import { PrismaClient, RoleAssignment } from '@prisma/client';

/**
 * Service for processing ASS subtitles in the Electron Main Process.
 */
export interface RawSubtitleLine {
  id: number;
  start: string;
  end: string;
  style: string;
  name: string;
  text: string;
  rawLineIndex: number;
}

export async function getRawSubtitles(assFilePath: string): Promise<RawSubtitleLine[]> {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  const result: RawSubtitleLine[] = [];
  
  let inEvents = false;
  let nameIndex = -1;
  let startIndex = -1;
  let endIndex = -1;
  let styleIndex = -1;
  let textIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      const formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      nameIndex = formatParts.indexOf('Name');
      startIndex = formatParts.indexOf('Start');
      endIndex = formatParts.indexOf('End');
      styleIndex = formatParts.indexOf('Style');
      textIndex = formatParts.indexOf('Text');
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      if (nameIndex !== -1 && textIndex !== -1) {
        const data = line.substring(9);
        const parts = data.split(',');
        
        // Text can contain commas, so we join the rest
        const textPart = parts.slice(textIndex).join(',');
        
        result.push({
          id: i,
          start: parts[startIndex]?.trim() || '',
          end: parts[endIndex]?.trim() || '',
          style: parts[styleIndex]?.trim() || '',
          name: parts[nameIndex]?.trim() || '',
          text: textPart,
          rawLineIndex: i
        });
      }
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  return result;
}

export async function saveRawSubtitles(assFilePath: string, updates: { rawLineIndex: number, name: string }[]): Promise<void> {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  let inEvents = false;
  let nameIndex = -1;
  let textIndex = -1;

  // Create a map for fast lookup
  const updatesMap = new Map<number, string>();
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
      const formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      nameIndex = formatParts.indexOf('Name');
      textIndex = formatParts.indexOf('Text');
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      if (updatesMap.has(i) && nameIndex !== -1 && textIndex !== -1) {
        const prefix = line.substring(0, 9);
        const data = line.substring(9);
        const parts = data.split(',');
        
        // Update the name
        parts[nameIndex] = updatesMap.get(i) || '';
        
        // Reconstruct the line
        const beforeText = parts.slice(0, textIndex);
        const textPart = parts.slice(textIndex).join(',');
        
        lines[i] = `${prefix}${beforeText.join(',')},${textPart}`;
      }
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  await fs.writeFile(assFilePath, lines.join('\n'), 'utf-8');
}

export async function splitSubsByActor(prisma: PrismaClient, assFilePath: string, outputDirectory: string) {
  // 1. Читаем исходный файл
  const content = await fs.readFile(assFilePath, 'utf-8');
  
  // 2. Используем ass-compiler для парсинга структуры
  const parsed = parse(content);

  // 3. Извлекаем все уникальные имена из поля Name/Actor
  const actors = new Set<string>();
  for (const event of parsed.events.dialogue) {
    if (event.Name && event.Name.trim() !== '') {
      actors.add(event.Name.trim());
    }
  }

  const uniqueActors = Array.from(actors);
  
  // Получаем участников из базы
  const participants = await prisma.user.findMany();
  const participantsData = participants.map(p => ({
    ...p,
    roles: JSON.parse(p.roles)
  }));

  // Создаем маппинг: имя персонажа -> участник
  const actorMapping: Record<string, any> = {};
  for (const actorName of uniqueActors) {
    const participant = participantsData.find(p => 
      p.nickname.toLowerCase() === actorName.toLowerCase()
    );
    actorMapping[actorName] = participant || null;
  }

  const generatedFiles: string[] = [];

  // Создаем папку для вывода, если ее нет
  await fs.mkdir(outputDirectory, { recursive: true });

  // 4. Генерируем отдельные .ass файлы для каждого актера
  const lines = content.split('\n');
  
  for (const actor of uniqueActors) {
    const newLines: string[] = [];
    let inEvents = false;
    let nameIndex = -1;
    let textIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('[Events]')) {
        inEvents = true;
        newLines.push(line);
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Format:')) {
        const formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
        nameIndex = formatParts.indexOf('Name');
        textIndex = formatParts.indexOf('Text');
        newLines.push(line);
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Dialogue:')) {
        if (nameIndex !== -1 && textIndex !== -1) {
          const prefix = line.substring(0, 9);
          const data = line.substring(9);
          const parts = data.split(',');

          const beforeText = parts.slice(0, textIndex);
          const textPart = parts.slice(textIndex).join(',');

          const currentName = parts[nameIndex].trim();

          if (currentName !== actor && currentName !== '') {
            const newText = `{\\c&H808080&}${textPart}`;
            newLines.push(`${prefix}${beforeText.join(',')},${newText}`);
          } else {
            newLines.push(line);
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

    const outputPath = path.join(outputDirectory, `${actor}.ass`);
    await fs.writeFile(outputPath, newLines.join('\n'), 'utf-8');
    generatedFiles.push(outputPath);
  }

  return { actorMapping, generatedFiles };
}

export async function splitSubsByDubber(
  prisma: PrismaClient, 
  assFilePath: string, 
  outputDirectory: string,
  assignments: RoleAssignment[] // characterName -> dubberId
) {
  const content = await fs.readFile(assFilePath, 'utf-8');
  const lines = content.split('\n');
  
  // Get dubbers
  const dubberIds = Array.from(new Set(assignments.map(a => a.dubberId)));
  const dubbers = await prisma.user.findMany({
    where: { id: { in: dubberIds } }
  });
  
  const dubberMap = new Map<string, any>();
  for (const dubber of dubbers) {
    dubberMap.set(dubber.id, dubber);
  }

  const generatedFiles: string[] = [];
  await fs.mkdir(outputDirectory, { recursive: true });

  for (const dubberId of dubberIds) {
    const dubber = dubberMap.get(dubberId);
    if (!dubber) continue;

    // Characters assigned to this dubber
    const assignedCharacters = assignments
      .filter(a => a.dubberId === dubberId)
      .map(a => a.characterName);

    const newLines: string[] = [];
    let inEvents = false;
    let nameIndex = -1;
    let textIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('[Events]')) {
        inEvents = true;
        newLines.push(line);
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Format:')) {
        const formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
        nameIndex = formatParts.indexOf('Name');
        textIndex = formatParts.indexOf('Text');
        newLines.push(line);
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Dialogue:')) {
        if (nameIndex !== -1 && textIndex !== -1) {
          const prefix = line.substring(0, 9);
          const data = line.substring(9);
          const parts = data.split(',');

          const beforeText = parts.slice(0, textIndex);
          const textPart = parts.slice(textIndex).join(',');

          const currentName = parts[nameIndex].trim();

          // If the line belongs to one of the assigned characters, keep it normal
          // Otherwise, grey it out
          if (!assignedCharacters.includes(currentName) && currentName !== '') {
            const newText = `{\\c&H808080&}${textPart}`;
            newLines.push(`${prefix}${beforeText.join(',')},${newText}`);
          } else {
            newLines.push(line);
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

    const outputPath = path.join(outputDirectory, `${dubber.nickname}.ass`);
    await fs.writeFile(outputPath, newLines.join('\n'), 'utf-8');
    generatedFiles.push(outputPath);
  }

  return { generatedFiles };
}
