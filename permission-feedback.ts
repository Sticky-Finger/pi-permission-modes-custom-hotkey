/**
 * Shared helpers for the "No, and tell the agent what to do differently"
 * permission-feedback option.
 *
 * The option is appended to the end of every permission selector. Picking it
 * opens pi's native inline editor so the user can type what the agent should
 * do differently; the text is attached to the denial reason, which pi hands
 * back to the model as the tool error — the model therefore sees both the
 * rejection and the requested change.
 *
 * Pure text helpers only (no UI, no pi imports) so they stay unit-testable.
 */

/** Option label shown in the permission selectors (agent-facing default). */
export const FEEDBACK_OPTION_LABEL =
	"No, and tell the agent what to do differently";

/** Hard cap for the feedback text (characters). */
export const MAX_FEEDBACK_CHARS = 1000;

/** "No, and tell <target> what to do differently" (falls back to the default). */
export function buildFeedbackOptionLabel(target?: string): string {
	const who = target?.trim();
	if (!who) return FEEDBACK_OPTION_LABEL;
	return `No, and tell ${who} what to do differently`;
}

/** Title of the native feedback editor prompt. */
export function buildFeedbackPromptTitle(tool: string, target?: string): string {
	const who = target?.trim();
	return who
		? `Tell ${who} how to proceed with ${tool}:`
		: `Tell the agent how to proceed with ${tool}:`;
}

/** Collapse whitespace runs, trim, and cap the length. */
export function sanitizeFeedback(raw: string | undefined | null): string {
	if (!raw) return "";
	const collapsed = raw.replace(/\s+/g, " ").trim();
	return collapsed.length > MAX_FEEDBACK_CHARS
		? collapsed.slice(0, MAX_FEEDBACK_CHARS)
		: collapsed;
}

/**
 * Attach the user's feedback to a denial reason.
 * Empty or cancelled feedback keeps the plain denial reason unchanged
 * (fail-closed: an empty answer must never look like an approval).
 */
export function buildFeedbackDenialReason(
	baseReason: string,
	feedback: string | undefined | null,
): string {
	const clean = sanitizeFeedback(feedback);
	if (!clean) return baseReason;
	return `${baseReason}. User feedback: ${clean}`;
}
