import fs from 'fs/promises';
import path from 'path';
import { parse } from 'ass-compiler';
import { PrismaClient } from '@prisma/client';

/**
 * Service for processing ASS subtitles in the Electron Main Process.
 */
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
