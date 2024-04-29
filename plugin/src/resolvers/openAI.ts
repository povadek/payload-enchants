import { chunkArray } from '../utils/chunkArray';
import type { TranslateResolver } from './types';

export type OpenAIPrompt = (args: {
  localeFrom: string;
  localeTo: string;
  texts: string[];
}) => string;

export type OpenAIResolverConfig = {
  apiKey: string;
  chunkLength?: number;
  model?: string;
  promt?: OpenAIPrompt;
};

type OpenAIResponse = {
  choices: {
    message: {
      content: string;
    };
  }[];
};

const defaultPromt: OpenAIPrompt = ({ localeFrom, localeTo, texts }) => {
  return `Translate me the following array: ${JSON.stringify(texts)} in locale=${localeFrom} to locale ${localeTo}, respond me with the same array structure`;
};

export const openAIResolver = ({
  apiKey,
  chunkLength = 100,
  model = 'gpt-3.5-turbo',
  promt = defaultPromt,
}: OpenAIResolverConfig): TranslateResolver => {
  return {
    key: 'openai',
    resolve: async ({ localeFrom, localeTo, req, texts }) => {
      const apiUrl = 'https://api.openai.com/v1/chat/completions';

      try {
        const respones: {
          data: OpenAIResponse;
          success: boolean;
        }[] = await Promise.all(
          chunkArray(texts, chunkLength).map((texts) => {
            return fetch(apiUrl, {
              body: JSON.stringify({
                messages: [
                  {
                    content: promt({ localeFrom, localeTo, texts }),
                    role: 'user',
                  },
                ],
                model,
              }),
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              method: 'post',
            }).then(async (res) => {
              const data = await res.json();

              if (!res.ok)
                req.payload.logger.info({
                  message: `An error occurred when trying to translate the data using OpenAI API`,
                  openAIresponse: data,
                });

              return {
                data,
                success: res.ok,
              };
            });
          }),
        );

        const translated: string[] = [];

        for (const { data, success } of respones) {
          if (!success)
            return {
              success: false as const,
            };

          const content = data?.choices?.[0]?.message?.content;

          if (!content) {
            req.payload.logger.info(
              `An error occurred when trying to translate the data using OpenAI API - missing content in the response`,
            );

            return {
              success: false as const,
            };
          }

          const translatedChunk: string[] = JSON.parse(content);

          if (!Array.isArray(translatedChunk)) {
            req.payload.logger.info({
              data: translatedChunk,
              message: `An error occurred when trying to translate the data using OpenAI API - parsed content is not an array`,
            });

            return {
              success: false as const,
            };
          }

          for (const text of translatedChunk) {
            if (typeof text !== 'string') {
              req.payload.logger.info({
                data: text,
                message: `An error occurred when trying to translate the data using OpenAI API - parsed content is not an array`,
              });

              return {
                success: false as const,
              };
            }

            translated.push(text);
          }
        }

        return {
          success: true as const,
          translatedTexts: translated,
        };
      } catch (e) {
        if (e instanceof Error) {
          req.payload.logger.info({
            message: `An error occurred when trying to translate the data using OpenAI API`,
            originalErr: e.message,
          });
        }

        return { success: false as const };
      }
    },
  };
};
