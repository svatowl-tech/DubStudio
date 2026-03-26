export interface ReleaseData {
  projectTitle: string;
  episodeNumber: number | string;
  dubbers: string[];
}

/**
 * Сервис для обращения к API Polza.ai (Main Process).
 * Формирует JSON-запрос для генерации красивого поста для Telegram/VK.
 */
export class SocialMediaBot {
  private apiKey: string;
  private apiUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    // Пример базового URL для API Polza.ai (совместимого с OpenAI форматом)
    this.apiUrl = 'https://api.polza.ai/v1/chat/completions';
  }

  /**
   * Генерирует текст поста на основе данных о релизе.
   */
  async generateReleasePost(data: ReleaseData): Promise<string> {
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
          model: 'polza-pro', // Пример названия модели Polza.ai
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

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Polza.ai API Error (${response.status}): ${errorData.error?.message || response.statusText}`);
      }

      const result = await response.json();
      
      // Возвращаем сгенерированный текст
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
}
