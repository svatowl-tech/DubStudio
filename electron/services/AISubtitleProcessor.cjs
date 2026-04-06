const axios = require('axios');
const log = require('electron-log');

/**
 * Service for processing subtitles using AI (OpenRouter).
 * Handles batching, translation, and smart transliteration.
 */
class AISubtitleProcessor {
  /**
   * @param {string} apiKey - OpenRouter API key.
   * @param {Object} glossary - Glossary of names and terms (e.g., { "Kanji": "Cyrillic" }).
   */
  constructor(apiKey, glossary = {}) {
    this.apiKey = apiKey;
    this.glossary = glossary;
    this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
  }

  /**
   * Group subtitle lines into batches.
   * @param {Array} lines - Array of subtitle line objects.
   * @param {number} size - Batch size (default 25).
   * @returns {Array<Array>} Batches of lines.
   */
  batchLines(lines, size = 25) {
    const batches = [];
    for (let i = 0; i < lines.length; i += size) {
      batches.push(lines.slice(i, i + size));
    }
    return batches;
  }

  /**
   * Main method to process subtitles.
   * @param {Array} lines - Original subtitle lines.
   * @returns {Promise<Array>} Processed subtitle lines.
   */
  async processSubtitles(lines) {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key is missing in config.json');
    }

    const batches = this.batchLines(lines);
    const processedLines = [];

    log.info(`AISubtitleProcessor: Starting processing ${lines.length} lines in ${batches.length} batches.`);

    for (let i = 0; i < batches.length; i++) {
      log.info(`AISubtitleProcessor: Processing batch ${i + 1}/${batches.length}`);
      const translatedBatch = await this.translateBatch(batches[i]);
      processedLines.push(...translatedBatch);
    }

    return processedLines;
  }

  /**
   * Translate a batch of lines via OpenRouter.
   * @param {Array} batch - Batch of subtitle lines.
   * @returns {Promise<Array>} Translated batch.
   */
  async translateBatch(batch) {
    const glossaryStr = Object.entries(this.glossary)
      .map(([k, v]) => `${k} -> ${v}`)
      .join('\n');

    const systemPrompt = `
You are a professional anime translator and editor. 
Translate the following subtitle lines from Japanese to Russian.
Maintain the original style, tone, and character personalities.
Keep all ASS tags like {\\pos(100,100)} or {\\i1} exactly as they are in the text.
Do NOT translate or change anything inside curly braces {}.

Use the following glossary for names and terms:
${glossaryStr || 'No glossary provided.'}

Rules for translation:
1. Return ONLY the translated text for each line, one per line.
2. The number of output lines MUST exactly match the number of input lines.
3. Do not add any explanations, numbering, or extra text.
4. If a line is a name or a sign, translate it appropriately.
5. Use the Polivanov system for Japanese names if they are not in the glossary.
   - し -> си (NOT ши)
   - じ -> дзи (NOT жи)
   - ち -> ти (NOT чи)
   - つ -> цу
   - ふ -> фу
   - ん -> н (м before b, p, m)
    `;

    const userPrompt = batch.map(l => l.text).join('\n');

    try {
      const response = await axios.post(this.baseUrl, {
        model: 'openai/gpt-4o-mini', // Efficient and smart enough for subs
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://github.com/SvatOwl/anime-dub-manager',
          'X-Title': 'Anime Dub Manager'
        }
      });

      const content = response.data.choices[0].message.content.trim();
      const translatedTexts = content.split('\n').map(t => t.trim());

      if (translatedTexts.length !== batch.length) {
        log.warn(`AISubtitleProcessor: Batch size mismatch. Expected ${batch.length}, got ${translatedTexts.length}.`);
      }

      return batch.map((line, index) => {
        let text = translatedTexts[index] || line.text;
        
        // Apply Smart Transliteration as a safety pass for common errors
        return {
          ...line,
          text: this.smartTransliterate(text)
        };
      });
    } catch (error) {
      const errorData = error.response?.data || error.message;
      log.error('AISubtitleProcessor: OpenRouter API error:', errorData);
      throw new Error(`AI Translation failed: ${JSON.stringify(errorData)}`);
    }
  }

  /**
   * Smart Transliteration for Japanese names (Polivanov rules).
   * Fixes common Hepburn-isms in Cyrillic and ensures consistency.
   * @param {string} text - Translated text.
   * @returns {string} Corrected text.
   */
  smartTransliterate(text) {
    // Common Hepburn-isms in Russian that should be Polivanov
    // We use word boundaries or specific patterns to avoid breaking common Russian words
    const corrections = [
      [/\bши\b/gi, 'си'],
      [/\bжи\b/gi, 'дзи'],
      [/\bчи\b/gi, 'ти'],
      [/ши(?=[аеёиоуэюя])/gi, 'си'],
      [/жи(?=[аеёиоуэюя])/gi, 'дзи'],
      [/чи(?=[аеёиоуэюя])/gi, 'ти'],
      [/чу/gi, 'тю'],
      [/ча/gi, 'тя'],
      [/чо/gi, 'тё'],
      [/шо/gi, 'сё'],
      [/ша/gi, 'ся'],
      [/шу/gi, 'сю'],
      [/тсу/gi, 'цу'],
      [/е(?=[аеёиоуэюя])/gi, 'э'], // E -> E/E distinction in some cases
    ];

    let result = text;
    
    // First, protect glossary terms from being "corrected"
    const protectedTerms = [];
    Object.values(this.glossary).forEach((term, index) => {
      const placeholder = `__GLOSSARY_${index}__`;
      protectedTerms.push({ term, placeholder });
      result = result.split(term).join(placeholder);
    });

    for (const [regex, replacement] of corrections) {
      result = result.replace(regex, (match) => {
        // Preserve casing
        const isUpper = match === match.toUpperCase();
        const isFirstUpper = match[0] === match[0].toUpperCase();
        
        if (isUpper) return replacement.toUpperCase();
        if (isFirstUpper) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
        return replacement;
      });
    }

    // Restore glossary terms
    protectedTerms.forEach(({ term, placeholder }) => {
      result = result.split(placeholder).join(term);
    });

    return result;
  }
}

module.exports = AISubtitleProcessor;
