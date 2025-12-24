import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { lucasAgent } from './agents';

export const mastra = new Mastra({
  agents: { lucasAgent },
  logger: new PinoLogger({
    name: 'Lucas',
    level: 'info',
  }),
  observability: {
    default: {
      enabled: true,
    },
  },
});