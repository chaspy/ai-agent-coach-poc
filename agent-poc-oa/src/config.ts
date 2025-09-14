import 'dotenv/config';
export const CONFIG = {
  port: Number(process.env.AGENT_POC_OA_PORT || 4122),
};

