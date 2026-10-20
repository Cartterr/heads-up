// Maps an agent's hook payload to [debounce key, heads-up text]. Add one function per agent; anything else can
// simply call `heads-up "text"` from a shell.

/** Claude Code hook JSON (PreToolUse / Notification) -> [key, text]. */
export function claudeCode(h) {
  const tool = h.tool_name ?? '', action = h.tool_input?.action;
  if (h.hook_event_name === 'Notification') return ['need', 'The agent needs you: ' + (h.message ?? 'attention please')];
  if (tool === 'AskUserQuestion') return ['need', 'The agent is asking you a question and needs an answer'];
  if (/screenshot|snapshot/i.test(tool) || action === 'screenshot') return ['screen', 'About to take a screenshot of your screen'];
  if (/gif_creator|record/i.test(tool)) return ['screen', 'About to record your screen'];
  return ['screen', 'About to take over your mouse and keyboard to use the computer'];
}

export const adapters = { 'claude-code': claudeCode };
