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
  const dubbers = episode.assignments
    .map(a => participants.find(p => p.id === a.dubberId))
    .filter(Boolean) as Participant[];
  
  const dubberMentions = dubbers.map(d => d.telegram.startsWith('@') ? d.telegram : `@${d.telegram}`).join('\n');

  return `📢 ${episode.project?.title}
👾Серия: #${episode.number}
📅 ДЕДЛАЙН: ${formatDeadline(episode.deadline)}
━━━━━━ ◦ ❖ ◦ ━━━━━━
Если вы по каким то причинам не успеваете в дедлайн и знаете об этом, напишите об этом сразу, чтобы я мог найти вам замену или распределить сабы.

В серии учавствуют:
${dubberMentions}`;
};

export const generateFixesIssuedMessage = (episode: Episode, participants: Participant[]) => {
  const assignmentsWithFixes = episode.assignments.filter(a => a.status === 'FIXES_NEEDED');
  const dubbersWithFixes = assignmentsWithFixes
    .map(a => participants.find(p => p.id === a.dubberId))
    .filter(Boolean) as Participant[];
  
  // Unique dubbers
  const uniqueDubbers = Array.from(new Set(dubbersWithFixes.map(d => d.id)))
    .map(id => dubbersWithFixes.find(d => d.id === id)!);

  const dubberSections = uniqueDubbers.map(d => {
    const mention = d.telegram.startsWith('@') ? d.telegram : `@${d.telegram}`;
    return `${mention}:\n\n\n\n`;
  }).join('\n');

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
  const pendingRoads = episode.assignments.filter(a => a.status === 'PENDING');
  const pendingFixes = episode.assignments.filter(a => a.status === 'FIXES_NEEDED');

  const roadsMentions = pendingRoads.map(a => {
    const d = participants.find(p => p.id === a.dubberId);
    if (!d) return '• Неизвестно';
    const mention = d.telegram.startsWith('@') ? d.telegram : `@${d.telegram}`;
    return `• ${mention}`;
  }).join('\n');

  const fixesMentions = pendingFixes.map(a => {
    const d = participants.find(p => p.id === a.dubberId);
    if (!d) return '• Неизвестно';
    const mention = d.telegram.startsWith('@') ? d.telegram : `@${d.telegram}`;
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
    const url = d.tgChannel || `https://t.me/${d.telegram.replace('@', '')}`;
    return `[${d.nickname}](${url})`;
  }).join(', ');

  const projectSlug = episode.project?.title.toLowerCase().replace(/\s+/g, '_') || 'project';
  const total = episode.project?.totalEpisodes || 12;

  return `${episode.project?.title}
👾${episode.number}/${total}👾

━━━━━━ ◦ ❖ ◦ ━━━━━━
Роли озвучили:
 
${dubberLinks}

Тайминг и работа со звуком: 
@Tenmag
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

  return `${episode.project?.title}
👾${episode.number}/${total}👾

| Роли озвучили: ${dubberInfo}

| Тайминг и работа со звуком: @Tenmag

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
