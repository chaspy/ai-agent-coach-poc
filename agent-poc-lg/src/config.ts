import 'dotenv/config';
export const CONFIG = {
  port: Number(process.env.AGENT_POC_LG_PORT || 4121),
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
};

