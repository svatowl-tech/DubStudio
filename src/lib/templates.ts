import { Episode, Participant } from '../types';

export const formatDeadline = (dateStr?: string) => {
  if (!dateStr) return 'не указан';
  const date = new Date(dateStr);
  const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const day = days[date.getDay()];
  const dayOfMonth = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${day} ${dayOfMonth}.${month}`;
};

export const generateStartEpisodeMessage = (episode: Episode, participants: Participant[]) => {
  const dubberLineCounts: Record<string, number> = {};
  
  // Calculate line counts per dubber from assignments
  episode.assignments?.forEach(as => {
    if (as.dubberId && typeof as.lineCount === 'number') {
      dubberLineCounts[as.dubberId] = (dubberLineCounts[as.dubberId] || 0) + as.lineCount;
    }
  });

  const assignedDubberIds = new Set(episode.assignments?.map(a => a.dubberId).filter(Boolean) || []);
  const assignedDubbers = participants.filter(p => assignedDubberIds.has(p.id));
  
  const dubberMentions = assignedDubbers.map(d => {
    const mention = d.telegram?.startsWith('@') ? d.telegram : `@${d.telegram || d.nickname}`;
    const count = dubberLineCounts[d.id] || 0;
    return `${d.nickname} (${mention}) — ${count} реп.`;
  }).join('\n');

  return `📢 ${episode.project?.title}
👾Серия: #${episode.number}
📅 ДЕДЛАЙН: ${formatDeadline(episode.deadline)}
━━━━━━ ◦ ❖ ◦ ━━━━━━
Если вы по каким то причинам не успеваете в дедлайн и знаете об этом, напишите об этом сразу, чтобы я мог найти вам замену или распределить сабы.

В серии учавствуют:
${dubberMentions || '• Даберы не назначены'}`;
};

export const generateFixesIssuedMessage = (episode: Episode, participants: Participant[]) => {
  const assignments = episode.assignments || [];
  
  // Group by dubber
  const dubberFixes: Record<string, { dubber: Participant, fixes: { character: string, comments: any[] }[] }> = {};
  
  assignments.forEach(as => {
    const dubberId = as.dubberId;
    if (!dubberId) return;
    
    // Only include assignments that actually need fixes
    if (as.status !== 'FIXES_NEEDED') return;
    
    const dubber = participants.find(p => p.id === dubberId);
    if (!dubber) return;
    
    let comments = [];
    try {
      comments = JSON.parse(as.comments || '[]');
    } catch (e) {
      console.error('Failed to parse comments for assignment', as.id, e);
    }
    
    if (!Array.isArray(comments) || comments.length === 0) return;

    if (!dubberFixes[dubberId]) {
      dubberFixes[dubberId] = { dubber, fixes: [] };
    }
    
    dubberFixes[dubberId].fixes.push({
      character: as.characterName,
      comments
    });
  });

  const dubberIds = Object.keys(dubberFixes);
  if (dubberIds.length === 0) return null;

  const dubberSections = dubberIds.map(id => {
    const { dubber, fixes } = dubberFixes[id];
    const mention = dubber.telegram?.startsWith('@') ? dubber.telegram : `@${dubber.telegram || dubber.nickname}`;
    
    const fixesText = fixes.map(f => {
      const characterFixes = f.comments.map(c => {
        const time = typeof c.timestamp === 'number' 
          ? new Date(c.timestamp * 1000).toISOString().substr(14, 5)
          : '??:??';
        return `  • [${time}] ${c.text}`;
      }).join('\n');
      return `🔹 ${f.character}:\n${characterFixes}`;
    }).join('\n\n');

    return `${dubber.nickname} (${mention}):\n${fixesText}`;
  }).join('\n\n');

  const projectSlug = episode.project?.title.toLowerCase().replace(/\s+/g, '_') || 'project';

  return `✏️ ВЫПИСАНЫ ФИКСЫ: ${episode.project?.title}
👾 Серия: ${episode.number}
📅 ДЕДЛАЙН ФИКСОВ: ${formatDeadline(episode.deadline)}
━━━━━━ ◦ ❖ ◦ ━━━━━━
Ребята, ознакомьтесь с правками и исправьте их до дедлайна! 🎙

${dubberSections}

━━━━━━ ◦ ❖ ◦ ━━━━━━

#${projectSlug}_fix
#fix`;
};

