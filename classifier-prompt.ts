/**
 * CC-style auto-mode classifier system prompt assembly.
 * Prompt text from Claude Code yolo-classifier-prompts (external build).
 */

import basePromptText from "./classifier-prompts/auto_mode_system_prompt.txt?raw"
import permissionsTemplateText from "./classifier-prompts/permissions_external.txt?raw"

export type AutoModeRules = {
	allow?: string[]
	soft_deny?: string[]
	environment?: string[]
}

export function getBaseClassifierPrompt(): string {
	return basePromptText
}

export function getExternalPermissionsTemplate(): string {
	return permissionsTemplateText
}

const CC_TOOL_OUTPUT_LINE =
	"Use the classify_result tool to report your classification."

const PI_JSON_OUTPUT = `## Output Format

Reply with a single JSON object only — no markdown fences, no prose before or after.
Required shape: {"thinking": string, "shouldBlock": boolean, "reason": string}
- shouldBlock=false → ALLOW (auto-approve the pending tool call)
- shouldBlock=true → BLOCK (require explicit user confirmation)
Keep thinking brief. Keep reason under one sentence.`

function extractTaggedBullets(tagName: string, template: string): string[] {
	const match = template.match(
		new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`),
	)
	if (!match) return []
	return (match[1] ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.map((line) => line.slice(2))
}

export function getDefaultAutoModeRules(): AutoModeRules {
	const template = getExternalPermissionsTemplate()
	return {
		allow: extractTaggedBullets("user_allow_rules_to_replace", template),
		soft_deny: extractTaggedBullets("user_deny_rules_to_replace", template),
		environment: extractTaggedBullets(
			"user_environment_to_replace",
			template,
		),
	}
}

function formatRuleBullets(rules: string[] | undefined): string | undefined {
	if (!rules?.length) return undefined
	return rules.map((r) => `- ${r}`).join("\n")
}

/**
 * Assemble the CC external auto-mode classifier system prompt.
 * User rules in autoMode REPLACE the tagged defaults (external template semantics).
 */
export function buildClassifierSystemPrompt(
	autoMode?: AutoModeRules,
): string {
	const systemPrompt = getBaseClassifierPrompt()
		.replace("<permissions_template>", () => getExternalPermissionsTemplate())
		.replace(CC_TOOL_OUTPUT_LINE, PI_JSON_OUTPUT)

	const userAllow = formatRuleBullets(autoMode?.allow)
	const userDeny = formatRuleBullets(autoMode?.soft_deny)
	const userEnvironment = formatRuleBullets(autoMode?.environment)

	return systemPrompt
		.replace(
			/<user_allow_rules_to_replace>([\s\S]*?)<\/user_allow_rules_to_replace>/,
			(_m, defaults: string) => userAllow ?? defaults,
		)
		.replace(
			/<user_deny_rules_to_replace>([\s\S]*?)<\/user_deny_rules_to_replace>/,
			(_m, defaults: string) => userDeny ?? defaults,
		)
		.replace(
			/<user_environment_to_replace>([\s\S]*?)<\/user_environment_to_replace>/,
			(_m, defaults: string) => userEnvironment ?? defaults,
		)
}
