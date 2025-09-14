import 'dotenv/config';

export const CONFIG = {
  port: Number(process.env.AGENT_POC_PORT || 4120),
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
};