export const generateStatusMessage = (episode: Episode, participants: Participant[]) => {
  const assignedDubberIds = new Set(episode.assignments?.map(a => a.dubberId) || []);
  const assignedDubbers = participants.filter(p => assignedDubberIds.has(p.id));

  const roadsMentions = assignedDubbers
    .filter(p => {
      const pAssignments = (episode.assignments || []).filter(a => a.dubberId === p.id);
      const hasPending = pAssignments.some(a => a.status === 'PENDING');
      // If track uploaded to QA, it's submitted
      const hasUpload = (episode.uploads || []).some(u => u.type === 'DUBBER_FILE' && u.uploadedById === p.id);
      return hasPending && !hasUpload;
    })
    .map(p => {
      const mention = p.telegram?.startsWith('@') ? p.telegram : `@${p.telegram || p.nickname}`;
      return `• ${mention}`;
    }).join('\n');

  const fixesMentions = assignedDubbers
    .filter(p => (episode.assignments || []).some(a => a.dubberId === p.id && a.status === 'FIXES_NEEDED'))
    .map(p => {
      const mention = p.telegram?.startsWith('@') ? p.telegram : `@${p.telegram || p.nickname}`;
      return `• ${mention}`;
    }).join('\n');

  return `📢 ${episode.project?.title}
👾 Серия: ${episode.number}
📅 ДЕДЛАЙН ФИКСОВ: ${formatDeadline(episode.deadline)}
━━━━━━ ◦ ❖ ◦ ━━━━━━


🎙 ЖДЕМ ДОРОЖКИ:
${roadsMentions || '• Все сдано!'}

✏️ ЖДЕМ ИСПРАВЛЕНИЕ ФИКСОВ:
${fixesMentions || '• Фиксов нет!'}
━━━━━━ ◦ ❖ ◦ ━━━━━━`;
};

export const generateTGPostMessage = (episode: Episode, participants: Participant[]) => {
  const dubbers = episode.assignments
    .map(a => participants.find(p => p.id === a.dubberId))
    .filter(Boolean) as Participant[];
  
  const uniqueDubbers = Array.from(new Set(dubbers.map(d => d.id)))
    .map(id => dubbers.find(d => d.id === id)!);

  const dubberLinks = uniqueDubbers.map(d => {
    const url = d.tgChannel || `https://t.me/${(d.telegram || d.nickname).replace('@', '')}`;
    return `[${d.nickname}](${url})`;
  }).join(', ');

  const projectSlug = episode.project?.title.toLowerCase().replace(/\s+/g, '_') || 'project';
  const total = episode.project?.totalEpisodes || 12;

  const seId = episode.project?.soundEngineerId;
  const se = seId ? participants.find(p => p.id === seId) : null;
  const seMention = se ? (se.telegram?.startsWith('@') ? se.telegram : `@${se.telegram || se.nickname}`) : '@Tenmag';

  const emoji = episode.project?.emoji || '📢';
  const releaseType = episode.project?.releaseType === 'VOICEOVER' ? 'Закадр' : episode.project?.releaseType === 'RECAST' ? 'Рекаст' : 'Редаб';

  return `${emoji} ${episode.project?.title} (${releaseType})
👾${episode.number}/${total}👾
 
━━━━━━ ◦ ❖ ◦ ━━━━━━
Роли озвучили:
 
${dubberLinks}
 
Тайминг и работа со звуком: 
${seMention}
━━━━━━ ◦ ❖ ◦ ━━━━━━
#${projectSlug}`;
};

export const generateVKPostMessage = (episode: Episode, participants: Participant[]) => {
  const dubbers = episode.assignments
    .map(a => participants.find(p => p.id === a.dubberId))
    .filter(Boolean) as Participant[];
  
  const uniqueDubbers = Array.from(new Set(dubbers.map(d => d.id)))
    .map(id => dubbers.find(d => d.id === id)!);

  const dubberInfo = uniqueDubbers.map(d => {
    const vk = d.vkLink ? `@${d.vkLink.split('/').pop()}` : d.telegram;
    return `${vk} (${d.nickname})`;
  }).join(', ');

  const total = episode.project?.totalEpisodes || 12;
  const links = episode.project?.links ? JSON.parse(episode.project.links) : {};

  const seId = episode.project?.soundEngineerId;
  const se = seId ? participants.find(p => p.id === seId) : null;
  const seName = se ? se.nickname : 'Tenmag';

  const emoji = episode.project?.emoji || '📢';
  const releaseType = episode.project?.releaseType === 'VOICEOVER' ? 'Закадр' : episode.project?.releaseType === 'RECAST' ? 'Рекаст' : 'Редаб';

  return `${emoji} ${episode.project?.title} (${releaseType})
👾${episode.number}/${total}👾
 
| Роли озвучили: ${dubberInfo}
 
| Тайминг и работа со звуком: ${seName}
 
➪ Аниме 365: : ${links.anime365 || ''}
➪ Телеграмм:: ${links.tg || ''}
➪ Kodik: : ${links.kodik || ''}`;
};

export const generateFinalTGMessage = (episode: Episode, participants: Participant[]) => {
  const total = episode.project?.totalEpisodes || 12;
  const links = episode.project?.links ? JSON.parse(episode.project.links) : {};
  const projectSlug = episode.project?.title.toLowerCase().replace(/\s+/g, '_') || 'project';

  return `✅ СЕРИЯ ВЫЛОЖЕНА: ${episode.project?.title}
👾${episode.number}/${total}👾
━━━━━━ ◦ ❖ ◦ ━━━━━━
Ребята, всем спасибо за работу! Серия доступна по ссылкам ниже:

➪ ➪ Аниме 365: : ${links.anime365 || ''}
➪ ➪ Телеграмм:: ${links.tg || ''}
➪ ➪ Kodik: : ${links.kodik || ''}
➪ ➪ VK: : ${links.vk || ''}
➪ ➪ Shikimori: : ${links.shikimori || ''}
━━━━━━ ◦ ❖ ◦ ━━━━━━
#${projectSlug} #готово`;
};
