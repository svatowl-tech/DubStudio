/**
 * Сервис для обращения к API Polza.ai (Main Process).
 * Формирует JSON-запрос для генерации красивого поста для Telegram/VK.
 */
class SocialMediaBot {
  constructor(apiKey) {
    this.apiKey = apiKey;
    // Пример базового URL для API Polza.ai (совместимого с OpenAI форматом)
    this.apiUrl = 'https://api.polza.ai/v1/chat/completions';
  }

  /**
   * Генерирует текст поста на основе данных о релизе.
   */
  async generateReleasePost(data) {
    const prompt = `Создай красивый, эмоциональный и вовлекающий пост для Telegram и VK о выходе новой серии в нашей студии озвучки.
    
Детали релиза:
- Название проекта: ${data.projectTitle}
- Номер серии: ${data.episodeNumber}
- Роли озвучивали: ${data.dubbers.join(', ')}

Требования:
1. Используй подходящие эмодзи (микрофоны, хлопушки, огоньки и т.д.).
2. Добавь призыв к просмотру (Call to Action).
3. Поблагодари команду даберов за работу.
4. Текст должен быть разбит на абзацы для удобного чтения.
5. Не пиши лишних вступлений (сразу выдавай готовый текст поста).`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'polza-pro',
          messages: [
            { 
              role: 'system', 
              content: 'Ты креативный и энергичный SMM-менеджер аниме-студии озвучки и фандаба.' 
            },
            { 
              role: 'user', 
              content: prompt 
            }
          ],
          temperature: 0.7,
          max_tokens: 800,
        }),
      });

      if (!response.ok) throw new Error('API Error');
      const result = await response.json();
      
      if (result.choices && result.choices.length > 0) {
        return result.choices[0].message.content.trim();
      } else {
        throw new Error('Неожиданный формат ответа от Polza.ai API');
      }
    } catch (error) {
      console.error('Ошибка при генерации поста через Polza.ai:', error);
      throw error;
    }
  }

  /**
   * Извлекает список персонажей из текста субтитров или описания.
   */
  async extractCharacters(text) {
    const prompt = `Проанализируй следующий текст (фрагмент субтитров или описание проекта) и извлеки из него список уникальных персонажей.
    
Текст для анализа:
${text.slice(0, 4000)} // Ограничиваем объем текста

Требования:
1. Верни только список имен через запятую.
2. Имена должны быть в именительном падеже.
3. Если персонаж имеет несколько имен/прозвищ, выбери основное.
4. Не пиши ничего, кроме имен.`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'polza-pro',
          messages: [
            { 
              role: 'system', 
              content: 'Ты эксперт по анализу текстов и аниме-контента.' 
            },
            { 
              role: 'user', 
              content: prompt 
            }
          ],
          temperature: 0.3,
        }),
      });

      if (!response.ok) throw new Error('API Error');
      const result = await response.json();
      
      if (result.choices && result.choices.length > 0) {
        const content = result.choices[0].message.content.trim();
        return content.split(',').map(s => s.trim()).filter(s => s.length > 0);
      }
      return [];
    } catch (error) {
      console.error('Ошибка при извлечении персонажей:', error);
      throw error;
    }
  }
}

module.exports = {
  SocialMediaBot
};
