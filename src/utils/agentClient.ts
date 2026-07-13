import axios, { AxiosInstance } from 'axios';
import { IAgent } from '../models/Agent';
import { config } from '../config';

type AgentLike = Pick<IAgent, 'base_url'> | null | undefined;

/** Resolve the base URL for an agent: its own `base_url` when set, else the
 *  global `AGENT_BASE_URL` (dev-mode fallback for a single localhost agent). */
export function agentBaseUrl(agent: AgentLike): string {
  const url = (agent?.base_url || config.agent.baseUrl).trim();
  return url.replace(/\/+$/, '');
}

/** Pre-configured axios instance for one agent. Every backend→agent call must
 *  go through this — never read `config.agent.baseUrl` at a call site. Sends
 *  the shared secret (`AGENT_SHARED_KEY`) as `X-Agent-Key` when configured;
 *  the agent (or its fronting nginx) rejects requests without it. Per-call
 *  timeouts are passed as usual in the request options. */
export function agentClient(agent: AgentLike): AxiosInstance {
  const headers: Record<string, string> = {};
  if (config.agent.sharedKey) {
    headers['X-Agent-Key'] = config.agent.sharedKey;
  }
  return axios.create({ baseURL: agentBaseUrl(agent), headers });
}
